import { create } from 'zustand';
import type { PromptPart } from '../../shared/types';

interface ComposerDraftStoreState {
	draftPartsBySessionId: Map<string, PromptPart[]>;
	/**
	 * Parts queued to be appended into a session's live composer (e.g. from the
	 * Checks "Add to chat" action). Kept separate from the persisted draft so the
	 * append reaches an already-mounted composer without the draft write-back loop
	 * clobbering in-progress attachments. The composer drains this on mount and
	 * whenever it changes for its session.
	 */
	pendingAppendBySessionId: Map<string, PromptPart[]>;
	setDraft: (sessionId: string, parts: PromptPart[]) => void;
	clearDraft: (sessionId: string) => void;
	getDraft: (sessionId: string) => PromptPart[];
	appendToComposer: (sessionId: string, parts: PromptPart[]) => void;
	consumePendingAppend: (sessionId: string) => PromptPart[];
}

export const useComposerDraftStore = create<ComposerDraftStoreState>((set, get) => ({
	draftPartsBySessionId: new Map(),
	pendingAppendBySessionId: new Map(),

	getDraft: (sessionId) => {
		return get().draftPartsBySessionId.get(sessionId) ?? [];
	},

	setDraft: (sessionId, parts) => {
		set((state) => {
			const draftPartsBySessionId = new Map(state.draftPartsBySessionId);
			draftPartsBySessionId.set(sessionId, parts);
			return { draftPartsBySessionId };
		});
	},

	clearDraft: (sessionId) => {
		set((state) => {
			if (!state.draftPartsBySessionId.has(sessionId)) return state;
			const draftPartsBySessionId = new Map(state.draftPartsBySessionId);
			draftPartsBySessionId.delete(sessionId);
			return { draftPartsBySessionId };
		});
	},

	appendToComposer: (sessionId, parts) => {
		if (parts.length === 0) return;
		set((state) => {
			const pendingAppendBySessionId = new Map(state.pendingAppendBySessionId);
			const existing = pendingAppendBySessionId.get(sessionId) ?? [];
			pendingAppendBySessionId.set(sessionId, [...existing, ...parts]);
			return { pendingAppendBySessionId };
		});
	},

	consumePendingAppend: (sessionId) => {
		const pending = get().pendingAppendBySessionId.get(sessionId) ?? [];
		if (pending.length === 0) return [];
		set((state) => {
			if (!state.pendingAppendBySessionId.has(sessionId)) return state;
			const pendingAppendBySessionId = new Map(state.pendingAppendBySessionId);
			pendingAppendBySessionId.delete(sessionId);
			return { pendingAppendBySessionId };
		});
		return pending;
	},
}));
