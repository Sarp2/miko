import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
	WorkspaceGitHubSnapshot,
	WorkspaceGitSnapshot,
	WorkspaceSetupState,
} from 'src/shared/types';
import { DiffStore } from './diff-store';
import { runGit } from './process-utils';
import { EventStore } from './event-store';
import { WorkspaceManager } from './workspace-manager';

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function noPrSnapshot(): WorkspaceGitHubSnapshot {
	return { status: 'none', owner: 'sarp', repo: 'miko', comments: [], checks: [] };
}

function readyGitSnapshot(branchName: string): WorkspaceGitSnapshot {
	return { status: 'ready', branchName, files: [] };
}

async function createTempDir() {
	const dir = await mkdtemp(path.join(tmpdir(), 'miko-workspace-manager-'));
	tempDirs.push(dir);
	return dir;
}

async function createEventStore() {
	const dataDir = path.join(await createTempDir(), 'data');
	const store = new EventStore(dataDir);
	await store.initialize();
	return store;
}

async function createWorkspaceManager(
	store: EventStore,
	deps: ConstructorParameters<typeof WorkspaceManager>[1] = {},
) {
	return new WorkspaceManager(store, {
		...deps,
		worktreesRoot: deps.worktreesRoot ?? path.join(await createTempDir(), 'worktrees'),
	});
}

async function createGitHubBackedDirectory() {
	const root = await createTempDir();
	const sourcePath = path.join(root, 'miko');
	const originPath = path.join(root, 'origin.git');

	await mkdir(sourcePath, { recursive: true });
	await runGit(['init', '-b', 'main'], sourcePath);
	await runGit(['config', 'user.email', 'miko@example.com'], sourcePath);
	await runGit(['config', 'user.name', 'Miko'], sourcePath);
	await Bun.write(path.join(sourcePath, 'README.md'), 'hello\n');
	await runGit(['add', '.'], sourcePath);
	await runGit(['commit', '-m', 'init'], sourcePath);
	await runGit(['init', '--bare', originPath], root);
	await runGit(['remote', 'add', 'origin', originPath], sourcePath);
	await runGit(['push', '-u', 'origin', 'main'], sourcePath);

	const store = await createEventStore();
	const directory = await store.addDirectory({
		localPath: sourcePath,
		title: 'Miko',
		githubOwner: 'sarp',
		githubRepo: 'miko',
	});

	return { store, directory, sourcePath, originPath };
}

async function createGitDirectoryWithoutMain() {
	const sourcePath = path.join(await createTempDir(), 'miko');
	await mkdir(sourcePath, { recursive: true });
	await runGit(['init', '-b', 'dev'], sourcePath);
	await runGit(['config', 'user.email', 'miko@example.com'], sourcePath);
	await runGit(['config', 'user.name', 'Miko'], sourcePath);
	await Bun.write(path.join(sourcePath, 'README.md'), 'hello\n');
	await runGit(['add', '.'], sourcePath);
	await runGit(['commit', '-m', 'init'], sourcePath);

	const store = await createEventStore();
	const directory = await store.addDirectory({
		localPath: sourcePath,
		title: 'Miko',
		githubOwner: 'sarp',
		githubRepo: 'miko',
	});

	return { store, directory, sourcePath };
}

async function createReadyWorkspace() {
	const setup = await createGitHubBackedDirectory();
	const refreshCalls: Array<{ workspaceId: string; localPath: string }> = [];
	const manager = await createWorkspaceManager(setup.store, {
		diffStore: {
			refreshWorkspaceGitSnapshot: async (workspaceId, localPath) => {
				refreshCalls.push({ workspaceId, localPath });
				return true;
			},
		},
	});
	const result = await manager.createWorkspace(setup.directory.id);
	return { ...setup, manager, refreshCalls, ...result };
}

