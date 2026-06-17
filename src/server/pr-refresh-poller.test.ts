import { describe, expect, test } from 'bun:test';
import type { WorkspaceGitHubSnapshot } from 'src/shared/types';
import type { WorkspaceRecord } from './event';
import { GitHubRateLimitError } from './github-rest-client';
import { PrRefreshPoller } from './pr-refresh-poller';

function workspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
	return {
		id: 'workspace-1',
		directoryId: 'directory-1',
		localPath: '/repo/workspace-1',
		branchName: 'atlas',
		setupState: 'ready',
		reviewState: 'in_review',
		visibilityState: 'active',
		hasUnreadAgentResult: false,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function snapshot(title = 'PR'): WorkspaceGitHubSnapshot {
	return {
		status: 'open',
		owner: 'sarp',
		repo: 'miko',
		prNumber: 1,
		title,
		comments: [],
		checks: [],
		lastRefreshedAt: Date.now(),
	};
}

describe('PrRefreshPoller', () => {
	test('force refreshes active workspaces and broadcasts only when material snapshots change', async () => {
		let currentSnapshot = snapshot('Before');
		let broadcasts = 0;
		const poller = new PrRefreshPoller({
			listWorkspaces: () => [workspace()],
			getWorkspaceGitHubSnapshot: () => currentSnapshot,
			refreshWorkspacePrStage: async () => {
				currentSnapshot = snapshot('After');
				return { snapshot: currentSnapshot };
			},
			broadcastSnapshots: async () => {
				broadcasts += 1;
			},
		});

		await poller.tick();
		await poller.tick();

		expect(broadcasts).toBe(1);
	});

	test('skips archived, terminal, and not-ready workspaces', async () => {
		let refreshes = 0;
		const poller = new PrRefreshPoller({
			listWorkspaces: () => [
				workspace({ visibilityState: 'archived' }),
				workspace({ reviewState: 'done' }),
				workspace({ reviewState: 'closed' }),
				workspace({ setupState: 'creating' }),
			],
			getWorkspaceGitHubSnapshot: () => null,
			refreshWorkspacePrStage: async () => {
				refreshes += 1;
				return {};
			},
			broadcastSnapshots: async () => undefined,
		});

		await poller.tick();

		expect(refreshes).toBe(0);
	});

	test('backs off after GitHub rate limits and skips overlapping ticks', async () => {
		let now = 0;
		let refreshes = 0;
		const poller = new PrRefreshPoller({
			listWorkspaces: () => [workspace()],
			getWorkspaceGitHubSnapshot: () => null,
			refreshWorkspacePrStage: async () => {
				refreshes += 1;
				throw new GitHubRateLimitError('slow down', 5_000);
			},
			broadcastSnapshots: async () => undefined,
			now: () => now,
			logger: { warn: () => undefined },
		});

		await poller.tick();
		await poller.tick();
		now = 5_001;
		await poller.tick();

		expect(refreshes).toBe(2);
	});

	test('keeps polling other workspaces when one workspace refresh fails', async () => {
		const snapshots = new Map([
			['workspace-1', snapshot('Before')],
			['workspace-2', snapshot('Before')],
		]);
		let broadcasts = 0;
		const poller = new PrRefreshPoller({
			listWorkspaces: () => [workspace({ id: 'workspace-1' }), workspace({ id: 'workspace-2' })],
			getWorkspaceGitHubSnapshot: (workspaceId) => snapshots.get(workspaceId) ?? null,
			refreshWorkspacePrStage: async (workspaceId) => {
				if (workspaceId === 'workspace-1') throw new Error('bad workspace');
				snapshots.set(workspaceId, snapshot('After'));
				return { snapshot: snapshots.get(workspaceId) };
			},
			broadcastSnapshots: async () => {
				broadcasts += 1;
			},
			logger: { warn: () => undefined },
		});

		await poller.tick();

		expect(broadcasts).toBe(1);
	});
});
