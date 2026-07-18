import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranscriptEntry } from 'src/shared/types';
import type { SnapshotFile } from './event';
import { EventStore, MAX_QUEUED_SESSION_MESSAGES } from './event-store';

const originalRuntimeProfile = process.env.MIKO_RUNTIME_PROFILE;
const tempDirs: string[] = [];

afterEach(async () => {
	if (originalRuntimeProfile === undefined) {
		delete process.env.MIKO_RUNTIME_PROFILE;
	} else {
		process.env.MIKO_RUNTIME_PROFILE = originalRuntimeProfile;
	}

	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDataDir() {
	const dir = await mkdtemp(join(tmpdir(), 'miko-event-store-'));
	tempDirs.push(dir);
	return dir;
}

function entry(
	kind: TranscriptEntry['kind'],
	createdAt: number,
	extra: Record<string, unknown> = {},
): TranscriptEntry {
	const base = { _id: `${kind}-${createdAt}`, createdAt };
	if (kind === 'user_prompt') {
		return { ...base, ...extra, kind, content: String(extra.content ?? '') } as TranscriptEntry;
	}
	if (kind === 'assistant_text') {
		return {
			...base,
			...extra,
			kind,
			text: String(extra.content ?? extra.text ?? ''),
		} as TranscriptEntry;
	}
	return { ...base, kind, ...extra } as TranscriptEntry;
}

async function createReadyWorkspace(store: EventStore) {
	const directory = await store.addDirectory({
		localPath: '/tmp/miko',
		title: 'Miko',
		githubOwner: 'sarp',
		githubRepo: 'miko',
	});
	const workspace = await store.createWorkspace({
		directoryId: directory.id,
		localPath: '/tmp/miko/atlas',
		branchName: 'atlas',
	});
	await store.markWorkspaceSetupCompleted(workspace.id);
	return { directory, workspace: store.requireWorkspace(workspace.id) };
}

describe('EventStore.constructor', () => {
	test('uses the runtime profile for the default data dir', () => {
		process.env.MIKO_RUNTIME_PROFILE = 'dev';
		const store = new EventStore();

		expect(store.dataDir).toEndWith('/.miko-dev/data');
	});
});

describe('EventStore.initialize', () => {
	test('creates data dir, transcripts subdir, and empty log files', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		expect(existsSync(store.dataDir)).toBe(true);
		expect(existsSync(join(dataDir, 'transcripts'))).toBe(true);
		expect(existsSync(join(dataDir, 'directories.jsonl'))).toBe(true);
		expect(existsSync(join(dataDir, 'workspaces.jsonl'))).toBe(true);
		expect(existsSync(join(dataDir, 'sessions.jsonl'))).toBe(true);
		expect(existsSync(join(dataDir, 'turns.jsonl'))).toBe(true);
		expect(existsSync(join(dataDir, 'queues.jsonl'))).toBe(true);
		expect((await stat(dataDir)).mode & 0o777).toBe(0o700);
		expect((await stat(join(dataDir, 'directories.jsonl'))).mode & 0o777).toBe(0o600);
	});

	test('holds the optional data-directory lock until explicitly released', async () => {
		const dataDir = await createTempDataDir();
		const first = new EventStore(dataDir, { lockDataDir: true });
		await first.initialize();
		const second = new EventStore(dataDir, { lockDataDir: true });

		await expect(second.initialize()).rejects.toThrow('Miko is already using');

		await first.releaseDataDirLock();
		await second.initialize();
		await second.releaseDataDirLock();
	});

	test('ignores corrupt trailing log lines while preserving prior events', async () => {
		const dataDir = await createTempDataDir();
		const warn = spyOn(console, 'warn').mockImplementation(() => {});
		const directoryEvent = {
			type: 'directory_added',
			timestamp: 100,
			directoryId: 'directory-1',
			localPath: '/tmp/miko',
			title: 'Miko',
			githubOwner: 'sarp',
			githubRepo: 'miko',
			defaultBranchName: 'main',
		};

		await Bun.write(
			join(dataDir, 'directories.jsonl'),
			`${JSON.stringify(directoryEvent)}\n{not json`,
		);

		try {
			const store = new EventStore(dataDir);
			await store.initialize();

			expect(store.getDirectory('directory-1')).toMatchObject({
				id: 'directory-1',
				localPath: '/tmp/miko',
				title: 'Miko',
			});
			expect(await Bun.file(join(dataDir, 'directories.jsonl')).text()).toContain(
				'directory_added',
			);
		} finally {
			warn.mockRestore();
		}
	});

	test('quarantines corrupt logs and preserves every valid event', async () => {
		const dataDir = await createTempDataDir();
		const warn = spyOn(console, 'warn').mockImplementation(() => {});
		await mkdir(join(dataDir, 'transcripts'), { recursive: true });
		await Bun.write(join(dataDir, 'transcripts', 'orphan.jsonl'), '{"kind":"user_prompt"}\n');
		const firstEvent = {
			type: 'directory_added',
			timestamp: 100,
			directoryId: 'directory-1',
			localPath: '/tmp/miko',
			title: 'Miko',
			githubOwner: 'sarp',
			githubRepo: 'miko',
			defaultBranchName: 'main',
		};
		const secondEvent = {
			type: 'directory_added',
			timestamp: 101,
			directoryId: 'directory-2',
			localPath: '/tmp/other',
			title: 'Other',
			githubOwner: 'sarp',
			githubRepo: 'other',
			defaultBranchName: 'main',
		};

		await Bun.write(
			join(dataDir, 'directories.jsonl'),
			`${JSON.stringify(firstEvent)}\n{not json\n${JSON.stringify(secondEvent)}\n`,
		);

		try {
			const store = new EventStore(dataDir);
			await store.initialize();

			expect(store.listDirectories().map((directory) => directory.id)).toEqual([
				'directory-1',
				'directory-2',
			]);
			expect(await Bun.file(join(dataDir, 'directories.jsonl')).text()).not.toContain('{not json');
			expect(await Bun.file(join(dataDir, 'workspaces.jsonl')).text()).toBe('');
			expect(await Bun.file(join(dataDir, 'sessions.jsonl')).text()).toBe('');
			expect(await Bun.file(join(dataDir, 'turns.jsonl')).text()).toBe('');
			expect(await Bun.file(join(dataDir, 'transcripts', 'orphan.jsonl')).text()).toBe(
				'{"kind":"user_prompt"}\n',
			);
			expect(
				(await readdir(dataDir)).some((name) => name.startsWith('directories.jsonl.corrupt-')),
			).toBe(true);
		} finally {
			warn.mockRestore();
		}
	});
});

describe('EventStore.addDirectory', () => {
	test('continues accepting writes after a transient write failure', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const paths = store as unknown as { directoriesLogPath: string };

		await rm(paths.directoriesLogPath, { force: true });
		await mkdir(paths.directoriesLogPath);

		await expect(
			store.addDirectory({
				localPath: '/tmp/broken',
				githubOwner: 'sarp',
				githubRepo: 'broken',
			}),
		).rejects.toThrow();

		await rm(paths.directoriesLogPath, { recursive: true, force: true });
		await Bun.write(paths.directoriesLogPath, '');

		const directory = await store.addDirectory({
			localPath: '/tmp/miko',
			githubOwner: 'sarp',
			githubRepo: 'miko',
		});

		expect(directory).toMatchObject({ localPath: '/tmp/miko', githubRepo: 'miko' });
		expect(store.listDirectories().map((candidate) => candidate.id)).toEqual([directory.id]);
	});

	test('deduplicates active directories by normalized path and reopens after removal', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const first = await store.addDirectory({
			localPath: '/tmp/miko',
			title: 'Custom',
			githubOwner: 'sarp',
			githubRepo: 'miko',
		});
		const second = await store.addDirectory({
			localPath: '/tmp/miko',
			title: 'Ignored',
			githubOwner: 'sarp',
			githubRepo: 'miko',
		});

		expect(second.id).toBe(first.id);
		expect(second.title).toBe('Custom');
		expect(store.listDirectories().map((directory) => directory.id)).toEqual([first.id]);

		await store.removeDirectory(first.id);

		expect(store.getDirectory(first.id)).toBeNull();
		expect(store.listDirectories()).toEqual([]);

		const reopened = await store.addDirectory({
			localPath: '/tmp/miko',
			title: 'Reopened',
			githubOwner: 'sarp',
			githubRepo: 'miko',
		});
		expect(reopened.id).not.toBe(first.id);
		expect(reopened.title).toBe('Reopened');
	});
});

