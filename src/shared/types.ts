export type AgentProvider = 'claude' | 'codex';

export type AttachmentKind = 'image' | 'file';

export interface ChatAttachment {
	id: string;
	kind: AttachmentKind;
	displayName: string;
	absolutePath: string;
	relativePath: string;
	contentUrl: string;
	mimeType: string;
	size: number;
}

export type PromptPart =
	| { type: 'text'; text: string }
	| { type: 'mention'; path: string; label?: string }
	| { type: 'attachment'; attachmentId: string }
	| { type: 'pasted_text'; id: string; text: string };

export interface InternalUserAttachmentsData {
	userText: string;
	attachments: ChatAttachment[];
	llmHintText: string;
}

export interface ProviderModelOption {
	id: string;
	label: string;
	supportsEffort: boolean;
	contextWindowOptions?: readonly ProviderContextWindowOption[];
	badge?: 'NEW';
}

export interface ProviderEffortOption {
	id: string;
	label: string;
}

export interface ProviderContextWindowOption {
	id: ClaudeContextWindow;
	label: string;
}

export const CLAUDE_REASONING_OPTIONS = [
	{ id: 'low', label: 'Low' },
	{ id: 'medium', label: 'Medium' },
	{ id: 'high', label: 'High' },
	{ id: 'max', label: 'Max' },
] as const satisfies readonly ProviderEffortOption[];

export const CODEX_REASONING_OPTIONS = [
	{ id: 'minimal', label: 'Minimal' },
	{ id: 'low', label: 'Low' },
	{ id: 'medium', label: 'Medium' },
	{ id: 'high', label: 'High' },
	{ id: 'xhigh', label: 'XHigh' },
] as const satisfies readonly ProviderEffortOption[];

export type ClaudeReasoningEffort = (typeof CLAUDE_REASONING_OPTIONS)[number]['id'];
export type CodexReasoningEffort = (typeof CODEX_REASONING_OPTIONS)[number]['id'];
export type ClaudeContextWindow = '200k' | '1m';
export type ServiceTier = 'fast';

export interface ClaudeModelOptions {
	reasoningEffort: ClaudeReasoningEffort;
	contextWindow: ClaudeContextWindow;
}

export interface CodexModelOptions {
	reasoningEffort: CodexReasoningEffort;
	fastMode: boolean;
}

export interface ProviderModelOptionsByProvider {
	claude: ClaudeModelOptions;
	codex: CodexModelOptions;
}

export type ModelOptions = Partial<{
	[K in AgentProvider]: Partial<ProviderModelOptionsByProvider[K]>;
}>;

export const DEFAULT_CLAUDE_MODEL_OPTIONS = {
	reasoningEffort: 'high',
	contextWindow: '200k',
} as const satisfies ClaudeModelOptions;

export const DEFAULT_CODEX_MODEL_OPTIONS = {
	reasoningEffort: 'high',
	fastMode: false,
} as const satisfies CodexModelOptions;

export function isClaudeReasoningEffort(value: unknown): value is ClaudeReasoningEffort {
	return CLAUDE_REASONING_OPTIONS.some((option) => option.id === value);
}

export function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
	return CODEX_REASONING_OPTIONS.some((option) => option.id === value);
}

export const CLAUDE_CONTEXT_WINDOW_OPTIONS = [
	{ id: '200k', label: '200k' },
	{ id: '1m', label: '1M' },
] as const satisfies readonly ProviderContextWindowOption[];

export function isClaudeContextWindow(value: unknown): value is ClaudeContextWindow {
	return CLAUDE_CONTEXT_WINDOW_OPTIONS.some((option) => option.id === value);
}

export interface ProviderCatalogEntry {
	id: AgentProvider;
	label: string;
	defaultModel: string;
	defaultEffort?: string;
	supportsPlanMode: boolean;
	models: ProviderModelOption[];
	efforts: ProviderEffortOption[];
}

