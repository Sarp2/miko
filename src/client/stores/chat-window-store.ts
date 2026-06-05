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
	generation: number;
}

interface ChatWindowStoreState {
	windowBySessionId: Map<string, ChatWindow>;
	nextGeneration: number;
	getWindow: (sessionId: string) => ChatWindow | null;
	syncFromSnapshot: (sessionId: string, snapshot: SessionSnapshot | null) => void;
	loadOlder: (sessionId: string, limit?: number) => Promise<void>;
	resetSession: (sessionId: string) => void;
	resetSessions: (sessionIds: string[]) => void;
}

function emptyWindow(sessionId: string, generation: number): ChatWindow {
	return {
		sessionId,
		messages: [],
		hasOlder: false,
		olderCursor: null,
		loadingOlder: false,
		initialized: false,
		olderPagesLoaded: false,
		generation,
	};
}

function mergeOlderWithRecent(olderMessages: TranscriptEntry[], recentMessages: TranscriptEntry[]) {
	const recentIds = new Set(recentMessages.map((message) => message._id));
	return [...olderMessages.filter((message) => !recentIds.has(message._id)), ...recentMessages];
}

function replaceExistingWindow(
	windows: Map<string, ChatWindow>,
	sessionId: string,
	updater: (current: ChatWindow) => ChatWindow,
) {
	const current = windows.get(sessionId);
	if (!current) return windows;

	const nextWindows = new Map(windows);
	nextWindows.set(sessionId, updater(current));
	return nextWindows;
}

function setWindow(windows: Map<string, ChatWindow>, sessionId: string, window: ChatWindow) {
	const nextWindows = new Map(windows);
	nextWindows.set(sessionId, window);
	return nextWindows;
}

export const useChatWindowStore = create<ChatWindowStoreState>((set, get) => ({
	windowBySessionId: new Map(),
	nextGeneration: 1,

	getWindow: (sessionId) => {
		return get().windowBySessionId.get(sessionId) ?? null;
	},

	syncFromSnapshot: (sessionId, snapshot) => {
		if (!snapshot) {
			get().resetSession(sessionId);
			return;
		}

		set((state) => {
			const current = state.windowBySessionId.get(sessionId);
			const window = current ?? emptyWindow(sessionId, state.nextGeneration);
			const messages = window.initialized
				? mergeOlderWithRecent(window.messages, snapshot.messages)
				: [...snapshot.messages];

			return {
				windowBySessionId: setWindow(state.windowBySessionId, sessionId, {
					...window,
					messages,
					hasOlder: window.olderPagesLoaded ? window.hasOlder : snapshot.history.hasOlder,
					olderCursor: window.olderPagesLoaded ? window.olderCursor : snapshot.history.olderCursor,
					initialized: true,
				}),
				nextGeneration: current ? state.nextGeneration : state.nextGeneration + 1,
			};
		});
	},

	loadOlder: async (sessionId, limit = 80) => {
		const current = get().windowBySessionId.get(sessionId);
		if (!current || current.loadingOlder || !current.hasOlder || !current.olderCursor) return;
		const requestGeneration = current.generation;

		set((state) => ({
			windowBySessionId: replaceExistingWindow(state.windowBySessionId, sessionId, (window) => ({
				...window,
				loadingOlder: true,
			})),
		}));

		try {
			const page = await useSessionStore
				.getState()
				.loadHistory(sessionId, current.olderCursor, limit);

			set((state) => {
				const window = state.windowBySessionId.get(sessionId);
				if (!window || window.generation !== requestGeneration) return state;

				return {
					windowBySessionId: replaceExistingWindow(
						state.windowBySessionId,
						sessionId,
						(window) => ({
							...window,
							messages: mergeOlderWithRecent(page.messages, window.messages),
							hasOlder: page.hasOlder,
							olderCursor: page.olderCursor,
							loadingOlder: false,
							initialized: true,
							olderPagesLoaded: true,
						}),
					),
				};
			});
		} catch (error) {
			set((state) => {
				const window = state.windowBySessionId.get(sessionId);
				if (!window || window.generation !== requestGeneration) return state;

				return {
					windowBySessionId: replaceExistingWindow(
						state.windowBySessionId,
						sessionId,
						(window) => ({
							...window,
							loadingOlder: false,
						}),
					),
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
