import type {
	AgentProvider,
	ChatAttachment,
	DirectorySummary,
	ModelOptions,
	PromptPart,
	SessionSummary,
	TranscriptEntry,
	WorkspacePullRequestSummary,
	WorkspaceReviewState,
	WorkspaceSummary,
	WorkspaceVisibilityState,
} from 'src/shared/types';

export interface DirectoryRecord extends DirectorySummary {
	removedAt?: number;
}

export interface WorkspaceRecord extends WorkspaceSummary {
	removedAt?: number;
}

export interface SessionRecord extends SessionSummary {
	removedAt?: number;
}

export interface QueuedSessionSendPayload {
	provider?: AgentProvider;
	content: string;
	attachments?: ChatAttachment[];
	parts?: PromptPart[];
	model?: string;
	modelOptions: ModelOptions;
	effort?: string;
	planMode?: boolean;
}

export type QueuedSessionMessageStatus = 'queued' | 'draining';

export interface QueuedSessionMessageRecord {
	id: string;
	sessionId: string;
	payload: QueuedSessionSendPayload;
	status: QueuedSessionMessageStatus;
	sequence: number;
	promptEntryId: string;
	createdAt: number;
	updatedAt: number;
}

export interface StoreState {
	directoriesById: Map<string, DirectoryRecord>;
	workspacesById: Map<string, WorkspaceRecord>;
	sessionsById: Map<string, SessionRecord>;
	queuedMessagesById: Map<string, QueuedSessionMessageRecord>;
}

export interface SnapshotFile {
	generatedAt: number;
	directories: DirectoryRecord[];
	workspaces: WorkspaceRecord[];
	sessions: SessionRecord[];
	queuedMessages?: QueuedSessionMessageRecord[];
}

export type DirectoryEvent =
	| {
			type: 'directory_added';
			timestamp: number;
			directoryId: string;
			localPath: string;
			title: string;
			githubOwner: string;
			githubRepo: string;
			defaultBranchName: 'main';
	  }
	| {
			type: 'directory_removed';
			timestamp: number;
			directoryId: string;
	  };

export type WorkspaceEvent =
	| {
			type: 'workspace_created';
			timestamp: number;
			workspaceId: string;
			directoryId: string;
			localPath: string;
			branchName: string;
	  }
	| {
			type: 'workspace_removed';
			timestamp: number;
			workspaceId: string;
	  }
	| {
			type: 'workspace_setup_completed';
			timestamp: number;
			workspaceId: string;
	  }
	| {
			type: 'workspace_setup_failed';
			timestamp: number;
			workspaceId: string;
			error: string;
	  }
	| {
			type: 'workspace_branch_name_changed';
			timestamp: number;
			workspaceId: string;
			branchName: string;
	  }
	| {
			type: 'workspace_review_state_changed';
			timestamp: number;
			workspaceId: string;
			reviewState: WorkspaceReviewState;
	  }
	| {
			type: 'workspace_visibility_changed';
			timestamp: number;
			workspaceId: string;
			visibilityState: WorkspaceVisibilityState;
	  }
	| {
			type: 'workspace_pr_observed';
			timestamp: number;
			workspaceId: string;
			pullRequest: WorkspacePullRequestSummary;
	  }
	| {
			type: 'workspace_pr_cleared';
			timestamp: number;
			workspaceId: string;
	  }
	| {
			type: 'workspace_unread_agent_result_set';
			timestamp: number;
			workspaceId: string;
			hasUnreadAgentResult: boolean;
	  };

export type SessionEvent =
	| {
			type: 'session_created';
			timestamp: number;
			sessionId: string;
			workspaceId: string;
			title: string;
	  }
	| {
			type: 'session_renamed';
			timestamp: number;
			sessionId: string;
			title: string;
	  }
	| {
			type: 'session_removed';
			timestamp: number;
			sessionId: string;
	  }
	| {
			type: 'session_provider_set';
			timestamp: number;
			sessionId: string;
			provider: AgentProvider;
	  }
	| {
			type: 'session_plan_mode_set';
			timestamp: number;
			sessionId: string;
			planMode: boolean;
	  };

export type TurnEvent =
	| {
			type: 'turn_started';
			timestamp: number;
			sessionId: string;
	  }
	| {
			type: 'turn_finished';
			timestamp: number;
			sessionId: string;
	  }
	| {
			type: 'turn_failed';
			timestamp: number;
			sessionId: string;
			error: string;
	  }
	| {
			type: 'turn_cancelled';
			timestamp: number;
			sessionId: string;
	  }
	| {
			type: 'session_token_set';
			timestamp: number;
			sessionId: string;
			sessionToken: string | null;
	  };

export type QueueEvent =
	| {
			type: 'session_message_queued';
			timestamp: number;
			message: QueuedSessionMessageRecord;
	  }
	| {
			type: 'session_message_claimed';
			timestamp: number;
			sessionId: string;
			messageId: string;
			promptEntryId: string;
	  }
	| {
			type: 'session_message_requeued';
			timestamp: number;
			sessionId: string;
			messageId: string;
	  }
	| {
			type: 'session_message_completed' | 'session_message_failed' | 'session_message_dequeued';
			timestamp: number;
			sessionId: string;
			messageId: string;
	  }
	| {
			type: 'session_queue_cleared';
			timestamp: number;
			sessionId: string;
	  };

export type StoreEvent = DirectoryEvent | WorkspaceEvent | SessionEvent | TurnEvent | QueueEvent;

export function createEmptyState(): StoreState {
	return {
		directoriesById: new Map(),
		workspacesById: new Map(),
		sessionsById: new Map(),
		queuedMessagesById: new Map(),
	};
}

export function cloneTranscriptEntries(entries: TranscriptEntry[]): TranscriptEntry[] {
	return structuredClone(entries);
}