export const PROVIDERS: ProviderCatalogEntry[] = [
	{
		id: 'claude',
		label: 'Claude',
		defaultModel: 'claude-sonnet-4-6',
		defaultEffort: 'high',
		supportsPlanMode: true,
		// `id` values are runtime model ids accepted by the installed Claude Code harness.
		// 1M context is a session beta (`context-1m-2025-08-07`); models that support it expose
		// `contextWindowOptions` so the composer can offer a 1M variant row.
		models: [
			{ id: 'claude-fable-5', label: 'Fable 5', supportsEffort: true, badge: 'NEW' },
			{
				id: 'claude-opus-4-8',
				label: 'Opus 4.8',
				supportsEffort: true,
				badge: 'NEW',
				contextWindowOptions: [...CLAUDE_CONTEXT_WINDOW_OPTIONS],
			},
			{
				id: 'claude-opus-4-6',
				label: 'Opus 4.6',
				supportsEffort: true,
				contextWindowOptions: [...CLAUDE_CONTEXT_WINDOW_OPTIONS],
			},
			{
				id: 'claude-sonnet-4-6',
				label: 'Sonnet 4.6',
				supportsEffort: true,
				contextWindowOptions: [...CLAUDE_CONTEXT_WINDOW_OPTIONS],
			},
			{ id: 'claude-haiku-4-5', label: 'Haiku 4.5', supportsEffort: true },
		],
		efforts: [...CLAUDE_REASONING_OPTIONS],
	},
	{
		id: 'codex',
		label: 'Codex',
		defaultModel: 'gpt-5.5',
		supportsPlanMode: true,
		models: [
			{ id: 'gpt-5.5', label: 'GPT-5.5', supportsEffort: false },
			{ id: 'gpt-5.4', label: 'GPT-5.4', supportsEffort: false },
		],
		efforts: [],
	},
];

export function getProviderCatalog(provider: AgentProvider): ProviderCatalogEntry {
	const entry = PROVIDERS.find((candidate) => candidate.id === provider);
	if (!entry) {
		throw new Error(`Unknown provider: ${provider}`);
	}
	return entry;
}

export function getClaudeModelOption(modelId: string): ProviderModelOption | undefined {
	return getProviderCatalog('claude').models.find((candidate) => candidate.id === modelId);
}

export function getClaudeContextWindowOptions(
	modelId: string,
): readonly ProviderContextWindowOption[] {
	return getClaudeModelOption(modelId)?.contextWindowOptions ?? [];
}

export function normalizeClaudeContextWindow(
	modelId: string,
	contextWindow?: unknown,
): ClaudeContextWindow {
	const options = getClaudeContextWindowOptions(modelId);
	if (options.length === 0) return DEFAULT_CLAUDE_MODEL_OPTIONS.contextWindow;

	return options.some((option) => option.id === contextWindow)
		? (contextWindow as ClaudeContextWindow)
		: DEFAULT_CLAUDE_MODEL_OPTIONS.contextWindow;
}

export function resolveClaudeContextWindowTokens(contextWindow: ClaudeContextWindow): number {
	switch (contextWindow) {
		case '1m':
			return 1_000_000;
		case '200k':
			return 200_000;
		default:
			return 200_000;
	}
}

export type MikoStatus = 'idle' | 'starting' | 'running' | 'waiting_for_user' | 'failed';

export interface DirectorySummary {
	id: string;
	localPath: string;
	title: string;
	githubOwner: string;
	githubRepo: string;
	defaultBranchName: 'main';
	createdAt: number;
	updatedAt: number;
}

export type WorkspaceReviewState = 'in_progress' | 'in_review' | 'done' | 'closed';
export type WorkspaceVisibilityState = 'active' | 'archived';
export type WorkspaceSetupState = 'creating' | 'ready' | 'failed';
export type WorkspacePullRequestStatus = 'open' | 'merged' | 'closed';
export type WorkspaceHealthState =
	| 'healthy'
	| 'source_missing'
	| 'workspace_missing'
	| 'git_invalid'
	| 'worktree_mismatch'
	| 'branch_missing'
	| 'detached_head'
	| 'repo_mismatch';

export interface WorkspacePullRequestSummary {
	number: number;
	status: WorkspacePullRequestStatus;
	title?: string;
	url?: string;
	headRefName?: string;
	baseRefName?: string;
	ciStatus?: 'unknown' | 'pending' | 'passing' | 'failing';
	isDraft?: boolean;
	mergeStateStatus?: string;
	hasMergeConflicts?: boolean;
	createdAt?: number;
	lastObservedAt: number;
	/**
	 * Snapshot of the PR's changed files at the time it was observed. Persisted so the
	 * right-sidebar Changes list survives a merge/close, when live PR refresh is skipped
	 * and the local branch...main diff has collapsed to empty.
	 */
	files?: WorkspaceDiffFile[];
}

