import { describe, expect, test } from 'bun:test';
import {
	fallbackTitleFromMessage,
	generateTitleForSession,
	generateTitleForSessionDetailed,
} from './generate-title';
import { QuickResponseAdapter } from './quick-response';

describe('fallbackTitleFromMessage', () => {
	test('returns null for empty or whitespace-only messages', () => {
		expect(fallbackTitleFromMessage('')).toBeNull();
		expect(fallbackTitleFromMessage('   \n\t  ')).toBeNull();
	});

	test('collapses whitespace and returns short messages unchanged', () => {
		expect(fallbackTitleFromMessage('  hello   world  ')).toBe('hello world');
	});

	test('truncates long messages to 35 chars with an ellipsis', () => {
		const long = 'a'.repeat(50);
		expect(fallbackTitleFromMessage(long)).toBe(`${'a'.repeat(35)}...`);
	});
});

describe('generateTitleForSessionDetailed', () => {
	test('returns the normalized provider title on success', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => ({ title: '  Fix   login   flow  ' }),
			runCodexStructured: async () => null,
		});

		await expect(generateTitleForSessionDetailed('login is broken', adapter)).resolves.toEqual({
			title: 'Fix login flow',
			usedFallback: false,
			failureMessage: null,
		});
	});

	test('truncates titles longer than 80 characters', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => ({ title: 'a'.repeat(120) }),
			runCodexStructured: async () => null,
		});

		const result = await generateTitleForSessionDetailed('hi', adapter);

		expect(result.title).toBe('a'.repeat(80));
		expect(result.usedFallback).toBe(false);
	});

	test('rejects "New Session" and falls back to the message-derived title', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => ({ title: 'New Session' }),
			runCodexStructured: async () => ({ title: 'New Session' }),
		});

		const result = await generateTitleForSessionDetailed('build a settings page', adapter);

		expect(result.title).toBe('build a settings page');
		expect(result.usedFallback).toBe(true);
	});

	test('falls back and summarizes both provider failures when neither returns a title', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => null,
			runCodexStructured: async () => null,
		});

		const result = await generateTitleForSessionDetailed('login is broken', adapter);

		expect(result.title).toBe('login is broken');
		expect(result.usedFallback).toBe(true);
		expect(result.failureMessage).toContain('claude');
		expect(result.failureMessage).toContain('codex');
	});
});

describe('generateTitleForSession', () => {
	test('unwraps the title from the detailed result', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => ({ title: 'Picked Title' }),
			runCodexStructured: async () => null,
		});

		expect(await generateTitleForSession('hello', adapter)).toBe('Picked Title');
	});
});
