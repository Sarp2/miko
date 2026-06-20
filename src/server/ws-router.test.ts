import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WorkspaceGitHubSnapshot, WorkspaceGitSnapshot } from 'src/shared/types';
import { EventStore } from './event-store';
import { createWsRouter } from './ws-router';

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function waitFor(predicate: () => boolean) {
	const startedAt = Date.now();
	while (!predicate()) {
		if (Date.now() - startedAt > 1000) throw new Error('Timed out waiting for condition');
		await Bun.sleep(1);
	}
}

class FakeWebSocket {
	readonly sent: unknown[] = [];
	readonly data = {
		subscriptions: new Map(),
		snapshotSignatures: new Map(),
	};

	send(message: string) {
		this.sent.push(JSON.parse(message));
	}
}

function unknownGitSnapshot(): WorkspaceGitSnapshot {
	return {
		status: 'unknown',
		files: [],
		branchHistory: { entries: [] },
	};
}

function readyGitSnapshot(): WorkspaceGitSnapshot {
	return {
		status: 'ready',
		branchName: 'atlas',
		defaultBranchName: 'main',
		hasOriginRemote: true,
		originRepoSlug: 'sarp/miko',
		hasUpstream: false,
		files: [
			{
				path: 'src/app.ts',
				changeType: 'modified',
				isUntracked: false,
				additions: 2,
				deletions: 1,
				patchDigest: 'digest',
			},
		],
		hasPushedCommits: false,
		branchPublishState: 'local_only',
		mainAheadCount: 0,
		branchHistory: { entries: [] },
	};
}

async function createSeededStore() {
	const dataDir = await mkdtemp(path.join(tmpdir(), 'miko-ws-router-'));
	tempDirs.push(dataDir);
	const store = new EventStore(dataDir);
	await store.initialize();

	const directory = await store.addDirectory({
		localPath: '/repo/miko',
		title: 'Miko',
		githubOwner: 'sarp',
		githubRepo: 'miko',
	});
	const workspace = await store.createWorkspace({
		directoryId: directory.id,
		localPath: '/repo/miko/atlas',
		branchName: 'atlas',
	});
	await store.markWorkspaceSetupCompleted(workspace.id);
	const session = await store.createSession(workspace.id);

	return { store, workspaceId: workspace.id, sessionId: session.id };
}

async function createRouter(overrides: Record<string, unknown> = {}) {
	let gitSnapshot = unknownGitSnapshot();
	let scratchpadContent = '';
	let scratchpadUpdatedAt: number | null = null;
	const seeded = await createSeededStore();

	const diffStore = {
		getWorkspaceGitSnapshot: () => gitSnapshot,
		refreshWorkspaceGitSnapshot: async () => {
			gitSnapshot = readyGitSnapshot();
			return true;
		},
		fetchWorkspaceGit: async () => ({ ok: true, branchName: 'atlas', snapshotChanged: true }),
		initializeGit: async () => ({ ok: true, snapshotChanged: false }),
		getGitHubPublishInfo: async () => ({
			ghInstalled: true,
			authenticated: true,
			owners: ['sarp'],
			suggestedRepoName: 'miko',
		}),
		checkGitHubRepoAvailability: async () => ({ available: true, message: 'available' }),
		publishToGitHub: async () => ({ ok: true, snapshotChanged: false }),
		inspectGitHubBackedRepo: async () => ({ ok: true, githubOwner: 'sarp', githubRepo: 'miko' }),
		discardFile: async () => ({ snapshotChanged: true }),
		ignoreFile: async () => ({ snapshotChanged: true }),
		readPatch: async () => ({ path: 'app.txt', patch: 'diff', patchDigest: 'digest' }),
		readFileContents: async () => ({
			kind: 'text' as const,
			path: 'app.txt',
			name: 'app.txt',
			contents: 'hello',
			mimeType: 'text/plain; charset=utf-8',
			size: 5,
			encoding: 'utf-8' as const,
			cacheKey: 'app.txt:digest',
		}),
		readExternalFileContents: async () => ({
			kind: 'text' as const,
			path: '/tmp/app.txt',
			name: 'app.txt',
			contents: 'external',
			mimeType: 'text/plain; charset=utf-8',
			size: 8,
			encoding: 'utf-8' as const,
			cacheKey: '/tmp/app.txt:digest',
		}),
	};

	const workspaceManager = {
		getWorkspaceHealthState: async () => 'healthy',
		markWorkspaceInstructionTurnStarted: () => {},
		clearWorkspaceInstructionTurn: () => {},
		createWorkspace: async () => ({ workspace: {}, session: null }),
		renameWorkspaceBranch: async () => ({}),
	};

	const prSnapshot: WorkspaceGitHubSnapshot = {
		status: 'none',
		owner: 'sarp',
		repo: 'miko',
		comments: [],
		checks: [],
	};
	const prManager = {
		getWorkspaceGitHubSnapshot: () => null,
		refreshWorkspacePrState: async () => prSnapshot,
		fetchFailingCheckLogs: async () => [],
		mergeWorkspacePullRequest: async () => ({ status: 'merged' }),
	};

	const router = createWsRouter({
		store: seeded.store,
		diffStore,
		workspaceManager,
		prManager,
		scratchpadManager: {
			getSnapshot: async (workspaceId: string) => ({
				workspaceId,
				content: scratchpadContent,
				updatedAt: scratchpadUpdatedAt,
			}),
			updateScratchpad: async (workspaceId: string, content: string) => {
				scratchpadContent = content;
				scratchpadUpdatedAt = 123;
				return { workspaceId, content, updatedAt: scratchpadUpdatedAt };
			},
		} as never,
		agent: {
			getActiveStatuses: () => new Map(),
			getDrainingSessionIds: () => new Set(),
			getPendingTool: () => null,
			listCommands: async () => [],
			getQueuedMessages: () => [],
			dequeueMessage: () => {},
			send: async () => ({ sessionId: seeded.sessionId }),
			cancel: async () => {},
			closeSession: async () => {},
			stopDraining: async () => {},
			respondTool: async () => {},
			setBackgroundErrorReporter: () => {},
		} as never,
		terminals: {
			getSnapshot: () => null,
			onEvent: () => () => {},
			createTerminal: () => ({ terminalId: 'terminal-1' }),
			write: () => {},
			resize: () => {},
			close: () => {},
		} as never,
		keybindings: {
			getSnapshot: () => ({
				bindings: {},
				warning: null,
				filePathDisplay: '/tmp/keybindings.json',
			}),
			onChange: () => () => {},
			write: async () => ({
				bindings: {},
				warning: null,
				filePathDisplay: '/tmp/keybindings.json',
			}),
		} as never,
		machineDisplayName: 'Local Machine',
		updateManager: null,
		refreshWorkspacePrStage: async () => ({ refreshed: true, snapshot: prSnapshot }),
		...overrides,
	} as never);

	return { router, ...seeded };
}

