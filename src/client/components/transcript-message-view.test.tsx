import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HydratedTranscriptMessage } from '../../shared/types';
import { groupTranscriptTurns } from '../lib/group-transcript-turns';
import { TranscriptItemView } from './transcript-message-view';

function base(id: string) {
	return { id, messageId: undefined, timestamp: '1970-01-01T00:00:01.000Z', hidden: undefined };
}

function renderMessages(messages: HydratedTranscriptMessage[]) {
	return groupTranscriptTurns(messages)
		.map((item) => renderToStaticMarkup(<TranscriptItemView item={item} workspaceRoot="" />))
		.join('');
}

describe('TranscriptItemView', () => {
	test('renders user prompts with attachments', () => {
		const html = renderMessages([
			{
				...base('user-1'),
				kind: 'user_prompt',
				content: 'Please inspect this file',
				attachments: [
					{
						id: 'attachment-1',
						kind: 'file',
						displayName: 'notes.md',
						absolutePath: '/tmp/notes.md',
						relativePath: 'notes.md',
						contentUrl: '/uploads/notes.md',
						mimeType: 'text/markdown',
						size: 12,
					},
				],
			},
		]);

		expect(html).toContain('Please inspect this file');
		expect(html).toContain('notes.md');
		expect(html).toContain('data-transcript-item-id="user-1"');
	});

	test('groups tool calls under a turn and surfaces the final reply', () => {
		const html = renderMessages([
			{
				...base('tool-1'),
				kind: 'tool',
				toolKind: 'bash',
				toolName: 'bash',
				toolId: 'call-1',
				input: { command: 'bun test' },
				hasResult: true,
				result: 'pass',
				rawResult: 'pass',
				isError: false,
			},
			{ ...base('assistant-1'), kind: 'assistant_text', text: '**Done**' },
			{ ...base('result-1'), kind: 'result', success: true, result: '', durationMs: 1200 },
		]);

		expect(html).toContain('1 tool call');
		expect(html).toContain('data-transcript-item-id="tool-1"');
		expect(html).not.toContain('1 message');
		expect(html).toContain('<strong');
		expect(html).toContain('Done');
	});

	test('drops diagnostic kinds and skips hidden messages', () => {
		const html = renderMessages([
			{
				...base('status-1'),
				kind: 'status',
				status: 'compacting',
			},
			{ ...base('hidden-1'), kind: 'assistant_text', text: 'secret', hidden: true },
		]);

		expect(html).toBe('');
	});
});
