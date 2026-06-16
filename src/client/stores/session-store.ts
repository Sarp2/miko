import { create } from 'zustand';
import type { ClientCommand } from '../../shared/protocol';
import type {
	AgentProvider,
	ChatAttachment,
	ModelOptions,
	PromptPart,
	SessionHistoryPage,
	SessionSnapshot,
} from '../../shared/types';
import { useChatWindowStore } from './chat-window-store';
import { useWsStore } from './ws-store';

function sessionSubscriptionId(sessionId: string) {
	return `session:${sessionId}`;
}

type SessionSendCommand = Extract<ClientCommand, { type: 'session.send' }>;

interface SendSessionInput {
	sessionId: string;
	workspaceId?: string;
	provider?: AgentProvider;
	content: string;
	attachments?: ChatAttachment[];
	parts?: PromptPart[];
	model?: string;
	modelOptions: ModelOptions;
	effort?: string;
	planMode?: boolean;
}

interface SessionStoreState {
	snapshotBySessionId: Map<string, SessionSnapshot | null>;
	connectedSessionIds: Set<string>;
	sessionWorkspaceIdBySessionId: Map<string, string>;
	getSessionSnapshot: (sessionId: string) => SessionSnapshot | null;
	connectSession: (
		sessionId: string,
		options?: { workspaceId?: string; recentLimit?: number },
	) => void;
	disconnectSession: (sessionId: string) => void;
	syncWorkspaceSessions: (
		workspaceId: string,
		sessionIds: string[],
		options?: { recentLimit?: number },
	) => void;
	disconnectWorkspaceSessions: (workspaceId: string) => void;
	createSession: (workspaceId: string) => Promise<{ sessionId: string }>;
	renameSession: (sessionId: string, title: string) => Promise<void>;
	removeSession: (sessionId: string) => Promise<void>;
	sendSessionMessage: (input: SendSessionInput) => Promise<{ sessionId: string }>;
	cancelSession: (sessionId: string) => Promise<void>;
	stopDrainingSession: (sessionId: string) => Promise<void>;
	loadHistory: (
		sessionId: string,
		beforeCursor: string,
		limit: number,
	) => Promise<SessionHistoryPage>;
	loadOlderChatWindow: (sessionId: string, limit?: number) => Promise<void>;
	respondTool: (sessionId: string, toolUseId: string, result: unknown) => Promise<void>;
}

let unsubscribeFromWsStore: (() => void) | null = null;

function readSessionSnapshot(sessionId: string) {
	const subscriptionId = sessionSubscriptionId(sessionId);
	const snapshot = useWsStore.getState().snapshotsBySubscriptionId.get(subscriptionId);
	return snapshot?.type === 'session' ? snapshot.data : null;
}

function syncConnectedSessionSnapshots() {
	const state = useSessionStore.getState();
	let changed = false;
	const snapshotBySessionId = new Map(state.snapshotBySessionId);

	for (const sessionId of state.connectedSessionIds) {
		const snapshot = readSessionSnapshot(sessionId);
		if (snapshotBySessionId.get(sessionId) === snapshot) continue;

		snapshotBySessionId.set(sessionId, snapshot);
		useChatWindowStore.getState().syncFromSnapshot(sessionId, snapshot);
		changed = true;
	}

	if (changed) useSessionStore.setState({ snapshotBySessionId });
}

