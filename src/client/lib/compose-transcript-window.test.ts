import { describe, expect, test } from 'bun:test';
import type { HydratedTranscriptMessage } from '../../shared/types';
import { composeTranscriptWindow } from './compose-transcript-window';

function base(id: string) {
	return {
		id,
		timestamp: '1970-01-01T00:00:01.000Z',
		hidden: undefined,
		messageId: undefined,
	};
}

describe('composeTranscriptWindow', () => {
	test('folds a loaded tool result into its matching tool call', () => {
		const messages: HydratedTranscriptMessage[] = [
			{
				...base('tool-1'),
				kind: 'tool',
				toolKind: 'bash',
				toolName: 'Bash',
				toolId: 'call-1',
				input: { command: 'bun test' },
				hasResult: false,
			},
			{
				...base('result-1'),
				kind: 'tool_result',
				toolId: 'call-1',
				rawResult: 'pass',
				isError: false,
			},
		];

		expect(composeTranscriptWindow(messages)).toEqual([
			{
				...base('tool-1'),
				kind: 'tool',
				toolKind: 'bash',
				toolName: 'Bash',
				toolId: 'call-1',
				input: { command: 'bun test' },
				result: 'pass',
				hasResult: true,
				rawResult: 'pass',
				isError: false,
			},
		]);
	});

	test('keeps orphaned tool results visible at transcript page boundaries', () => {
		const messages: HydratedTranscriptMessage[] = [
			{
				...base('result-1'),
				kind: 'tool_result',
				toolId: 'call-1',
				rawResult: 'pass',
				isError: false,
			},
			{
				...base('assistant-1'),
				kind: 'assistant_text',
				text: 'Done',
			},
		];

		expect(composeTranscriptWindow(messages)).toEqual(messages);
	});

	test('normalizes specialized results when folding them into tool calls', () => {
		const messages: HydratedTranscriptMessage[] = [
			{
				...base('question-tool'),
				kind: 'tool',
				toolKind: 'ask_user_question',
				toolName: 'AskUserQuestion',
				toolId: 'question-1',
				input: { questions: [{ id: 'choice', question: 'Pick one' }] },
				hasResult: false,
			},
			{
				...base('question-result'),
				kind: 'tool_result',
				toolId: 'question-1',
				rawResult: JSON.stringify({ answers: { choice: 'yes' } }),
				isError: false,
			},
		];

		expect(composeTranscriptWindow(messages)[0]).toMatchObject({
			kind: 'tool',
			toolKind: 'ask_user_question',
			hasResult: true,
			rawResult: JSON.stringify({ answers: { choice: 'yes' } }),
			result: { answers: { choice: ['yes'] } },
		});
	});

	test('keeps context window metadata before each assistant turn closer', () => {
		const messages: HydratedTranscriptMessage[] = [
			{
				...base('assistant-1'),
				kind: 'assistant_text',
				text: 'First answer',
			},
			{
				...base('context-1'),
				kind: 'context_window_updated',
				usage: { usedTokens: 10, maxTokens: 100, compactsAutomatically: false },
			},
			{
				...base('user-1'),
				kind: 'user_prompt',
				content: 'Next question',
			},
			{
				...base('assistant-2'),
				kind: 'assistant_text',
				text: 'Second answer',
			},
			{
				...base('context-2'),
				kind: 'context_window_updated',
				usage: { usedTokens: 20, maxTokens: 100, compactsAutomatically: false },
			},
		];

		expect(composeTranscriptWindow(messages).map((message) => message.id)).toEqual([
			'context-1',
			'assistant-1',
			'user-1',
			'context-2',
			'assistant-2',
		]);
	});

	test('keeps trailing context window metadata before the final assistant message', () => {
		const messages: HydratedTranscriptMessage[] = [
			{
				...base('assistant-1'),
				kind: 'assistant_text',
				text: 'Final answer',
			},
			{
				...base('context-1'),
				kind: 'context_window_updated',
				usage: { usedTokens: 10, maxTokens: 100, compactsAutomatically: false },
			},
		];

		expect(composeTranscriptWindow(messages).map((message) => message.kind)).toEqual([
			'context_window_updated',
			'assistant_text',
		]);
	});
});