export interface WorkspaceSummary {
	id: string;
	directoryId: string;
	localPath: string;
	branchName: string;
	setupState: WorkspaceSetupState;
	setupError?: string;
	reviewState: WorkspaceReviewState;
	visibilityState: WorkspaceVisibilityState;
	hasUnreadAgentResult: boolean;
	pullRequest?: WorkspacePullRequestSummary;
	createdAt: number;
	updatedAt: number;
}

export interface SessionSummary {
	id: string;
	workspaceId: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	provider: AgentProvider | null;
	planMode: boolean;
	sessionToken: string | null;
	lastMessageAt?: number;
	lastAssistantPreview?: string;
	lastTurnOutcome: 'success' | 'failed' | 'cancelled' | null;
}

export type WorkspaceSidebarIndicator =
	| 'none'
	| 'workspace_creating'
	| 'workspace_failed'
	| 'agent_active'
	| 'commit_and_push'
	| 'create_pr'
	| 'pr_opened'
	| 'draft_pr'
	| 'ci_failed'
	| 'merge_conflicts'
	| 'merged'
	| 'closed';

export interface SidebarWorkspaceRow {
	_id: string;
	_creationTime: number;
	workspaceId: string;
	createdAt: number;
	updatedAt: number;
	displayName: string;
	reviewState: WorkspaceReviewState;
	visibilityState: WorkspaceVisibilityState;
	indicator: WorkspaceSidebarIndicator;
	hasUnreadAgentResult: boolean;
	hasActiveSession: boolean;
	localPath: string;
	branchName: string;
	githubOwner: string;
	githubRepo: string;
	defaultBranchName: 'main';
	hasPullRequest: boolean;
	prNumber?: number;
	prTitle?: string;
	prUrl?: string;
	prCreatedAt?: number;
	hasDirtyFiles: boolean;
	hasUnpushedCommits: boolean;
	displayDiffStats: { additions: number; deletions: number };
	lastActivityAt?: number;
	lastSessionId?: string;
	lastSessionTitle?: string;
	lastAssistantPreview?: string;
}

export interface SidebarDirectoryGroup {
	groupKey: string;
	directoryId: string;
	localPath: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	avatarUrl?: string;
	workspaces: SidebarWorkspaceRow[];
}

export interface SidebarSnapshot {
	directoryGroups: SidebarDirectoryGroup[];
}

export interface DirectoryListSnapshot {
	machine: {
		id: 'local';
		displayName: string;
	};
	directories: DirectorySummary[];
	workspaces: WorkspaceSummary[];
}

export type UpdateStatus =
	| 'idle'
	| 'checking'
	| 'available'
	| 'up_to_date'
	| 'updating'
	| 'restart_pending'
	| 'error';

export interface UpdateSnapshot {
	currentVersion: string;
	latestVersion: string | null;
	status: UpdateStatus;
	updateAvailable: boolean;
	lastCheckedAt: number | null;
	error: string | null;
	installAction: 'restart' | 'reload';
}

export type UpdateInstallErrorCode = 'version_not_live_yet' | 'install_failed' | 'command_missing';

export interface UpdateInstallResult {
	ok: boolean;
	action: 'restart' | 'realod';
	errorCode: UpdateInstallErrorCode | null;
	userTitle: string | null;
	userMessage: string | null;
}

export type KeybindingAction =
	| 'toggleLeftSidebar'
	| 'toggleEmbeddedTerminal'
	| 'toggleRightSidebar'
	| 'addSplitTerminal'
	| 'createSessionInCurrentWorkspace'
	| 'createWorkspaceInCurrentDirectory'
	| 'switchToNextWorkspace';

export const DEFAULT_KEYBINDINGS: Record<KeybindingAction, string[]> = {
	toggleLeftSidebar: ['cmd+shift+b', 'ctrl+shift+b'],
	toggleEmbeddedTerminal: ['cmd+j', 'ctrl+`'],
	toggleRightSidebar: ['cmd+b', 'ctrl+b'],
	addSplitTerminal: ['cmd+/', 'ctrl+/'],
	createSessionInCurrentWorkspace: ['cmd+alt+n'],
	createWorkspaceInCurrentDirectory: ['cmd+alt+shift+n'],
	switchToNextWorkspace: ['cmd+alt+down', 'ctrl+alt+down'],
};

