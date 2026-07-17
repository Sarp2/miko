import type {
	AccountInfo,
	AgentProvider,
	NormalizedToolCall,
	TranscriptEntry,
} from '../shared/types';

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
