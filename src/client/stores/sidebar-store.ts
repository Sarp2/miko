import { create } from 'zustand';
import type { SidebarSnapshot, WorkspaceVisibilityState } from '../../shared/types';
import { useWsStore } from './ws-store';

export const SIDEBAR_SUBSCRIPTION_ID = 'sidebar';

interface CreateWorkspaceResult {
	workspaceId: string;
	sessionId: string | null;
}

interface AddDirectoryResult {
	directoryId: string;
}

interface SidebarStoreState {
	snapshot: SidebarSnapshot | null;
	isSubscribed: boolean;
	connectSidebar: () => void;
	disconnectSidebar: () => void;
	addDirectory: (localPath: string) => Promise<AddDirectoryResult>;
	createWorkspace: (directoryId: string) => Promise<CreateWorkspaceResult>;
	setWorkspaceVisibility: (
		workspaceId: string,
		visibilityState: WorkspaceVisibilityState,
	) => Promise<void>;
	markWorkspaceRead: (workspaceId: string) => Promise<void>;
}

let unsubscribeFromWsStore: (() => void) | null = null;

function getSidebarSnapshotFromWsStore() {
	const snapshot = useWsStore.getState().snapshotsBySubscriptionId.get(SIDEBAR_SUBSCRIPTION_ID);
	return snapshot?.type === 'sidebar' ? snapshot.data : null;
}

function syncSidebarSnapshot() {
	const snapshot = getSidebarSnapshotFromWsStore();
	if (useSidebarStore.getState().snapshot === snapshot) return;
	useSidebarStore.setState({ snapshot });
}

function ensureSidebarSnapshotSync() {
	if (unsubscribeFromWsStore) return;
	unsubscribeFromWsStore = useWsStore.subscribe(syncSidebarSnapshot);
}

export const useSidebarStore = create<SidebarStoreState>((set) => ({
	snapshot: null,
	isSubscribed: false,

	connectSidebar: () => {
		ensureSidebarSnapshotSync();
		useWsStore.getState().subscribeTopic(SIDEBAR_SUBSCRIPTION_ID, { type: 'sidebar' });
		syncSidebarSnapshot();
		set({ isSubscribed: true });
	},

	disconnectSidebar: () => {
		useWsStore.getState().unsubscribeTopic(SIDEBAR_SUBSCRIPTION_ID);
		set({ isSubscribed: false, snapshot: null });
	},

	addDirectory: (localPath) => {
		return useWsStore.getState().command<AddDirectoryResult>({ type: 'directory.add', localPath });
	},

	createWorkspace: (directoryId) => {
		return useWsStore
			.getState()
			.command<CreateWorkspaceResult>({ type: 'workspace.create', directoryId });
	},

	setWorkspaceVisibility: async (workspaceId, visibilityState) => {
		await useWsStore
			.getState()
			.command({ type: 'workspace.setVisibility', workspaceId, visibilityState });
	},

	markWorkspaceRead: async (workspaceId) => {
		await useWsStore.getState().command({ type: 'workspace.markRead', workspaceId });
	},
}));