export interface KeybindingsSnapshot {
	bindings: Record<KeybindingAction, string[]>;
	warning: string | null;
	filePathDisplay: string;
}

export interface McpServerInfo {
	name: string;
	status: string;
	error?: string;
}

export interface AccountInfo {
	email?: string;
	organization?: string;
	subscriptionType?: string;
	tokenSource?: string;
	apiKeySource?: string;
}

export interface AskUserQuestionOption {
	label: string;
	description?: string;
}

export interface AskUserQuestionItem {
	id?: string;
	question: string;
	header?: string;
	options?: AskUserQuestionOption[];
	multiSelect?: boolean;
}

export type AskUserQuestionAnswerMap = Record<string, string[]>;

export interface TodoItem {
	content: string;
	status: 'pending' | 'in_progress' | 'completed';
	activeForm: string;
}

interface TranscriptEntryBase {
	_id: string;
	messageId?: string;
	createdAt: number;
	hidden?: boolean;
	debugRaw?: string;
}

interface ToolCallBase<Tkind extends string, TInput> {
	kind: 'tool';
	toolKind: Tkind;
	toolName: string;
	toolId: string;
	input: TInput;
	rawInput?: Record<string, unknown>;
}

export interface AskUserQuestionToolCall
	extends ToolCallBase<'ask_user_question', { questions: AskUserQuestionItem[] }> {}

export interface ExitPlanModeToolCall
	extends ToolCallBase<'exit_plan_mode', { plan?: string; summary?: string }> {}

export interface TodoWriteToolCall extends ToolCallBase<'todo_write', { todos: TodoItem[] }> {}

export interface SkillToolCall extends ToolCallBase<'skill', { skill: string }> {}

export interface GlobToolCall extends ToolCallBase<'glob', { pattern: string }> {}

export interface GrepToolCall
	extends ToolCallBase<'grep', { pattern: string; outputMode?: string }> {}

export interface BashToolCall
	extends ToolCallBase<
		'bash',
		{ command: string; description?: string; timeoutMs?: number; runInBackground?: boolean }
	> {}

export interface WebSearchToolCall extends ToolCallBase<'web_search', { query: string }> {}

export interface ReadFileToolCall extends ToolCallBase<'read_file', { filePath: string }> {}

export interface WriteFileToolCall
	extends ToolCallBase<'write_file', { filePath: string; content: string }> {}

export interface EditFileToolCall
	extends ToolCallBase<'edit_file', { filePath: string; oldString: string; newString: string }> {}

export interface DeleteFileToolCall
	extends ToolCallBase<'delete_file', { filePath: string; oldString?: string }> {}

export interface SubAgentTaskToolCall
	extends ToolCallBase<'subagent_task', { subagentType?: string }> {}

export interface McpGenericToolCall
	extends ToolCallBase<
		'mcp_generic',
		{ server: string; tool: string; payload: Record<string, unknown> }
	> {}

export interface UnknownToolCall
	extends ToolCallBase<'unknown_tool', { payload: Record<string, unknown> }> {}

export type NormalizedToolCall =
	| AskUserQuestionToolCall
	| ExitPlanModeToolCall
	| TodoWriteToolCall
	| SkillToolCall
	| GlobToolCall
	| GrepToolCall
	| BashToolCall
	| WebSearchToolCall
	| ReadFileToolCall
	| WriteFileToolCall
	| EditFileToolCall
	| DeleteFileToolCall
	| SubAgentTaskToolCall
	| McpGenericToolCall
	| UnknownToolCall;

export interface ToolResultEntry extends TranscriptEntryBase {
	kind: 'tool_result';
	toolId: string;
	content: unknown;
	isError?: false;
}

export interface UserPromptEntry extends TranscriptEntryBase {
	kind: 'user_prompt';
	content: string;
	attachments?: ChatAttachment[];
	parts?: PromptPart[];
}

export interface SystemInitEntry extends TranscriptEntryBase {
	kind: 'system_init';
	provider: AgentProvider;
	model: string;
	tools: string[];
	agents: string[];
	slashCommands: string[];
	mcpServers: McpServerInfo[];
}

export interface AccountInfoEntry extends TranscriptEntryBase {
	kind: 'account_info';
	accountInfo: AccountInfo;
}

export interface AssistantTextEntry extends TranscriptEntryBase {
	kind: 'assistant_text';
	text: string;
}

