import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
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
		inspectGitHubBackedRepo: async () => ({ ok: true }),
		discardFile: async () => ({ snapshotChanged: true }),
		ignoreFile: async () => ({ snapshotChanged: true }),
		readPatch: async () => ({ patch: 'diff' }),
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
		agent: {
			getActiveStatuses: () => new Map(),
			getDrainingSessionIds: () => new Set(),
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
});

describe('createWsRouter.handleCommand', () => {
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

		expect(ws.sent).toEqual([{ type: 'ack', id: 'patch-1', result: { patch: 'diff' } }]);
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