async function subscribe(ws: FakeWebSocket, topic: unknown) {
	const { router } = await createRouter();
	await router.handleMessage(
		ws as never,
		JSON.stringify({ type: 'subscribe', id: 'sub-1', topic }),
	);
	return router;
}

describe('createWsRouter.refreshWorkspaceOpenState', () => {
	test('refreshes workspace health and git state after workspace subscribe', async () => {
		let gitSnapshot = unknownGitSnapshot();
		const { router, workspaceId } = await createRouter({
			diffStore: {
				getWorkspaceGitSnapshot: () => gitSnapshot,
				refreshWorkspaceGitSnapshot: async () => {
					gitSnapshot = readyGitSnapshot();
					return true;
				},
			},
			workspaceManager: {
				getWorkspaceHealthState: async () => 'branch_missing',
			},
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'subscribe',
				id: 'workspace-sub',
				topic: { type: 'workspace', workspaceId },
			}),
		);
		await waitFor(() => ws.sent.length >= 2);

		expect(ws.sent[0]).toMatchObject({
			id: 'workspace-sub',
			snapshot: { type: 'workspace', data: { healthState: 'healthy' } },
		});
		expect(ws.sent.at(-1)).toMatchObject({
			id: 'workspace-sub',
			snapshot: {
				type: 'workspace',
				data: { healthState: 'branch_missing', git: { status: 'ready' } },
			},
		});
	});
});

describe('createWsRouter.createEnvelope', () => {
	test('creates a sidebar snapshot', async () => {
		const ws = new FakeWebSocket();
		await subscribe(ws, { type: 'sidebar' });

		expect(ws.sent[0]).toMatchObject({
			type: 'snapshot',
			id: 'sub-1',
			snapshot: { type: 'sidebar' },
		});
	});

	test('creates a directories snapshot', async () => {
		const ws = new FakeWebSocket();
		await subscribe(ws, { type: 'directories' });

		expect(ws.sent[0]).toMatchObject({
			type: 'snapshot',
			id: 'sub-1',
			snapshot: { type: 'directories' },
		});
	});

	test('creates a scratchpad snapshot', async () => {
		const ws = new FakeWebSocket();
		const { router, workspaceId } = await createRouter({
			scratchpadManager: {
				getSnapshot: async (id: string) => ({
					workspaceId: id,
					content: '# Scratchpad',
					updatedAt: 123,
				}),
			},
		});

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'subscribe',
				id: 'scratchpad-sub',
				topic: { type: 'scratchpad', workspaceId },
			}),
		);

		expect(ws.sent[0]).toEqual({
			type: 'snapshot',
			id: 'scratchpad-sub',
			snapshot: {
				type: 'scratchpad',
				data: { workspaceId, content: '# Scratchpad', updatedAt: 123 },
			},
		});
	});

	test('creates a scratchpad snapshot for a stale workspace subscription', async () => {
		const ws = new FakeWebSocket();
		const { router } = await createRouter();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'subscribe',
				id: 'scratchpad-sub',
				topic: { type: 'scratchpad', workspaceId: 'removed-workspace' },
			}),
		);

		expect(ws.sent[0]).toEqual({
			type: 'snapshot',
			id: 'scratchpad-sub',
			snapshot: {
				type: 'scratchpad',
				data: { workspaceId: 'removed-workspace', content: '', updatedAt: null },
			},
		});
	});
});

