import type {
	HydratedToolCall,
	HydratedTranscriptMessage,
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

// The backend owns transcript normalization. This is only a read-side render guard so a
// malformed persisted tool row cannot crash the entire chat surface.
function isHydratableToolCallEntry(entry: TranscriptEntry) {
	if (entry.kind !== 'tool_call') return false;
	const tool = (entry as { tool?: unknown }).tool;
	if (!tool || typeof tool !== 'object') return false;
	const candidate = tool as { toolId?: unknown; toolKind?: unknown; toolName?: unknown };
	return (
		typeof candidate.toolId === 'string' &&
		candidate.toolId.length > 0 &&
		typeof candidate.toolKind === 'string' &&
		typeof candidate.toolName === 'string' &&
		'input' in tool
	);
}

export function hydrateTranscriptEntry(entry: TranscriptEntry): HydratedTranscriptMessage {
	const base = entryBase(entry);

	switch (entry.kind) {
		case 'user_prompt':
			return {
				...base,
				kind: 'user_prompt',
				content: entry.content,
				attachments: entry.attachments,
			};
		case 'system_init':
			return {
				...base,
				kind: 'system_init',
				model: entry.model,
				tools: entry.tools,
				agents: entry.agents,
				slashCommands: entry.slashCommands,
				mcpServers: entry.mcpServers,
				provider: entry.provider,
				debugRaw: entry.debugRaw,
			};
		case 'account_info':
			return {
				...base,
				kind: 'account_info',
				accountInfo: entry.accountInfo,
			};
		case 'assistant_text':
			return {
				...base,
				kind: 'assistant_text',
				text: entry.text,
			};
		case 'tool_call':
			if (!isHydratableToolCallEntry(entry)) {
				return {
					...base,
					kind: 'unknown',
					json: serializeUnknown(entry),
				};
			}
			return {
				...base,
				kind: 'tool',
				toolKind: entry.tool.toolKind,
				toolName: entry.tool.toolName,
				toolId: entry.tool.toolId,
				input: entry.tool.input,
			} as HydratedToolCall;
		case 'tool_result':
			return {
				...base,
				kind: 'tool_result',
				toolId: entry.toolId,
				rawResult: entry.content,
				isError: (entry as { isError?: boolean }).isError === true,
			};
		case 'result':
			return {
				...base,
				kind: 'result',
				success: entry.subtype === 'success' && !entry.isError,
				cancelled: entry.subtype === 'cancelled',
				result: entry.result,
				durationMs: entry.durationMs,
				costUsd: entry.costUsd,
			};
		case 'status':
			return {
				...base,
				kind: 'status',
				status: entry.status,
			};
		case 'context_window_updated':
			return {
				...base,
				kind: 'context_window_updated',
				usage: entry.usage,
			};
		case 'compact_boundary':
			return {
				...base,
				kind: 'compact_boundary',
			};
		case 'compact_summary':
			return {
				...base,
				kind: 'compact_summary',
				summary: entry.summary,
			};
		case 'context_cleared':
			return {
				...base,
				kind: 'context_cleared',
			};
		case 'interrupted':
			return {
				...base,
				kind: 'interrupted',
			};
		default:
			return {
				...base,
				kind: 'unknown',
				json: serializeUnknown(entry),
			};
	}
}

export function hydrateTranscriptMessages(entries: TranscriptEntry[]): HydratedTranscriptMessage[] {
	return entries.map(hydrateTranscriptEntry);
}
