import { describe, expect, test } from 'bun:test';
import type { TranscriptEntry } from '../../shared/types';
import { hydrateTranscriptMessages } from './hydrate-transcript-messages';

function baseEntry(id: string, kind: TranscriptEntry['kind'], createdAt = 1) {
	return {
		_id: id,
		kind,
		createdAt,
	};
}

describe('hydrateTranscriptMessages', () => {
	test('hydrates basic user and assistant transcript entries', () => {
		const messages = hydrateTranscriptMessages([
			{ ...baseEntry('u1', 'user_prompt', 1000), content: 'Build it', messageId: 'msg-1' },
			{ ...baseEntry('a1', 'assistant_text', 2000), text: 'Done', hidden: true },
		] as TranscriptEntry[]);

		expect(messages).toEqual([
			{
				kind: 'user_prompt',
				id: 'u1',
				messageId: 'msg-1',
				timestamp: '1970-01-01T00:00:01.000Z',
				hidden: undefined,
				content: 'Build it',
				attachments: undefined,
			},
			{
				kind: 'assistant_text',
				id: 'a1',
				messageId: undefined,
				timestamp: '1970-01-01T00:00:02.000Z',
				hidden: true,
				text: 'Done',
			},
		]);
	});

	test('pairs tool calls with tool results by tool id', () => {
		const messages = hydrateTranscriptMessages([
			{
				...baseEntry('tool-1', 'tool_call', 1000),
				tool: {
					kind: 'tool',
					toolKind: 'bash',
					toolName: 'bash',
					toolId: 'call-1',
					input: { command: 'bun test' },
				},
			},
			{
				...baseEntry('result-1', 'tool_result', 2000),
				toolId: 'call-1',
				content: 'pass',
				isError: false,
			},
		] as TranscriptEntry[]);

		expect(messages).toEqual([
			{
				kind: 'tool',
				id: 'tool-1',
				messageId: undefined,
				hidden: undefined,
				timestamp: '1970-01-01T00:00:01.000Z',
				toolKind: 'bash',
				toolName: 'bash',
				toolId: 'call-1',
				input: { command: 'bun test' },
				result: 'pass',
				rawResult: 'pass',
				isError: false,
			},
		]);
	});

	test('hydrates pending tool calls without a result', () => {
		const messages = hydrateTranscriptMessages([
			{
				...baseEntry('tool-1', 'tool_call', 1000),
				tool: {
					kind: 'tool',
					toolKind: 'read_file',
					toolName: 'read_file',
					toolId: 'call-1',
					input: { filePath: 'src/index.ts' },
				},
			},
		] as TranscriptEntry[]);

		expect(messages[0]).toMatchObject({
			kind: 'tool',
			toolKind: 'read_file',
			toolId: 'call-1',
			input: { filePath: 'src/index.ts' },
		});
		expect(messages[0]).not.toHaveProperty('result');
	});

	test('maps result entries into success and cancelled flags', () => {
		const messages = hydrateTranscriptMessages([
			{
				...baseEntry('success', 'result', 1000),
				subtype: 'success',
				isError: false,
				durationMs: 123,
				result: 'ok',
				costUsd: 0.01,
			},
			{
				...baseEntry('cancelled', 'result', 2000),
				subtype: 'cancelled',
				isError: false,
				durationMs: 50,
				result: 'stopped',
			},
		] as TranscriptEntry[]);

		expect(messages).toMatchObject([
			{ kind: 'result', success: true, cancelled: false, result: 'ok', durationMs: 123 },
			{ kind: 'result', success: false, cancelled: true, result: 'stopped', durationMs: 50 },
		]);
	});

	test('skips standalone tool results and keeps chronological tool call position', () => {
		const messages = hydrateTranscriptMessages([
			{ ...baseEntry('result-early', 'tool_result', 500), toolId: 'call-1', content: 'early' },
			{
				...baseEntry('tool-1', 'tool_call', 1000),
				tool: {
					kind: 'tool',
					toolKind: 'grep',
					toolName: 'grep',
					toolId: 'call-1',
					input: { pattern: 'TODO' },
				},
			},
			{ ...baseEntry('a1', 'assistant_text', 1500), text: 'After tool' },
		] as TranscriptEntry[]);

		expect(messages.map((message) => message.id)).toEqual(['tool-1', 'a1']);
		expect(messages[0]).toMatchObject({ kind: 'tool', result: 'early' });
	});

	test('normalizes specialized tool results for render components', () => {
		const messages = hydrateTranscriptMessages([
			{
				...baseEntry('question-tool', 'tool_call', 1000),
				tool: {
					kind: 'tool',
					toolKind: 'ask_user_question',
					toolName: 'AskUserQuestion',
					toolId: 'question-1',
					input: { questions: [{ id: 'choice', question: 'Pick one' }] },
				},
			},
			{
				...baseEntry('question-result', 'tool_result', 2000),
				toolId: 'question-1',
				content: JSON.stringify({ answers: { choice: 'yes' } }),
			},
			{
				...baseEntry('read-tool', 'tool_call', 3000),
				tool: {
					kind: 'tool',
					toolKind: 'read_file',
					toolName: 'Read',
					toolId: 'read-1',
					input: { filePath: 'src/index.ts' },
				},
			},
			{
				...baseEntry('read-result', 'tool_result', 4000),
				toolId: 'read-1',
				content: [{ type: 'text', text: 'hello' }],
			},
		] as TranscriptEntry[]);

		expect(messages[0]).toMatchObject({
			kind: 'tool',
			toolKind: 'ask_user_question',
			rawResult: JSON.stringify({ answers: { choice: 'yes' } }),
			result: { answers: { choice: ['yes'] } },
		});

		expect(messages[1]).toMatchObject({
			kind: 'tool',
			toolKind: 'read_file',
			rawResult: [{ type: 'text', text: 'hello' }],
			result: {
				content: 'hello',
				blocks: [{ type: 'text', text: 'hello' }],
			},
		});
	});

	test('hydrates unknown future entries safely', () => {
		const messages = hydrateTranscriptMessages([
			{ ...baseEntry('future', 'future_kind' as TranscriptEntry['kind'], 1000), value: 1 },
		] as unknown as TranscriptEntry[]);

		expect(messages[0]).toMatchObject({
			kind: 'unknown',
			id: 'future',
			json: expect.stringContaining('future_kind'),
		});
	});

	test('degrades malformed timestamps instead of crashing the transcript', () => {
		const messages = hydrateTranscriptMessages([
			{
				...baseEntry('bad-time', 'assistant_text'),
				createdAt: Number.NaN,
				text: 'Still render me',
			},
			{ _id: 'missing-time', kind: 'future_kind', value: 1 },
		] as unknown as TranscriptEntry[]);

		expect(messages).toMatchObject([
			{ kind: 'assistant_text', id: 'bad-time', timestamp: '', text: 'Still render me' },
			{ kind: 'unknown', id: 'missing-time', timestamp: '' },
		]);
	});
});
