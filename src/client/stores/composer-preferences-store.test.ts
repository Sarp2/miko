import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	COMPOSER_PREFERENCES_STORAGE_KEY,
	sanitizeComposerPreferences,
	useComposerPreferencesStore,
} from './composer-preferences-store';

const initialState = useComposerPreferencesStore.getInitialState();

function resetStore() {
	useComposerPreferencesStore.setState(initialState, true);
	useComposerPreferencesStore.persist.clearStorage();
}

function installLocalStorage() {
	const values = new Map<string, string>();
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
	test('writes selections to persisted storage', async () => {
		const store = useComposerPreferencesStore.getState();
		store.setProviderPreference('codex');
		store.setModelPreference('claude', 'opus');
		store.setClaudeReasoningEffortPreference('max');
		store.setClaudeContextWindowPreference('1m');
		store.setCodexFastModePreference(true);
		store.setPlanModePreference(true);

		const persisted = await useComposerPreferencesStore.persist
			.getOptions()
			.storage?.getItem(COMPOSER_PREFERENCES_STORAGE_KEY);

		expect(persisted?.state).toEqual({
			provider: 'codex',
			selectedModelByProvider: { claude: 'opus' },
			claudeReasoningEffort: 'max',
			claudeContextWindow: '1m',
			codexReasoningEffort: null,
			codexFastMode: true,
			planMode: true,
		});
	});

	test('resetComposerPreferences clears every preference to null', () => {
		const store = useComposerPreferencesStore.getState();
		store.setProviderPreference('claude');
		store.setModelPreference('codex', 'gpt-5.4');
		store.setPlanModePreference(false);

		store.resetComposerPreferences();

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
});

describe('sanitizeComposerPreferences', () => {
	test('keeps valid values and drops stale or malformed ones', () => {
		expect(
			sanitizeComposerPreferences({
				provider: 'codex',
				selectedModelByProvider: { claude: 'opus', codex: 7 },
				claudeReasoningEffort: 'max',
				claudeContextWindow: '9000',
				codexReasoningEffort: 'nope',
				codexFastMode: 'yes',
				planMode: true,
			}),
		).toEqual({
			provider: 'codex',
			selectedModelByProvider: { claude: 'opus' },
			claudeReasoningEffort: 'max',
			claudeContextWindow: null,
			codexReasoningEffort: null,
			codexFastMode: null,
			planMode: true,
		});

		expect(sanitizeComposerPreferences('broken')).toEqual({
			provider: null,
			selectedModelByProvider: {},
			claudeReasoningEffort: null,
			claudeContextWindow: null,
			codexReasoningEffort: null,
			codexFastMode: null,
			planMode: null,
		});
	});
});
