import { create } from 'zustand';
import type { WorkspaceSnapshot } from '../../shared/types';
import { useWsStore } from './ws-store';

function workspaceSubscriptionId(workspaceId: string) {
	return `workspace:${workspaceId}`;
}

interface WorkspaceStoreState {
	snapshotByWorkspaceId: Map<string, WorkspaceSnapshot | null>;
	connectedWorkspaceIds: Set<string>;
	getWorkspaceSnapshot: (workspaceId: string) => WorkspaceSnapshot | null;
	connectWorkspace: (workspaceId: string) => void;
	disconnectWorkspace: (workspaceId: string) => void;
	markRead: (workspaceId: string) => Promise<void>;
	refreshGit: (workspaceId: string) => Promise<unknown>;
	refreshPrStage: (workspaceId: string) => Promise<unknown>;
	renameBranch: (workspaceId: string, branchName: string) => Promise<unknown>;
	mergePr: (workspaceId: string) => Promise<unknown>;
}

let unsubscribeFromWsStore: (() => void) | null = null;

function readWorkspaceSnapshot(workspaceId: string) {
	const subscriptionId = workspaceSubscriptionId(workspaceId);
	const snapshot = useWsStore.getState().snapshotsBySubscriptionId.get(subscriptionId);
	return snapshot?.type === 'workspace' ? snapshot.data : null;
}

function syncConnectedWorkspaceSnapshots() {
	const state = useWorkspaceStore.getState();
	let changed = false;
	const snapshotByWorkspaceId = new Map(state.snapshotByWorkspaceId);

	for (const workspaceId of state.connectedWorkspaceIds) {
		const snapshot = readWorkspaceSnapshot(workspaceId);
		if (snapshotByWorkspaceId.get(workspaceId) === snapshot) continue;
		snapshotByWorkspaceId.set(workspaceId, snapshot);
		changed = true;
	}

	if (changed) useWorkspaceStore.setState({ snapshotByWorkspaceId });
}

function ensureWorkspaceSnapshotSync() {
	if (unsubscribeFromWsStore) return;
	unsubscribeFromWsStore = useWsStore.subscribe(syncConnectedWorkspaceSnapshots);
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
	snapshotByWorkspaceId: new Map(),
	connectedWorkspaceIds: new Set(),

	getWorkspaceSnapshot: (workspaceId) => {
		return get().snapshotByWorkspaceId.get(workspaceId) ?? null;
	},

	connectWorkspace: (workspaceId) => {
		ensureWorkspaceSnapshotSync();
		set((state) => {
			if (state.connectedWorkspaceIds.has(workspaceId)) return state;
			const connectedWorkspaceIds = new Set(state.connectedWorkspaceIds);
			connectedWorkspaceIds.add(workspaceId);
			return { connectedWorkspaceIds };
		});

		useWsStore
			.getState()
			.subscribeTopic(workspaceSubscriptionId(workspaceId), { type: 'workspace', workspaceId });
		syncConnectedWorkspaceSnapshots();
	},

	disconnectWorkspace: (workspaceId) => {
		useWsStore.getState().unsubscribeTopic(workspaceSubscriptionId(workspaceId));
		set((state) => {
			const connectedWorkspaceIds = new Set(state.connectedWorkspaceIds);
			const snapshotByWorkspaceId = new Map(state.snapshotByWorkspaceId);
			connectedWorkspaceIds.delete(workspaceId);
			snapshotByWorkspaceId.delete(workspaceId);
			return { connectedWorkspaceIds, snapshotByWorkspaceId };
		});
	},

	markRead: async (workspaceId) => {
		await useWsStore.getState().command({ type: 'workspace.markRead', workspaceId });
	},

	refreshGit: (workspaceId) => {
		return useWsStore.getState().command({ type: 'workspace.refreshGit', workspaceId });
	},

	refreshPrStage: (workspaceId) => {
		return useWsStore.getState().command({ type: 'workspace.refreshPrStage', workspaceId });
	},

	renameBranch: (workspaceId, branchName) => {
		return useWsStore
			.getState()
			.command({ type: 'workspace.renameBranch', workspaceId, branchName });
	},

	mergePr: (workspaceId) => {
		return useWsStore.getState().command({ type: 'workspace.mergePr', workspaceId });
	},
}));