export interface ToolCallEntry extends TranscriptEntryBase {
	kind: 'tool_call';
	tool: NormalizedToolCall;
}

export interface ResultEntry extends TranscriptEntryBase {
	kind: 'result';
	subtype: 'success' | 'error' | 'cancelled';
	isError: boolean;
	durationMs: number;
	result: string;
	costUsd?: number;
}

export interface StatusEntry extends TranscriptEntryBase {
	kind: 'status';
	status: string;
}

export interface ContextWindowUsageSnapshot {
	usedTokens: number;
	totalProcessedTokens?: number;
	maxTokens?: number;
	inputTokens?: number;
	cachedInputTokens?: number;
	outputTokens?: number;
	reasoningOutputTokens?: number;
	lastUsedTokens?: number;
	lastInputTokens?: number;
	lastCachedInputTokens?: number;
	lastOutputTokens?: number;
	lastReasoningOutputTokens?: number;
	toolUses?: number;
	durationMs?: number;
	compactsAutomatically: boolean;
}

export interface WorkspaceDiffFile {
	path: string;
	changeType: 'added' | 'deleted' | 'modified' | 'renamed';
	isUntracked: boolean;
	additions: number;
	deletions: number;
	patchDigest: string;
	patch?: string;
	mimeType?: string;
	size?: number;
}

export interface WorkspaceDiffPatchResult {
	path: string;
	patch: string;
	patchDigest: string;
}

export interface WorkspaceTextFilePreviewResult {
	kind: 'text';
	path: string;
	name: string;
	contents: string;
	mimeType: string;
	size: number;
	encoding: 'utf-8';
	cacheKey: string;
}

export interface WorkspaceImageFilePreviewResult {
	kind: 'image';
	path: string;
	name: string;
	contentUrl: string;
	mimeType: string;
	size: number;
	cacheKey: string;
}

export interface WorkspaceBinaryFilePreviewResult {
	kind: 'binary';
	path: string;
	name: string;
	mimeType: string;
	size: number;
	cacheKey: string;
}

export type WorkspaceFileContentsResult =
	| WorkspaceTextFilePreviewResult
	| WorkspaceImageFilePreviewResult
	| WorkspaceBinaryFilePreviewResult;

export interface WorkspaceFileSearchResult {
	id: string;
	name: string;
	relativePath: string;
}

export interface WorkspaceBranchHistoryEntry {
	sha: string;
	summary: string;
	description: string;
	authorName?: string;
	authoredAt: string;
	tags: string[];
	githubUrl?: string;
}

export interface WorkspaceBranchHistorySnapshot {
	entries: WorkspaceBranchHistoryEntry[];
}

export type WorkspaceBranchListEntryKind = 'local' | 'remote' | 'pull_request';

export interface WorkspaceBranchListEntry {
	id: string;
	kind: WorkspaceBranchListEntryKind;
	name: string;
	displayName: string;
	updatedAt?: string;
	description?: string;
	prNumber?: number;
	prTitle: string;
	headRefName?: string;
	headLabel?: string;
	headRepoCloneUrl?: string;
	isCrossRepository?: boolean;
}

export interface WorkspaceBranchListResult {
	currentBranchName?: string;
	defaultBranchName?: string;
	recent: WorkspaceBranchListEntry[];
	local: WorkspaceBranchListEntry[];
	remote: WorkspaceBranchListEntry[];
	pullRequests: WorkspaceBranchListEntry[];
	pullRequestsStatus: 'available' | 'unavailable' | 'error';
	pullRequestsError?: string;
}

export interface GithubPublishInfo {
	ghInstalled: boolean;
	authenticated: boolean;
	activeAccountLogin?: string;
	owners: string[];
	suggestedRepoName: string;
}

export interface GitHubRepoAvailabilityResult {
	available: boolean;
	message: string;
}

export interface BranchMetadata {
	branchName?: string;
	defaultBranchName?: string;
	hasOriginRemote?: boolean;
	originRepoSlug?: string;
	hasUpstream?: boolean;
}

export interface UpstreamStatus {
	aheadCount?: number;
	behindCount?: number;
	lastFetchedAt?: string;
}

