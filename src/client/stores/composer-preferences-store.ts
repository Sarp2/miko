import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import {
	type AgentProvider,
	type ClaudeContextWindow,
	type ClaudeReasoningEffort,
	type CodexReasoningEffort,
	isClaudeContextWindow,
	isClaudeReasoningEffort,
	isCodexReasoningEffort,
} from '../../shared/types';

export const COMPOSER_PREFERENCES_STORAGE_KEY = 'miko:v1:composer-preferences';

// `null` means the user has not chosen a preference yet, which lets later
// Settings UI distinguish "unset" from an explicit value.
interface PersistedComposerPreferences {
	provider: AgentProvider | null;
	selectedModelByProvider: Partial<Record<AgentProvider, string>>;
	claudeReasoningEffort: ClaudeReasoningEffort | null;
	claudeContextWindow: ClaudeContextWindow | null;
	codexReasoningEffort: CodexReasoningEffort | null;
	codexFastMode: boolean | null;
	planMode: boolean | null;
}

interface ComposerPreferencesState extends PersistedComposerPreferences {
	setProviderPreference(provider: AgentProvider): void;
	setModelPreference(provider: AgentProvider, modelId: string): void;
	setClaudeReasoningEffortPreference(value: ClaudeReasoningEffort): void;
	setClaudeContextWindowPreference(value: ClaudeContextWindow): void;
	setCodexReasoningEffortPreference(value: CodexReasoningEffort): void;
	setCodexFastModePreference(value: boolean): void;
	setPlanModePreference(value: boolean): void;
	resetComposerPreferences(): void;
}

const INITIAL_PREFERENCES: PersistedComposerPreferences = {
	provider: null,
	selectedModelByProvider: {},
	claudeReasoningEffort: null,
	claudeContextWindow: null,
	codexReasoningEffort: null,
	codexFastMode: null,
	planMode: null,
};

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

function isAgentProvider(value: unknown): value is AgentProvider {
	return value === 'claude' || value === 'codex';
}

function sanitizeModelMap(value: unknown): Partial<Record<AgentProvider, string>> {
	if (!value || typeof value !== 'object') return {};
	const record = value as Record<string, unknown>;
	const result: Partial<Record<AgentProvider, string>> = {};
	for (const provider of ['claude', 'codex'] as const) {
		const modelId = record[provider];
		if (typeof modelId === 'string' && modelId.length > 0) result[provider] = modelId;
	}
	return result;
}

// Stale or hand-edited localStorage must never crash the composer or submit an
// invalid model/option, so every persisted field is validated before use.
export function sanitizeComposerPreferences(value: unknown): PersistedComposerPreferences {
	const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	return {
		provider: isAgentProvider(record.provider) ? record.provider : null,
		selectedModelByProvider: sanitizeModelMap(record.selectedModelByProvider),
		claudeReasoningEffort: isClaudeReasoningEffort(record.claudeReasoningEffort)
			? record.claudeReasoningEffort
			: null,
		claudeContextWindow: isClaudeContextWindow(record.claudeContextWindow)
			? record.claudeContextWindow
			: null,
		codexReasoningEffort: isCodexReasoningEffort(record.codexReasoningEffort)
			? record.codexReasoningEffort
			: null,
		codexFastMode: typeof record.codexFastMode === 'boolean' ? record.codexFastMode : null,
		planMode: typeof record.planMode === 'boolean' ? record.planMode : null,
	};
}

export const useComposerPreferencesStore = create<ComposerPreferencesState>()(
	persist(
		(set) => ({
			...INITIAL_PREFERENCES,

			setProviderPreference: (provider) => {
				set({ provider });
			},

			setModelPreference: (provider, modelId) => {
				set((state) => ({
					selectedModelByProvider: { ...state.selectedModelByProvider, [provider]: modelId },
				}));
			},

			setClaudeReasoningEffortPreference: (value) => {
				set({ claudeReasoningEffort: value });
			},

			setClaudeContextWindowPreference: (value) => {
				set({ claudeContextWindow: value });
			},

			setCodexReasoningEffortPreference: (value) => {
				set({ codexReasoningEffort: value });
			},

			setCodexFastModePreference: (value) => {
				set({ codexFastMode: value });
			},

			setPlanModePreference: (value) => {
				set({ planMode: value });
			},

			resetComposerPreferences: () => {
				set({ ...INITIAL_PREFERENCES });
			},
		}),
		{
			name: COMPOSER_PREFERENCES_STORAGE_KEY,
			storage: createJSONStorage(getLocalStorage),
			partialize: (state): PersistedComposerPreferences => ({
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
				...sanitizeComposerPreferences(persisted),
			}),
		},
	),
);
