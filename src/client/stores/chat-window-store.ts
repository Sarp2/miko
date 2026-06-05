import { create } from 'zustand';
import type { SessionSnapshot, TranscriptEntry } from '../../shared/types';
import { useSessionStore } from './session-store';

export interface ChatWindow {
	sessionId: string;
	messages: TranscriptEntry[];
	hasOlder: boolean;
	olderCursor: string | null;
	loadingOlder: boolean;
	initialized: boolean;
	olderPagesLoaded: boolean;
}

interface ChatWindowStoreState {
	windowBySessionId: Map<string, ChatWindow>;
	getWindow: (sessionId: string) => ChatWindow | null;
	syncFromSnapshot: (sessionId: string, snapshot: SessionSnapshot | null) => void;
	loadOlder: (sessionId: string, limit?: number) => Promise<void>;
	resetSession: (sessionId: string) => void;
	resetSessions: (sessionIds: string[]) => void;
}

function emptyWindow(sessionId: string): ChatWindow {
	return {
		sessionId,
		messages: [],
		hasOlder: false,
		olderCursor: null,
		loadingOlder: false,
		initialized: false,
		olderPagesLoaded: false,
	};
}

function mergeOlderWithRecent(olderMessages: TranscriptEntry[], recentMessages: TranscriptEntry[]) {
	const recentIds = new Set(recentMessages.map((message) => message._id));
	return [...olderMessages.filter((message) => !recentIds.has(message._id)), ...recentMessages];
}

function replaceWindow(
	windows: Map<string, ChatWindow>,
	sessionId: string,
	updater: (current: ChatWindow) => ChatWindow,
) {
	const nextWindows = new Map(windows);
	const current = nextWindows.get(sessionId) ?? emptyWindow(sessionId);
	nextWindows.set(sessionId, updater(current));
	return nextWindows;
}

export const useChatWindowStore = create<ChatWindowStoreState>((set, get) => ({
	windowBySessionId: new Map(),

	getWindow: (sessionId) => {
		return get().windowBySessionId.get(sessionId) ?? null;
	},

	syncFromSnapshot: (sessionId, snapshot) => {
		if (!snapshot) {
			get().resetSession(sessionId);
			return;
		}

		set((state) => ({
			windowBySessionId: replaceWindow(state.windowBySessionId, sessionId, (current) => {
				const messages = current.initialized
					? mergeOlderWithRecent(current.messages, snapshot.messages)
					: [...snapshot.messages];

				return {
					...current,
					messages,
					hasOlder: current.olderPagesLoaded ? current.hasOlder : snapshot.history.hasOlder,
					olderCursor: current.olderPagesLoaded
						? current.olderCursor
						: snapshot.history.olderCursor,
					initialized: true,
				};
			}),
		}));
	},

	loadOlder: async (sessionId, limit = 80) => {
		const current = get().windowBySessionId.get(sessionId);
		if (!current || current.loadingOlder || !current.hasOlder || !current.olderCursor) return;

		set((state) => ({
			windowBySessionId: replaceWindow(state.windowBySessionId, sessionId, (window) => ({
				...window,
				loadingOlder: true,
			})),
		}));

		try {
			const page = await useSessionStore
				.getState()
				.loadHistory(sessionId, current.olderCursor, limit);

			set((state) => {
				if (!state.windowBySessionId.has(sessionId)) return state;

				return {
					windowBySessionId: replaceWindow(state.windowBySessionId, sessionId, (window) => ({
						...window,
						messages: mergeOlderWithRecent(page.messages, window.messages),
						hasOlder: page.hasOlder,
						olderCursor: page.olderCursor,
						loadingOlder: false,
						initialized: true,
						olderPagesLoaded: true,
					})),
				};
			});
		} catch (error) {
			set((state) => {
				if (!state.windowBySessionId.has(sessionId)) return state;

				return {
					windowBySessionId: replaceWindow(state.windowBySessionId, sessionId, (window) => ({
						...window,
						loadingOlder: false,
					})),
				};
			});
			throw error;
		}
	},

	resetSession: (sessionId) => {
		set((state) => {
			if (!state.windowBySessionId.has(sessionId)) return state;
			const windowBySessionId = new Map(state.windowBySessionId);
			windowBySessionId.delete(sessionId);
			return { windowBySessionId };
		});
	},

	resetSessions: (sessionIds) => {
		set((state) => {
			const windowBySessionId = new Map(state.windowBySessionId);
			let changed = false;

			for (const sessionId of sessionIds) {
				if (!windowBySessionId.delete(sessionId)) continue;
				changed = true;
			}

			return changed ? { windowBySessionId } : state;
		});
	},
}));