describe('EventStore.createWorkspace', () => {
	test('creates workspaces in creating state and blocks duplicate paths or branches', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const directory = await store.addDirectory({
			localPath: '/tmp/miko',
			githubOwner: 'sarp',
			githubRepo: 'miko',
		});

		const workspace = await store.createWorkspace({
			directoryId: directory.id,
			localPath: '/tmp/miko/atlas',
			branchName: 'atlas',
		});

		expect(workspace).toMatchObject({
			directoryId: directory.id,
			localPath: '/tmp/miko/atlas',
			branchName: 'atlas',
			setupState: 'creating',
			reviewState: 'in_progress',
			visibilityState: 'active',
			hasUnreadAgentResult: false,
		});
		await expect(
			store.createWorkspace({
				directoryId: directory.id,
				localPath: '/tmp/miko/atlas',
				branchName: 'orion',
			}),
		).rejects.toThrow('Workspace path is already in use');
		await expect(
			store.createWorkspace({
				directoryId: directory.id,
				localPath: '/tmp/miko/orion',
				branchName: 'atlas',
			}),
		).rejects.toThrow('Workspace branch is already in use for this directory');
	});

	test('updates workspace lifecycle, review, visibility, PR, unread, branch, and removal state', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);

		await store.setWorkspaceBranch(workspace.id, 'orion');
		await store.setWorkspaceReviewState(workspace.id, 'in_review');
		await store.setWorkspaceVisibilityState(workspace.id, 'archived');
		await store.observeWorkspacePullRequest(workspace.id, {
			number: 12,
			status: 'open',
			title: 'Add workspace model',
			url: 'https://github.com/sarp/miko/pull/12',
			headRefName: 'orion',
			baseRefName: 'main',
			ciStatus: 'passing',
			lastObservedAt: 100,
		});
		await store.setWorkspaceUnreadAgentResult(workspace.id, true);

		expect(store.getWorkspace(workspace.id)).toMatchObject({
			setupState: 'ready',
			branchName: 'orion',
			reviewState: 'in_review',
			visibilityState: 'archived',
			hasUnreadAgentResult: true,
			pullRequest: { number: 12, status: 'open', ciStatus: 'passing' },
		});

		await store.clearWorkspacePullRequest(workspace.id);
		expect(store.getWorkspace(workspace.id)?.pullRequest).toBeUndefined();

		await store.removeWorkspace(workspace.id);
		expect(store.getWorkspace(workspace.id)).toBeNull();
		expect(store.listWorkspaces()).toEqual([]);
	});

	test('persists PR observations when only the PR file list changes', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);

		const basePullRequest = {
			number: 12,
			status: 'open' as const,
			title: 'Add workspace model',
			url: 'https://github.com/sarp/miko/pull/12',
			headRefName: 'orion',
			baseRefName: 'main',
			ciStatus: 'passing' as const,
			lastObservedAt: 100,
		};

		await store.observeWorkspacePullRequest(workspace.id, {
			...basePullRequest,
			files: [
				{
					path: 'README.md',
					changeType: 'modified',
					isUntracked: false,
					additions: 1,
					deletions: 0,
					patchDigest: 'digest-1',
				},
			],
		});
		await store.observeWorkspacePullRequest(workspace.id, {
			...basePullRequest,
			lastObservedAt: 200,
			files: [
				{
					path: 'README.md',
					changeType: 'modified',
					isUntracked: false,
					additions: 2,
					deletions: 0,
					patchDigest: 'digest-2',
				},
			],
		});

		expect(store.getWorkspace(workspace.id)?.pullRequest?.files).toEqual([
			{
				path: 'README.md',
				changeType: 'modified',
				isUntracked: false,
				additions: 2,
				deletions: 0,
				patchDigest: 'digest-2',
			},
		]);
	});

	test('removing a workspace deletes Miko-owned workspace data but leaves the worktree untouched', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);
		await store.appendMessage(session.id, entry('user_prompt', 100, { content: 'hello' }));

		const uploadDir = join(dataDir, 'uploads', workspace.id);
		const scratchpadPath = join(dataDir, 'scratchpads', `${workspace.id}.md`);
		const instructionPath = join(dataDir, 'agent-instructions', `create-pr-${workspace.id}.md`);
		const worktreeFilePath = join(workspace.localPath, 'README.md');
		await mkdir(uploadDir, { recursive: true });
		await mkdir(join(dataDir, 'scratchpads'), { recursive: true });
		await mkdir(join(dataDir, 'agent-instructions'), { recursive: true });
		await mkdir(workspace.localPath, { recursive: true });
		await Bun.write(join(uploadDir, 'paste.txt'), 'pasted text');
		await Bun.write(scratchpadPath, 'scratchpad');
		await Bun.write(instructionPath, 'instructions');
		await Bun.write(worktreeFilePath, 'repo data');

		const transcriptPath = join(dataDir, 'transcripts', `${session.id}.jsonl`);
		expect(existsSync(transcriptPath)).toBe(true);

		await store.removeWorkspace(workspace.id);

		expect(store.getWorkspace(workspace.id)).toBeNull();
		expect(store.getSession(session.id)).toBeNull();
		expect(existsSync(transcriptPath)).toBe(false);
		expect(existsSync(uploadDir)).toBe(false);
		expect(existsSync(scratchpadPath)).toBe(false);
		expect(existsSync(instructionPath)).toBe(false);
		expect(existsSync(worktreeFilePath)).toBe(true);
	});

	test('records setup failures and lets setup completion clear the error', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const directory = await store.addDirectory({
			localPath: '/tmp/miko',
			githubOwner: 'sarp',
			githubRepo: 'miko',
		});
		const workspace = await store.createWorkspace({
			directoryId: directory.id,
			localPath: '/tmp/miko/atlas',
			branchName: 'atlas',
		});

		await store.markWorkspaceSetupFailed(workspace.id, 'worktree failed');
		expect(store.getWorkspace(workspace.id)).toMatchObject({
			setupState: 'failed',
			setupError: 'worktree failed',
		});

		await store.markWorkspaceSetupCompleted(workspace.id);
		expect(store.getWorkspace(workspace.id)).toMatchObject({
			setupState: 'ready',
			setupError: undefined,
		});
	});
});

