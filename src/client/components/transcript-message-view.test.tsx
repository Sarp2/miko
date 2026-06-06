import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HydratedTranscriptMessage } from '../../shared/types';
import { TranscriptMessageView } from './transcript-message-view';

function base(id: string) {
	return {
		id,
		messageId: undefined,
		timestamp: '1970-01-01T00:00:01.000Z',
		hidden: undefined,
	};
}

function renderMessage(message: HydratedTranscriptMessage) {
	return renderToStaticMarkup(<TranscriptMessageView message={message} />);
}

describe('TranscriptMessageView', () => {
	test('renders user prompt messages with attachments', () => {
		const html = renderMessage({
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
		});

		expect(html).toContain('Please inspect this file');
		expect(html).toContain('notes.md');
	});

	test('renders assistant markdown messages', () => {
		const html = renderMessage({
			...base('assistant-1'),
			kind: 'assistant_text',
			text: '**Done**',
		});

		expect(html).toContain('<strong');
		expect(html).toContain('Done');
	});

	test('renders pending and completed tool messages', () => {
		const pendingHtml = renderMessage({
			...base('tool-pending'),
			kind: 'tool',
			toolKind: 'bash',
			toolName: 'bash',
			toolId: 'call-1',
			input: { command: 'bun test' },
			hasResult: false,
		});
		const completedHtml = renderMessage({
			...base('tool-completed'),
			kind: 'tool',
			toolKind: 'bash',
			toolName: 'bash',
			toolId: 'call-2',
			input: { command: 'bun run lint' },
			hasResult: true,
			result: 'pass',
			rawResult: 'pass',
			isError: false,
		});

		expect(pendingHtml).toContain('bun test');
		expect(completedHtml).toContain('Run terminal command');
		expect(completedHtml).toContain('pass');
	});

	test('preserves orphan tool results as explicit fallback rows', () => {
		const html = renderMessage({
			...base('tool-result-1'),
			kind: 'tool_result',
			toolId: 'call-1',
			rawResult: { ok: true },
			isError: false,
		});

		expect(html).toContain('Tool Result');
	});

	test('renders session/system metadata rows', () => {
		const systemHtml = renderMessage({
			...base('system-1'),
			kind: 'system_init',
			provider: 'codex',
			model: 'gpt-5.4',
			tools: ['bash'],
			agents: [],
			slashCommands: [],
			mcpServers: [{ name: 'github', status: 'ready' }],
		});
		const accountHtml = renderMessage({
			...base('account-1'),
			kind: 'account_info',
			accountInfo: { email: 'sarp@example.com' },
		});

		expect(systemHtml).toContain('Started session');
		expect(accountHtml).toContain('Account');
	});

	test('renders result/status/context rows', () => {
		const resultHtml = renderMessage({
			...base('result-1'),
			kind: 'result',
			success: false,
			cancelled: false,
			result: 'failed',
			durationMs: 10,
		});
		const statusHtml = renderMessage({ ...base('status-1'), kind: 'status', status: 'compacting' });
		const contextHtml = renderMessage({
			...base('context-1'),
			kind: 'context_window_updated',
			usage: { usedTokens: 10, maxTokens: 100, compactsAutomatically: true },
		});

		expect(resultHtml).toContain('failed');
		expect(statusHtml).toContain('Compacting');
		expect(contextHtml).toContain('Context window');
	});

	test('renders compact and interruption lifecycle rows', () => {
		const boundaryHtml = renderMessage({ ...base('boundary-1'), kind: 'compact_boundary' });
		const summaryHtml = renderMessage({
			...base('summary-1'),
			kind: 'compact_summary',
			summary: 'Previous work was summarized.',
		});
		const clearedHtml = renderMessage({ ...base('cleared-1'), kind: 'context_cleared' });
		const interruptedHtml = renderMessage({ ...base('interrupted-1'), kind: 'interrupted' });

		expect(boundaryHtml).toContain('Compacted');
		expect(summaryHtml).toContain('Summarized');
		expect(clearedHtml).toContain('Context Cleared');
		expect(interruptedHtml).toContain('Interrupted');
	});

	test('renders unknown rows and skips hidden messages', () => {
		const unknownHtml = renderMessage({
			...base('unknown-1'),
			kind: 'unknown',
			json: '{"kind":"future"}',
		});
		const hiddenHtml = renderMessage({
			...base('hidden-1'),
			kind: 'assistant_text',
			text: 'secret',
			hidden: true,
		});

		expect(unknownHtml).toContain('Unknown');
		expect(hiddenHtml).toBe('');
	});
});