describe('WorkspaceManager.refreshWorkspacePrStage', () => {
	test('skips refresh when no PR manager is configured', async () => {
		const store = await createEventStore();
		const manager = new WorkspaceManager(store);

		await expect(manager.refreshWorkspacePrStage('workspace-1')).resolves.toEqual({
			refreshed: false,
			snapshot: null,
		});
	});

	test('uses cooldown unless force is requested', async () => {
		const store = await createEventStore();
		let refreshCalls = 0;
		const snapshot: WorkspaceGitHubSnapshot = {
			status: 'open',
			owner: 'sarp',
			repo: 'miko',
			prNumber: 12,
			title: 'Add workspace tests',
			url: 'https://github.com/sarp/miko/pull/12',
			comments: [],
			checks: [],
		};
		const manager = new WorkspaceManager(store, {
			prManager: {
				clearWorkspaceGitHubSnapshot: () => {},
				getWorkspaceGitHubSnapshot: () => snapshot,
				refreshWorkspacePrState: async () => {
					refreshCalls += 1;
					return snapshot;
				},
			},
		});

		await expect(manager.refreshWorkspacePrStage('workspace-1')).resolves.toEqual({
			refreshed: true,
			snapshot,
		});
		await expect(manager.refreshWorkspacePrStage('workspace-1')).resolves.toEqual({
			refreshed: false,
			snapshot,
		});
		await expect(manager.refreshWorkspacePrStage('workspace-1', { force: true })).resolves.toEqual({
			refreshed: true,
			snapshot,
		});
		expect(refreshCalls).toBe(2);
	});

	test('does not perform a git refresh from the PR refresh path', async () => {
		const { store, directory } = await createGitHubBackedDirectory();
		const workspace = await store.createWorkspace({
			directoryId: directory.id,
			localPath: path.join(directory.localPath, 'atlas'),
			branchName: 'atlas',
		});
		await store.markWorkspaceSetupCompleted(workspace.id);
		let gitRefreshCalls = 0;
		let prRefreshCalls = 0;
		const manager = new WorkspaceManager(store, {
			diffStore: {
				refreshWorkspaceGitSnapshot: async () => {
					gitRefreshCalls += 1;
					return true;
				},
				getWorkspaceGitSnapshot: () => readyGitSnapshot('atlas'),
			},
			prManager: {
				clearWorkspaceGitHubSnapshot: () => {},
				getWorkspaceGitHubSnapshot: () => null,
				refreshWorkspacePrState: async () => {
					prRefreshCalls += 1;
					return noPrSnapshot();
				},
			},
		});

		await manager.refreshWorkspacePrStage(workspace.id, { force: true });

		expect(gitRefreshCalls).toBe(0);
		expect(prRefreshCalls).toBe(1);
	});

	test('cached branch changes bypass PR cooldown without refreshing git again', async () => {
		const { store, directory } = await createGitHubBackedDirectory();
		const workspace = await store.createWorkspace({
			directoryId: directory.id,
			localPath: path.join(directory.localPath, 'atlas'),
			branchName: 'atlas',
		});
		await store.markWorkspaceSetupCompleted(workspace.id);
		let gitSnapshot = readyGitSnapshot('atlas');
		let gitRefreshCalls = 0;
		let prRefreshCalls = 0;
		const clearedSnapshots: string[] = [];
		const manager = new WorkspaceManager(store, {
			diffStore: {
				refreshWorkspaceGitSnapshot: async () => {
					gitRefreshCalls += 1;
					return true;
				},
				getWorkspaceGitSnapshot: () => gitSnapshot,
			},
			prManager: {
				clearWorkspaceGitHubSnapshot: (workspaceId) => {
					clearedSnapshots.push(workspaceId);
				},
				getWorkspaceGitHubSnapshot: () => null,
				refreshWorkspacePrState: async () => {
					prRefreshCalls += 1;
					return noPrSnapshot();
				},
			},
		});

		await manager.refreshWorkspacePrStage(workspace.id);
		gitSnapshot = readyGitSnapshot('workspace-scaffold');
		await manager.refreshWorkspacePrStage(workspace.id);

		expect(gitRefreshCalls).toBe(0);
		expect(prRefreshCalls).toBe(2);
		expect(store.requireWorkspace(workspace.id).branchName).toBe('workspace-scaffold');
		expect(clearedSnapshots).toEqual([workspace.id]);
	});
});

describe('WorkspaceManager.markWorkspaceInstructionTurnStarted', () => {
	test('rejects sessions from another workspace', async () => {
		const { store, directory } = await createGitHubBackedDirectory();
		const first = await store.createWorkspace({
			directoryId: directory.id,
			localPath: path.join(directory.localPath, 'atlas'),
			branchName: 'atlas',
		});
		const second = await store.createWorkspace({
			directoryId: directory.id,
			localPath: path.join(directory.localPath, 'orion'),
			branchName: 'orion',
		});
		await store.markWorkspaceSetupCompleted(first.id);
		await store.markWorkspaceSetupCompleted(second.id);
		const session = await store.createSession(first.id);
		const manager = new WorkspaceManager(store);

		expect(() =>
			manager.markWorkspaceInstructionTurnStarted({
				workspaceId: second.id,
				sessionId: session.id,
				intent: 'commit_and_push',
			}),
		).toThrow('Session does not belong to workspace');
	});
});