describe('EventStore.createSession', () => {
	test('creates, renames, removes, and lists sessions by workspace', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);

		const session = await store.createSession(workspace.id);

		expect(session.title).toBe('Untitled');
		expect(store.listSessionsByWorkspace(workspace.id).map((candidate) => candidate.id)).toEqual([
			session.id,
		]);

		await store.renameSession(session.id, '   ');
		expect(store.getSession(session.id)?.title).toBe('Untitled');

		await store.renameSession(session.id, '  Better Session  ');
		expect(store.getSession(session.id)?.title).toBe('Better Session');

		await store.removeSession(session.id);

		expect(store.getSession(session.id)).toBeNull();
		expect(store.listSessionsByWorkspace(workspace.id)).toEqual([]);
		expect(() => store.requireSession(session.id)).toThrow('Session not found');
	});

	test('rejects session creation before workspace setup is ready', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const directory = await store.addDirectory({
			localPath: '/tmp/miko',
			githubOwner: 'sarp',
			githubRepo: 'miko',
		});
		const workspace = await store.createWorkspace({
			directoryId: directory.id,
			localPath: '/tmp/miko/atlas',
			branchName: 'atlas',
		});

		await expect(store.createSession(workspace.id)).rejects.toThrow('Workspace is not ready');
	});

	test('persists provider, plan mode, and session token across store instances', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);

		await store.setSessionProvider(session.id, 'codex');
		await store.setPlanMode(session.id, true);
		await store.setSessionToken(session.id, 'session-1');

		const reloaded = new EventStore(dataDir);
		await reloaded.initialize();

		expect(reloaded.getSession(session.id)).toMatchObject({
			provider: 'codex',
			planMode: true,
			sessionToken: 'session-1',
		});

		await reloaded.setSessionToken(session.id, null);

		const reloadedAfterClear = new EventStore(dataDir);
		await reloadedAfterClear.initialize();
		expect(reloadedAfterClear.getSession(session.id)?.sessionToken).toBeNull();
	});
});