describe('createWsRouter.broadcastSnapshots', () => {
	test('does not resend unchanged snapshots', async () => {
		const { router } = await createRouter();
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({ type: 'subscribe', id: 'sub-1', topic: { type: 'sidebar' } }),
		);
		await router.broadcastSnapshots();

		expect(ws.sent).toHaveLength(1);
	});

	test('broadcasts only to open sockets', async () => {
		const { router } = await createRouter();
		const ws = new FakeWebSocket();
		ws.data.subscriptions.set('sidebar-1', { type: 'sidebar' });

		await router.broadcastSnapshots();
		expect(ws.sent).toEqual([]);

		router.handleOpen(ws as never);
		await router.broadcastSnapshots();
		expect(ws.sent).toHaveLength(1);
	});
});

describe('createWsRouter.broadcastError', () => {
	test('sends background errors to open sockets', async () => {
		let reportError: (message: string) => void = () => {};
		const { router } = await createRouter({
			agent: {
				getActiveStatuses: () => new Map(),
				getDrainingSessionIds: () => new Set(),
				getPendingTool: () => null,
				listCommands: async () => [],
				getQueuedMessages: () => [],
				dequeueMessage: () => {},
				setBackgroundErrorReporter: (reporter: (message: string) => void) => {
					reportError = reporter;
				},
			},
		});
		const ws = new FakeWebSocket();

		router.handleOpen(ws as never);
		reportError('boom');

		expect(ws.sent).toEqual([{ type: 'error', message: 'boom' }]);
	});
});

describe('createWsRouter.pushTerminalEvent', () => {
	test('pushes terminal events to matching subscriptions', async () => {
		let emitTerminalEvent: (event: unknown) => void = () => {};
		const { router } = await createRouter({
			terminals: {
				getSnapshot: () => null,
				onEvent: (listener: (event: unknown) => void) => {
					emitTerminalEvent = listener;
					return () => {};
				},
			},
		});
		const ws = new FakeWebSocket();

		router.handleOpen(ws as never);
		ws.data.subscriptions.set('terminal-sub', { type: 'terminal', terminalId: 'terminal-1' });
		emitTerminalEvent({ type: 'terminal.output', terminalId: 'terminal-1', data: 'hello' });

		expect(ws.sent).toEqual([
			{
				type: 'event',
				id: 'terminal-sub',
				event: { type: 'terminal.output', terminalId: 'terminal-1', data: 'hello' },
			},
		]);
	});
});

