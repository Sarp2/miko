import { create } from 'zustand';
import type { KeybindingsSnapshot } from '../../shared/types';
import { useWsStore } from './ws-store';

export const KEYBINDINGS_SUBSCRIPTION_ID = 'keybindings';

interface KeybindingsStoreState {
	snapshot: KeybindingsSnapshot | null;
	isSubscribed: boolean;
	connectKeybindings: () => void;
	disconnectKeybindings: () => void;
	writeKeybindings: (bindings: KeybindingsSnapshot['bindings']) => Promise<KeybindingsSnapshot>;
}

let unsubscribeFromWsStore: (() => void) | null = null;

function getKeybindingsSnapshotFromWsStore() {
	const snapshot = useWsStore.getState().snapshotsBySubscriptionId.get(KEYBINDINGS_SUBSCRIPTION_ID);
	return snapshot?.type === 'keybindings' ? snapshot.data : null;
}

function syncKeybindingsSnapshot() {
	const snapshot = getKeybindingsSnapshotFromWsStore();
	if (useKeybindingsStore.getState().snapshot === snapshot) return;
	useKeybindingsStore.setState({ snapshot });
}

function ensureKeybindingsSnapshotSync() {
	if (unsubscribeFromWsStore) return;
	unsubscribeFromWsStore = useWsStore.subscribe(syncKeybindingsSnapshot);
}

export const useKeybindingsStore = create<KeybindingsStoreState>((set) => ({
	snapshot: null,
	isSubscribed: false,

	connectKeybindings: () => {
		ensureKeybindingsSnapshotSync();
		useWsStore.getState().subscribeTopic(KEYBINDINGS_SUBSCRIPTION_ID, { type: 'keybindings' });
		syncKeybindingsSnapshot();
		set({ isSubscribed: true });
	},

	disconnectKeybindings: () => {
		useWsStore.getState().unsubscribeTopic(KEYBINDINGS_SUBSCRIPTION_ID);
		unsubscribeFromWsStore?.();
		unsubscribeFromWsStore = null;
		set({ isSubscribed: false, snapshot: null });
	},

	writeKeybindings: async (bindings) => {
		const snapshot = await useWsStore
			.getState()
			.command<KeybindingsSnapshot>({ type: 'settings.writeKeybindings', bindings });
		set({ snapshot });
		return snapshot;
	},
}));
