import { describe, expect, test } from 'bun:test';
import {
	fallbackTitleFromMessage,
	generateTitleForChat,
	generateTitleForChatDetailed,
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

describe('generateTitleForChatDetailed', () => {
	test('returns the normalized provider title on success', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => ({ title: '  Fix   login   flow  ' }),
			runCodexStructured: async () => null,
		});

		await expect(generateTitleForChatDetailed('login is broken', adapter)).resolves.toEqual({
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

		const result = await generateTitleForChatDetailed('hi', adapter);

		expect(result.title).toBe('a'.repeat(80));
		expect(result.usedFallback).toBe(false);
	});

	test('rejects "New Chat" and falls back to the message-derived title', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => ({ title: 'New Chat' }),
			runCodexStructured: async () => ({ title: 'New Chat' }),
		});

		const result = await generateTitleForChatDetailed('build a settings page', adapter);

		expect(result.title).toBe('build a settings page');
		expect(result.usedFallback).toBe(true);
	});

	test('falls back and summarizes both provider failures when neither returns a title', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => null,
			runCodexStructured: async () => null,
		});

		const result = await generateTitleForChatDetailed('login is broken', adapter);

		expect(result.title).toBe('login is broken');
		expect(result.usedFallback).toBe(true);
		expect(result.failureMessage).toContain('claude');
		expect(result.failureMessage).toContain('codex');
	});
});

describe('generateTitleForChat', () => {
	test('unwraps the title from the detailed result', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => ({ title: 'Picked Title' }),
			runCodexStructured: async () => null,
		});

		expect(await generateTitleForChat('hello', adapter)).toBe('Picked Title');
	});
});
