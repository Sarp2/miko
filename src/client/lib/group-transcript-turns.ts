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

function buildTurn(messages: Message[], meta: TurnMeta): TranscriptTurn | null {
	const tools = messages.filter((message): message is ToolMessage => message.kind === 'tool');
	const texts = messages.filter(
		(message): message is AssistantMessage => message.kind === 'assistant_text',
	);

	if (tools.length === 0 && texts.length === 0) return null;

	const result =
		[...messages]
			.reverse()
			.find((message): message is ResultMessage => message.kind === 'result') ?? null;
	const usage =
		[...messages].reverse().find((message) => message.kind === 'context_window_updated')?.usage ??
		null;
	// A cancelled turn ends with an `interrupted` entry instead of a `result`;
	// treat it as terminal so the turn stops showing the running timer.
	const interrupted = messages.some((message) => message.kind === 'interrupted');

	const finalText = texts.at(-1) ?? null;
	const activity = messages.filter(
		(message) =>
			message.kind === 'tool' || (message.kind === 'assistant_text' && message !== finalText),
	);

	const errorMessage =
		result && !result.success && !result.cancelled ? result.result?.trim() : undefined;
	const start = tools[0]?.timestamp ?? texts[0]?.timestamp ?? messages[0]?.timestamp ?? '';

	return {
		id:
			messages.find((message) => message.kind === 'tool' || message.kind === 'assistant_text')
				?.id ?? start,
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
		const turn = buildTurn(pending, { model, provider });
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
			items.push({ type: 'user', id: message.id, message });
			continue;
		}
		pending.push(message);
	}

	flushTurn();
	return items;
}