describe('EventStore.appendMessage', () => {
	test('appends transcript entries to per-session jsonl files and reloads them', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);
		const userEntry = entry('user_prompt', 100, { content: 'hello' });
		const assistantEntry = entry('assistant_text', 101, { content: 'world' });

		await store.appendMessage(session.id, userEntry);
		await store.appendMessage(session.id, assistantEntry);

		expect(store.getMessages(session.id)).toEqual([userEntry, assistantEntry]);

		const transcriptPath = join(dataDir, 'transcripts', `${session.id}.jsonl`);
		const transcriptText = await Bun.file(transcriptPath).text();
		expect(transcriptText).toContain('"kind":"user_prompt"');
		expect(transcriptText).toContain('"kind":"assistant_text"');

		const reloaded = new EventStore(dataDir);
		await reloaded.initialize();
		expect(reloaded.getMessages(session.id)).toEqual([userEntry, assistantEntry]);
		expect(reloaded.getSession(session.id)).toMatchObject({
			lastMessageAt: 101,
			lastAssistantPreview: 'world',
		});
	});

	test('stores a collapsed bounded preview of the latest assistant text', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);

		await store.appendMessage(
			session.id,
			entry('assistant_text', 100, {
				text: `  ${'write sidebar hover card '.repeat(12)}  `,
			}),
		);

		const preview = store.getSession(session.id)?.lastAssistantPreview;
		expect(preview).toBeDefined();
		expect(preview?.endsWith('…')).toBe(true);
		expect(preview?.length).toBeLessThanOrEqual(140);
		expect(preview).not.toContain('\n');
	});

	test('protects stored transcript entries from caller mutations', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);
		const original = entry('user_prompt', 100, { content: 'hello' });
		await store.appendMessage(session.id, original);

		const messages = store.getMessages(session.id);
		if (messages[0]?.kind === 'user_prompt') {
			messages[0].content = 'mutated';
		}
		messages.push(entry('assistant_text', 101, { content: 'extra' }));

		expect(store.getMessages(session.id)).toEqual([original]);

		const page = store.getRecentMessagesPage(session.id, 1);
		if (page.messages[0]?.kind === 'user_prompt') {
			page.messages[0].content = 'page-mutated';
		}

		expect(store.getRecentMessagesPage(session.id, 1).messages).toEqual([original]);
	});

	test('deep-clones nested transcript fields written to and read from the cache', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);
		const original = entry('user_prompt', 100, {
			content: 'hello',
			attachments: [
				{
					id: 'attachment-1',
					kind: 'file',
					displayName: 'notes.txt',
					absolutePath: '/tmp/notes.txt',
					relativePath: 'notes.txt',
					contentUrl: '/content/notes.txt',
					mimeType: 'text/plain',
					size: 12,
				},
			],
		});

		await store.appendMessage(session.id, original);
		if (original.kind === 'user_prompt' && original.attachments?.[0]) {
			original.attachments[0].displayName = 'mutated.txt';
		}

		const messages = store.getMessages(session.id);
		if (messages[0]?.kind === 'user_prompt' && messages[0].attachments?.[0]) {
			expect(messages[0].attachments[0].displayName).toBe('notes.txt');
			messages[0].attachments[0].displayName = 'read-mutated.txt';
		}

		const freshMessages = store.getMessages(session.id);
		expect(
			freshMessages[0]?.kind === 'user_prompt'
				? freshMessages[0].attachments?.[0]?.displayName
				: undefined,
		).toBe('notes.txt');
	});

	test('ignores corrupt trailing transcript lines while preserving earlier entries', async () => {
		const dataDir = await createTempDataDir();
		const warn = spyOn(console, 'warn').mockImplementation(() => {});
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);
		const userEntry = entry('user_prompt', 100, { content: 'hello' });
		await store.appendMessage(session.id, userEntry);
		const transcriptPath = join(dataDir, 'transcripts', `${session.id}.jsonl`);
		await Bun.write(transcriptPath, `${await Bun.file(transcriptPath).text()}{not json`);

		try {
			const reloaded = new EventStore(dataDir);
			await reloaded.initialize();

			expect(reloaded.getMessages(session.id)).toEqual([userEntry]);
			expect(reloaded.getSession(session.id)?.lastMessageAt).toBe(100);
		} finally {
			warn.mockRestore();
		}
	});
});

