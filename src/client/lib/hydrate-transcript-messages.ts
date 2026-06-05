import type {
	HydratedToolCall,
	HydratedTranscriptMessage,
	ToolCallEntry,
	ToolResultEntry,
	TranscriptEntry,
} from '../../shared/types';

function timestampFromCreatedAt(createdAt: unknown) {
	if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return '';

	const date = new Date(createdAt);
	if (!Number.isFinite(date.getTime())) return '';

	return date.toISOString();
}

function entryBase(entry: TranscriptEntry) {
	return {
		id: entry._id,
		messageId: entry.messageId,
		timestamp: timestampFromCreatedAt(entry.createdAt),
		hidden: entry.hidden,
	};
}

function serializeUnknown(entry: TranscriptEntry) {
	try {
		return JSON.stringify(entry, null, 2);
	} catch {
		return String(entry);
	}
}

function hydrateToolCall(entry: ToolCallEntry, result?: ToolResultEntry): HydratedToolCall {
	const hydrated = {
		...entryBase(entry),
		kind: 'tool' as const,
		toolKind: entry.tool.toolKind,
		toolName: entry.tool.toolName,
		toolId: entry.tool.toolId,
		input: entry.tool.input,
	};

	if (!result) return hydrated as HydratedToolCall;

	return {
		...hydrated,
		rawResult: result.content,
		result: result.content,
		isError: (result as { isError?: boolean }).isError === true,
	} as HydratedToolCall;
}

function findToolResults(entries: TranscriptEntry[]) {
	const resultsByToolId = new Map<string, ToolResultEntry>();

	for (const entry of entries) {
		if (entry.kind !== 'tool_result') continue;
		resultsByToolId.set(entry.toolId, entry);
	}

	return resultsByToolId;
}

export function hydrateTranscriptMessages(entries: TranscriptEntry[]): HydratedTranscriptMessage[] {
	const toolResultsByToolId = findToolResults(entries);
	const messages: HydratedTranscriptMessage[] = [];

	for (const entry of entries) {
		if (entry.kind === 'tool_result') continue;
		const base = entryBase(entry);

		switch (entry.kind) {
			case 'user_prompt':
				messages.push({
					...base,
					kind: 'user_prompt',
					content: entry.content,
					attachments: entry.attachments,
				});
				break;
			case 'system_init':
				messages.push({
					...base,
					kind: 'system_init',
					model: entry.model,
					tools: entry.tools,
					agents: entry.agents,
					slashCommands: entry.slashCommands,
					mcpServers: entry.mcpServers,
					provider: entry.provider,
					debugRaw: entry.debugRaw,
				});
				break;
			case 'account_info':
				messages.push({
					...base,
					kind: 'account_info',
					accountInfo: entry.accountInfo,
				});
				break;
			case 'assistant_text':
				messages.push({
					...base,
					kind: 'assistant_text',
					text: entry.text,
				});
				break;
			case 'tool_call':
				messages.push(hydrateToolCall(entry, toolResultsByToolId.get(entry.tool.toolId)));
				break;
			case 'result':
				messages.push({
					...base,
					kind: 'result',
					success: entry.subtype === 'success' && !entry.isError,
					cancelled: entry.subtype === 'cancelled',
					result: entry.result,
					durationMs: entry.durationMs,
					costUsd: entry.costUsd,
				});
				break;
			case 'status':
				messages.push({
					...base,
					kind: 'status',
					status: entry.status,
				});
				break;
			case 'context_window_updated':
				messages.push({
					...base,
					kind: 'context_window_updated',
					usage: entry.usage,
				});
				break;
			case 'compact_boundary':
				messages.push({
					...base,
					kind: 'compact_boundary',
				});
				break;
			case 'compact_summary':
				messages.push({
					...base,
					kind: 'compact_summary',
					summary: entry.summary,
				});
				break;
			case 'context_cleared':
				messages.push({
					...base,
					kind: 'context_cleared',
				});
				break;
			case 'interrupted':
				messages.push({
					...base,
					kind: 'interrupted',
				});
				break;
			default:
				messages.push({
					...base,
					kind: 'unknown',
					json: serializeUnknown(entry),
				});
		}
	}

	return messages;
}
