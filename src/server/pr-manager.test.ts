import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WorkspaceRecord } from './event';
import { EventStore } from './event-store';
import { PrManager } from './pr-manager';

type GhResult = { stdout: string; stderr: string; exitCode: number };

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createEventStore() {
	const dataDir = await mkdtemp(path.join(tmpdir(), 'miko-pr-manager-'));
	tempDirs.push(dataDir);
	const store = new EventStore(dataDir);
	await store.initialize();
	return store;
}

async function createWorkspace(args: { branchName?: string; localPath?: string } = {}) {
	const store = await createEventStore();
	const directory = await store.addDirectory({
		localPath: '/repo/miko',
		title: 'Miko',
		githubOwner: 'sarp',
		githubRepo: 'miko',
	});
	const branchName = args.branchName ?? 'atlas';
	const workspace = await store.createWorkspace({
		directoryId: directory.id,
		localPath: args.localPath ?? `/repo/miko/${branchName}`,
		branchName,
	});
	await store.markWorkspaceSetupCompleted(workspace.id);
	return { store, directory, workspace };
}

async function createAdditionalWorkspace(
	store: EventStore,
	directoryId: string,
	args: {
		branchName: string;
		reviewState?: WorkspaceRecord['reviewState'];
		visibilityState?: WorkspaceRecord['visibilityState'];
	},
) {
	const workspace = await store.createWorkspace({
		directoryId,
		localPath: `/repo/miko/${args.branchName}`,
		branchName: args.branchName,
	});
	await store.markWorkspaceSetupCompleted(workspace.id);
	if (args.reviewState) await store.setWorkspaceReviewState(workspace.id, args.reviewState);
	if (args.visibilityState)
		await store.setWorkspaceVisibilityState(workspace.id, args.visibilityState);
	return store.requireWorkspace(workspace.id);
}

function okJson(value: unknown): GhResult {
	return { stdout: JSON.stringify(value), stderr: '', exitCode: 0 };
}

function okText(stdout: string): GhResult {
	return { stdout, stderr: '', exitCode: 0 };
}

function failed(stderr: string): GhResult {
	return { stdout: '', stderr, exitCode: 1 };
}

function openPrView() {
	return {
		number: 12,
		title: 'Add workspace model',
		body: 'PR body',
		url: 'https://github.com/sarp/miko/pull/12',
		state: 'OPEN',
		headRefName: 'atlas',
		baseRefName: 'main',
		createdAt: '2026-01-01T00:00:00Z',
		comments: [
			{
				id: 'issue-comment-1',
				author: { login: 'coderabbitai[bot]' },
				authorAssociation: 'NONE',
				body: 'Fix this issue',
				url: 'https://github.com/sarp/miko/pull/12#issuecomment-1',
				createdAt: '2026-01-01T00:00:00Z',
			},
		],
		reviews: [
			{
				id: 'review-1',
				author: { login: 'reviewer' },
				body: 'Looks close',
				url: 'https://github.com/sarp/miko/pull/12#pullrequestreview-1',
				submittedAt: '2026-01-01T01:00:00Z',
			},
		],
		statusCheckRollup: [
			{
				name: 'test',
				workflowName: 'CI',
				status: 'COMPLETED',
				conclusion: 'FAILURE',
				detailsUrl: 'https://github.com/sarp/miko/actions/runs/1',
			},
		],
	};
}

describe('PrManager.getWorkspaceGitHubSnapshot', () => {
	test('returns null before a workspace has been refreshed', async () => {
		const { store, workspace } = await createWorkspace();
		const manager = new PrManager(store, { runGh: async () => okJson([]) });

		expect(manager.getWorkspaceGitHubSnapshot(workspace.id)).toBeNull();
	});
});