describe('EventStore.getRecentMessagesPage', () => {
	test('paginates transcript history from newest to oldest', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);

		for (let index = 1; index <= 5; index++) {
			await store.appendMessage(
				session.id,
				entry(index % 2 === 0 ? 'assistant_text' : 'user_prompt', 200 + index, {
					content: `message-${index}`,
				}),
			);
		}

		const recentPage = store.getRecentMessagesPage(session.id, 2);
		expect(recentPage.messages.map((message) => message._id)).toEqual([
			'assistant_text-204',
			'user_prompt-205',
		]);
		expect(recentPage.hasOlder).toBe(true);
		expect(recentPage.olderCursor).not.toBeNull();

		const recentCursor = recentPage.olderCursor;
		if (recentCursor === null) {
			throw new Error('Expected recent page to include an older cursor');
		}

		const olderPage = store.getMessagesPageBefore(session.id, recentCursor, 2);
		expect(olderPage.messages.map((message) => message._id)).toEqual([
			'assistant_text-202',
			'user_prompt-203',
		]);
		expect(olderPage.hasOlder).toBe(true);
		expect(olderPage.olderCursor).not.toBeNull();

		const olderCursor = olderPage.olderCursor;
		if (olderCursor === null) {
			throw new Error('Expected older page to include an older cursor');
		}

		const oldestPage = store.getMessagesPageBefore(session.id, olderCursor, 2);
		expect(oldestPage.messages.map((message) => message._id)).toEqual(['user_prompt-201']);
		expect(oldestPage.hasOlder).toBe(false);
		expect(oldestPage.olderCursor).toBeNull();
	});

	test('handles empty, zero-limit, and invalid transcript page requests', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);

		expect(store.getRecentMessagesPage(session.id, 10)).toEqual({
			messages: [],
			hasOlder: false,
			olderCursor: null,
		});
		expect(store.getRecentMessagesPage(session.id, 0)).toEqual({
			messages: [],
			hasOlder: false,
			olderCursor: null,
		});
		expect(store.getMessagesPageBefore(session.id, 'idx:0', 0)).toEqual({
			messages: [],
			hasOlder: false,
			olderCursor: null,
		});

		expect(() => store.getMessagesPageBefore(session.id, 'bad', 10)).toThrow(
			'Invalid history cursor',
		);
		expect(() => store.getMessagesPageBefore(session.id, 'idx:bad', 10)).toThrow(
			'Invalid history cursor',
		);
		expect(() => store.getMessagesPageBefore(session.id, 'idx:-1', 10)).toThrow(
			'Invalid history cursor',
		);
	});
});

