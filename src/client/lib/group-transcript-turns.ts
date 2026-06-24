import type {
	AgentProvider,
	ContextWindowUsageSnapshot,
	HydratedTranscriptMessage,
} from '../../shared/types';

type Message = HydratedTranscriptMessage;
type UserMessage = Extract<Message, { kind: 'user_prompt' }>;
type AssistantMessage = Extract<Message, { kind: 'assistant_text' }>;
type ToolMessage = Extract<Message, { kind: 'tool' }>;
type ResultMessage = Extract<Message, { kind: 'result' }>;

export interface TurnMeta {
	model: string | null;
	provider: AgentProvider | null;
}

/**
 * One agent turn: the work (tool calls + intermediate replies) between a user
 * prompt and the agent's final answer. The work is collapsed behind a summary;
 * the final reply is surfaced as the visible answer. Diagnostic message kinds
 * (system_init, status, context_window_updated, …) are intentionally dropped.
 */
export interface TranscriptTurn {
	id: string;
	/** Folded work: tool calls + intermediate replies, in chronological order. */
	activity: Message[];
	tools: ToolMessage[];
	toolCount: number;
	messageCount: number;
	finalText: AssistantMessage | null;
	durationMs: number | null;
	errorText: string | null;
	startTimestamp: string;
	isComplete: boolean;
	model: string | null;
	provider: AgentProvider | null;
	usage: ContextWindowUsageSnapshot | null;
}

export type TranscriptItem =
	| { type: 'user'; id: string; message: UserMessage }
	| { type: 'turn'; id: string; turn: TranscriptTurn };

function fallbackItemId(kind: 'turn' | 'user', index: number) {
	return `${kind}:${index}`;
}

function nonEmptyItemId(id: string | undefined, fallback: string) {
	return id && id.length > 0 ? id : fallback;
}

function buildTurn(messages: Message[], meta: TurnMeta, fallbackId: string): TranscriptTurn | null {
	const tools = messages.filter((message): message is ToolMessage => message.kind === 'tool');
	const texts = messages.filter(
		(message): message is AssistantMessage => message.kind === 'assistant_text',
	);
	const result =
		[...messages]
			.reverse()
			.find((message): message is ResultMessage => message.kind === 'result') ?? null;

	if (tools.length === 0 && texts.length === 0 && result === null) return null;

	const usage =
		[...messages].reverse().find((message) => message.kind === 'context_window_updated')?.usage ??
		null;
	// A cancelled turn ends with an `interrupted` entry instead of a `result`;
	// treat it as terminal so the turn stops showing the running timer.
	const interrupted = messages.some((message) => message.kind === 'interrupted');

	// The final reply is the last assistant text that comes *after* the last tool
	// call. A pre-tool preamble (e.g. "I'll inspect…") stays with the work instead
	// of being surfaced as the answer.
	let finalText: AssistantMessage | null = null;
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.kind === 'tool') break;
		if (message.kind === 'assistant_text') {
			finalText = message;
			break;
		}
	}
	const activity = messages.filter(
		(message) =>
			message.kind === 'tool' || (message.kind === 'assistant_text' && message !== finalText),
	);

	const errorMessage =
		result && !result.success && !result.cancelled ? result.result?.trim() : undefined;
	const start =
		tools[0]?.timestamp ?? texts[0]?.timestamp ?? result?.timestamp ?? messages[0]?.timestamp ?? '';

	return {
		id: nonEmptyItemId(
			messages.find(
				(message) =>
					message.kind === 'tool' || message.kind === 'assistant_text' || message.kind === 'result',
			)?.id,
			fallbackId,
		),
		activity,
		tools,
		toolCount: tools.length,
		messageCount: activity.filter((message) => message.kind === 'assistant_text').length,
		finalText,
		durationMs: result ? result.durationMs : null,
		errorText: errorMessage || null,
		startTimestamp: start,
		isComplete: result !== null || interrupted,
		model: meta.model,
		provider: meta.provider,
		usage,
	};
}

/**
 * Segments a flat transcript window into render items: standalone user prompts
 * and collapsed agent turns. A turn starts after a user prompt (or at the start
 * of the window) and runs until the next user prompt.
 */
export function groupTranscriptTurns(messages: Message[]): TranscriptItem[] {
	const items: TranscriptItem[] = [];
	let pending: Message[] = [];
	let model: string | null = null;
	let provider: AgentProvider | null = null;

	const flushTurn = () => {
		const turn = buildTurn(pending, { model, provider }, fallbackItemId('turn', items.length));
		pending = [];
		if (turn) items.push({ type: 'turn', id: turn.id, turn });
	};

	for (const message of messages) {
		if (message.hidden) continue;
		if (message.kind === 'system_init') {
			model = message.model;
			provider = message.provider;
		}
		if (message.kind === 'user_prompt') {
			flushTurn();
			items.push({
				type: 'user',
				id: nonEmptyItemId(message.id, fallbackItemId('user', items.length)),
				message,
			});
			continue;
		}
		pending.push(message);
	}

	flushTurn();
	return items;
}
