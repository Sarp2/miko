import { create } from 'zustand';
import type { TerminalEvent, TerminalSnapshot } from '../../shared/protocol';
import { useWsStore } from './ws-store';

function terminalSubscriptionId(terminalId: string) {
	return `terminal:${terminalId}`;
}

interface CreateTerminalInput {
	workspaceId: string;
	terminalId: string;
	cols: number;
	rows: number;
	scrollback: number;
}

interface TerminalStoreState {
	snapshotByTerminalId: Map<string, TerminalSnapshot | null>;
	connectedTerminalIds: Set<string>;
	getTerminalSnapshot: (terminalId: string) => TerminalSnapshot | null;
	connectTerminal: (terminalId: string) => void;
	disconnectTerminal: (terminalId: string) => void;
	createTerminal: (input: CreateTerminalInput) => Promise<TerminalSnapshot>;
	writeTerminal: (terminalId: string, data: string) => Promise<void>;
	resizeTerminal: (terminalId: string, cols: number, rows: number) => Promise<void>;
	closeTerminal: (terminalId: string) => Promise<void>;
	addTerminalEventListener: (listener: TerminalEventListener) => () => void;
}

type TerminalEventListener = (event: TerminalEvent, subscriptionId: string) => void;

let unsubscribeFromWsStore: (() => void) | null = null;

function readTerminalSnapshot(terminalId: string) {
	const subscriptionId = terminalSubscriptionId(terminalId);
	const snapshot = useWsStore.getState().snapshotsBySubscriptionId.get(subscriptionId);
	return snapshot?.type === 'terminal' ? snapshot.data : null;
}

function syncConnectedTerminalSnapshots() {
	const state = useTerminalStore.getState();
	let changed = false;
	const snapshotByTerminalId = new Map(state.snapshotByTerminalId);

	for (const terminalId of state.connectedTerminalIds) {
		const snapshot = readTerminalSnapshot(terminalId);
		if (snapshotByTerminalId.get(terminalId) === snapshot) continue;
		snapshotByTerminalId.set(terminalId, snapshot);
		changed = true;
	}

	if (changed) useTerminalStore.setState({ snapshotByTerminalId });
}

function ensureTerminalSnapshotSync() {
	if (unsubscribeFromWsStore) return;
	unsubscribeFromWsStore = useWsStore.subscribe(syncConnectedTerminalSnapshots);
}

export const useTerminalStore = create<TerminalStoreState>((set, get) => ({
	snapshotByTerminalId: new Map(),
	connectedTerminalIds: new Set(),

	getTerminalSnapshot: (terminalId) => {
		return get().snapshotByTerminalId.get(terminalId) ?? null;
	},

	connectTerminal: (terminalId) => {
		ensureTerminalSnapshotSync();
		set((state) => {
			if (state.connectedTerminalIds.has(terminalId)) return state;
			const connectedTerminalIds = new Set(state.connectedTerminalIds);
			connectedTerminalIds.add(terminalId);
			return { connectedTerminalIds };
		});

		useWsStore
			.getState()
			.subscribeTopic(terminalSubscriptionId(terminalId), { type: 'terminal', terminalId });
		syncConnectedTerminalSnapshots();
	},

	disconnectTerminal: (terminalId) => {
		useWsStore.getState().unsubscribeTopic(terminalSubscriptionId(terminalId));
		set((state) => {
			const connectedTerminalIds = new Set(state.connectedTerminalIds);
			const snapshotByTerminalId = new Map(state.snapshotByTerminalId);

			connectedTerminalIds.delete(terminalId);
			snapshotByTerminalId.delete(terminalId);
			return { connectedTerminalIds, snapshotByTerminalId };
		});
	},

	createTerminal: (input) => {
		return useWsStore.getState().command({ type: 'terminal.create', ...input });
	},

	writeTerminal: async (terminalId, data) => {
		await useWsStore.getState().command({ type: 'terminal.input', terminalId, data });
	},

	resizeTerminal: async (terminalId, cols, rows) => {
		await useWsStore.getState().command({ type: 'terminal.resize', terminalId, cols, rows });
	},

	closeTerminal: async (terminalId) => {
		await useWsStore.getState().command({ type: 'terminal.close', terminalId });
		get().disconnectTerminal(terminalId);
	},

	addTerminalEventListener: (listener) => {
		return useWsStore.getState().addEventListener((event, subscriptionId) => {
			listener(event, subscriptionId);
		});
	},
}));