describe('EventStore.recordTurnFinished', () => {
	test('marks workspace unread on completed and failed turns and records session outcomes', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);

		expect(store.getSession(session.id)).toMatchObject({ lastTurnOutcome: null });
		expect(store.getWorkspace(workspace.id)?.hasUnreadAgentResult).toBe(false);

		await store.recordTurnStarted(session.id);
		expect(store.getSession(session.id)?.lastTurnOutcome).toBeNull();

		await store.recordTurnFinished(session.id);
		expect(store.getSession(session.id)?.lastTurnOutcome).toBe('success');
		expect(store.getWorkspace(workspace.id)?.hasUnreadAgentResult).toBe(true);

		await store.setWorkspaceUnreadAgentResult(workspace.id, false);
		expect(store.getWorkspace(workspace.id)?.hasUnreadAgentResult).toBe(false);

		await store.recordTurnCancelled(session.id);
		expect(store.getSession(session.id)?.lastTurnOutcome).toBe('cancelled');
		expect(store.getWorkspace(workspace.id)?.hasUnreadAgentResult).toBe(false);

		await store.recordTurnFailed(session.id, 'boom');
		expect(store.getSession(session.id)?.lastTurnOutcome).toBe('failed');
		expect(store.getWorkspace(workspace.id)?.hasUnreadAgentResult).toBe(true);

		const reloaded = new EventStore(dataDir);
		await reloaded.initialize();
		expect(reloaded.getSession(session.id)?.lastTurnOutcome).toBe('failed');
		expect(reloaded.getWorkspace(workspace.id)?.hasUnreadAgentResult).toBe(true);
	});
});

describe('EventStore.listWorkspaces', () => {
	test('hides workspaces when their directory is removed', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { directory, workspace } = await createReadyWorkspace(store);

		expect(store.listWorkspaces().map((candidate) => candidate.id)).toEqual([workspace.id]);

		await store.removeDirectory(directory.id);

		expect(store.getWorkspace(workspace.id)).toBeNull();
		expect(store.listWorkspaces()).toEqual([]);
	});

	test('removing a directory deletes Miko-owned data for its workspaces', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { directory, workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);
		await store.appendMessage(session.id, entry('user_prompt', 100, { content: 'hello' }));

		const uploadDir = join(dataDir, 'uploads', workspace.id);
		await mkdir(uploadDir, { recursive: true });
		await Bun.write(join(uploadDir, 'attachment.txt'), 'attachment');

		await store.removeDirectory(directory.id);

		expect(store.getDirectory(directory.id)).toBeNull();
		expect(store.getWorkspace(workspace.id)).toBeNull();
		expect(store.getSession(session.id)).toBeNull();
		expect(existsSync(join(dataDir, 'transcripts', `${session.id}.jsonl`))).toBe(false);
		expect(existsSync(uploadDir)).toBe(false);
	});
});