describe('WorkspaceManager.clearWorkspaceInstructionTurn', () => {
	test('removes pending instruction intent before turn settlement', async () => {
		const { store, directory } = await createGitHubBackedDirectory();
		const workspace = await store.createWorkspace({
			directoryId: directory.id,
			localPath: path.join(directory.localPath, 'atlas'),
			branchName: 'atlas',
		});
		await store.markWorkspaceSetupCompleted(workspace.id);
		const session = await store.createSession(workspace.id);
		let prRefreshCalls = 0;
		const manager = new WorkspaceManager(store, {
			diffStore: {
				refreshWorkspaceGitSnapshot: async () => false,
			},
			prManager: {
				clearWorkspaceGitHubSnapshot: () => {},
				getWorkspaceGitHubSnapshot: () => null,
				refreshWorkspacePrState: async () => {
					prRefreshCalls += 1;
					return noPrSnapshot();
				},
			},
		});

		manager.markWorkspaceInstructionTurnStarted({
			workspaceId: workspace.id,
			sessionId: session.id,
			intent: 'create_pr',
		});
		manager.clearWorkspaceInstructionTurn(session.id);

		await expect(manager.handleWorkspaceTurnSettled({ sessionId: session.id })).resolves.toEqual({
			changed: false,
		});
		expect(prRefreshCalls).toBe(0);
	});
});

describe('WorkspaceManager.handleWorkspaceTurnSettled', () => {
	test('refreshes git and forces PR refresh after create-pr instruction turns', async () => {
		const { store, directory } = await createGitHubBackedDirectory();
		const workspace = await store.createWorkspace({
			directoryId: directory.id,
			localPath: path.join(directory.localPath, 'atlas'),
			branchName: 'atlas',
		});
		await store.markWorkspaceSetupCompleted(workspace.id);
		const session = await store.createSession(workspace.id);
		let prRefreshCalls = 0;
		const manager = new WorkspaceManager(store, {
			diffStore: {
				refreshWorkspaceGitSnapshot: async () => true,
			},
			prManager: {
				clearWorkspaceGitHubSnapshot: () => {},
				getWorkspaceGitHubSnapshot: () => null,
				refreshWorkspacePrState: async () => {
					prRefreshCalls += 1;
					return noPrSnapshot();
				},
			},
		});

		await manager.refreshWorkspacePrStage(workspace.id);

		manager.markWorkspaceInstructionTurnStarted({
			workspaceId: workspace.id,
			sessionId: session.id,
			intent: 'create_pr',
		});

		await expect(manager.handleWorkspaceTurnSettled({ sessionId: session.id })).resolves.toEqual({
			changed: true,
		});
		expect(prRefreshCalls).toBe(2);
	});

	test('refreshes open PR stages after regular turns in review workspaces', async () => {
		const { store, directory } = await createGitHubBackedDirectory();
		const workspace = await store.createWorkspace({
			directoryId: directory.id,
			localPath: path.join(directory.localPath, 'atlas'),
			branchName: 'atlas',
		});
		await store.markWorkspaceSetupCompleted(workspace.id);
		await store.setWorkspaceReviewState(workspace.id, 'in_review');
		const session = await store.createSession(workspace.id);
		let prRefreshCalls = 0;
		const manager = new WorkspaceManager(store, {
			diffStore: {
				refreshWorkspaceGitSnapshot: async () => false,
			},
			prManager: {
				clearWorkspaceGitHubSnapshot: () => {},
				getWorkspaceGitHubSnapshot: () => null,
				refreshWorkspacePrState: async () => {
					prRefreshCalls += 1;
					return noPrSnapshot();
				},
			},
		});

		await expect(manager.handleWorkspaceTurnSettled({ sessionId: session.id })).resolves.toEqual({
			changed: true,
		});
		expect(prRefreshCalls).toBe(1);
	});

	test('keeps turn settlement recoverable when refreshes fail', async () => {
		const { store, directory } = await createGitHubBackedDirectory();
		const workspace = await store.createWorkspace({
			directoryId: directory.id,
			localPath: path.join(directory.localPath, 'atlas'),
			branchName: 'atlas',
		});
		await store.markWorkspaceSetupCompleted(workspace.id);
		const session = await store.createSession(workspace.id);
		const originalConsoleError = console.error;
		console.error = () => {};
		try {
			const manager = new WorkspaceManager(store, {
				diffStore: {
					refreshWorkspaceGitSnapshot: async () => {
						throw new Error('git refresh failed');
					},
				},
				prManager: {
					clearWorkspaceGitHubSnapshot: () => {},
					getWorkspaceGitHubSnapshot: () => null,
					refreshWorkspacePrState: async () => {
						throw new Error('pr refresh failed');
					},
				},
			});

			manager.markWorkspaceInstructionTurnStarted({
				workspaceId: workspace.id,
				sessionId: session.id,
				intent: 'create_pr',
			});

			await expect(manager.handleWorkspaceTurnSettled({ sessionId: session.id })).resolves.toEqual({
				changed: false,
			});
		} finally {
			console.error = originalConsoleError;
		}
	});
});

