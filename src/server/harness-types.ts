import type {
	AccountInfo,
	AgentProvider,
	NormalizedToolCall,
	TranscriptEntry,
} from '../shared/types';

/** Stamp a transcript entry with an id and timestamp. Shared by all provider harnesses. */
export function timestamped<T extends Omit<TranscriptEntry, '_id' | 'createdAt'>>(
	entry: T,
	createdAt = Date.now(),
	id: string = crypto.randomUUID(),
): TranscriptEntry {
	return {
		_id: id,
		createdAt,
		...entry,
	} as TranscriptEntry;
}

export type HarnessEvent =
	| { type: 'transcript'; entry: TranscriptEntry }
	| { type: 'session_token'; sessionToken: string };

export interface HarnessToolRequest {
	tool: NormalizedToolCall & { toolKind: 'ask_user_question' | 'exit_plan_mode' };
}

export interface HarnessTurn {
	provider: AgentProvider;
	stream: AsyncIterable<HarnessEvent>;
	getAccountInfo?: () => Promise<AccountInfo | null>;
	interrupt: () => Promise<void>;
	close: () => void;
}