function ensureSessionSnapshotSync() {
	if (unsubscribeFromWsStore) return;
	unsubscribeFromWsStore = useWsStore.subscribe(syncConnectedSessionSnapshots);
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
	snapshotBySessionId: new Map(),
	connectedSessionIds: new Set(),
	sessionWorkspaceIdBySessionId: new Map(),

	getSessionSnapshot: (sessionId) => {
		return get().snapshotBySessionId.get(sessionId) ?? null;
	},

	connectSession: (sessionId, options = {}) => {
		ensureSessionSnapshotSync();
		set((state) => {
			const connectedSessionIds = new Set(state.connectedSessionIds);
			const sessionWorkspaceIdBySessionId = new Map(state.sessionWorkspaceIdBySessionId);

			connectedSessionIds.add(sessionId);
			if (options.workspaceId) sessionWorkspaceIdBySessionId.set(sessionId, options.workspaceId);
			return { connectedSessionIds, sessionWorkspaceIdBySessionId };
		});

		useWsStore.getState().subscribeTopic(sessionSubscriptionId(sessionId), {
			type: 'session',
			sessionId,
			recentLimit: options.recentLimit,
		});
		syncConnectedSessionSnapshots();
	},

	disconnectSession: (sessionId) => {
		useWsStore.getState().unsubscribeTopic(sessionSubscriptionId(sessionId));
		useChatWindowStore.getState().resetSession(sessionId);
		set((state) => {
			const connectedSessionIds = new Set(state.connectedSessionIds);
			const snapshotBySessionId = new Map(state.snapshotBySessionId);
			const sessionWorkspaceIdBySessionId = new Map(state.sessionWorkspaceIdBySessionId);

			connectedSessionIds.delete(sessionId);
			snapshotBySessionId.delete(sessionId);
			sessionWorkspaceIdBySessionId.delete(sessionId);

			return { connectedSessionIds, snapshotBySessionId, sessionWorkspaceIdBySessionId };
		});
	},

	syncWorkspaceSessions: (workspaceId, sessionIds, options = {}) => {
		const desiredSessionIds = new Set(sessionIds);
		for (const [sessionId, connectedWorkspaceId] of get().sessionWorkspaceIdBySessionId.entries()) {
			if (connectedWorkspaceId !== workspaceId || desiredSessionIds.has(sessionId)) continue;
			get().disconnectSession(sessionId);
		}

		for (const sessionId of desiredSessionIds) {
			get().connectSession(sessionId, { workspaceId, recentLimit: options.recentLimit });
		}
	},

	disconnectWorkspaceSessions: (workspaceId) => {
		for (const [sessionId, connectedWorkspaceId] of get().sessionWorkspaceIdBySessionId.entries()) {
			if (connectedWorkspaceId === workspaceId) get().disconnectSession(sessionId);
		}
	},

	createSession: (workspaceId) => {
		return useWsStore.getState().command({ type: 'session.create', workspaceId });
	},

	renameSession: async (sessionId, title) => {
		await useWsStore.getState().command({ type: 'session.rename', sessionId, title });
	},

	removeSession: async (sessionId) => {
		await useWsStore.getState().command({ type: 'session.remove', sessionId });
	},

	sendSessionMessage: (input) => {
		const command = { type: 'session.send', ...input } satisfies SessionSendCommand;
		return useWsStore.getState().command(command);
	},

	cancelSession: async (sessionId) => {
		await useWsStore.getState().command({ type: 'session.cancel', sessionId });
	},

	stopDrainingSession: async (sessionId) => {
		await useWsStore.getState().command({ type: 'session.stopDraining', sessionId });
	},

	loadHistory: (sessionId, beforeCursor, limit) => {
		return useWsStore
			.getState()
			.command({ type: 'session.loadHistory', sessionId, beforeCursor, limit });
	},

	loadOlderChatWindow: async (sessionId, limit = 80) => {
		const request = useChatWindowStore.getState().beginOlderPageLoad(sessionId);
		if (!request) return;

		try {
			const page = await get().loadHistory(sessionId, request.olderCursor, limit);
			useChatWindowStore.getState().applyOlderPage(sessionId, request, page);
		} catch (error) {
			useChatWindowStore.getState().failOlderPage(sessionId, request);
			throw error;
		}
	},

	respondTool: async (sessionId, toolUseId, result) => {
		await useWsStore
			.getState()
			.command({ type: 'session.respondTool', sessionId, toolUseId, result });
	},
}));