describe('WorkspaceManager.getWorkspaceHealthState', () => {
	test('returns workspace_missing when metadata points to a missing worktree', async () => {
		const { store, directory } = await createGitHubBackedDirectory();
		const workspace = await store.createWorkspace({
			directoryId: directory.id,
			localPath: path.join(directory.localPath, 'atlas'),
			branchName: 'atlas',
		});
		await store.markWorkspaceSetupCompleted(workspace.id);
		const manager = new WorkspaceManager(store);

		await expect(manager.getWorkspaceHealthState(workspace.id)).resolves.toBe('workspace_missing');
	});

	test('returns healthy for a matching git worktree and GitHub remote', async () => {
		const { workspace, manager } = await createReadyWorkspace();
		await runGit(
			['remote', 'set-url', 'origin', 'https://github.com/sarp/miko.git'],
			workspace.localPath,
		);

		await expect(manager.getWorkspaceHealthState(workspace.id)).resolves.toBe('healthy');
	});

	test('returns branch_missing when metadata and worktree branch diverge', async () => {
		const { store, workspace, manager } = await createReadyWorkspace();
		await runGit(
			['remote', 'set-url', 'origin', 'https://github.com/sarp/miko.git'],
			workspace.localPath,
		);
		await store.setWorkspaceBranch(workspace.id, 'orion');

		await expect(manager.getWorkspaceHealthState(workspace.id)).resolves.toBe('branch_missing');
	});
});