describe('PrManager.refreshWorkspacePrState', () => {
	test('discovers a PR by branch, caches GitHub metadata, and updates workspace review state', async () => {
		const { store, workspace } = await createWorkspace();
		const calls: string[][] = [];
		const manager = new PrManager(store, {
			runGh: async (args) => {
				calls.push(args);
				if (args[0] === 'pr' && args[1] === 'list') {
					return okJson([
						{
							number: 12,
							title: 'List title',
							url: 'https://github.com/sarp/miko/pull/12',
							state: 'OPEN',
							headRefName: 'atlas',
							baseRefName: 'main',
							createdAt: '2026-01-01T00:00:00Z',
						},
					]);
				}
				if (args[0] === 'pr' && args[1] === 'view') return okJson(openPrView());
				return failed('unexpected gh command');
			},
		});

		const snapshot = await manager.refreshWorkspacePrState(workspace.id);

		expect(calls[0]).toEqual([
			'pr',
			'list',
			'--repo',
			'sarp/miko',
			'--head',
			'atlas',
			'--state',
			'all',
			'--limit',
			'20',
			'--json',
			'number,title,url,state,headRefName,baseRefName,isDraft,createdAt',
		]);
		expect(snapshot).toMatchObject({
			status: 'open',
			owner: 'sarp',
			repo: 'miko',
			prNumber: 12,
			title: 'Add workspace model',
			body: 'PR body',
			ciStatus: 'failing',
			createdAt: Date.parse('2026-01-01T00:00:00Z'),
		});
		expect(snapshot.comments).toHaveLength(2);
		expect(snapshot.comments[0]).toMatchObject({
			id: 'issue-comment-1',
			source: 'issue',
			isBot: true,
		});
		expect(snapshot.comments[1]).toMatchObject({ id: 'review-1', source: 'review' });
		expect(snapshot.checks[0]).toMatchObject({
			name: 'test',
			workflowName: 'CI',
			status: 'failing',
			canFetchLogs: true,
		});
		expect(manager.getWorkspaceGitHubSnapshot(workspace.id)).toBe(snapshot);
		expect(store.requireWorkspace(workspace.id)).toMatchObject({
			reviewState: 'in_review',
			pullRequest: { number: 12, status: 'open', ciStatus: 'failing' },
		});
	});

	test('uses a stored PR number before searching by branch', async () => {
		const { store, workspace } = await createWorkspace();
		await store.observeWorkspacePullRequest(workspace.id, {
			number: 12,
			status: 'open',
			lastObservedAt: Date.now(),
		});
		const calls: string[][] = [];
		const manager = new PrManager(store, {
			runGh: async (args) => {
				calls.push(args);
				if (args[0] === 'pr' && args[1] === 'view') {
					return okJson({ ...openPrView(), state: 'MERGED', title: 'Merged PR' });
				}
				return failed('unexpected gh command');
			},
		});

		const snapshot = await manager.refreshWorkspacePrState(workspace.id);

		expect(calls.some((args) => args[0] === 'pr' && args[1] === 'list')).toBe(false);
		expect(snapshot).toMatchObject({ status: 'merged', title: 'Merged PR' });
		expect(store.requireWorkspace(workspace.id)).toMatchObject({
			reviewState: 'done',
			pullRequest: { number: 12, status: 'merged' },
		});
	});

	test('keeps known PR metadata when a stored PR cannot be refreshed', async () => {
		const { store, workspace } = await createWorkspace();
		await store.observeWorkspacePullRequest(workspace.id, {
			number: 12,
			status: 'open',
			title: 'Known PR',
			url: 'https://github.com/sarp/miko/pull/12',
			headRefName: 'atlas',
			baseRefName: 'main',
			ciStatus: 'passing',
			lastObservedAt: Date.now(),
		});
		const manager = new PrManager(store, {
			runGh: async (args) =>
				args[0] === 'pr' && args[1] === 'view'
					? failed('temporary gh failure')
					: failed('unexpected gh command'),
		});

		const snapshot = await manager.refreshWorkspacePrState(workspace.id);

		expect(snapshot).toMatchObject({
			status: 'open',
			prNumber: 12,
			title: 'Known PR',
			ciStatus: 'passing',
		});
		expect(manager.getWorkspaceGitHubSnapshot(workspace.id)).toBe(snapshot);
		expect(store.requireWorkspace(workspace.id).pullRequest).toMatchObject({
			number: 12,
			status: 'open',
		});
	});

	test('caches a none snapshot when no pull request is found', async () => {
		const { store, workspace } = await createWorkspace();
		const manager = new PrManager(store, {
			runGh: async (args) => {
				if (args[0] === 'pr' && args[1] === 'list') return okJson([]);
				return failed('unexpected gh command');
			},
		});

		const snapshot = await manager.refreshWorkspacePrState(workspace.id);

		expect(snapshot).toMatchObject({ status: 'none', owner: 'sarp', repo: 'miko' });
		expect(snapshot.comments).toEqual([]);
		expect(snapshot.checks).toEqual([]);
		expect(store.requireWorkspace(workspace.id).reviewState).toBe('in_progress');
	});

	test('does not cache a none snapshot when GitHub branch lookup fails', async () => {
		const { store, workspace } = await createWorkspace();
		const manager = new PrManager(store, {
			runGh: async (args) =>
				args[0] === 'pr' && args[1] === 'list'
					? failed('gh auth failed')
					: failed('unexpected gh command'),
		});

		await expect(manager.refreshWorkspacePrState(workspace.id)).rejects.toThrow('gh auth failed');
		expect(manager.getWorkspaceGitHubSnapshot(workspace.id)).toBeNull();
	});

	test('clears cached live snapshots for terminal or archived workspaces', async () => {
		const { store, workspace } = await createWorkspace();
		const manager = new PrManager(store, {
			runGh: async (args) => {
				if (args[0] === 'pr' && args[1] === 'list') {
					return okJson([{ number: 12, state: 'OPEN', title: 'Open PR' }]);
				}
				if (args[0] === 'pr' && args[1] === 'view') return okJson(openPrView());
				return failed('unexpected gh command');
			},
		});
		await manager.refreshWorkspacePrState(workspace.id);
		expect(manager.getWorkspaceGitHubSnapshot(workspace.id)).not.toBeNull();

		await store.setWorkspaceVisibilityState(workspace.id, 'archived');
		const snapshot = await manager.refreshWorkspacePrState(workspace.id);

		expect(snapshot).toMatchObject({ status: 'open', prNumber: 12 });
		expect(manager.getWorkspaceGitHubSnapshot(workspace.id)).toBeNull();
	});

	test('clears cached live snapshots when a workspace has been removed', async () => {
		const { store, workspace } = await createWorkspace();
		const manager = new PrManager(store, {
			runGh: async (args) => {
				if (args[0] === 'pr' && args[1] === 'list') {
					return okJson([{ number: 12, state: 'OPEN', title: 'Open PR' }]);
				}
				if (args[0] === 'pr' && args[1] === 'view') return okJson(openPrView());
				return failed('unexpected gh command');
			},
		});
		await manager.refreshWorkspacePrState(workspace.id);

		await store.removeWorkspace(workspace.id);

		await expect(manager.refreshWorkspacePrState(workspace.id)).rejects.toThrow(
			'Workspace not found',
		);
		expect(manager.getWorkspaceGitHubSnapshot(workspace.id)).toBeNull();
	});
});

