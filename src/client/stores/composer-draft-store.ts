import { create } from 'zustand';
import type { PromptPart } from '../../shared/types';

interface ComposerDraftStoreState {
	draftPartsBySessionId: Map<string, PromptPart[]>;
	setDraft: (sessionId: string, parts: PromptPart[]) => void;
	clearDraft: (sessionId: string) => void;
	getDraft: (sessionId: string) => PromptPart[];
}

export const useComposerDraftStore = create<ComposerDraftStoreState>((set, get) => ({
	draftPartsBySessionId: new Map(),

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
}));