describe('createWsRouter.sendWorkspaceInstruction', () => {
	test('starts commit-and-push as a workspace instruction turn', async () => {
		let markedIntent: unknown;
		let sentCommand: unknown;
		const { router, workspaceId, sessionId } = await createRouter({
			workspaceManager: {
				markWorkspaceInstructionTurnStarted: (args: unknown) => {
					markedIntent = args;
				},
				clearWorkspaceInstructionTurn: () => {},
			},
			agent: {
				getActiveStatuses: () => new Map(),
				getDrainingSessionIds: () => new Set(),
				getPendingTool: () => null,
				listCommands: async () => [],
				getQueuedMessages: () => [],
				dequeueMessage: () => {},
				send: async (command: unknown) => {
					sentCommand = command;
					return { sessionId };
				},
				setBackgroundErrorReporter: () => {},
			},
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'commit-1',
				command: {
					type: 'workspace.commitAndPush',
					workspaceId,
					sessionId,
				},
			}),
		);

		expect(markedIntent).toEqual({
			workspaceId,
			sessionId,
			intent: 'commit_and_push',
		});
		expect(sentCommand).toMatchObject({
			type: 'session.send',
			sessionId,
			workspaceId,
			content: 'Commit and Push',
		});
		expect(ws.sent[0]).toEqual({ type: 'ack', id: 'commit-1', result: { sessionId } });
	});

	test('clears workspace instruction intent when the agent turn fails to start', async () => {
		let clearedSessionId: string | null = null;
		const { router, workspaceId, sessionId } = await createRouter({
			workspaceManager: {
				markWorkspaceInstructionTurnStarted: () => {},
				clearWorkspaceInstructionTurn: (id: string) => {
					clearedSessionId = id;
				},
			},
			agent: {
				getActiveStatuses: () => new Map(),
				getDrainingSessionIds: () => new Set(),
				getPendingTool: () => null,
				listCommands: async () => [],
				getQueuedMessages: () => [],
				dequeueMessage: () => {},
				send: async () => {
					throw new Error('agent failed');
				},
				setBackgroundErrorReporter: () => {},
			},
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'commit-1',
				command: {
					type: 'workspace.commitAndPush',
					workspaceId,
					sessionId,
				},
			}),
		);

		expect(clearedSessionId as string | null).toBe(sessionId);
		expect(ws.sent).toEqual([{ type: 'error', id: 'commit-1', message: 'agent failed' }]);
	});

	test('starts merge-conflict resolution only with a current conflicting PR snapshot', async () => {
		let markedIntent: unknown;
		let sentCommand: unknown;
		const github: WorkspaceGitHubSnapshot = {
			status: 'open',
			owner: 'sarp',
			repo: 'miko',
			prNumber: 12,
			title: 'Resolve conflicts',
			url: 'https://github.com/sarp/miko/pull/12',
			mergeStateStatus: 'DIRTY',
			hasMergeConflicts: true,
			comments: [],
			checks: [],
		};
		const { router, workspaceId, sessionId } = await createRouter({
			workspaceManager: {
				markWorkspaceInstructionTurnStarted: (args: unknown) => {
					markedIntent = args;
				},
				clearWorkspaceInstructionTurn: () => {},
			},
			prManager: {
				getWorkspaceGitHubSnapshot: () => github,
				refreshWorkspacePrState: async () => github,
				fetchFailingCheckLogs: async () => [],
				mergeWorkspacePullRequest: async () => ({ status: 'merged' }),
			},
			agent: {
				getActiveStatuses: () => new Map(),
				getDrainingSessionIds: () => new Set(),
				getPendingTool: () => null,
				listCommands: async () => [],
				getQueuedMessages: () => [],
				dequeueMessage: () => {},
				send: async (command: unknown) => {
					sentCommand = command;
					return { sessionId };
				},
				setBackgroundErrorReporter: () => {},
			},
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'conflicts-1',
				command: {
					type: 'workspace.resolveMergeConflicts',
					workspaceId,
					sessionId,
				},
			}),
		);

		expect(markedIntent).toEqual({
			workspaceId,
			sessionId,
			intent: 'resolve_merge_conflicts',
		});
		expect(sentCommand).toMatchObject({
			type: 'session.send',
			sessionId,
			workspaceId,
			content: 'Resolve merge conflicts using the attached instructions.',
			attachments: [
				{
					displayName: 'merge-conflict-instructions.md',
					mimeType: 'text/markdown',
				},
			],
		});
		expect(ws.sent[0]).toEqual({ type: 'ack', id: 'conflicts-1', result: { sessionId } });
	});

	test('rejects merge-conflict resolution without a current conflicting PR snapshot', async () => {
		let sendCalled = false;
		const nonConflictingGithub: WorkspaceGitHubSnapshot = {
			status: 'open',
			owner: 'sarp',
			repo: 'miko',
			prNumber: 12,
			hasMergeConflicts: false,
			comments: [],
			checks: [],
		};
		const { router, workspaceId, sessionId } = await createRouter({
			prManager: {
				getWorkspaceGitHubSnapshot: () => nonConflictingGithub,
				refreshWorkspacePrState: async () => ({
					status: 'none',
					owner: 'sarp',
					repo: 'miko',
					comments: [],
					checks: [],
				}),
				fetchFailingCheckLogs: async () => [],
				mergeWorkspacePullRequest: async () => ({ status: 'merged' }),
			},
			agent: {
				getActiveStatuses: () => new Map(),
				getDrainingSessionIds: () => new Set(),
				getPendingTool: () => null,
				listCommands: async () => [],
				getQueuedMessages: () => [],
				dequeueMessage: () => {},
				send: async () => {
					sendCalled = true;
					return { sessionId };
				},
				setBackgroundErrorReporter: () => {},
			},
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'conflicts-1',
				command: {
					type: 'workspace.resolveMergeConflicts',
					workspaceId,
					sessionId,
				},
			}),
		);

		expect(sendCalled).toBe(false);
		expect(ws.sent).toEqual([
			{
				type: 'error',
				id: 'conflicts-1',
				message: 'Workspace does not have merge conflicts to resolve',
			},
		]);
	});

	test('rejects merge-conflict resolution without a current PR snapshot', async () => {
		let sendCalled = false;
		const { router, workspaceId, sessionId } = await createRouter({
			prManager: {
				getWorkspaceGitHubSnapshot: () => null,
				refreshWorkspacePrState: async () => ({
					status: 'none',
					owner: 'sarp',
					repo: 'miko',
					comments: [],
					checks: [],
				}),
				fetchFailingCheckLogs: async () => [],
				mergeWorkspacePullRequest: async () => ({ status: 'merged' }),
			},
			agent: {
				getActiveStatuses: () => new Map(),
				getDrainingSessionIds: () => new Set(),
				getPendingTool: () => null,
				listCommands: async () => [],
				getQueuedMessages: () => [],
				dequeueMessage: () => {},
				send: async () => {
					sendCalled = true;
					return { sessionId };
				},
				setBackgroundErrorReporter: () => {},
			},
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'conflicts-1',
				command: {
					type: 'workspace.resolveMergeConflicts',
					workspaceId,
					sessionId,
				},
			}),
		);

		expect(sendCalled).toBe(false);
		expect(ws.sent).toEqual([
			{
				type: 'error',
				id: 'conflicts-1',
				message: 'Workspace does not have a current pull request snapshot',
			},
		]);
	});

	test('rejects merge-conflict resolution when mergeability is unknown', async () => {
		let sendCalled = false;
		const unknownMergeabilityGithub: WorkspaceGitHubSnapshot = {
			status: 'open',
			owner: 'sarp',
			repo: 'miko',
			prNumber: 12,
			comments: [],
			checks: [],
		};
		const { router, workspaceId, sessionId } = await createRouter({
			prManager: {
				getWorkspaceGitHubSnapshot: () => unknownMergeabilityGithub,
				refreshWorkspacePrState: async () => unknownMergeabilityGithub,
				fetchFailingCheckLogs: async () => [],
				mergeWorkspacePullRequest: async () => ({ status: 'merged' }),
			},
			agent: {
				getActiveStatuses: () => new Map(),
				getDrainingSessionIds: () => new Set(),
				getPendingTool: () => null,
				listCommands: async () => [],
				getQueuedMessages: () => [],
				dequeueMessage: () => {},
				send: async () => {
					sendCalled = true;
					return { sessionId };
				},
				setBackgroundErrorReporter: () => {},
			},
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'conflicts-1',
				command: {
					type: 'workspace.resolveMergeConflicts',
					workspaceId,
					sessionId,
				},
			}),
		);

		expect(sendCalled).toBe(false);
		expect(ws.sent).toEqual([
			{
				type: 'error',
				id: 'conflicts-1',
				message: 'Workspace merge conflict status is unknown',
			},
		]);
	});

	test('marks a draft pull request ready', async () => {
		let markedWorkspaceId: string | null = null;
		const { router, workspaceId } = await createRouter({
			prManager: {
				getWorkspaceGitHubSnapshot: () => null,
				refreshWorkspacePrState: async () => ({
					status: 'open',
					owner: 'sarp',
					repo: 'miko',
					comments: [],
					checks: [],
				}),
				fetchFailingCheckLogs: async () => [],
				mergeWorkspacePullRequest: async () => ({ status: 'merged' }),
				markWorkspacePullRequestReady: async (id: string) => {
					markedWorkspaceId = id;
					return { status: 'open', isDraft: false };
				},
			},
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'ready-1',
				command: {
					type: 'workspace.markPrReady',
					workspaceId,
				},
			}),
		);

		expect(markedWorkspaceId as string | null).toBe(workspaceId);
		expect(ws.sent[0]).toEqual({
			type: 'ack',
			id: 'ready-1',
			result: { status: 'open', isDraft: false },
		});
	});
});

