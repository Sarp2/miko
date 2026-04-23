import type { AgentProvider, ProjectSummary, TranscriptEntry } from 'src/shared/types';

export interface ProjectRecord extends ProjectSummary {
	deletedAt?: number;
}

export interface ChatRecord {
	id: string;
	projectId: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	deletedAt?: number;
	unread: boolean;
	provider: AgentProvider | null;
	planMode: boolean;
	sessionToken: string | null;
	lastMessageAt?: number;
	lastTurnOutcome: 'success' | 'failed' | 'cancelled' | null;
}

export interface StoreState {
	projectsById: Map<string, ProjectRecord>;
	projectIdsByPath: Map<string, string>;
	chatsById: Map<string, ChatRecord>;
}

export interface SnapshotFile {
	generatedAt: number;
	projects: ProjectRecord[];
	chats: ChatRecord[];
	messages?: Array<{ chatId: string; entries: TranscriptEntry[] }>;
}

export type ProjectEvent =
	| {
			type: 'project_opened';
			timestamp: number;
			projectId: string;
			localPath: string;
			title: string;
	  }
	| {
			type: 'project_removed';
			timestamp: number;
			projectId: string;
	  };

export type ChatEvent =
	| {
			type: 'chat_created';
			timestamp: number;
			chatId: string;
			projectId: string;
			title: string;
	  }
	| {
			type: 'chat_renamed';
			timestamp: number;
			chatId: string;
			title: string;
	  }
	| {
			type: 'chat_deleted';
			timestamp: number;
			chatId: string;
	  }
	| {
			type: 'chat_provider_set';
			timestamp: number;
			chatId: string;
			provider: AgentProvider;
	  }
	| {
			type: 'chat_plan_mode_set';
			timestamp: number;
			chatId: string;
			planMode: boolean;
	  }
	| {
			type: 'chat_read_state_set';
			timestamp: number;
			chatId: string;
			unread: boolean;
	  };

export type TurnEvent =
	| {
			type: 'turn_started';
			timestamp: number;
			chatId: string;
	  }
	| {
			type: 'turn_finished';
			timestamp: number;
			chatId: string;
	  }
	| {
			type: 'turn_failed';
			timestamp: number;
			chatId: string;
			error: string;
	  }
	| {
			type: 'turn_cancelled';
			timestamp: number;
			chatId: string;
	  }
	| {
			type: 'session_token_set';
			timestamp: number;
			chatId: string;
			sessionToken: string | null;
	  };

export type StoreEvent = ProjectEvent | ChatEvent | TurnEvent;

export function createEmptyState(): StoreState {
	return {
		projectsById: new Map(),
		projectIdsByPath: new Map(),
		chatsById: new Map(),
	};
}

export function cloneTranscriptEntries(entries: TranscriptEntry[]): TranscriptEntry[] {
	return entries.map((entry) => ({ ...entry }));
}
