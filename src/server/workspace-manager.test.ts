import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WorkspaceGitHubSnapshot } from 'src/shared/types';
import { runGit } from './diff-store';
import { EventStore } from './event-store';
import { WorkspaceManager } from './workspace-manager';

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function noPrSnapshot(): WorkspaceGitHubSnapshot {
	return { status: 'none', owner: 'sarp', repo: 'miko', comments: [], checks: [] };
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
	const manager = new WorkspaceManager(setup.store, {
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
		const { workspace, session, sourcePath, refreshCalls } = await createReadyWorkspace();

		await expect(stat(workspace.localPath)).resolves.toMatchObject({});
		expect(workspace).toMatchObject({
			branchName: 'atlas',
			localPath: path.join(sourcePath, 'atlas'),
			setupState: 'ready',
		});
		expect(session).toMatchObject({ workspaceId: workspace.id });
		expect(await readFile(path.join(sourcePath, '.git/info/exclude'), 'utf-8')).toContain(
			'/atlas/',
		);
		expect((await runGit(['branch', '--show-current'], workspace.localPath)).stdout.trim()).toBe(
			'atlas',
		);
		expect(
			(await runGit(['rev-parse', '--abbrev-ref', '@{upstream}'], workspace.localPath)).exitCode,
		).not.toBe(0);
		expect(refreshCalls).toEqual([{ workspaceId: workspace.id, localPath: workspace.localPath }]);
	});

	test('keeps a created workspace ready when the non-critical git snapshot refresh fails', async () => {
		const setup = await createGitHubBackedDirectory();
		const manager = new WorkspaceManager(setup.store, {
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
		const manager = new WorkspaceManager(store);

		const result = await manager.createWorkspace(directory.id);

		expect(result.session).toBeNull();
		expect(result.workspace).toMatchObject({ setupState: 'failed' });
		expect(result.workspace.setupError).toContain('Directory must have a main branch');
		expect(store.listSessionsByWorkspace(result.workspace.id)).toEqual([]);
	});

	test('removes the source exclude entry when worktree setup fails after writing it', async () => {
		const { store, directory, sourcePath } = await createGitDirectoryWithoutMain();
		const manager = new WorkspaceManager(store);

		const result = await manager.createWorkspace(directory.id);

		expect(result.session).toBeNull();
		expect(result.workspace.setupState).toBe('failed');
		expect(await readFile(path.join(sourcePath, '.git/info/exclude'), 'utf-8')).not.toContain(
			'/atlas/',
		);
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
		const manager = new WorkspaceManager(store);

		await expect(manager.createWorkspace(directory.id)).rejects.toThrow(
			'Git could not list local branches',
		);
	});
});

describe('WorkspaceManager.renameWorkspaceBranch', () => {
	test('renames a local-only workspace branch', async () => {
		const { manager, workspace, sourcePath, refreshCalls } = await createReadyWorkspace();

		const renamed = await manager.renameWorkspaceBranch(workspace.id, 'Feature Login!!');

		expect(renamed.branchName).toBe('feature-login');
		expect((await runGit(['branch', '--show-current'], workspace.localPath)).stdout.trim()).toBe(
			'feature-login',
		);
		expect(await readFile(path.join(sourcePath, '.git/info/exclude'), 'utf-8')).toContain(
			'/atlas/',
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
		const originalSetWorkspaceBranch = store.setWorkspaceBranch.bind(store);
		store.setWorkspaceBranch = async () => {
			throw new Error('snapshot write failed');
		};

		await expect(manager.renameWorkspaceBranch(workspace.id, 'orion')).rejects.toThrow(
			'snapshot write failed',
		);
		expect((await runGit(['branch', '--show-current'], workspace.localPath)).stdout.trim()).toBe(
			workspace.branchName,
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
