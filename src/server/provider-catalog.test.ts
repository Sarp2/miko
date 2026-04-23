import { describe, expect, test } from 'bun:test';
import type { ModelOptions } from 'src/shared/types';
import {
	codexServiceTierFromModelOptions,
	normalizeClaudeModelOptions,
	normalizeCodexModelOptions,
	SERVER_PROVIDERS,
} from './provider-catalog';

describe('SERVER_PROVIDERS', () => {
	test('pins the codex catalog to the server-supported model list', () => {
		const codexModelIds = SERVER_PROVIDERS.find((provider) => provider.id === 'codex')?.models.map(
			(model) => model.id,
		);

		expect(codexModelIds).toEqual(['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3-codex-spark']);
	});
});

describe('normalizeClaudeModelOptions', () => {
	test('falls back to legacy effort argument when modelOptions is missing', () => {
		expect(normalizeClaudeModelOptions('opus', undefined, 'max')).toEqual({
			reasoningEffort: 'max',
			contextWindow: '200k',
		});
	});

	test('keeps the 1m context window for models that support it', () => {
		const modelOptions: ModelOptions = {
			claude: { reasoningEffort: 'medium', contextWindow: '1m' },
		};

		const normalized = normalizeClaudeModelOptions('sonnet', modelOptions);

		expect(normalized).toEqual({
			reasoningEffort: 'medium',
			contextWindow: '1m',
		});
	});

	test('drops unsupported context windows back to the default', () => {
		const modelOptions: ModelOptions = {
			claude: { reasoningEffort: 'medium', contextWindow: '1m' },
		};

		const normalized = normalizeClaudeModelOptions('haiku', modelOptions);

		expect(normalized).toEqual({
			reasoningEffort: 'medium',
			contextWindow: '200k',
		});
	});
});

describe('normalizeCodexModelOptions', () => {
	test('fills defaults when no options are provided', () => {
		const normalized = normalizeCodexModelOptions(undefined);

		expect(normalized).toEqual({
			reasoningEffort: 'high',
			fastMode: false,
		});
	});

	test('preserves explicit reasoning effort and fast mode', () => {
		const modelOptions: ModelOptions = {
			codex: { reasoningEffort: 'xhigh', fastMode: true },
		};

		const normalized = normalizeCodexModelOptions(modelOptions);

		expect(normalized).toEqual({
			reasoningEffort: 'xhigh',
			fastMode: true,
		});
	});
});

describe('codexServiceTierFromModelOptions', () => {
	test('maps fast mode to the fast service tier', () => {
		const tier = codexServiceTierFromModelOptions({ reasoningEffort: 'high', fastMode: true });

		expect(tier).toBe('fast');
	});

	test('returns undefined when fast mode is off', () => {
		const tier = codexServiceTierFromModelOptions({ reasoningEffort: 'high', fastMode: false });

		expect(tier).toBeUndefined();
	});
});
