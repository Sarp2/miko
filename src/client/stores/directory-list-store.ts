import { create } from 'zustand';
import type { DirectoryListSnapshot, WorkspaceVisibilityState } from '../../shared/types';
import { useWsStore } from './ws-store';

export const DIRECTORY_LIST_SUBSCRIPTION_ID = 'directories';

interface DirectoryListStoreState {
	snapshot: DirectoryListSnapshot | null;
	isSubscribed: boolean;
	connectDirectoryList: () => void;
	disconnectDirectoryList: () => void;
	removeDirectory: (directoryId: string) => Promise<void>;
	removeWorkspace: (workspaceId: string) => Promise<void>;
	setWorkspaceVisibility: (
		workspaceId: string,
		visibilityState: WorkspaceVisibilityState,
	) => Promise<void>;
}

let unsubscribeFromWsStore: (() => void) | null = null;

function getDirectoryListSnapshotFromWsStore() {
	const snapshot = useWsStore
		.getState()
		.snapshotsBySubscriptionId.get(DIRECTORY_LIST_SUBSCRIPTION_ID);
	return snapshot?.type === 'directories' ? snapshot.data : null;
}

function syncDirectoryListSnapshot() {
	const snapshot = getDirectoryListSnapshotFromWsStore();
	if (useDirectoryListStore.getState().snapshot === snapshot) return;
	useDirectoryListStore.setState({ snapshot });
}

function ensureDirectoryListSnapshotSync() {
	if (unsubscribeFromWsStore) return;
	unsubscribeFromWsStore = useWsStore.subscribe(syncDirectoryListSnapshot);
}

export const useDirectoryListStore = create<DirectoryListStoreState>((set) => ({
	snapshot: null,
	isSubscribed: false,

	connectDirectoryList: () => {
		ensureDirectoryListSnapshotSync();
		useWsStore.getState().subscribeTopic(DIRECTORY_LIST_SUBSCRIPTION_ID, { type: 'directories' });
		syncDirectoryListSnapshot();
		set({ isSubscribed: true });
	},

	disconnectDirectoryList: () => {
		useWsStore.getState().unsubscribeTopic(DIRECTORY_LIST_SUBSCRIPTION_ID);
		unsubscribeFromWsStore?.();
		unsubscribeFromWsStore = null;
		set({ isSubscribed: false, snapshot: null });
	},

	removeDirectory: async (directoryId) => {
		await useWsStore.getState().command({ type: 'directory.remove', directoryId });
	},

	removeWorkspace: async (workspaceId) => {
		await useWsStore.getState().command({ type: 'workspace.remove', workspaceId });
	},

	setWorkspaceVisibility: async (workspaceId, visibilityState) => {
		await useWsStore
			.getState()
			.command({ type: 'workspace.setVisibility', workspaceId, visibilityState });
	},
}));
