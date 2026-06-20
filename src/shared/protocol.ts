import type {
	AgentProvider,
	BranchActionFailure,
	BranchActionSuccess,
	ChatAttachment,
	DirectoryListSnapshot,
	GitHubRepoAvailabilityResult,
	GithubPublishInfo,
	KeybindingsSnapshot,
	ModelOptions,
	PromptPart,
	ScratchpadSnapshot,
	SessionHistoryPage,
	SessionSnapshot,
	SidebarSnapshot,
	UpdateSnapshot,
	WorkspaceFileSearchResult,
	WorkspaceSnapshot,
	WorkspaceVisibilityState,
} from './types';

export type EditorPreset = 'cursor' | 'vscode' | 'warp' | 'antigravity' | 'custom';

export type EditorOpenSettings =
	| { preset: Exclude<EditorPreset, 'custom'>; commandTemplate?: string }
	| { preset: 'custom'; commandTemplate: string };

export type SubscriptionTopic =
	| { type: 'sidebar' }
	| { type: 'directories' }
	| { type: 'update' }
	| { type: 'keybindings' }
	| { type: 'workspace'; workspaceId: string }
	| { type: 'session'; sessionId: string; recentLimit?: number }
	| { type: 'scratchpad'; workspaceId: string }
	| { type: 'terminal'; terminalId: string };

export interface TerminalSnapshot {
	terminalId: string;
	title: string;
	cwd: string;
	shell: string;
	cols: number;
	rows: number;
	scrollback: number;
	serializedState: string;
	status: 'running' | 'exited';
	exitCode: number | null;
	signal?: number;
}

export type TerminalEvent =
	| { type: 'terminal.output'; terminalId: string; data: string }
	| { type: 'terminal.exit'; terminalId: string; exitCode: number; signal?: number };

export type DirectoryOnboardingResult = BranchActionSuccess | BranchActionFailure;