export interface WorkspaceGitSnapshot extends BranchMetadata, UpstreamStatus {
	status: 'unknown' | 'ready' | 'no_repo';
	files: WorkspaceDiffFile[];
	pullRequestFiles?: WorkspaceDiffFile[];
	hasPushedCommits?: boolean;
	branchPublishState?: 'unknown' | 'local_only' | 'published';
	mainAheadCount?: number;
	branchHistory?: WorkspaceBranchHistorySnapshot;
}

export interface WorkspaceGitHubSnapshot {
	status: 'unknown' | 'none' | 'open' | 'merged' | 'closed';
	owner: string;
	repo: string;
	prNumber?: number;
	title?: string;
	body?: string;
	url?: string;
	headRefName?: string;
	baseRefName?: string;
	ciStatus?: 'unknown' | 'pending' | 'passing' | 'failing';
	isDraft?: boolean;
	mergeStateStatus?: string;
	hasMergeConflicts?: boolean;
	unresolvedCommentCount?: number;
	additions?: number;
	deletions?: number;
	files?: WorkspaceDiffFile[];
	comments: PullRequestCommentSnapshot[];
	checks: PullRequestCheckSnapshot[];
	createdAt?: number;
	lastRefreshedAt?: number;
}

export interface PullRequestCommentSnapshot {
	id: string;
	author?: string;
	authorAssociation?: string;
	body: string;
	url?: string;
	path?: string;
	line?: number;
	isResolved?: boolean;
	isBot: boolean;
	source: 'issue' | 'review' | 'thread';
	createdAt?: string;
	updatedAt?: string;
}

export interface PullRequestCheckSnapshot {
	name: string;
	workflowName?: string;
	status: 'unknown' | 'pending' | 'passing' | 'failing';
	conclusion?: string;
	detailsUrl?: string;
	startedAt?: string;
	completedAt?: string;
	summary?: string;
	canFetchLogs: boolean;
}

export interface ScratchpadSnapshot {
	workspaceId: string;
	content: string;
	updatedAt: number | null;
}

export interface WorkspaceSnapshot {
	workspace: WorkspaceSummary;
	primaryLabel: string;
	healthState: WorkspaceHealthState;
	git: WorkspaceGitSnapshot | null;
	github: WorkspaceGitHubSnapshot | null;
	sessions: SessionSummary[];
	hasActiveSession: boolean;
	hasUnreadAgentResult: boolean;
}

export interface BranchActionSuccess {
	ok: true;
	branchName?: string;
	snapshotChanged: boolean;
}

export interface BranchActionFailure {
	ok: false;
	title: string;
	message: string;
	detail?: string;
	cancelled?: boolean;
	snapshotChanged?: boolean;
}

export type WorkspaceSyncSuccess = BranchActionSuccess & {
	action: 'fetch' | 'pull' | 'push' | 'publish';
	aheadCount?: number;
	behindCount?: number;
};

export type WorkspaceSyncFailure = BranchActionFailure & {
	action: 'fetch' | 'pull' | 'push' | 'publish';
};

export type WorkspaceSyncResult = WorkspaceSyncSuccess | WorkspaceSyncFailure;

export type DiffCommitMode = 'commit_and_push' | 'commit_only';

export type WorkspaceCheckoutBranchSuccess = BranchActionSuccess;
export type WorkspaceCheckoutBranchFailure = BranchActionFailure;
export type WorkspaceCheckoutBranchResult =
	| WorkspaceCheckoutBranchSuccess
	| WorkspaceCheckoutBranchFailure;
export type WorkspaceCreateBranchSuccess = BranchActionSuccess & { branchName: string };
export type WorkspaceCreateBranchFailure = BranchActionFailure;
export type WorkspaceCreateBranchResult =
	| WorkspaceCreateBranchSuccess
	| WorkspaceCreateBranchFailure;
export type WorkspaceMergePreviewStatus = 'up_to_date' | 'mergeable' | 'conflicts' | 'error';

export interface WorkspaceMergePreviewResult {
	currentBranchName?: string;
	targetBranchName: string;
	targetDisplayName: string;
	status: WorkspaceMergePreviewStatus;
	commitCount: number;
	hasConflicts: boolean;
	message: string;
	detail?: string;
}
export type WorkspaceMergeBranchSuccess = BranchActionSuccess;
export type WorkspaceMergeBranchFailure = BranchActionFailure;
export type WorkspaceMergeBranchResult = WorkspaceMergeBranchSuccess | WorkspaceMergeBranchFailure;
export type DiffCommitSuccess = BranchActionSuccess & { mode: DiffCommitMode; pushed: boolean };

