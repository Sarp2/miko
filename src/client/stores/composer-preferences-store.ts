import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type {
	AgentProvider,
	ClaudeContextWindow,
	ClaudeReasoningEffort,
	CodexReasoningEffort,
} from '../../shared/types';
import {
	isClaudeContextWindow,
	isClaudeReasoningEffort,
	isCodexReasoningEffort,
} from '../../shared/types';

export const COMPOSER_PREFERENCES_STORAGE_KEY = 'miko:v1:composer-preferences';

export interface ComposerPreferencesSnapshot {
	provider: AgentProvider | null;
	selectedModelByProvider: Partial<Record<AgentProvider, string>>;
	claudeReasoningEffort: ClaudeReasoningEffort | null;
	claudeContextWindow: ClaudeContextWindow | null;
	codexReasoningEffort: CodexReasoningEffort | null;
	codexFastMode: boolean | null;
	planMode: boolean | null;
}

interface ComposerPreferencesState extends ComposerPreferencesSnapshot {
	setProviderPreference: (provider: AgentProvider) => void;
	setModelPreference: (provider: AgentProvider, modelId: string) => void;
	setClaudeReasoningEffortPreference: (value: ClaudeReasoningEffort) => void;
	setClaudeContextWindowPreference: (value: ClaudeContextWindow) => void;
	setCodexReasoningEffortPreference: (value: CodexReasoningEffort) => void;
	setCodexFastModePreference: (value: boolean) => void;
	setPlanModePreference: (value: boolean) => void;
	resetComposerPreferences: () => void;
}

const memoryStorage = new Map<string, string>();

const fallbackStorage: StateStorage = {
	getItem: (name) => memoryStorage.get(name) ?? null,
	setItem: (name, value) => {
		memoryStorage.set(name, value);
	},
	removeItem: (name) => {
		memoryStorage.delete(name);
	},
};

function getLocalStorage(): StateStorage {
	if (typeof window === 'undefined') return fallbackStorage;
	return window.localStorage;
}

const DEFAULT_COMPOSER_PREFERENCES: ComposerPreferencesSnapshot = {
	provider: null,
	selectedModelByProvider: {},
	claudeReasoningEffort: null,
	claudeContextWindow: null,
	codexReasoningEffort: null,
	codexFastMode: null,
	planMode: null,
};

function isAgentProvider(value: unknown): value is AgentProvider {
	return value === 'claude' || value === 'codex';
}

function normalizeSelectedModelByProvider(value: unknown) {
	if (!value || typeof value !== 'object') return {};
	const candidate = value as Record<string, unknown>;
	const selectedModelByProvider: Partial<Record<AgentProvider, string>> = {};
	if (typeof candidate.claude === 'string') selectedModelByProvider.claude = candidate.claude;
	if (typeof candidate.codex === 'string') selectedModelByProvider.codex = candidate.codex;
	return selectedModelByProvider;
}

function normalizePersistedState(value: unknown): ComposerPreferencesSnapshot {
	const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	return {
		provider: isAgentProvider(candidate.provider) ? candidate.provider : null,
		selectedModelByProvider: normalizeSelectedModelByProvider(candidate.selectedModelByProvider),
		claudeReasoningEffort: isClaudeReasoningEffort(candidate.claudeReasoningEffort)
			? candidate.claudeReasoningEffort
			: null,
		claudeContextWindow: isClaudeContextWindow(candidate.claudeContextWindow)
			? candidate.claudeContextWindow
			: null,
		codexReasoningEffort: isCodexReasoningEffort(candidate.codexReasoningEffort)
			? candidate.codexReasoningEffort
			: null,
		codexFastMode: typeof candidate.codexFastMode === 'boolean' ? candidate.codexFastMode : null,
		planMode: typeof candidate.planMode === 'boolean' ? candidate.planMode : null,
	};
}

export const useComposerPreferencesStore = create<ComposerPreferencesState>()(
	persist(
		(set) => ({
			...DEFAULT_COMPOSER_PREFERENCES,

			setProviderPreference: (provider) => {
				set({ provider });
			},

			setModelPreference: (provider, modelId) => {
				set((state) => ({
					selectedModelByProvider: {
						...state.selectedModelByProvider,
						[provider]: modelId,
					},
				}));
			},

			setClaudeReasoningEffortPreference: (claudeReasoningEffort) => {
				set({ claudeReasoningEffort });
			},

			setClaudeContextWindowPreference: (claudeContextWindow) => {
				set({ claudeContextWindow });
			},

			setCodexReasoningEffortPreference: (codexReasoningEffort) => {
				set({ codexReasoningEffort });
			},

			setCodexFastModePreference: (codexFastMode) => {
				set({ codexFastMode });
			},

			setPlanModePreference: (planMode) => {
				set({ planMode });
			},

			resetComposerPreferences: () => {
				set(DEFAULT_COMPOSER_PREFERENCES);
			},
		}),
		{
			name: COMPOSER_PREFERENCES_STORAGE_KEY,
			storage: createJSONStorage(getLocalStorage),
			partialize: (state): ComposerPreferencesSnapshot => ({
				provider: state.provider,
				selectedModelByProvider: state.selectedModelByProvider,
				claudeReasoningEffort: state.claudeReasoningEffort,
				claudeContextWindow: state.claudeContextWindow,
				codexReasoningEffort: state.codexReasoningEffort,
				codexFastMode: state.codexFastMode,
				planMode: state.planMode,
			}),
			merge: (persisted, current) => ({
				...current,
				...normalizePersistedState(persisted),
			}),
		},
	),
);
