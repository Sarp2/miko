import type { TranscriptEntry } from 'src/shared/types';
import { QuickResponseAdapter, type StructuredQuickResponseFailure } from './quick-response';

const TITLE_MAX_LENGTH = 60;
const TITLE_SCHEMA = {
	type: 'object',
	properties: {
		title: { type: 'string' },
	},
	required: ['title'],
	additionalProperties: false,
} as const;

export interface GenerateTitleResult {
	title: string;
	usedFallback: boolean;
	failureMessage: string | null;
}

export function summarizeTitleFailures(failures: StructuredQuickResponseFailure[]) {
	if (failures.length === 0) return null;
	return failures.map((failure) => failure.reason).join('; ');
}

export function limitTitleText(value: string, maxLength: number) {
	return value.length <= maxLength
		? value
		: `${value.slice(0, maxLength).trimEnd()}\n...[truncated]`;
}

export function sanitizeTitle(value: unknown): string | null {
	if (typeof value !== 'string') return null;

	const normalized = (value.trim().split(/\r?\n/u)[0] ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[-*#"'`]+/u, '')
		.trim()
		.slice(0, TITLE_MAX_LENGTH)
		.replace(/[-*#"'`.]+$/u, '')
		.trim();

	return normalized.length > 0 ? normalized : null;
}

export function transcriptEntryToTitleLine(entry: TranscriptEntry): string | null {
	if (entry.hidden) return null;

	if (entry.kind === 'user_prompt') {
		return `User: ${entry.content}`;
	}

	if (entry.kind === 'assistant_text') {
		return `Assistant: ${entry.text}`;
	}

	return null;
}

export function transcriptToTitleText(entries: TranscriptEntry[]) {
	return entries
		.map(transcriptEntryToTitleLine)
		.filter((line): line is string => line !== null && line.trim().length > 0)
		.slice(0, 8)
		.join('\n\n');
}

export function fallbackTitle(entries: TranscriptEntry[]) {
	for (const entry of entries) {
		if (entry.kind !== 'user_prompt' || entry.hidden) continue;

		const title = sanitizeTitle(entry.content);
		if (title) return title;
	}

	return 'New Chat';
}

export function buildGenerateTitlePrompt(args: {
	projectTitle?: string;
	messages: TranscriptEntry[];
}) {
	const transcript = transcriptToTitleText(args.messages);

	return [
		'Generate a concise title for this chat.',
		'Return JSON with key: title.',
		'Rules:',
		'- title must be 2-6 words and under 60 characters',
		'- title must describe the user goal or task',
		'- title must not include quotes, markdown, or a trailing period',
		'- do not use generic titles like "New Chat", "Question", or "Help"',
		'',
		`Project: ${args.projectTitle?.trim() || 'current project'}`,
		'',
		'Transcript:',
		limitTitleText(transcript || 'No transcript yet.', 12_000),
	].join('\n');
}

export async function generateTitleDetailed(
	args: {
		projectTitle?: string;
		messages: TranscriptEntry[];
	},
	adapter = new QuickResponseAdapter(),
): Promise<GenerateTitleResult> {
	const result = await adapter.generateStructuredWithDiagnostics<{ title: string }>({
		task: 'chat title generation',
		prompt: buildGenerateTitlePrompt(args),
		schema: TITLE_SCHEMA,
		parse: (value) => {
			const output = value && typeof value === 'object' ? (value as { title?: unknown }) : {};
			const title = sanitizeTitle(output.title);
			if (!title) return null;
			return { title };
		},
	});

	if (result.value) {
		return {
			title: result.value.title,
			usedFallback: false,
			failureMessage: null,
		};
	}

	return {
		title: fallbackTitle(args.messages),
		usedFallback: true,
		failureMessage: summarizeTitleFailures(result.failures),
	};
}

export async function generateTitle(
	args: {
		projectTitle?: string;
		messages: TranscriptEntry[];
	},
	adapter = new QuickResponseAdapter(),
) {
	const result = await generateTitleDetailed(args, adapter);
	return result.title;
}