export type DiffCommitFailure = BranchActionFailure & {
	mode: DiffCommitMode;
	phase: 'commit' | 'push';
	localCommitCreated?: boolean;
};

export type DiffCommitResult = DiffCommitSuccess | DiffCommitFailure;

export interface ContextWindowUpdatedEntry extends TranscriptEntryBase {
	kind: 'context_window_updated';
	usage: ContextWindowUsageSnapshot;
}

export interface CompactBoundaryEntry extends TranscriptEntryBase {
	kind: 'compact_boundary';
}

export interface CompactSummaryEntry extends TranscriptEntryBase {
	kind: 'compact_summary';
	summary: string;
}

export interface ContextClearedEntry extends TranscriptEntryBase {
	kind: 'context_cleared';
}

export interface InterruptedEntry extends TranscriptEntryBase {
	kind: 'interrupted';
}

export type TranscriptEntry =
	| UserPromptEntry
	| SystemInitEntry
	| AccountInfoEntry
	| AssistantTextEntry
	| ToolCallEntry
	| ToolResultEntry
	| ResultEntry
	| StatusEntry
	| ContextWindowUpdatedEntry
	| CompactBoundaryEntry
	| CompactSummaryEntry
	| ContextClearedEntry
	| InterruptedEntry;

export interface HydratedToolCallBase<TKind extends string, TInput, TResult> {
	id: string;
	messageId?: string;
	hidden?: boolean;
	kind: 'tool';
	toolKind: TKind;
	toolName: string;
	toolId: string;
	input: TInput;
	result?: TResult;
	hasResult: boolean;
	rawResult?: unknown;
	isError?: boolean;
	timestamp: string;
}

export interface AskUserQuestionToolResult {
	answers: AskUserQuestionAnswerMap;
	discarded?: boolean;
}

export interface ExitPlanModeToolResult {
	confirmed?: boolean;
	clearContext?: boolean;
	message?: string;
	discarded?: boolean;
}

export type HydratedAskUserQuestionToolCall = HydratedToolCallBase<
	'ask_user_question',
	AskUserQuestionToolCall['input'],
	AskUserQuestionToolResult
>;

export type HydratedExitPlanModeToolCall = HydratedToolCallBase<
	'exit_plan_mode',
	ExitPlanModeToolCall['input'],
	ExitPlanModeToolResult
>;

export type HydratedTodoWriteToolCall = HydratedToolCallBase<
	'todo_write',
	TodoWriteToolCall['input'],
	unknown
>;

export type HydratedSkillToolCall = HydratedToolCallBase<'skill', SkillToolCall['input'], unknown>;

export type HydratedGlobToolCall = HydratedToolCallBase<'glob', GlobToolCall['input'], unknown>;

export type HydratedGrepToolCall = HydratedToolCallBase<'grep', GrepToolCall['input'], unknown>;

export type HydratedBashToolCall = HydratedToolCallBase<'bash', BashToolCall['input'], unknown>;

export type HydratedWebSearchToolCall = HydratedToolCallBase<
	'web_search',
	WebSearchToolCall['input'],
	unknown
>;

export interface ReadFileTextBlock {
	type: 'text';
	text: string;
}

export interface ReadFileImageBlock {
	type: 'image';
	data: string;
	mimeType?: string;
}

export interface ReadFileToolResult {
	content: string;
	blocks?: Array<ReadFileTextBlock | ReadFileImageBlock>;
}

export type HydratedReadFileToolCall = HydratedToolCallBase<
	'read_file',
	ReadFileToolCall['input'],
	ReadFileToolResult | string
>;

export type HydratedWriteFileToolCall = HydratedToolCallBase<
	'write_file',
	WriteFileToolCall['input'],
	unknown
>;

export type HydratedEditFileToolCall = HydratedToolCallBase<
	'edit_file',
	EditFileToolCall['input'],
	unknown
>;

export type HydratedDeleteFileToolCall = HydratedToolCallBase<
	'delete_file',
	DeleteFileToolCall['input'],
	unknown
>;

export type HydratedSubagentTaskToolCall = HydratedToolCallBase<
	'subagent_task',
	SubAgentTaskToolCall['input'],
	unknown
>;

export type HydratedMcpGenericToolCall = HydratedToolCallBase<
	'mcp_generic',
	McpGenericToolCall['input'],
	unknown