describe('EventStore.compact', () => {
	test('drops removed records from the snapshot', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { directory, workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);

		await store.removeWorkspace(workspace.id);
		await store.compact();

		const snapshot = JSON.parse(
			await Bun.file(join(dataDir, 'snapshot.json')).text(),
		) as SnapshotFile;
		expect(snapshot.directories.map((candidate) => candidate.id)).toEqual([directory.id]);
		expect(snapshot.workspaces).toEqual([]);
		expect(snapshot.sessions).toEqual([]);

		const reloaded = new EventStore(dataDir);
		await reloaded.initialize();
		expect(reloaded.getDirectory(directory.id)?.title).toBe('Miko');
		expect(reloaded.getWorkspace(workspace.id)).toBeNull();
		expect(reloaded.getSession(session.id)).toBeNull();
	});

	test('replaying a removal event for an entity missing from the snapshot is a no-op', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		await store.compact();

		// Simulate a crash between snapshot write and log truncation: a stale
		// removal event for an entity the snapshot no longer knows about.
		await Bun.write(
			join(dataDir, 'workspaces.jsonl'),
			`${JSON.stringify({ type: 'workspace_removed', timestamp: Date.now(), workspaceId: 'ghost' })}\n`,
		);

		const reloaded = new EventStore(dataDir);
		await reloaded.initialize();
		expect(reloaded.getWorkspace(workspace.id)).toMatchObject({ setupState: 'ready' });
		expect(reloaded.getWorkspace('ghost')).toBeNull();
	});

	test('compacts logs into a snapshot and reloads state without transcript loss', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { directory, workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);
		const userEntry = entry('user_prompt', 100, { content: 'hello' });
		const assistantEntry = entry('assistant_text', 101, { content: 'world' });

		await store.setSessionProvider(session.id, 'codex');
		await store.setPlanMode(session.id, true);
		await store.setSessionToken(session.id, 'session-1');
		await store.appendMessage(session.id, userEntry);
		await store.appendMessage(session.id, assistantEntry);
		await store.recordTurnFinished(session.id);
		await store.compact();

		expect(await Bun.file(join(dataDir, 'directories.jsonl')).text()).toBe('');
		expect(await Bun.file(join(dataDir, 'workspaces.jsonl')).text()).toBe('');
		expect(await Bun.file(join(dataDir, 'sessions.jsonl')).text()).toBe('');
		expect(await Bun.file(join(dataDir, 'turns.jsonl')).text()).toBe('');

		const snapshot = JSON.parse(
			await Bun.file(join(dataDir, 'snapshot.json')).text(),
		) as SnapshotFile & {
			messages?: unknown;
		};
		expect(snapshot.directories.map((candidate) => candidate.id)).toEqual([directory.id]);
		expect(snapshot.workspaces.map((candidate) => candidate.id)).toEqual([workspace.id]);
		expect(snapshot.sessions.map((candidate) => candidate.id)).toEqual([session.id]);
		expect(snapshot.sessions[0]).toMatchObject({
			provider: 'codex',
			planMode: true,
			sessionToken: 'session-1',
			lastTurnOutcome: 'success',
		});
		expect(snapshot.workspaces[0]).toMatchObject({ hasUnreadAgentResult: true });
		expect(snapshot.messages).toBeUndefined();

		const reloaded = new EventStore(dataDir);
		await reloaded.initialize();

		expect(reloaded.getDirectory(directory.id)?.title).toBe('Miko');
		expect(reloaded.getWorkspace(workspace.id)).toMatchObject({ setupState: 'ready' });
		expect(reloaded.getSession(session.id)).toMatchObject({
			provider: 'codex',
			planMode: true,
			sessionToken: 'session-1',
		});
		expect(reloaded.getMessages(session.id)).toEqual([userEntry, assistantEntry]);
	});

	test('recovers the previous snapshot when the current snapshot is damaged', async () => {
		const dataDir = await createTempDataDir();
		const warn = spyOn(console, 'warn').mockImplementation(() => {});
		const store = new EventStore(dataDir);
		await store.initialize();
		const first = await store.addDirectory({
			localPath: '/tmp/first',
			title: 'First',
			githubOwner: 'sarp',
			githubRepo: 'first',
		});
		await store.compact();
		await store.addDirectory({
			localPath: '/tmp/second',
			title: 'Second',
			githubOwner: 'sarp',
			githubRepo: 'second',
		});
		await store.compact();
		await Bun.write(join(dataDir, 'snapshot.json'), '{broken');

		try {
			const reloaded = new EventStore(dataDir);
			await reloaded.initialize();

			expect(reloaded.getDirectory(first.id)?.title).toBe('First');
			expect(reloaded.listDirectories()).toHaveLength(1);
			expect(
				(await readdir(dataDir)).some((name) => name.startsWith('snapshot.json.corrupt-')),
			).toBe(true);
			expect(JSON.parse(await Bun.file(join(dataDir, 'snapshot.json')).text())).toBeObject();
		} finally {
			warn.mockRestore();
		}
	});
});

