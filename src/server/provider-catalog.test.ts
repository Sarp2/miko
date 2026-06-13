import { describe, expect, test } from 'bun:test';
import type { ModelOptions } from 'src/shared/types';
import {
	codexServiceTierFromModelOptions,
	normalizeClaudeModelOptions,
	normalizeCodexModelOptions,
	normalizeServerModel,
	SERVER_PROVIDERS,
} from './provider-catalog';

describe('SERVER_PROVIDERS', () => {
	test('pins the codex catalog to the server-supported model list', () => {
		const codexModelIds = SERVER_PROVIDERS.find((provider) => provider.id === 'codex')?.models.map(
			(model) => model.id,
		);

		expect(codexModelIds).toEqual(['gpt-5.5', 'gpt-5.4']);
	});
});

describe('normalizeServerModel', () => {
	test('accepts every catalog model id and falls back for unknown ids', () => {
		for (const provider of SERVER_PROVIDERS) {
			for (const model of provider.models) {
				expect(normalizeServerModel(provider.id, model.id)).toBe(model.id);
			}
			expect(normalizeServerModel(provider.id, 'not-a-real-model')).toBe(provider.defaultModel);
		}
	});
});

describe('normalizeClaudeModelOptions', () => {
	test('falls back to legacy effort argument when modelOptions is missing', () => {
		expect(normalizeClaudeModelOptions('claude-opus-4-8', undefined, 'max')).toEqual({
			reasoningEffort: 'max',
			contextWindow: '200k',
		});
	});

	test('keeps the 1m context window for models that support it', () => {
		const modelOptions: ModelOptions = {
			claude: { reasoningEffort: 'medium', contextWindow: '1m' },
		};

		const normalized = normalizeClaudeModelOptions('claude-sonnet-4-6', modelOptions);

		expect(normalized).toEqual({
			reasoningEffort: 'medium',
			contextWindow: '1m',
		});
	});

	test('drops the 1m context window for models that do not support it', () => {
		const modelOptions: ModelOptions = {
			claude: { reasoningEffort: 'medium', contextWindow: '1m' },
		};

		const normalized = normalizeClaudeModelOptions('claude-haiku-4-5', modelOptions);

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
