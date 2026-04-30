import { describe, expect, test } from 'bun:test';
import {
	buildGenerateTitlePrompt,
	fallbackTitle,
	generateTitleDetailed,
	limitTitleText,
	sanitizeTitle,
	summarizeTitleFailures,
	transcriptEntryToTitleLine,
	transcriptToTitleText,
} from 'src/server/generate-title';
import { QuickResponseAdapter } from 'src/server/quick-response';
import type {
	AssistantTextEntry,
	StatusEntry,
	TranscriptEntry,
	UserPromptEntry,
} from 'src/shared/types';

const baseEntry = { _id: 'entry', createdAt: 123 };

function user(
	content: string,
	extra: Partial<Omit<UserPromptEntry, 'kind' | 'content'>> = {},
): TranscriptEntry {
	return { ...baseEntry, kind: 'user_prompt', content, ...extra };
}

function assistant(
	text: string,
	extra: Partial<Omit<AssistantTextEntry, 'kind' | 'text'>> = {},
): TranscriptEntry {
	return { ...baseEntry, kind: 'assistant_text', text, ...extra };
}

function status(extra: Partial<Omit<StatusEntry, 'kind' | 'status'>> = {}): TranscriptEntry {
	return { ...baseEntry, kind: 'status', status: 'running', ...extra };
}

describe('summarizeTitleFailures', () => {
	test('returns null or joined provider reasons', () => {
		expect(summarizeTitleFailures([])).toBeNull();
		expect(
			summarizeTitleFailures([
				{ provider: 'claude', reason: 'claude timed out' },
				{ provider: 'codex', reason: 'codex returned invalid json' },
			]),
		).toBe('claude timed out; codex returned invalid json');
	});
});

describe('limitTitleText', () => {
	test('leaves short text alone and trims truncated text before the marker', () => {
		expect(limitTitleText('hello', 10)).toBe('hello');
		expect(limitTitleText('abcdef   ghij', 9)).toBe('abcdef\n...[truncated]');
	});
});

describe('sanitizeTitle', () => {
	test('rejects unusable values and normalizes title-like strings', () => {
		expect(sanitizeTitle(undefined)).toBeNull();
		expect(sanitizeTitle('   \n  ')).toBeNull();
		expect(sanitizeTitle('  "fix   login   flow."\nmore details  ')).toBe('fix login flow');
		expect(sanitizeTitle('## Fix login flow ##')).toBe('Fix login flow');
		expect(sanitizeTitle('**Fix login flow**')).toBe('Fix login flow');
		expect(sanitizeTitle('a'.repeat(80))).toBe('a'.repeat(60));
		expect(sanitizeTitle(`${'a'.repeat(59)}* more details`)).toBe('a'.repeat(59));
	});
});

describe('transcriptEntryToTitleLine', () => {
	test('formats supported visible entries', () => {
		expect(transcriptEntryToTitleLine(user('Build a settings page'))).toBe(
			'User: Build a settings page',
		);
		expect(transcriptEntryToTitleLine(assistant('I will inspect the UI first.'))).toBe(
			'Assistant: I will inspect the UI first.',
		);
	});

	test('ignores hidden and unsupported entries', () => {
		expect(transcriptEntryToTitleLine(user('Hidden request', { hidden: true }))).toBeNull();
		expect(transcriptEntryToTitleLine(status())).toBeNull();
	});
});

describe('transcriptToTitleText', () => {
	test('filters transcript noise and limits output to eight lines', () => {
		const entries = [
			user('Build a settings page'),
			status(),
			assistant('I will inspect the UI first.'),
			user('Hidden follow-up', { hidden: true }),
			...Array.from({ length: 8 }, (_, index) => user(`Message ${index + 1}`)),
		];

		expect(transcriptToTitleText(entries)).toBe(
			[
				'User: Build a settings page',
				'Assistant: I will inspect the UI first.',
				...Array.from({ length: 6 }, (_, index) => `User: Message ${index + 1}`),
			].join('\n\n'),
		);
	});
});

describe('fallbackTitle', () => {
	test('uses the first usable visible user prompt or "New Chat"', () => {
		expect(fallbackTitle([user('  "Build   project   search."\nwith details')])).toBe(
			'Build project search',
		);
		expect(fallbackTitle([user('Hidden prompt', { hidden: true }), user('Visible prompt')])).toBe(
			'Visible prompt',
		);
		expect(fallbackTitle([assistant('Ready.'), user('   ')])).toBe('New Chat');
	});
});

describe('buildGenerateTitlePrompt', () => {
	test('includes rules, project context, transcript text, and empty-transcript fallback', () => {
		const prompt = buildGenerateTitlePrompt({
			projectTitle: 'Miko',
			messages: [user('Build a settings page'), assistant('I will inspect the UI first.')],
		});

		expect(prompt).toContain('- title must be 2-6 words and under 60 characters');
		expect(prompt).toContain('Project: Miko');
		expect(prompt).toContain('User: Build a settings page');
		expect(prompt).toContain('Assistant: I will inspect the UI first.');
		expect(buildGenerateTitlePrompt({ messages: [] })).toContain(
			'Project: current project\n\nTranscript:\nNo transcript yet.',
		);
	});
});

describe('generateTitleDetailed', () => {
	test('returns sanitized adapter output', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => ({ title: '  "Fix   login   flow."\nextra details' }),
			runCodexStructured: async () => null,
		});

		await expect(
			generateTitleDetailed({ projectTitle: 'Miko', messages: [user('Login is broken')] }, adapter),
		).resolves.toEqual({
			title: 'Fix login flow',
			usedFallback: false,
			failureMessage: null,
		});
	});

	test('falls back to the first user prompt and summarizes provider failures', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => null,
			runCodexStructured: async () => null,
		});

		const result = await generateTitleDetailed(
			{ messages: [user('Build a project search page')] },
			adapter,
		);

		expect(result.title).toBe('Build a project search page');
		expect(result.usedFallback).toBe(true);
		expect(result.failureMessage).toContain('claude');
		expect(result.failureMessage).toContain('codex');
	});
});
