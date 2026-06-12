import { describe, expect, test } from 'bun:test';
import { distinctToolKinds, summarizeTurn } from './turn-summary';

describe('summarizeTurn', () => {
	test('pluralizes and joins non-zero counts', () => {
		expect(summarizeTurn(5, 2)).toBe('5 tool calls, 2 messages');
		expect(summarizeTurn(1, 1)).toBe('1 tool call, 1 message');
	});

	test('omits zero counts and falls back to Working', () => {
		expect(summarizeTurn(3, 0)).toBe('3 tool calls');
		expect(summarizeTurn(0, 0)).toBe('Working');
	});
});

describe('distinctToolKinds', () => {
	test('dedupes in first-seen order and caps at the limit', () => {
		const tools = [
			{ toolKind: 'bash' },
			{ toolKind: 'read_file' },
			{ toolKind: 'bash' },
			{ toolKind: 'grep' },
		];
		expect(distinctToolKinds(tools)).toEqual(['bash', 'read_file', 'grep']);
		expect(distinctToolKinds(tools, 2)).toEqual(['bash', 'read_file']);
	});
});
