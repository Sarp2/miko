import { hydrateToolResult } from '../../shared/tools';
import type { HydratedToolCall, HydratedTranscriptMessage } from '../../shared/types';

type HydratedToolMessage = Extract<HydratedTranscriptMessage, { kind: 'tool' }>;
type HydratedToolResultMessage = Extract<HydratedTranscriptMessage, { kind: 'tool_result' }>;

function attachToolResult(
	tool: HydratedToolMessage,
	result: HydratedToolResultMessage,
): HydratedToolCall {
	return {
		...tool,
		result: hydrateToolResult(tool, result.rawResult),
		hasResult: true,
		rawResult: result.rawResult,
		isError: result.isError === true,
	} as HydratedToolCall;
}

function shouldMoveBeforeFinalAssistant(message: HydratedTranscriptMessage) {
	return message.kind === 'context_window_updated';
}

function keepAssistantTextAsTurnCloser(
	messages: HydratedTranscriptMessage[],
): HydratedTranscriptMessage[] {
	const composed: HydratedTranscriptMessage[] = [];
	let pendingAssistant: HydratedTranscriptMessage | null = null;
	let metadataBeforePendingAssistant: HydratedTranscriptMessage[] = [];

	const flushPendingAssistant = () => {
		if (!pendingAssistant) return;
		composed.push(...metadataBeforePendingAssistant, pendingAssistant);
		pendingAssistant = null;
		metadataBeforePendingAssistant = [];
	};

	for (const message of messages) {
		if (pendingAssistant && shouldMoveBeforeFinalAssistant(message)) {
			metadataBeforePendingAssistant.push(message);
			continue;
		}

		flushPendingAssistant();

		if (message.kind === 'assistant_text') {
			pendingAssistant = message;
			continue;
		}

		composed.push(message);
	}

	flushPendingAssistant();
	return composed;
}

export function composeTranscriptWindow(
	messages: HydratedTranscriptMessage[],
): HydratedTranscriptMessage[] {
	const toolIds = new Set<string>();
	const resultsByToolId = new Map<string, HydratedToolResultMessage>();

	for (const message of messages) {
		if (message.kind === 'tool') {
			toolIds.add(message.toolId);
			continue;
		}
		if (message.kind === 'tool_result') {
			resultsByToolId.set(message.toolId, message);
		}
	}

	const composed: HydratedTranscriptMessage[] = [];
	for (const message of messages) {
		if (message.kind === 'tool') {
			const result = resultsByToolId.get(message.toolId);
			composed.push(result ? attachToolResult(message, result) : message);
			continue;
		}

		if (message.kind === 'tool_result' && toolIds.has(message.toolId)) {
			continue;
		}

		composed.push(message);
	}

	return keepAssistantTextAsTurnCloser(composed);
}
