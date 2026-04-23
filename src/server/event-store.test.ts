import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranscriptEntry } from 'src/shared/types';
import type { SnapshotFile } from './event';
import { EventStore } from './event-store';

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
	kind: 'user_prompt' | 'assistant_text',
	createdAt: number,
	extra: Record<string, unknown> = {},
): TranscriptEntry {
	const base = { _id: `${kind}-${createdAt}`, createdAt };
	if (kind === 'user_prompt') {
		return { ...base, kind, content: String(extra.content ?? '') };
	}
	return { ...base, kind, text: String(extra.content ?? extra.text ?? '') };
}

describe('EventStore', () => {
	test('uses the runtime profile for the default data dir', () => {
		process.env.MIKO_RUNTIME_PROFILE = 'dev';
		const store = new EventStore();

		expect(store.dataDir).toEndWith('/.miko-dev/data');
	});

	test('creates data dir, transcripts subdir, and empty log files for project, chats and turns', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		expect(existsSync(store.dataDir)).toBe(true);
		expect(existsSync(join(dataDir, 'transcripts'))).toBe(true);
		expect(existsSync(join(dataDir, 'projects.jsonl'))).toBe(true);
		expect(existsSync(join(dataDir, 'chats.jsonl'))).toBe(true);
		expect(existsSync(join(dataDir, 'turns.jsonl'))).toBe(true);
	});

	test('opens existing projects by normalized path and removes them from active lists', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const first = await store.openProject('/tmp/project', 'Custom');
		const second = await store.openProject('/tmp/project', 'Ignored');

		expect(second.id).toBe(first.id);
		expect(second.title).toBe('Custom');
		expect(store.listProjects().map((project) => project.id)).toEqual([first.id]);

		await store.removeProject(first.id);

		expect(store.getProject(first.id)).toBeNull();
		expect(store.listProjects()).toEqual([]);

		const reopened = await store.openProject('/tmp/project', 'Reopened');
		expect(reopened.id).not.toBe(first.id);
		expect(reopened.title).toBe('Reopened');
	});

	test('creates, renames, deletes, and counts chats by project', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const project = await store.openProject('/tmp/project');
		const chat = await store.createChat(project.id);

		expect(chat.title).toBe('New Chat');
		expect(store.getChatCount(project.id)).toBe(1);

		await store.renameChat(chat.id, '   ');
		expect(store.getChat(chat.id)?.title).toBe('New Chat');

		await store.renameChat(chat.id, '  Better Chat  ');
		expect(store.getChat(chat.id)?.title).toBe('Better Chat');

		await store.deleteChat(chat.id);

		expect(store.getChat(chat.id)).toBeNull();
		expect(store.listChatsByProject(project.id)).toEqual([]);
		expect(store.getChatCount(project.id)).toBe(0);
		expect(() => store.requireChat(chat.id)).toThrow('Chat not found');
	});

	test('persists provider, plan mode, and session token across store instances', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const project = await store.openProject('/tmp/project');
		const chat = await store.createChat(project.id);

		await store.setChatProvider(chat.id, 'codex');
		await store.setPlanMode(chat.id, true);
		await store.setSessionToken(chat.id, 'session-1');

		const reloaded = new EventStore(dataDir);
		await reloaded.initialize();

		expect(reloaded.getChat(chat.id)).toMatchObject({
			provider: 'codex',
			planMode: true,
			sessionToken: 'session-1',
		});

		await reloaded.setSessionToken(chat.id, null);

		const reloadedAfterClear = new EventStore(dataDir);
		await reloadedAfterClear.initialize();
		expect(reloadedAfterClear.getChat(chat.id)?.sessionToken).toBeNull();
	});

	test('appends transcript entries to per-chat jsonl files and reloads them', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const project = await store.openProject('/tmp/project');
		const chat = await store.createChat(project.id);
		const userEntry = entry('user_prompt', 100, { content: 'hello' });
		const assistantEntry = entry('assistant_text', 101, { content: 'world' });

		await store.appendMessage(chat.id, userEntry);
		await store.appendMessage(chat.id, assistantEntry);

		expect(store.getMessages(chat.id)).toEqual([userEntry, assistantEntry]);

		const transcriptPath = join(dataDir, 'transcripts', `${chat.id}.jsonl`);
		const transcriptText = await readFile(transcriptPath, 'utf-8');
		expect(transcriptText).toContain('"kind":"user_prompt"');
		expect(transcriptText).toContain('"kind":"assistant_text"');

		const reloaded = new EventStore(dataDir);
		await reloaded.initialize();
		expect(reloaded.getMessages(chat.id)).toEqual([userEntry, assistantEntry]);
	});

	test('protects stored transcript entries from caller mutations', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const project = await store.openProject('/tmp/project');
		const chat = await store.createChat(project.id);
		const original = entry('user_prompt', 100, { content: 'hello' });
		await store.appendMessage(chat.id, original);

		const messages = store.getMessages(chat.id);
		if (messages[0]?.kind === 'user_prompt') {
			messages[0].content = 'mutated';
		}
		messages.push(entry('assistant_text', 101, { content: 'extra' }));

		expect(store.getMessages(chat.id)).toEqual([original]);

		const page = store.getRecentMessagesPage(chat.id, 1);
		if (page.messages[0]?.kind === 'user_prompt') {
			page.messages[0].content = 'page-mutated';
		}

		expect(store.getRecentMessagesPage(chat.id, 1).messages).toEqual([original]);
	});

	test('paginates transcript history from newest to oldest', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const project = await store.openProject('/tmp/project');
		const chat = await store.createChat(project.id);

		for (let index = 1; index <= 5; index++) {
			await store.appendMessage(
				chat.id,
				entry(index % 2 === 0 ? 'assistant_text' : 'user_prompt', 200 + index, {
					content: `message-${index}`,
				}),
			);
		}

		const recentPage = store.getRecentMessagesPage(chat.id, 2);
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

		const olderPage = store.getMessagesPageBefore(chat.id, recentCursor, 2);
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

		const oldestPage = store.getMessagesPageBefore(chat.id, olderCursor, 2);
		expect(oldestPage.messages.map((message) => message._id)).toEqual(['user_prompt-201']);
		expect(oldestPage.hasOlder).toBe(false);
		expect(oldestPage.olderCursor).toBeNull();
	});

	test('handles empty, zero-limit, and invalid transcript page requests', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const project = await store.openProject('/tmp/project');
		const chat = await store.createChat(project.id);

		expect(store.getRecentMessagesPage(chat.id, 10)).toEqual({
			messages: [],
			hasOlder: false,
			olderCursor: null,
		});
		expect(store.getRecentMessagesPage(chat.id, 0)).toEqual({
			messages: [],
			hasOlder: false,
			olderCursor: null,
		});
		expect(store.getMessagesPageBefore(chat.id, 'idx:0', 0)).toEqual({
			messages: [],
			hasOlder: false,
			olderCursor: null,
		});

		expect(() => store.getMessagesPageBefore(chat.id, 'bad', 10)).toThrow('Invalid history cursor');
		expect(() => store.getMessagesPageBefore(chat.id, 'idx:bad', 10)).toThrow(
			'Invalid history cursor',
		);
		expect(() => store.getMessagesPageBefore(chat.id, 'idx:-1', 10)).toThrow(
			'Invalid history cursor',
		);
	});

	test('marks chats unread on completed and failed turns and records outcomes', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const project = await store.openProject('/tmp/project');
		const chat = await store.createChat(project.id);

		expect(store.getChat(chat.id)).toMatchObject({
			unread: false,
			lastTurnOutcome: null,
		});

		await store.recordTurnStarted(chat.id);
		expect(store.getChat(chat.id)?.lastTurnOutcome).toBeNull();

		await store.recordTurnFinished(chat.id);
		expect(store.getChat(chat.id)).toMatchObject({
			unread: true,
			lastTurnOutcome: 'success',
		});

		await store.setChatReadState(chat.id, false);
		expect(store.getChat(chat.id)?.unread).toBe(false);

		await store.recordTurnCancelled(chat.id);
		expect(store.getChat(chat.id)).toMatchObject({
			unread: false,
			lastTurnOutcome: 'cancelled',
		});

		await store.recordTurnFailed(chat.id, 'boom');
		expect(store.getChat(chat.id)).toMatchObject({
			unread: true,
			lastTurnOutcome: 'failed',
		});

		const reloaded = new EventStore(dataDir);
		await reloaded.initialize();
		expect(reloaded.getChat(chat.id)).toMatchObject({
			unread: true,
			lastTurnOutcome: 'failed',
		});
	});

	test('orders chats by last user message activity before internal updates', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const project = await store.openProject('/tmp/project');
		const chatA = await store.createChat(project.id);
		const chatB = await store.createChat(project.id);
		const laterUserActivity = Date.now() + 60_000;

		await store.appendMessage(
			chatA.id,
			entry('user_prompt', laterUserActivity, { content: 'latest' }),
		);
		await store.recordTurnStarted(chatB.id);

		expect(store.listChatsByProject(project.id).map((chat) => chat.id)).toEqual([
			chatA.id,
			chatB.id,
		]);
	});

	test('prunes stale empty chats after five minutes', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const project = await store.openProject('/tmp/project');
		const chat = await store.createChat(project.id);
		const pruned = await store.pruneStaleEmptyChats({ now: chat.createdAt + 5 * 60 * 1000 });

		expect(pruned).toEqual([chat.id]);
		expect(store.getChat(chat.id)).toBeNull();
	});

	test('does not prune empty chats under five minutes old', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const project = await store.openProject('/tmp/project');
		const chat = await store.createChat(project.id);
		const pruned = await store.pruneStaleEmptyChats({ now: chat.createdAt + 5 * 60 * 1000 - 1 });

		expect(pruned).toEqual([]);
		expect(store.getChat(chat.id)?.id).toBe(chat.id);
	});

	test('does not prune chats once they have transcript messages', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const project = await store.openProject('/tmp/project');
		const chat = await store.createChat(project.id);
		await store.appendMessage(
			chat.id,
			entry('user_prompt', chat.createdAt + 1, { content: 'hello' }),
		);

		const pruned = await store.pruneStaleEmptyChats({ now: chat.createdAt + 5 * 60 * 1000 });

		expect(pruned).toEqual([]);
		expect(store.getChat(chat.id)?.id).toBe(chat.id);
	});

	test('does not prune stale chats that are currently active', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const project = await store.openProject('/tmp/project');
		const chat = await store.createChat(project.id);
		const pruned = await store.pruneStaleEmptyChats({
			now: chat.createdAt + 5 * 60 * 1000,
			activeChatIds: [chat.id],
		});

		expect(pruned).toEqual([]);
		expect(store.getChat(chat.id)?.id).toBe(chat.id);
	});

	test('compacts logs into a snapshot and reloads state without transcript loss', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		const project = await store.openProject('/tmp/project', 'Project');
		const chat = await store.createChat(project.id);
		const userEntry = entry('user_prompt', 100, { content: 'hello' });
		const assistantEntry = entry('assistant_text', 101, { content: 'world' });

		await store.setChatProvider(chat.id, 'codex');
		await store.setPlanMode(chat.id, true);
		await store.setSessionToken(chat.id, 'session-1');
		await store.appendMessage(chat.id, userEntry);
		await store.appendMessage(chat.id, assistantEntry);
		await store.recordTurnFinished(chat.id);
		await store.compact();

		expect(await readFile(join(dataDir, 'projects.jsonl'), 'utf-8')).toBe('');
		expect(await readFile(join(dataDir, 'chats.jsonl'), 'utf-8')).toBe('');
		expect(await readFile(join(dataDir, 'turns.jsonl'), 'utf-8')).toBe('');

		const snapshot = JSON.parse(
			await readFile(join(dataDir, 'snapshot.json'), 'utf-8'),
		) as SnapshotFile;
		expect(snapshot.projects.map((candidate) => candidate.id)).toEqual([project.id]);
		expect(snapshot.chats.map((candidate) => candidate.id)).toEqual([chat.id]);
		expect(snapshot.chats[0]).toMatchObject({
			provider: 'codex',
			planMode: true,
			sessionToken: 'session-1',
			unread: true,
			lastTurnOutcome: 'success',
		});
		expect(snapshot.messages).toBeUndefined();

		const reloaded = new EventStore(dataDir);
		await reloaded.initialize();

		expect(reloaded.getProject(project.id)?.title).toBe('Project');
		expect(reloaded.getChat(chat.id)).toMatchObject({
			provider: 'codex',
			planMode: true,
			sessionToken: 'session-1',
		});
		expect(reloaded.getMessages(chat.id)).toEqual([userEntry, assistantEntry]);
	});

	test('ignores corrupt trailing log lines while preserving prior events', async () => {
		const dataDir = await createTempDataDir();
		const warn = spyOn(console, 'warn').mockImplementation(() => {});
		const projectEvent = {
			type: 'project_opened',
			timestamp: 100,
			projectId: 'project-1',
			localPath: '/tmp/project',
			title: 'Project',
		};

		await writeFile(
			join(dataDir, 'projects.jsonl'),
			`${JSON.stringify(projectEvent)}\n{not json`,
			'utf-8',
		);

		try {
			const store = new EventStore(dataDir);
			await store.initialize();

			expect(store.getProject('project-1')).toMatchObject({
				id: 'project-1',
				localPath: '/tmp/project',
				title: 'Project',
			});
			expect(await readFile(join(dataDir, 'projects.jsonl'), 'utf-8')).toContain('project_opened');
		} finally {
			warn.mockRestore();
		}
	});

	test('resets local history for corrupt non-trailing log lines', async () => {
		const dataDir = await createTempDataDir();
		const warn = spyOn(console, 'warn').mockImplementation(() => {});
		const firstEvent = {
			type: 'project_opened',
			timestamp: 100,
			projectId: 'project-1',
			localPath: '/tmp/project',
			title: 'Project',
		};
		const secondEvent = {
			type: 'project_opened',
			timestamp: 101,
			projectId: 'project-2',
			localPath: '/tmp/project-2',
			title: 'Project 2',
		};

		await writeFile(
			join(dataDir, 'projects.jsonl'),
			`${JSON.stringify(firstEvent)}\n{not json\n${JSON.stringify(secondEvent)}\n`,
			'utf-8',
		);

		try {
			const store = new EventStore(dataDir);
			await store.initialize();

			expect(store.listProjects()).toEqual([]);
			expect(await readFile(join(dataDir, 'snapshot.json'), 'utf-8')).toBe('');
			expect(await readFile(join(dataDir, 'projects.jsonl'), 'utf-8')).toBe('');
			expect(await readFile(join(dataDir, 'chats.jsonl'), 'utf-8')).toBe('');
			expect(await readFile(join(dataDir, 'turns.jsonl'), 'utf-8')).toBe('');
		} finally {
			warn.mockRestore();
		}
	});

	test('throws when mutating missing projects or chats', async () => {
		const dataDir = await createTempDataDir();
		const store = new EventStore(dataDir);
		await store.initialize();

		await expect(store.createChat('missing-project')).rejects.toThrow('Project not found');
		await expect(store.removeProject('missing-project')).rejects.toThrow('Project not found');
		await expect(store.renameChat('missing-chat', 'Title')).rejects.toThrow('Chat not found');
		await expect(store.deleteChat('missing-chat')).rejects.toThrow('Chat not found');
		await expect(
			store.appendMessage('missing-chat', entry('user_prompt', 100, { content: 'hello' })),
		).rejects.toThrow('Chat not found');
		await expect(store.recordTurnStarted('missing-chat')).rejects.toThrow('Chat not found');
		await expect(store.recordTurnFinished('missing-chat')).rejects.toThrow('Chat not found');
		await expect(store.recordTurnFailed('missing-chat', 'boom')).rejects.toThrow('Chat not found');
		await expect(store.recordTurnCancelled('missing-chat')).rejects.toThrow('Chat not found');
		await expect(store.setSessionToken('missing-chat', 'session-1')).rejects.toThrow(
			'Chat not found',
		);
	});
});
