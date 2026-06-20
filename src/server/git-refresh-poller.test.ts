import { describe, expect, test } from 'bun:test';
import type { WorkspaceRecord } from './event';
import { GitRefreshPoller } from './git-refresh-poller';

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

describe('GitRefreshPoller', () => {
	test('refreshes active workspaces and broadcasts once when any snapshot changes', async () => {
		const refreshed: string[] = [];
		let broadcasts = 0;
		const poller = new GitRefreshPoller({
			listWorkspaces: () => [workspace({ id: 'changed' }), workspace({ id: 'unchanged' })],
			refreshWorkspaceGitSnapshot: async (workspaceId) => {
				refreshed.push(workspaceId);
				return workspaceId === 'changed';
			},
			broadcastSnapshots: async () => {
				broadcasts += 1;
			},
		});

		await poller.tick();

		expect(refreshed).toEqual(['changed', 'unchanged']);
		expect(broadcasts).toBe(1);
	});

	test('skips archived, terminal, and not-ready workspaces', async () => {
		let refreshes = 0;
		const poller = new GitRefreshPoller({
			listWorkspaces: () => [
				workspace({ visibilityState: 'archived' }),
				workspace({ reviewState: 'done' }),
				workspace({ reviewState: 'closed' }),
				workspace({ setupState: 'creating' }),
			],
			refreshWorkspaceGitSnapshot: async () => {
				refreshes += 1;
				return true;
			},
			broadcastSnapshots: async () => undefined,
		});

		await poller.tick();

		expect(refreshes).toBe(0);
	});

	test('skips overlapping ticks', async () => {
		let refreshes = 0;
		let resolveRefresh!: () => void;
		const poller = new GitRefreshPoller({
			listWorkspaces: () => [workspace()],
			refreshWorkspaceGitSnapshot: async () => {
				refreshes += 1;
				await new Promise<void>((resolve) => {
					resolveRefresh = resolve;
				});
				return false;
			},
			broadcastSnapshots: async () => undefined,
		});

		const first = poller.tick();
		await Promise.resolve();
		const second = poller.tick();
		resolveRefresh();
		await first;
		await second;

		expect(refreshes).toBe(1);
	});

	test('does not broadcast after stop waits for an in-flight tick', async () => {
		let resolveRefresh!: () => void;
		let broadcasts = 0;
		const poller = new GitRefreshPoller({
			listWorkspaces: () => [workspace()],
			refreshWorkspaceGitSnapshot: async () => {
				await new Promise<void>((resolve) => {
					resolveRefresh = resolve;
				});
				return true;
			},
			broadcastSnapshots: async () => {
				broadcasts += 1;
			},
		});

		const tickPromise = poller.tick();
		await Promise.resolve();
		const stopPromise = poller.stop();
		resolveRefresh();
		await stopPromise;
		await tickPromise;

		expect(broadcasts).toBe(0);
	});

	test('keeps polling other workspaces when one refresh fails', async () => {
		const refreshed: string[] = [];
		let broadcasts = 0;
		const poller = new GitRefreshPoller({
			listWorkspaces: () => [workspace({ id: 'bad' }), workspace({ id: 'good' })],
			refreshWorkspaceGitSnapshot: async (workspaceId) => {
				refreshed.push(workspaceId);
				if (workspaceId === 'bad') throw new Error('bad workspace');
				return true;
			},
			broadcastSnapshots: async () => {
				broadcasts += 1;
			},
			logger: { warn: () => undefined },
		});

		await poller.tick();

		expect(refreshed).toEqual(['bad', 'good']);
		expect(broadcasts).toBe(1);
	});
});