export type ClientCommand =
	| {
			type: 'directory.add';
			localPath: string;
			title?: string;
	  }
	| { type: 'directory.remove'; directoryId: string }
	| { type: 'directory.initializeGit'; localPath: string }
	| { type: 'directory.getGithubPublishInfo'; localPath: string }
	| { type: 'directory.checkGithubRepoAvailability'; owner: string; name: string }
	| {
			type: 'directory.publishToGithub';
			localPath: string;
			owner: string;
			name: string;
			visibility: 'public' | 'private';
			description?: string;
	  }
	| { type: 'workspace.create'; directoryId: string }
	| { type: 'workspace.remove'; workspaceId: string }
	| {
			type: 'workspace.setVisibility';
			workspaceId: string;
			visibilityState: WorkspaceVisibilityState;
	  }
	| { type: 'workspace.renameBranch'; workspaceId: string; branchName: string }
	| { type: 'workspace.markRead'; workspaceId: string }
	| { type: 'workspace.refreshGit'; workspaceId: string; fetchRemote?: boolean }
	| { type: 'workspace.refreshPrStage'; workspaceId: string }
	| { type: 'workspace.readDiffPatch'; workspaceId: string; path: string }
	| { type: 'workspace.discardFile'; workspaceId: string; path: string }
	| { type: 'workspace.readFile'; workspaceId: string; path: string }
	| { type: 'file.readExternal'; workspaceId: string; sessionId: string; path: string }
	| { type: 'workspace.searchFiles'; workspaceId: string; query: string; limit?: number }
	| { type: 'workspace.listFiles'; workspaceId: string; limit?: number }
	| { type: 'workspace.commitAndPush'; workspaceId: string; sessionId: string }
	| { type: 'workspace.pullLatestMain'; workspaceId: string; sessionId: string }
	| { type: 'workspace.createPr'; workspaceId: string; sessionId: string }
	| { type: 'workspace.fixCi'; workspaceId: string; sessionId: string }
	| { type: 'workspace.resolveMergeConflicts'; workspaceId: string; sessionId: string }
	| { type: 'workspace.markPrReady'; workspaceId: string }
	| {
			type: 'workspace.addressReviewComments';
			workspaceId: string;
			sessionId: string;
			commentIds: string[];
	  }
	| { type: 'workspace.mergePr'; workspaceId: string }
	| { type: 'workspace.reviewChanges'; workspaceId: string }
	| { type: 'workspace.updateScratchpad'; workspaceId: string; content: string }
	| { type: 'system.ping' }
	| { type: 'update.check'; force?: boolean }
	| { type: 'update.install' }
	| { type: 'settings.readKeybindings' }
	| { type: 'settings.writeKeybindings'; bindings: KeybindingsSnapshot['bindings'] }
	| {
			type: 'system.openExternal';
			localPath: string;
			action: 'open_finder' | 'open_terminal' | 'open_editor';
			line?: number;
			column?: number;
			editor?: EditorOpenSettings;
	  }
	| { type: 'session.create'; workspaceId: string }
	| { type: 'session.rename'; sessionId: string; title: string }
	| { type: 'session.remove'; sessionId: string }
	| {
			type: 'session.send';
			sessionId?: string;
			workspaceId?: string;
			provider?: AgentProvider;
			content: string;
			attachments?: ChatAttachment[];
			parts?: PromptPart[];
			model?: string;
			modelOptions: ModelOptions;
			effort?: string;
			planMode?: boolean;
	  }
	| { type: 'session.cancel'; sessionId: string }
	| { type: 'session.stopDraining'; sessionId: string }
	| { type: 'session.loadHistory'; sessionId: string; beforeCursor: string; limit: number }
	| { type: 'session.respondTool'; sessionId: string; toolUseId: string; result: unknown }
	| { type: 'session.listCommands'; sessionId: string; provider: AgentProvider }
	| {
			type: 'terminal.create';
			workspaceId: string;
			terminalId: string;
			cols: number;
			rows: number;
			scrollback: number;
	  }
	| { type: 'terminal.input'; terminalId: string; data: string }
	| { type: 'terminal.resize'; terminalId: string; cols: number; rows: number }
	| { type: 'terminal.close'; terminalId: string };

export type ClientEnvelope =
	| { type: 'subscribe'; id: string; topic: SubscriptionTopic }
	| { type: 'unsubscribe'; id: string }
	| { type: 'command'; id: string; command: ClientCommand };

export type ServerSnapshot =
	| { type: 'sidebar'; data: SidebarSnapshot }
	| { type: 'directories'; data: DirectoryListSnapshot }
	| { type: 'update'; data: UpdateSnapshot }
	| { type: 'keybindings'; data: KeybindingsSnapshot }
	| { type: 'workspace'; data: WorkspaceSnapshot | null }
	| { type: 'session'; data: SessionSnapshot | null }
	| { type: 'scratchpad'; data: ScratchpadSnapshot }
	| { type: 'terminal'; data: TerminalSnapshot | null };

export type ServerEnvelope =
	| { type: 'snapshot'; id: string; snapshot: ServerSnapshot }
	| { type: 'event'; id: string; event: TerminalEvent }
	| {
			type: 'ack';
			id: string;
			result?:
				| unknown
				| SessionHistoryPage
				| DirectoryOnboardingResult
				| GithubPublishInfo
				| GitHubRepoAvailabilityResult
				| WorkspaceFileSearchResult[];
	  }
	| { type: 'error'; id?: string; message: string };

export function isClientEnvelope(value: unknown): value is ClientEnvelope {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<ClientEnvelope>;
	if (typeof candidate.id !== 'string') return false;

	if (candidate.type === 'subscribe') {
		return Boolean(candidate.topic && typeof candidate.topic === 'object');
	}

	if (candidate.type === 'unsubscribe') {
		return true;
	}

	if (candidate.type === 'command') {
		return Boolean(candidate.command && typeof candidate.command === 'object');
	}

	return false;
}
