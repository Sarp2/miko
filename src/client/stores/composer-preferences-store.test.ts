import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	COMPOSER_PREFERENCES_STORAGE_KEY,
	useComposerPreferencesStore,
} from './composer-preferences-store';

const initialState = useComposerPreferencesStore.getInitialState();

function resetStore() {
	useComposerPreferencesStore.setState(initialState, true);
	useComposerPreferencesStore.persist.clearStorage();
}

function installLocalStorage(initialValues = new Map<string, string>()) {
	const values = new Map(initialValues);
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			localStorage: {
				getItem: (key: string) => values.get(key) ?? null,
				setItem: (key: string, value: string) => values.set(key, value),
				removeItem: (key: string) => values.delete(key),
			},
		},
	});
	return values;
}

function removeMockedBrowserGlobals() {
	delete (globalThis as { window?: unknown }).window;
}

beforeEach(() => {
	installLocalStorage();
	resetStore();
});

afterEach(() => {
	resetStore();
	removeMockedBrowserGlobals();
});

describe('useComposerPreferencesStore', () => {
	test('persists composer model preferences', () => {
		useComposerPreferencesStore.getState().setProviderPreference('codex');
		useComposerPreferencesStore.getState().setModelPreference('codex', 'gpt-5.5');
		useComposerPreferencesStore.getState().setModelPreference('claude', 'claude-sonnet-4-6');
		useComposerPreferencesStore.getState().setClaudeReasoningEffortPreference('max');
		useComposerPreferencesStore.getState().setClaudeContextWindowPreference('1m');
		useComposerPreferencesStore.getState().setCodexReasoningEffortPreference('xhigh');
		useComposerPreferencesStore.getState().setCodexFastModePreference(true);
		useComposerPreferencesStore.getState().setPlanModePreference(true);

		expect(useComposerPreferencesStore.getState()).toMatchObject({
			provider: 'codex',
			selectedModelByProvider: {
				codex: 'gpt-5.5',
				claude: 'claude-sonnet-4-6',
			},
			claudeReasoningEffort: 'max',
			claudeContextWindow: '1m',
			codexReasoningEffort: 'xhigh',
			codexFastMode: true,
			planMode: true,
		});
	});

	test('reset clears preferences to unset values', () => {
		useComposerPreferencesStore.getState().setProviderPreference('claude');
		useComposerPreferencesStore.getState().setModelPreference('claude', 'claude-opus-4-8');
		useComposerPreferencesStore.getState().setPlanModePreference(true);

		useComposerPreferencesStore.getState().resetComposerPreferences();

		expect(useComposerPreferencesStore.getState()).toMatchObject({
			provider: null,
			selectedModelByProvider: {},
			claudeReasoningEffort: null,
			claudeContextWindow: null,
			codexReasoningEffort: null,
			codexFastMode: null,
			planMode: null,
		});
	});

	test('uses the miko composer preference storage key', () => {
		expect(useComposerPreferencesStore.persist.getOptions().name).toBe(
			COMPOSER_PREFERENCES_STORAGE_KEY,
		);
	});

	test('normalizes stale persisted values during merge', () => {
		const merge = useComposerPreferencesStore.persist.getOptions().merge;
		expect(merge).toBeFunction();

		const merged = merge?.(
			{
				provider: 'bad-provider',
				selectedModelByProvider: { claude: 'claude-opus-4-8', bad: 'bad-model' },
				claudeReasoningEffort: 'impossible',
				claudeContextWindow: '2m',
				codexReasoningEffort: 'turbo',
				codexFastMode: 'yes',
				planMode: 'no',
			},
			initialState,
		);

		expect(merged).toMatchObject({
			provider: null,
			selectedModelByProvider: { claude: 'claude-opus-4-8' },
			claudeReasoningEffort: null,
			claudeContextWindow: null,
			codexReasoningEffort: null,
			codexFastMode: null,
			planMode: null,
		});
	});
});