describe('WorkspaceManager.createWorkspace', () => {
	test('creates a git worktree, marks setup ready, and creates the first session', async () => {
		const { workspace, session, sourcePath, directory, refreshCalls } =
			await createReadyWorkspace();

		const workspacePath = workspace.localPath;
		await expect(stat(workspacePath)).resolves.toMatchObject({});
		expect(workspace).toMatchObject({
			branchName: 'atlas',
			localPath: expect.stringContaining(path.join('worktrees', directory.id, 'atlas')),
			setupState: 'ready',
		});
		expect(session).toMatchObject({ workspaceId: workspace.id });
		expect(workspacePath.startsWith(sourcePath)).toBe(false);
		expect((await runGit(['branch', '--show-current'], workspacePath)).stdout.trim()).toBe('atlas');
		expect(
			(await runGit(['rev-parse', '--abbrev-ref', '@{upstream}'], workspacePath)).exitCode,
		).not.toBe(0);
		expect(refreshCalls).toEqual([{ workspaceId: workspace.id, localPath: workspacePath }]);
	});

	test('uses each codename before adding numeric suffixes', async () => {
		const setup = await createGitHubBackedDirectory();
		const manager = await createWorkspaceManager(setup.store, {
			diffStore: {
				refreshWorkspaceGitSnapshot: async () => true,
			},
		});

		const first = await manager.createWorkspace(setup.directory.id);
		const second = await manager.createWorkspace(setup.directory.id);
		const third = await manager.createWorkspace(setup.directory.id);

		expect(first.workspace.branchName).toBe('atlas');
		expect(second.workspace.branchName).toBe('orion');
		expect(third.workspace.branchName).toBe('vega');
	});

	test('keeps a created workspace ready when the non-critical git snapshot refresh fails', async () => {
		const setup = await createGitHubBackedDirectory();
		const manager = await createWorkspaceManager(setup.store, {
			diffStore: {
				refreshWorkspaceGitSnapshot: async () => {
					throw new Error('refresh failed');
				},
			},
		});

		const result = await manager.createWorkspace(setup.directory.id);

		expect(result.session).toMatchObject({ workspaceId: result.workspace.id });
		expect(result.workspace).toMatchObject({ setupState: 'ready', setupError: undefined });
		expect(setup.store.listSessionsByWorkspace(result.workspace.id)).toHaveLength(1);
	});

	test('marks setup failed and does not create a session when git worktree creation fails', async () => {
		const { store, directory } = await createGitDirectoryWithoutMain();
		const manager = await createWorkspaceManager(store);

		const result = await manager.createWorkspace(directory.id);

		expect(result.session).toBeNull();
		expect(result.workspace).toMatchObject({ setupState: 'failed' });
		expect(result.workspace.setupError).toContain('Directory must have a main branch');
		expect(store.listSessionsByWorkspace(result.workspace.id)).toEqual([]);
	});

	test('broadcasts the persisted setup state after creating and ready transitions', async () => {
		const setup = await createGitHubBackedDirectory();
		const observedStates: WorkspaceSetupState[] = [];
		const manager = await createWorkspaceManager(setup.store, {
			diffStore: { refreshWorkspaceGitSnapshot: async () => true },
			onWorkspaceSetupStateChanged: (workspaceId) => {
				observedStates.push(setup.store.requireWorkspace(workspaceId).setupState);
			},
		});

		const result = await manager.createWorkspace(setup.directory.id);

		expect(result.workspace.setupState).toBe('ready');
		expect(observedStates).toEqual(['creating', 'ready']);
	});

	test('broadcasts the persisted failed setup state when git worktree creation fails', async () => {
		const { store, directory } = await createGitDirectoryWithoutMain();
		const observedStates: WorkspaceSetupState[] = [];
		const manager = await createWorkspaceManager(store, {
			onWorkspaceSetupStateChanged: (workspaceId) => {
				observedStates.push(store.requireWorkspace(workspaceId).setupState);
			},
		});

		const result = await manager.createWorkspace(directory.id);

		expect(result.workspace.setupState).toBe('failed');
		expect(observedStates).toEqual(['creating', 'failed']);
	});

	test('keeps workspace creation working when the broadcast callback throws', async () => {
		const setup = await createGitHubBackedDirectory();
		const originalConsoleError = console.error;
		console.error = () => {};
		try {
			const manager = await createWorkspaceManager(setup.store, {
				diffStore: { refreshWorkspaceGitSnapshot: async () => true },
				onWorkspaceSetupStateChanged: () => {
					throw new Error('broadcast failed');
				},
			});

			const result = await manager.createWorkspace(setup.directory.id);

			expect(result.workspace.setupState).toBe('ready');
			expect(result.session).toMatchObject({ workspaceId: result.workspace.id });
		} finally {
			console.error = originalConsoleError;
		}
	});

	test('fails loudly when git cannot list existing branches', async () => {
		const sourcePath = path.join(await createTempDir(), 'not-a-git-repo');
		await mkdir(sourcePath, { recursive: true });
		const store = await createEventStore();
		const directory = await store.addDirectory({
			localPath: sourcePath,
			githubOwner: 'sarp',
			githubRepo: 'miko',
		});
		const manager = await createWorkspaceManager(store);

		await expect(manager.createWorkspace(directory.id)).rejects.toThrow(
			'Git could not list local branches',
		);
	});
});

