import { describe, expect, test } from 'bun:test';
import type { HydratedTranscriptMessage } from '../../shared/types';
import { groupTranscriptTurns } from './group-transcript-turns';

function base(id: string) {
	return { id, messageId: undefined, timestamp: '1970-01-01T00:00:01.000Z', hidden: undefined };
}

function toolMessage(id: string, toolId: string): HydratedTranscriptMessage {
	return {
		...base(id),
		kind: 'tool',
		toolKind: 'bash',
		toolName: 'bash',
		toolId,
		input: { command: 'bun test' },
		hasResult: true,
	};
}

describe('groupTranscriptTurns', () => {
	test('splits user prompts from agent turns', () => {
		const items = groupTranscriptTurns([
			{ ...base('u1'), kind: 'user_prompt', content: 'hi' },
			toolMessage('t1', 'call-1'),
			{ ...base('a1'), kind: 'assistant_text', text: 'done' },
		]);

		expect(items.map((item) => item.type)).toEqual(['user', 'turn']);
	});

	test('surfaces the last assistant text and counts only intermediate messages', () => {
		const items = groupTranscriptTurns([
			{ ...base('a1'), kind: 'assistant_text', text: 'thinking' },
			toolMessage('t1', 'call-1'),
			{ ...base('a2'), kind: 'assistant_text', text: 'final' },
		]);

		expect(items).toHaveLength(1);
		const item = items[0];
		if (item.type !== 'turn') throw new Error('expected turn');
		expect(item.turn.finalText?.text).toBe('final');
		expect(item.turn.toolCount).toBe(1);
		expect(item.turn.messageCount).toBe(1);
	});

	test('keeps a pre-tool preamble in activity instead of surfacing it as the reply', () => {
		const items = groupTranscriptTurns([
			{ ...base('a1'), kind: 'assistant_text', text: "I'll inspect" },
			toolMessage('t1', 'call-1'),
		]);

		const item = items[0];
		if (item.type !== 'turn') throw new Error('expected turn');
		expect(item.turn.finalText).toBeNull();
		expect(item.turn.activity.map((message) => message.id)).toEqual(['a1', 't1']);
	});

	test('captures model/provider from system_init and usage, dropping diagnostics', () => {
		const items = groupTranscriptTurns([
			{
				...base('s1'),
				kind: 'system_init',
				model: 'opus',
				provider: 'claude',
				tools: [],
				agents: [],
				slashCommands: [],
				mcpServers: [],
			},
			toolMessage('t1', 'call-1'),
			{ ...base('st'), kind: 'status', status: 'compacting' },
			{
				...base('ctx'),
				kind: 'context_window_updated',
				usage: { usedTokens: 10, compactsAutomatically: true, lastInputTokens: 42 },
			},
			{ ...base('r1'), kind: 'result', success: true, result: '', durationMs: 1200 },
		]);

		const item = items[0];
		if (item.type !== 'turn') throw new Error('expected turn');
		expect(item.turn.model).toBe('opus');
		expect(item.turn.provider).toBe('claude');
		expect(item.turn.usage?.lastInputTokens).toBe(42);
		expect(item.turn.isComplete).toBe(true);
	});

	test('uses stable fallback ids for malformed empty message ids', () => {
		const items = groupTranscriptTurns([
			{ ...base(''), kind: 'user_prompt', content: 'hi' },
			toolMessage('', 'call-1'),
		]);

		expect(items).toHaveLength(2);
		expect(items[0].id).toBe('user:0');
		expect(items[1].id).toBe('turn:1');
		if (items[1].type !== 'turn') throw new Error('expected turn');
		expect(items[1].turn.id).toBe('turn:1');
	});

	test('marks a turn without a result as incomplete', () => {
		const items = groupTranscriptTurns([toolMessage('t1', 'call-1')]);
		const item = items[0];
		if (item.type !== 'turn') throw new Error('expected turn');
		expect(item.turn.isComplete).toBe(false);
		expect(item.turn.durationMs).toBeNull();
	});

	test('keeps a result-only startup failure visible', () => {
		const items = groupTranscriptTurns([
			{
				...base('result-1'),
				kind: 'result',
				success: false,
				cancelled: false,
				result: 'Codex usage limit reached',
				durationMs: 0,
			},
		]);

		expect(items).toHaveLength(1);
		const item = items[0];
		if (item.type !== 'turn') throw new Error('expected turn');
		expect(item.id).toBe('result-1');
		expect(item.turn.errorText).toBe('Codex usage limit reached');
		expect(item.turn.isComplete).toBe(true);
	});

	test('treats an interrupted (cancelled) turn as complete', () => {
		const items = groupTranscriptTurns([
			toolMessage('t1', 'call-1'),
			{ ...base('int'), kind: 'interrupted' },
		]);
		const item = items[0];
		if (item.type !== 'turn') throw new Error('expected turn');
		expect(item.turn.isComplete).toBe(true);
		expect(item.turn.durationMs).toBeNull();
	});
});