describe('PrManager.refreshActiveWorkspaces', () => {
	test('refreshes active non-terminal workspaces only', async () => {
		const { store, directory, workspace } = await createWorkspace();
		const inReview = await createAdditionalWorkspace(store, directory.id, {
			branchName: 'orion',
			reviewState: 'in_review',
		});
		await createAdditionalWorkspace(store, directory.id, {
			branchName: 'archived',
			visibilityState: 'archived',
		});
		await createAdditionalWorkspace(store, directory.id, {
			branchName: 'done',
			reviewState: 'done',
		});
		await createAdditionalWorkspace(store, directory.id, {
			branchName: 'closed',
			reviewState: 'closed',
		});
		const refreshedHeads: string[] = [];
		const manager = new PrManager(store, {
			runGh: async (args) => {
				if (args[0] === 'pr' && args[1] === 'list') {
					refreshedHeads.push(String(args[5]));
					return okJson([]);
				}
				return failed('unexpected gh command');
			},
		});

		const results = await manager.refreshActiveWorkspaces();

		expect([...results.keys()].sort()).toEqual([workspace.id, inReview.id].sort());
		expect(refreshedHeads.sort()).toEqual(['atlas', 'orion']);
	});
});

describe('PrManager.refreshOpenPullRequests', () => {
	test('refreshes only active workspaces currently in review', async () => {
		const { store, directory } = await createWorkspace();
		const inReview = await createAdditionalWorkspace(store, directory.id, {
			branchName: 'orion',
			reviewState: 'in_review',
		});
		await createAdditionalWorkspace(store, directory.id, { branchName: 'atlas-2' });
		await createAdditionalWorkspace(store, directory.id, {
			branchName: 'archived',
			reviewState: 'in_review',
			visibilityState: 'archived',
		});
		const refreshedHeads: string[] = [];
		const manager = new PrManager(store, {
			runGh: async (args) => {
				if (args[0] === 'pr' && args[1] === 'list') {
					refreshedHeads.push(String(args[5]));
					return okJson([]);
				}
				return failed('unexpected gh command');
			},
		});

		const results = await manager.refreshOpenPullRequests();

		expect([...results.keys()]).toEqual([inReview.id]);
		expect(refreshedHeads).toEqual(['orion']);
	});
});