describe('createWsRouter.handleCommand', () => {
	test('adds a GitHub-backed directory by inspecting the selected path', async () => {
		const repoRoot = await mkdtemp(path.join(tmpdir(), 'miko-directory-add-'));
		const localPath = path.join(repoRoot, 'src');
		await mkdir(localPath, { recursive: true });
		tempDirs.push(repoRoot);
		let inspectedPath: string | undefined;
		const { router, store } = await createRouter({
			diffStore: {
				getWorkspaceGitSnapshot: () => unknownGitSnapshot(),
				refreshWorkspaceGitSnapshot: async () => true,
				fetchWorkspaceGit: async () => ({ ok: true, branchName: 'atlas', snapshotChanged: true }),
				initializeGit: async () => ({ ok: true, snapshotChanged: false }),
				getGitHubPublishInfo: async () => ({
					ghInstalled: true,
					authenticated: true,
					owners: ['sarp'],
					suggestedRepoName: 'miko',
				}),
				checkGitHubRepoAvailability: async () => ({ available: true, message: 'available' }),
				publishToGitHub: async () => ({ ok: true, snapshotChanged: false }),
				inspectGitHubBackedRepo: async (pathToInspect: string) => {
					inspectedPath = pathToInspect;
					return {
						ok: true,
						repoRoot,
						defaultBranchName: 'main',
						githubOwner: 'sarp',
						githubRepo: 'miko',
					};
				},
				discardFile: async () => ({ snapshotChanged: true }),
				ignoreFile: async () => ({ snapshotChanged: true }),
				readPatch: async () => ({ path: 'app.txt', patch: 'diff', patchDigest: 'digest' }),
				readFileContents: async () => ({
					kind: 'text' as const,
					path: 'app.txt',
					name: 'app.txt',
					contents: 'hello',
					mimeType: 'text/plain; charset=utf-8',
					size: 5,
					encoding: 'utf-8' as const,
					cacheKey: 'app.txt:digest',
				}),
				readExternalFileContents: async () => ({
					kind: 'text' as const,
					path: '/tmp/app.txt',
					name: 'app.txt',
					contents: 'external',
					mimeType: 'text/plain; charset=utf-8',
					size: 8,
					encoding: 'utf-8' as const,
					cacheKey: '/tmp/app.txt:digest',
				}),
			},
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'directory-add-1',
				command: { type: 'directory.add', localPath },
			}),
		);

		expect(inspectedPath).toBe(localPath);
		const directoryId = (ws.sent[0] as { result: { directoryId: string } }).result.directoryId;
		expect(ws.sent[0]).toMatchObject({
			type: 'ack',
			id: 'directory-add-1',
			result: { directoryId: expect.any(String) },
		});
		expect(store.state.directoriesById.get(directoryId)?.localPath).toBe(repoRoot);
	});

	test('returns a clear error when selected directory is not GitHub-backed', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-directory-add-invalid-'));
		tempDirs.push(localPath);
		const { router } = await createRouter({
			diffStore: {
				getWorkspaceGitSnapshot: () => unknownGitSnapshot(),
				refreshWorkspaceGitSnapshot: async () => true,
				fetchWorkspaceGit: async () => ({ ok: true, branchName: 'atlas', snapshotChanged: true }),
				initializeGit: async () => ({ ok: true, snapshotChanged: false }),
				getGitHubPublishInfo: async () => ({
					ghInstalled: true,
					authenticated: true,
					owners: ['sarp'],
					suggestedRepoName: 'miko',
				}),
				checkGitHubRepoAvailability: async () => ({ available: true, message: 'available' }),
				publishToGitHub: async () => ({ ok: true, snapshotChanged: false }),
				inspectGitHubBackedRepo: async () => ({
					ok: false,
					message: 'Directory must have a GitHub origin remote.',
				}),
				discardFile: async () => ({ snapshotChanged: true }),
				ignoreFile: async () => ({ snapshotChanged: true }),
				readPatch: async () => ({ path: 'app.txt', patch: 'diff', patchDigest: 'digest' }),
				readFileContents: async () => ({
					kind: 'text' as const,
					path: 'app.txt',
					name: 'app.txt',
					contents: 'hello',
					mimeType: 'text/plain; charset=utf-8',
					size: 5,
					encoding: 'utf-8' as const,
					cacheKey: 'app.txt:digest',
				}),
				readExternalFileContents: async () => ({
					kind: 'text' as const,
					path: '/tmp/app.txt',
					name: 'app.txt',
					contents: 'external',
					mimeType: 'text/plain; charset=utf-8',
					size: 8,
					encoding: 'utf-8' as const,
					cacheKey: '/tmp/app.txt:digest',
				}),
			},
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'directory-add-1',
				command: { type: 'directory.add', localPath },
			}),
		);

		expect(ws.sent).toEqual([
			{
				type: 'error',
				id: 'directory-add-1',
				message: 'Directory must have a GitHub origin remote.',
			},
		]);
	});

	test('rejects GitHub-backed directories without a main branch', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-directory-add-master-'));
		tempDirs.push(localPath);
		const { router } = await createRouter({
			diffStore: {
				getWorkspaceGitSnapshot: () => unknownGitSnapshot(),
				refreshWorkspaceGitSnapshot: async () => true,
				fetchWorkspaceGit: async () => ({ ok: true, branchName: 'atlas', snapshotChanged: true }),
				initializeGit: async () => ({ ok: true, snapshotChanged: false }),
				getGitHubPublishInfo: async () => ({
					ghInstalled: true,
					authenticated: true,
					owners: ['sarp'],
					suggestedRepoName: 'miko',
				}),
				checkGitHubRepoAvailability: async () => ({ available: true, message: 'available' }),
				publishToGitHub: async () => ({ ok: true, snapshotChanged: false }),
				inspectGitHubBackedRepo: async () => ({
					ok: true,
					repoRoot: localPath,
					defaultBranchName: 'master',
					githubOwner: 'sarp',
					githubRepo: 'miko',
				}),
				discardFile: async () => ({ snapshotChanged: true }),
				ignoreFile: async () => ({ snapshotChanged: true }),
				readPatch: async () => ({ path: 'app.txt', patch: 'diff', patchDigest: 'digest' }),
				readFileContents: async () => ({
					kind: 'text' as const,
					path: 'app.txt',
					name: 'app.txt',
					contents: 'hello',
					mimeType: 'text/plain; charset=utf-8',
					size: 5,
					encoding: 'utf-8' as const,
					cacheKey: 'app.txt:digest',
				}),
				readExternalFileContents: async () => ({
					kind: 'text' as const,
					path: '/tmp/app.txt',
					name: 'app.txt',
					contents: 'external',
					mimeType: 'text/plain; charset=utf-8',
					size: 8,
					encoding: 'utf-8' as const,
					cacheKey: '/tmp/app.txt:digest',
				}),
			},
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'directory-add-1',
				command: { type: 'directory.add', localPath },
			}),
		);

		expect(ws.sent).toEqual([
			{
				type: 'error',
				id: 'directory-add-1',
				message: 'Directory must have a main branch before it can be added.',
			},
		]);
	});

	test('reads workspace diff patches', async () => {
		const { router, workspaceId } = await createRouter();
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'patch-1',
				command: { type: 'workspace.readDiffPatch', workspaceId, path: 'app.txt' },
			}),
		);

		expect(ws.sent).toEqual([
			{
				type: 'ack',
				id: 'patch-1',
				result: { path: 'app.txt', patch: 'diff', patchDigest: 'digest' },
			},
		]);
	});

	test('falls back to persisted pull request patches when local diff is gone', async () => {
		const { router, store, workspaceId } = await createRouter({
			diffStore: {
				getWorkspaceGitSnapshot: () => unknownGitSnapshot(),
				refreshWorkspaceGitSnapshot: async () => false,
				fetchWorkspaceGit: async () => ({ ok: true, snapshotChanged: false }),
				initializeGit: async () => ({ ok: true, snapshotChanged: false }),
				getGitHubPublishInfo: async () => ({
					ghInstalled: true,
					authenticated: true,
					owners: ['sarp'],
					suggestedRepoName: 'miko',
				}),
				checkGitHubRepoAvailability: async () => ({ available: true, message: 'available' }),
				publishToGitHub: async () => ({ ok: true, snapshotChanged: false }),
				inspectGitHubBackedRepo: async () => ({
					ok: true,
					githubOwner: 'sarp',
					githubRepo: 'miko',
				}),
				discardFile: async () => ({ snapshotChanged: false }),
				ignoreFile: async () => ({ snapshotChanged: false }),
				readPatch: async () => {
					throw new Error('File is no longer changed: app.txt');
				},
				readFileContents: async () => {
					throw new Error('not used');
				},
				readExternalFileContents: async () => {
					throw new Error('not used');
				},
			},
		});
		await store.observeWorkspacePullRequest(workspaceId, {
			number: 12,
			status: 'merged',
			lastObservedAt: 1,
			files: [
				{
					path: 'app.txt/',
					changeType: 'modified',
					isUntracked: false,
					additions: 1,
					deletions: 0,
					patchDigest: 'persisted-digest',
					patch: 'persisted diff',
				},
			],
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'patch-persisted',
				command: { type: 'workspace.readDiffPatch', workspaceId, path: 'app.txt' },
			}),
		);

		expect(ws.sent).toEqual([
			{
				type: 'ack',
				id: 'patch-persisted',
				result: { path: 'app.txt/', patch: 'persisted diff', patchDigest: 'persisted-digest' },
			},
		]);
	});

	test('does not list files before workspace setup completes', async () => {
		const { router, store } = await createRouter({
			diffStore: {
				getWorkspaceGitSnapshot: () => unknownGitSnapshot(),
				refreshWorkspaceGitSnapshot: async () => false,
				fetchWorkspaceGit: async () => ({ ok: true, snapshotChanged: false }),
				initializeGit: async () => ({ ok: true, snapshotChanged: false }),
				getGitHubPublishInfo: async () => ({
					ghInstalled: true,
					authenticated: true,
					owners: ['sarp'],
					suggestedRepoName: 'miko',
				}),
				checkGitHubRepoAvailability: async () => ({ available: true, message: 'available' }),
				publishToGitHub: async () => ({ ok: true, snapshotChanged: false }),
				inspectGitHubBackedRepo: async () => ({
					ok: true,
					githubOwner: 'sarp',
					githubRepo: 'miko',
				}),
				discardFile: async () => ({ snapshotChanged: false }),
				ignoreFile: async () => ({ snapshotChanged: false }),
				readPatch: async () => ({ path: 'app.txt', patch: 'diff', patchDigest: 'digest' }),
				readFileContents: async () => {
					throw new Error('not used');
				},
				readExternalFileContents: async () => {
					throw new Error('not used');
				},
			},
		});
		const directory = store.listDirectories()[0];
		const workspace = await store.createWorkspace({
			directoryId: directory.id,
			localPath: '/repo/miko/creating',
			branchName: 'creating',
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'list-creating',
				command: { type: 'workspace.listFiles', workspaceId: workspace.id },
			}),
		);

		expect(ws.sent).toEqual([
			{ type: 'error', id: 'list-creating', message: 'Workspace is not ready yet' },
		]);
	});

	test('does not create terminals before workspace setup completes', async () => {
		const { router, store } = await createRouter();
		const directory = store.listDirectories()[0];
		const workspace = await store.createWorkspace({
			directoryId: directory.id,
			localPath: '/repo/miko/creating-terminal',
			branchName: 'creating-terminal',
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'terminal-creating',
				command: {
					type: 'terminal.create',
					workspaceId: workspace.id,
					terminalId: 'terminal-creating',
					cols: 80,
					rows: 24,
					scrollback: 1000,
				},
			}),
		);

		expect(ws.sent).toEqual([
			{ type: 'error', id: 'terminal-creating', message: 'Workspace is not ready yet' },
		]);
	});

	test('reads workspace file contents', async () => {
		const { router, workspaceId } = await createRouter();
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'file-1',
				command: { type: 'workspace.readFile', workspaceId, path: 'app.txt' },
			}),
		);

		expect(ws.sent).toEqual([
			{
				type: 'ack',
				id: 'file-1',
				result: {
					kind: 'text',
					path: 'app.txt',
					name: 'app.txt',
					contents: 'hello',
					mimeType: 'text/plain; charset=utf-8',
					size: 5,
					encoding: 'utf-8',
					cacheKey: 'app.txt:digest',
				},
			},
		]);
	});

	test('reads external file contents when the session transcript references the file', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-external-ws-router-'));
		tempDirs.push(localPath);
		const externalPath = path.join(localPath, 'app.txt');
		await Bun.write(externalPath, 'external');

		const { router, store, workspaceId, sessionId } = await createRouter();
		await store.appendMessage(sessionId, {
			_id: 'tool-call-1',
			kind: 'tool_call',
			createdAt: Date.now(),
			tool: {
				kind: 'tool',
				toolKind: 'read_file',
				toolName: 'Read',
				toolId: 'tool-call-1',
				input: { filePath: externalPath },
			},
		});
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'external-file-1',
				command: { type: 'file.readExternal', workspaceId, sessionId, path: externalPath },
			}),
		);

		expect(ws.sent).toEqual([
			{
				type: 'ack',
				id: 'external-file-1',
				result: {
					kind: 'text',
					path: '/tmp/app.txt',
					name: 'app.txt',
					contents: 'external',
					mimeType: 'text/plain; charset=utf-8',
					size: 8,
					encoding: 'utf-8',
					cacheKey: '/tmp/app.txt:digest',
				},
			},
		]);
	});

	test('normalizes refresh PR stage command results', async () => {
		const { router, workspaceId } = await createRouter();
		const ws = new FakeWebSocket();

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'refresh-1',
				command: { type: 'workspace.refreshPrStage', workspaceId },
			}),
		);

		expect(ws.sent).toEqual([
			{
				type: 'ack',
				id: 'refresh-1',
				result: {
					refreshed: true,
					snapshot: { status: 'none', owner: 'sarp', repo: 'miko', comments: [], checks: [] },
				},
			},
		]);
	});

	test('updates scratchpad and pushes subscribed snapshots', async () => {
		const { router, workspaceId } = await createRouter();
		const ws = new FakeWebSocket();
		router.handleOpen(ws as never);
		ws.data.subscriptions.set('scratchpad-sub', { type: 'scratchpad', workspaceId });

		await router.handleMessage(
			ws as never,
			JSON.stringify({
				type: 'command',
				id: 'scratchpad-1',
				command: {
					type: 'workspace.updateScratchpad',
					workspaceId,
					content: '# Updated notes',
				},
			}),
		);

		expect(ws.sent).toEqual([
			{
				type: 'ack',
				id: 'scratchpad-1',
				result: { workspaceId, content: '# Updated notes', updatedAt: 123 },
			},
			{
				type: 'snapshot',
				id: 'scratchpad-sub',
				snapshot: {
					type: 'scratchpad',
					data: { workspaceId, content: '# Updated notes', updatedAt: 123 },
				},
			},
		]);
	});
});