describe('WorkspaceManager.continueWorkspaceOnNewBranch', () => {
	test('keeps the same worktree and resets merged PR metadata onto a fresh branch', async () => {
		const setup = await createGitHubBackedDirectory();
		const refreshCalls: Array<{ workspaceId: string; localPath: string }> = [];
		const prRefreshCalls: string[] = [];
		const prClearCalls: string[] = [];
		const manager = await createWorkspaceManager(setup.store, {
			diffStore: {
				refreshWorkspaceGitSnapshot: async (workspaceId, localPath) => {
					refreshCalls.push({ workspaceId, localPath });
					return true;
				},
			},
			prManager: {
				clearWorkspaceGitHubSnapshot: (workspaceId) => {
					prClearCalls.push(workspaceId);
				},
				getWorkspaceGitHubSnapshot: () => null,
				refreshWorkspacePrState: async (workspaceId) => {
					prRefreshCalls.push(workspaceId);
					return noPrSnapshot();
				},
			},
		});
		const { workspace } = await manager.createWorkspace(setup.directory.id);
		const previousBranchName = workspace.branchName;
		await setup.store.observeWorkspacePullRequest(workspace.id, {
			number: 88,
			status: 'merged',
			title: 'Merged work',
			url: 'https://github.com/sarp/miko/pull/88',
			headRefName: workspace.branchName,
			baseRefName: 'main',
			ciStatus: 'passing',
			lastObservedAt: 100,
		});
		await setup.store.setWorkspaceReviewState(workspace.id, 'done');

		const continued = await manager.continueWorkspaceOnNewBranch(workspace.id);

		expect(continued.id).toBe(workspace.id);
		expect(continued.localPath).toBe(workspace.localPath);
		expect(continued.branchName).toBe(`${previousBranchName}-v1`);
		expect(continued.reviewState).toBe('in_progress');
		expect(continued.pullRequest).toBeUndefined();
		expect((await runGit(['branch', '--show-current'], workspace.localPath)).stdout.trim()).toBe(
			continued.branchName,
		);
		expect(refreshCalls.at(-1)).toEqual({
			workspaceId: workspace.id,
			localPath: workspace.localPath,
		});
		expect(prRefreshCalls).toContain(workspace.id);
		expect(prClearCalls).toContain(workspace.id);
		expect(
			await runGit(
				['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
				workspace.localPath,
			),
		).toMatchObject({ exitCode: 128 });
	});

	test('rolls back checkout and deletes continuation branch when metadata update fails', async () => {
		const setup = await createGitHubBackedDirectory();
		const manager = await createWorkspaceManager(setup.store);
		const { workspace } = await manager.createWorkspace(setup.directory.id);
		await setup.store.observeWorkspacePullRequest(workspace.id, {
			number: 88,
			status: 'merged',
			title: 'Merged work',
			lastObservedAt: 100,
		});
		await setup.store.setWorkspaceReviewState(workspace.id, 'done');
		const previousBranchName = workspace.branchName;
		setup.store.clearWorkspacePullRequest = async () => {
			throw new Error('disk write failed');
		};

		await expect(manager.continueWorkspaceOnNewBranch(workspace.id)).rejects.toThrow(
			'disk write failed',
		);

		expect((await runGit(['branch', '--show-current'], workspace.localPath)).stdout.trim()).toBe(
			previousBranchName,
		);
		const branches = await runGit(['branch', '--format=%(refname:short)'], workspace.localPath);
		expect(branches.stdout).not.toContain(`${previousBranchName}-v1`);
		expect(setup.store.requireWorkspace(workspace.id).branchName).toBe(previousBranchName);
	});

	test('skips continuation branch names that already exist on the remote', async () => {
		const setup = await createGitHubBackedDirectory();
		const manager = await createWorkspaceManager(setup.store);
		const { workspace } = await manager.createWorkspace(setup.directory.id);
		const previousBranchName = workspace.branchName;
		await runGit(['branch', `${previousBranchName}-v1`], setup.directory.localPath);
		await runGit(['push', 'origin', `${previousBranchName}-v1`], setup.directory.localPath);
		await runGit(['branch', '-D', `${previousBranchName}-v1`], setup.directory.localPath);
		await setup.store.observeWorkspacePullRequest(workspace.id, {
			number: 88,
			status: 'merged',
			title: 'Merged work',
			lastObservedAt: 100,
		});
		await setup.store.setWorkspaceReviewState(workspace.id, 'done');

		const continued = await manager.continueWorkspaceOnNewBranch(workspace.id);

		expect(continued.branchName).toBe(`${previousBranchName}-v2`);
	});

	test('rejects workspaces that are not terminal', async () => {
		const { manager, workspace } = await createReadyWorkspace();

		await expect(manager.continueWorkspaceOnNewBranch(workspace.id)).rejects.toThrow(
			'Workspace can only continue after its pull request is merged or closed',
		);
	});

	test('increments continuation branch suffixes that already exist', async () => {
		const setup = await createGitHubBackedDirectory();
		const manager = await createWorkspaceManager(setup.store);
		const { workspace } = await manager.createWorkspace(setup.directory.id);
		const previousBranchName = workspace.branchName;
		await runGit(['branch', `${previousBranchName}-v1`], setup.directory.localPath);
		await setup.store.observeWorkspacePullRequest(workspace.id, {
			number: 88,
			status: 'merged',
			title: 'Merged work',
			lastObservedAt: 100,
		});
		await setup.store.setWorkspaceReviewState(workspace.id, 'done');

		const continued = await manager.continueWorkspaceOnNewBranch(workspace.id);

		expect(continued.branchName).toBe(`${previousBranchName}-v2`);
	});
});

describe('WorkspaceManager.renameWorkspaceBranch', () => {
	test('syncs workspace metadata when an agent renames the branch directly in git', async () => {
		const setup = await createGitHubBackedDirectory();
		const diffStore = new DiffStore(setup.store.dataDir);
		const clearedSnapshots: string[] = [];
		const manager = await createWorkspaceManager(setup.store, {
			diffStore,
			prManager: {
				clearWorkspaceGitHubSnapshot: (workspaceId) => {
					clearedSnapshots.push(workspaceId);
				},
				getWorkspaceGitHubSnapshot: () => null,
				refreshWorkspacePrState: async () => noPrSnapshot(),
			},
		});
		const { workspace } = await manager.createWorkspace(setup.directory.id);

		await runGit(['branch', '-m', 'workspace-scaffold'], workspace.localPath);

		const changed = await manager.refreshWorkspaceGitSnapshot(workspace.id);

		expect(changed).toBe(true);
		expect(setup.store.requireWorkspace(workspace.id).branchName).toBe('workspace-scaffold');
		expect(diffStore.getWorkspaceGitSnapshot(workspace.id).branchName).toBe('workspace-scaffold');
		expect(clearedSnapshots).toEqual([workspace.id]);
	});

	test('renames a local-only workspace branch', async () => {
		const { manager, workspace, refreshCalls } = await createReadyWorkspace();

		const renamed = await manager.renameWorkspaceBranch(workspace.id, 'Feature Login!!');

		expect(renamed.branchName).toBe('feature-login');
		expect((await runGit(['branch', '--show-current'], workspace.localPath)).stdout.trim()).toBe(
			'feature-login',
		);
		expect(refreshCalls.at(-1)).toEqual({
			workspaceId: workspace.id,
			localPath: workspace.localPath,
		});
	});

	test('checks the current worktree branch before pushed-branch guards', async () => {
		const { manager, workspace } = await createReadyWorkspace();
		await runGit(['checkout', '-b', 'manual-branch'], workspace.localPath);
		await runGit(['push', '-u', 'origin', 'manual-branch'], workspace.localPath);

		await expect(manager.renameWorkspaceBranch(workspace.id, 'orion')).rejects.toThrow(
			'Workspace worktree is not on the expected branch',
		);
	});

	test('rolls back the git branch when metadata rename fails', async () => {
		const { store, manager, workspace } = await createReadyWorkspace();
		const previousBranchName = workspace.branchName;
		const originalSetWorkspaceBranch = store.setWorkspaceBranch.bind(store);
		store.setWorkspaceBranch = async () => {
			throw new Error('snapshot write failed');
		};

		await expect(manager.renameWorkspaceBranch(workspace.id, 'orion')).rejects.toThrow(
			'snapshot write failed',
		);
		expect((await runGit(['branch', '--show-current'], workspace.localPath)).stdout.trim()).toBe(
			previousBranchName,
		);
		expect(store.requireWorkspace(workspace.id).branchName).toBe(workspace.branchName);

		store.setWorkspaceBranch = originalSetWorkspaceBranch;
	});

	test('rejects branch rename after PR creation', async () => {
		const { store, manager, workspace } = await createReadyWorkspace();
		await store.observeWorkspacePullRequest(workspace.id, {
			number: 12,
			status: 'open',
			title: 'Add login',
			lastObservedAt: Date.now(),
		});

		await expect(manager.renameWorkspaceBranch(workspace.id, 'orion')).rejects.toThrow(
			'Cannot rename a workspace branch after PR creation',
		);
	});

	test('rejects branch rename after the branch has been pushed', async () => {
		const { manager, workspace } = await createReadyWorkspace();
		await runGit(['push', '-u', 'origin', workspace.branchName], workspace.localPath);

		await expect(manager.renameWorkspaceBranch(workspace.id, 'orion')).rejects.toThrow(
			'Cannot rename a workspace branch after it has been pushed',
		);
	});
});