describe('PrManager.fetchFailingCheckLogs', () => {
	test('fetches failed GitHub Actions logs for the workspace PR branch', async () => {
		const { store, workspace } = await createWorkspace();
		await store.observeWorkspacePullRequest(workspace.id, {
			number: 12,
			status: 'open',
			lastObservedAt: Date.now(),
		});
		const calls: string[][] = [];
		const manager = new PrManager(store, {
			runGh: async (args) => {
				calls.push(args);
				if (args[0] === 'run' && args[1] === 'list') {
					return okJson([
						{
							databaseId: 101,
							conclusion: 'failure',
							displayTitle: 'Test failed',
							workflowName: 'CI',
							url: 'https://github.com/sarp/miko/actions/runs/101',
						},
						{
							databaseId: 102,
							conclusion: 'cancelled',
							displayTitle: 'Cancelled test',
							workflowName: 'CI',
							url: 'https://github.com/sarp/miko/actions/runs/102',
						},
						{ databaseId: 103, conclusion: 'timed_out', displayTitle: 'Timed out' },
						{ databaseId: 104, conclusion: 'success', displayTitle: 'Passed' },
					]);
				}
				if (args[0] === 'run' && args[1] === 'view') return okText(`log for ${args[2]}`);
				return failed('unexpected gh command');
			},
		});

		const logs = await manager.fetchFailingCheckLogs(workspace.id);

		expect(calls[0]).toEqual([
			'run',
			'list',
			'--repo',
			'sarp/miko',
			'--branch',
			'atlas',
			'--limit',
			'10',
			'--json',
			'databaseId,conclusion,status,displayTitle,workflowName,url',
		]);
		expect(calls[1]).toEqual(['run', 'view', '101', '--repo', 'sarp/miko', '--log-failed']);
		expect(calls[2]).toEqual(['run', 'view', '102', '--repo', 'sarp/miko', '--log-failed']);
		expect(calls[3]).toEqual(['run', 'view', '103', '--repo', 'sarp/miko', '--log-failed']);
		expect(logs).toEqual([
			{
				runId: 101,
				title: 'Test failed',
				workflowName: 'CI',
				url: 'https://github.com/sarp/miko/actions/runs/101',
				log: 'log for 101',
			},
			{
				runId: 102,
				title: 'Cancelled test',
				workflowName: 'CI',
				url: 'https://github.com/sarp/miko/actions/runs/102',
				log: 'log for 102',
			},
			{
				runId: 103,
				title: 'Timed out',
				workflowName: undefined,
				url: undefined,
				log: 'log for 103',
			},
		]);
	});

	test('throws when the workspace has no pull request', async () => {
		const { store, workspace } = await createWorkspace();
		const manager = new PrManager(store, { runGh: async () => okJson([]) });

		await expect(manager.fetchFailingCheckLogs(workspace.id)).rejects.toThrow(
			'Workspace does not have a pull request',
		);
	});
});

describe('PrManager.mergeWorkspacePullRequest', () => {
	test('merges the workspace PR and refreshes its state', async () => {
		const { store, workspace } = await createWorkspace();
		await store.observeWorkspacePullRequest(workspace.id, {
			number: 12,
			status: 'open',
			lastObservedAt: Date.now(),
		});
		const calls: string[][] = [];
		const manager = new PrManager(store, {
			runGh: async (args) => {
				calls.push(args);
				if (args[0] === 'pr' && args[1] === 'merge') return okText('merged');
				if (args[0] === 'pr' && args[1] === 'view') {
					return okJson({ ...openPrView(), state: 'MERGED', title: 'Merged PR' });
				}
				return failed('unexpected gh command');
			},
		});

		const snapshot = await manager.mergeWorkspacePullRequest(workspace.id);

		expect(calls[0]).toEqual(['pr', 'merge', '12', '--repo', 'sarp/miko', '--merge']);
		expect(snapshot).toMatchObject({ status: 'merged', title: 'Merged PR' });
		expect(store.requireWorkspace(workspace.id).reviewState).toBe('done');
	});

	test('throws when GitHub merge fails', async () => {
		const { store, workspace } = await createWorkspace();
		await store.observeWorkspacePullRequest(workspace.id, {
			number: 12,
			status: 'open',
			lastObservedAt: Date.now(),
		});
		const manager = new PrManager(store, {
			runGh: async (args) =>
				args[0] === 'pr' && args[1] === 'merge' ? failed('merge failed') : okJson([]),
		});

		await expect(manager.mergeWorkspacePullRequest(workspace.id)).rejects.toThrow('merge failed');
	});
});