>;

export type HydratedUnknownToolCall = HydratedToolCallBase<
	'unknown_tool',
	UnknownToolCall['input'],
	unknown
>;

export type HydratedToolCall =
	| HydratedAskUserQuestionToolCall
	| HydratedExitPlanModeToolCall
	| HydratedTodoWriteToolCall
	| HydratedSkillToolCall
	| HydratedGlobToolCall
	| HydratedGrepToolCall
	| HydratedBashToolCall
	| HydratedWebSearchToolCall
	| HydratedReadFileToolCall
	| HydratedWriteFileToolCall
	| HydratedEditFileToolCall
	| HydratedDeleteFileToolCall
	| HydratedSubagentTaskToolCall
	| HydratedMcpGenericToolCall
	| HydratedUnknownToolCall;

export type HydratedTranscriptMessage =
	| {
			kind: 'user_prompt';
			content: string;
			attachments?: ChatAttachment[];
			parts?: PromptPart[];
			id: string;
			messageId?: string;
			timestamp: string;
			hidden?: boolean;
	  }
	| {
			kind: 'system_init';
			model: string;
			tools: string[];
			agents: string[];
			slashCommands: string[];
			mcpServers: McpServerInfo[];
			provider: AgentProvider;
			id: string;
			messageId?: string;
			timestamp: string;
			hidden?: boolean;
			debugRaw?: string;
	  }
	| {
			kind: 'account_info';
			accountInfo: AccountInfo;
			id: string;
			messageId?: string;
			timestamp: string;
			hidden?: boolean;
	  }
	| {
			kind: 'assistant_text';
			text: string;
			id: string;
			messageId?: string;
			timestamp: string;
			hidden?: boolean;
	  }
	| {
			kind: 'result';
			success: boolean;
			cancelled?: boolean;
			result: string;
			durationMs: number;
			costUsd?: number;
			id: string;
			messageId?: string;
			timestamp: string;
			hidden?: boolean;
	  }
	| {
			kind: 'status';
			status: string;
			id: string;
			messageId?: string;
			timestamp: string;
			hidden?: boolean;
	  }
	| {
			kind: 'context_window_updated';
			usage: ContextWindowUsageSnapshot;
			id: string;
			messageId?: string;
			timestamp: string;
			hidden?: boolean;
	  }
	| {
			kind: 'compact_boundary';
			id: string;
			messageId?: string;
			timestamp: string;
			hidden?: boolean;
	  }
	| {
			kind: 'compact_summary';
			summary: string;
			id: string;
			messageId?: string;
			timestamp: string;
			hidden?: boolean;
	  }
	| { kind: 'context_cleared'; id: string; messageId?: string; timestamp: string; hidden?: boolean }
	| { kind: 'interrupted'; id: string; messageId?: string; timestamp: string; hidden?: boolean }
	| {
			kind: 'unknown';
			json: string;
			id: string;
			messageId?: string;
			timestamp: string;
			hidden?: boolean;
	  }
	| {
			kind: 'tool_result';
			toolId: string;
			rawResult: unknown;
			isError?: boolean;
			id: string;
			messageId?: string;
			timestamp: string;
			hidden?: boolean;
	  }
	| ({ id: string; messageId?: string; hidden?: boolean } & HydratedToolCall);

export interface SessionRuntime {
	sessionId: string;
	workspaceId: string;
	directoryId: string;
	localPath: string;
	title: string;
	status: MikoStatus;
	isDraining: boolean;
	provider: AgentProvider | null;
	planMode: boolean;
	sessionToken: string | null;
}

export interface SessionHistorySnapshot {
	hasOlder: boolean;
	olderCursor: string | null;
	recentLimit: number;
}

export interface SessionSnapshot {
	runtime: SessionRuntime;
	messages: TranscriptEntry[];
	history: SessionHistorySnapshot;
	availableProviders: ProviderCatalogEntry[];
}

export interface SessionHistoryPage {
	messages: TranscriptEntry[];
	hasOlder: boolean;
	olderCursor: string | null;
}

export interface WorkspaceAppSnapshot {
	sidebar: SidebarSnapshot;
	session?: SessionSnapshot | null;
}

export interface PendingToolSnapshot {
	toolUseId: string;
	toolKind: 'ask_user_question' | 'exit_plan_mode';
}