describe('createWsRouter.handleMessage', () => {
	test('returns errors for invalid JSON', async () => {
		const { router } = await createRouter();
		const ws = new FakeWebSocket();

		await router.handleMessage(ws as never, '{');

		expect(ws.sent).toEqual([{ type: 'error', message: 'Invalid JSON' }]);
	});

	test('unsubscribes and acknowledges the request', async () => {
		const { router } = await createRouter();
		const ws = new FakeWebSocket();
		ws.data.subscriptions.set('sub-1', { type: 'sidebar' });

		await router.handleMessage(ws as never, JSON.stringify({ type: 'unsubscribe', id: 'sub-1' }));

		expect(ws.data.subscriptions.has('sub-1')).toBe(false);
		expect(ws.sent).toEqual([{ type: 'ack', id: 'sub-1' }]);
	});
});

describe('createWsRouter.dispose', () => {
	test('disposes background listeners', async () => {
		let clearedReporter: unknown;
		let terminalDisposed = false;
		let keybindingsDisposed = false;
		let updateDisposed = false;
		const { router } = await createRouter({
			agent: {
				getActiveStatuses: () => new Map(),
				getDrainingSessionIds: () => new Set(),
				getPendingTool: () => null,
				listCommands: async () => [],
				getQueuedMessages: () => [],
				dequeueMessage: () => {},
				setBackgroundErrorReporter: (reporter: unknown) => {
					clearedReporter = reporter;
				},
			},
			terminals: {
				getSnapshot: () => null,
				onEvent: () => () => {
					terminalDisposed = true;
				},
			},
			keybindings: {
				getSnapshot: () => ({
					bindings: {},
					warning: null,
					filePathDisplay: '/tmp/keybindings.json',
				}),
				onChange: () => () => {
					keybindingsDisposed = true;
				},
			},
			updateManager: {
				getSnapshot: () => ({
					currentVersion: '1.0.0',
					latestVersion: null,
					status: 'idle',
					updateAvailable: false,
					lastCheckedAt: null,
					error: null,
					installAction: 'restart',
				}),
				onChange: () => () => {
					updateDisposed = true;
				},
			},
		});

		router.dispose();

		expect(clearedReporter).toBeNull();
		expect(terminalDisposed).toBe(true);
		expect(keybindingsDisposed).toBe(true);
		expect(updateDisposed).toBe(true);
	});
});
