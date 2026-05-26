import { create } from 'zustand';
import type { ScratchpadSnapshot } from '../../shared/types';
import { useWsStore } from './ws-store';

function scratchpadSubscriptionId(workspaceId: string) {
	return `scratchpad:${workspaceId}`;
}

interface ScratchpadStoreState {
	snapshotByWorkspaceId: Map<string, ScratchpadSnapshot>;
	connectedWorkspaceIds: Set<string>;
	getScratchpadSnapshot: (workspaceId: string) => ScratchpadSnapshot | null;
	connectScratchpad: (workspaceId: string) => void;
	disconnectScratchpad: (workspaceId: string) => void;
	updateScratchpad: (workspaceId: string, content: string) => Promise<ScratchpadSnapshot>;
}

let unsubscribeFromWsStore: (() => void) | null = null;

function readScratchpadSnapshot(workspaceId: string) {
	const subscriptionId = scratchpadSubscriptionId(workspaceId);
	const snapshot = useWsStore.getState().snapshotsBySubscriptionId.get(subscriptionId);
	return snapshot?.type === 'scratchpad' ? snapshot.data : null;
}

function syncConnectedScratchpadSnapshots() {
	const state = useScratchpadStore.getState();
	let changed = false;
	const snapshotByWorkspaceId = new Map(state.snapshotByWorkspaceId);

	for (const workspaceId of state.connectedWorkspaceIds) {
		const snapshot = readScratchpadSnapshot(workspaceId);
		if (!snapshot || snapshotByWorkspaceId.get(workspaceId) === snapshot) continue;
		snapshotByWorkspaceId.set(workspaceId, snapshot);
		changed = true;
	}

	if (changed) useScratchpadStore.setState({ snapshotByWorkspaceId });
}

function ensureScratchpadSnapshotSync() {
	if (unsubscribeFromWsStore) return;
	unsubscribeFromWsStore = useWsStore.subscribe(syncConnectedScratchpadSnapshots);
}

export const useScratchpadStore = create<ScratchpadStoreState>((set, get) => ({
	snapshotByWorkspaceId: new Map(),
	connectedWorkspaceIds: new Set(),

	getScratchpadSnapshot: (workspaceId) => {
		return get().snapshotByWorkspaceId.get(workspaceId) ?? null;
	},

	connectScratchpad: (workspaceId) => {
		ensureScratchpadSnapshotSync();
		set((state) => {
			if (state.connectedWorkspaceIds.has(workspaceId)) return state;
			const connectedWorkspaceIds = new Set(state.connectedWorkspaceIds);
			connectedWorkspaceIds.add(workspaceId);
			return { connectedWorkspaceIds };
		});

		useWsStore
			.getState()
			.subscribeTopic(scratchpadSubscriptionId(workspaceId), { type: 'scratchpad', workspaceId });
		syncConnectedScratchpadSnapshots();
	},

	disconnectScratchpad: (workspaceId) => {
		useWsStore.getState().unsubscribeTopic(scratchpadSubscriptionId(workspaceId));
		set((state) => {
			const connectedWorkspaceIds = new Set(state.connectedWorkspaceIds);
			const snapshotByWorkspaceId = new Map(state.snapshotByWorkspaceId);

			connectedWorkspaceIds.delete(workspaceId);
			snapshotByWorkspaceId.delete(workspaceId);
			return { connectedWorkspaceIds, snapshotByWorkspaceId };
		});
	},

	updateScratchpad: (workspaceId, content) => {
		return useWsStore
			.getState()
			.command({ type: 'workspace.updateScratchpad', workspaceId, content });
	},
}));