describe('EventStore queued session messages', () => {
	const payload = (content: string) => ({ content, modelOptions: {} });

	test('persists FIFO queue state across reload and compaction', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);

		const first = await store.enqueueSessionMessage(session.id, payload('first'));
		const second = await store.enqueueSessionMessage(session.id, payload('second'));
		await store.compact();

		expect(await Bun.file(join(dataDir, 'queues.jsonl')).text()).toBe('');
		const reloaded = new EventStore(dataDir);
		await reloaded.initialize();

		expect(reloaded.listQueuedSessionMessages(session.id)).toEqual([
			expect.objectContaining({
				id: first.id,
				sequence: first.sequence,
				promptEntryId: first.promptEntryId,
				payload: expect.objectContaining({ content: 'first' }),
			}),
			expect.objectContaining({
				id: second.id,
				sequence: second.sequence,
				promptEntryId: second.promptEntryId,
				payload: expect.objectContaining({ content: 'second' }),
			}),
		]);
	});

	test('atomically enforces the queue cap under concurrent enqueue attempts', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);

		const results = await Promise.allSettled(
			Array.from({ length: MAX_QUEUED_SESSION_MESSAGES + 5 }, (_, index) =>
				store.enqueueSessionMessage(session.id, payload(`message-${index}`)),
			),
		);

		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
			MAX_QUEUED_SESSION_MESSAGES,
		);
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(5);
		expect(store.listQueuedSessionMessages(session.id)).toHaveLength(MAX_QUEUED_SESSION_MESSAGES);
	});

	test('atomically lets only one concurrent drainer claim the FIFO head', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);
		const first = await store.enqueueSessionMessage(session.id, payload('first'));
		await store.enqueueSessionMessage(session.id, payload('second'));

		const claims = await Promise.all(
			Array.from({ length: 8 }, () => store.claimNextQueuedSessionMessage(session.id)),
		);

		expect(claims.filter(Boolean)).toEqual([
			expect.objectContaining({ id: first.id, status: 'draining' }),
		]);
		expect(
			store.listQueuedSessionMessages(session.id).map((message) => message.payload.content),
		).toEqual(['second']);
	});

	test('does not resurrect queue entries after their session is removed', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();
		const { workspace } = await createReadyWorkspace(store);
		const session = await store.createSession(workspace.id);
		const queued = await store.enqueueSessionMessage(session.id, payload('discard me'));

		await store.removeSession(session.id);
		const reloaded = new EventStore(dataDir);
		await reloaded.initialize();

		expect(reloaded.getSession(session.id)).toBeNull();
		expect(reloaded.getQueuedSessionMessage(queued.id)).toBeNull();
	});
});

describe('EventStore.requireDirectory', () => {
	test('throws when mutating missing directories, workspaces, or sessions', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		await expect(
			store.createWorkspace({
				directoryId: 'missing-directory',
				localPath: '/tmp/miko/atlas',
				branchName: 'atlas',
			}),
		).rejects.toThrow('Directory not found');
		await expect(store.removeDirectory('missing-directory')).rejects.toThrow('Directory not found');
		await expect(store.createSession('missing-workspace')).rejects.toThrow('Workspace not found');
		await expect(store.removeWorkspace('missing-workspace')).rejects.toThrow('Workspace not found');
		await expect(store.setWorkspaceBranch('missing-workspace', 'orion')).rejects.toThrow(
			'Workspace not found',
		);
		await expect(store.renameSession('missing-session', 'Title')).rejects.toThrow(
			'Session not found',
		);
		await expect(store.removeSession('missing-session')).rejects.toThrow('Session not found');
		await expect(
			store.appendMessage('missing-session', entry('user_prompt', 100, { content: 'hello' })),
		).rejects.toThrow('Session not found');
		await expect(store.recordTurnStarted('missing-session')).rejects.toThrow('Session not found');
		await expect(store.recordTurnFinished('missing-session')).rejects.toThrow('Session not found');
		await expect(store.recordTurnFailed('missing-session', 'boom')).rejects.toThrow(
			'Session not found',
		);
		await expect(store.recordTurnCancelled('missing-session')).rejects.toThrow('Session not found');
		await expect(store.setSessionToken('missing-session', 'session-1')).rejects.toThrow(
			'Session not found',
		);
	});
});
