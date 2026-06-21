import {
	type CanUseTool,
	type PermissionResult,
	type Query,
	query,
	type SDKUserMessage,
	type SdkBeta,
} from '@anthropic-ai/claude-agent-sdk';
import type { ClientCommand } from '../shared/protocol';
import { normalizeToolCall } from '../shared/tools';
import type {
	AccountInfo,
	AgentProvider,
	ChatAttachment,
	ClaudeContextWindow,
	ContextWindowUsageSnapshot,
	MikoStatus,
	NormalizedToolCall,
	PendingToolSnapshot,
	PromptPart,
	QueuedMessageSnapshot,
	SlashCommandInfo,
	TranscriptEntry,
} from '../shared/types';
import { CodexAppServerManager } from './codex-app-server';
import type { QueuedSessionMessageRecord, QueuedSessionSendCommand } from './event';
import type { EventStore } from './event-store';
import {
	fallbackTitleFromMessage,
	type GenerateSessionTitleResult,
	generateTitleForSessionDetailed,
} from './generate-title';
import type { HarnessEvent, HarnessToolRequest, HarnessTurn } from './harness-types';
import {
	codexServiceTierFromModelOptions,
	getServerProviderCatalog,
	normalizeClaudeModelOptions,
	normalizeCodexModelOptions,
	normalizeServerModel,
} from './provider-catalog';

const CLAUDE_TOOLSET = [
	'Skill',
	'WebFetch',
	'WebSearch',
	'Task',
	'TaskOutput',
	'Bash',
	'Glob',
	'Grep',
	'Read',
	'Edit',
	'Write',
	'TodoWrite',
	'KillShell',
	'AskUserQuestion',
	'EnterPlanMode',
	'ExitPlanMode',
] as const;

// 1M context is a session-level beta; the model id no longer carries a `[1m]` suffix. The beta is
// only ever reached for models the catalog marks 1M-capable, since normalizeClaudeContextWindow
// downgrades `1m` to `200k` for any model without a `1m` contextWindowOption.
const CLAUDE_1M_CONTEXT_BETA: SdkBeta = 'context-1m-2025-08-07';

function claudeBetasForContextWindow(contextWindow?: ClaudeContextWindow): SdkBeta[] | undefined {
	return contextWindow === '1m' ? [CLAUDE_1M_CONTEXT_BETA] : undefined;
}

interface PendingToolRequest {
	toolUseId: string;
	tool: NormalizedToolCall & { toolKind: 'ask_user_question' | 'exit_plan_mode' };
	resolve: (result: unknown) => void;
}

function pendingToolSnapshot(pending: PendingToolRequest): PendingToolSnapshot {
	const { tool, toolUseId } = pending;
	if (tool.toolKind === 'exit_plan_mode') {
		return {
			toolUseId,
			toolKind: 'exit_plan_mode',
			plan: tool.input?.plan,
			summary: tool.input?.summary,
		};
	}
	return {
		toolUseId,
		toolKind: 'ask_user_question',
		questions: tool.input?.questions ?? [],
	};
}

// Bounds the in-memory follow-up queue per session so a long-running turn can't accumulate unlimited
// messages (and their uploaded attachments).
const MAX_QUEUED_MESSAGES = 25;

interface ActiveTurn {
	sessionId: string;
	provider: AgentProvider;
	turn: HarnessTurn;
	// The Claude session that owns this turn, so a stale session loop only tears down its own turn
	// (never a replacement registered under the same sessionId after a 200k<->1M/effort/cwd switch).
	claudeSession?: ClaudeSessionState;
	model: string;
	effort?: string;
	serviceTier?: 'fast';
	planMode: boolean;
	status: MikoStatus;
	pendingTool: PendingToolRequest | null;
	postToolFollowUp: { content: string; planMode: boolean } | null;
	hasFinalResult: boolean;
	cancelRequested: boolean;
	cancelRecorded: boolean;
	settled: boolean;
}

interface ClaudeSessionHandle {
	provider: 'claude';
	stream: AsyncIterable<HarnessEvent>;
	getAccountInfo?: () => Promise<AccountInfo | null>;
	interrupt: () => Promise<void>;
	close: () => void;
	sendPrompt: (content: string) => Promise<void>;
	setModel: (model: string) => Promise<void>;
	setPermissionMode: (planMode: boolean) => Promise<void>;
	getCommands: () => Promise<SlashCommandInfo[]>;
}

interface ClaudeSessionState {
	sessionId: string;
	session: ClaudeSessionHandle;
	localPath: string;
	model: string;
	effort?: string;
	contextWindow?: ClaudeContextWindow;
	planMode: boolean;
	sessionToken: string | null;
	accountInfoLoaded: boolean;
}

interface AutoRenameWorkspaceBranchArgs {
	workspaceId: string;
	branchName: string;
	expectedCurrentBranchName?: string;
}

interface AutoRenameWorkspaceBranchResult {
	branchName: string;
	changed: boolean;
}

interface AgentCoordinatorArgs {
	store: EventStore;
	onStateChange: () => void;
	onTurnSettled?: (event: {
		sessionId: string;
		outcome: 'success' | 'failed' | 'cancelled';
	}) => void | Promise<void>;
	codexManager?: CodexAppServerManager;
	generateTitle?: (messageContent: string) => Promise<GenerateSessionTitleResult>;
	renameWorkspaceBranch?: (
		args: AutoRenameWorkspaceBranchArgs,
	) => Promise<AutoRenameWorkspaceBranchResult>;
	startClaudeSession?: (args: {
		localPath: string;
		model: string;
		effort?: string;
		contextWindow?: ClaudeContextWindow;
		planMode: boolean;
		sessionToken: string | null;
		onToolRequest: (request: HarnessToolRequest) => Promise<unknown>;
	}) => Promise<ClaudeSessionHandle>;
}

interface StartClaudeSessionDeps {
	queryFn?: typeof query;
}

function timestamped<T extends Omit<TranscriptEntry, '_id' | 'createdAt'>>(
	entry: T,
	createdAt = Date.now(),
): TranscriptEntry {
	return {
		_id: crypto.randomUUID(),
		createdAt,
		...entry,
	} as TranscriptEntry;
}

function stringFromUnknown(value: unknown) {
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function escapeXmlAttribute(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

export function buildAttachmentHintText(attachments: ChatAttachment[]) {
	if (attachments.length === 0) return '';

	const lines = attachments.map(
		(attachment) =>
			`<attachment 
                kind="${escapeXmlAttribute(attachment.kind)}" 
                mime_type="${escapeXmlAttribute(attachment.mimeType)}" 
                path="${escapeXmlAttribute(attachment.absolutePath)}" 
                project_path="${escapeXmlAttribute(attachment.relativePath)}" 
                size_bytes="${attachment.size}" 
                display_name="${escapeXmlAttribute(attachment.displayName)}" 
            />`,
	);

	return ['<miko-attachments>', ...lines, '</miko-attachments>'].join('\n');
}

export function buildPromptText(content: string, attachments: ChatAttachment[]) {
	const attachmentHint = buildAttachmentHintText(attachments);
	if (!attachmentHint) {
		return content.trim();
	}

	const trimmed = content.trim();
	return [trimmed || 'Please inspect the attached files.', attachmentHint].join('\n\n').trim();
}

function discardedToolResult(
	tool: NormalizedToolCall & { toolKind: 'ask_user_question' | 'exit_plan_mode' },
) {
	if (tool.toolKind === 'ask_user_question') {
		return {
			discarded: true,
			answers: {},
		};
	}

	return {
		discarded: true,
	};
}

export function normalizeClaudeUsageSnapshot(
	value: unknown,
	maxTokens?: number,
): ContextWindowUsageSnapshot | null {
	const usage = asRecord(value);
	if (!usage) return null;

	const directInputTokens = asNumber(usage.input_tokens) ?? asNumber(usage.inputTokens) ?? 0;
	const cacheCreationInputTokens =
		asNumber(usage.cache_creation_input_tokens) ?? asNumber(usage.cacheCreationInputTokens) ?? 0;

	const cacheReadInputTokens =
		asNumber(usage.cache_read_input_tokens) ?? asNumber(usage.cacheReadInputTokens) ?? 0;

	const outputTokens = asNumber(usage.output_tokens) ?? asNumber(usage.outputTokens) ?? 0;
	const reasoningOutputTokens =
		asNumber(usage.reasoning_output_tokens) ?? asNumber(usage.reasoningOutputTokens);

	const toolUses = asNumber(usage.tool_uses) ?? asNumber(usage.toolUses);
	const durationMs = asNumber(usage.duration_ms) ?? asNumber(usage.durationMs);

	const inputTokens = directInputTokens + cacheCreationInputTokens + cacheReadInputTokens;
	const usedTokens = inputTokens + outputTokens;

	if (usedTokens <= 0) {
		return null;
	}

	return {
		usedTokens,
		inputTokens,
		...(cacheReadInputTokens > 0 ? { cachedInputTokens: cacheReadInputTokens } : {}),
		...(outputTokens > 0 ? { outputTokens } : {}),
		...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
		lastUsedTokens: usedTokens,
		lastInputTokens: inputTokens,
		...(cacheReadInputTokens > 0 ? { lastCachedInputTokens: cacheReadInputTokens } : {}),
		...(outputTokens > 0 ? { lastOutputTokens: outputTokens } : {}),
		...(reasoningOutputTokens !== undefined
			? { lastReasoningOutputTokens: reasoningOutputTokens }
			: {}),
		...(toolUses !== undefined ? { toolUses } : {}),
		...(durationMs !== undefined ? { durationMs } : {}),
		...(typeof maxTokens === 'number' && maxTokens > 0 ? { maxTokens } : {}),
		compactsAutomatically: false,
	};
}

export function maxClaudeContextWindowFromModelUsage(modelUsage: unknown): number | undefined {
	const record = asRecord(modelUsage);
	if (!record) return undefined;

	let maxContextWindow: number | undefined;
	for (const value of Object.values(record)) {
		const usage = asRecord(value);
		const contextWindow = asNumber(usage?.contextWindow) ?? asNumber(usage?.context_window);

		if (contextWindow === undefined) continue;
		maxContextWindow = Math.max(maxContextWindow ?? 0, contextWindow);
	}
	return maxContextWindow;
}

function getClaudeAssistantMessageUsageId(message: unknown): string | null {
	const record = asRecord(message);
	const nestedMessage = asRecord(record?.message);
	const nestedId = nestedMessage?.id;
	if (typeof nestedId === 'string' && nestedId) return nestedId;

	const uuid = record?.uuid;
	if (typeof uuid === 'string' && uuid) return uuid;

	return null;
}

export function normalizeClaudeStreamMessage(message: unknown): TranscriptEntry[] {
	const debugRaw = JSON.stringify(message);
	const record = asRecord(message) ?? {};
	const nestedMessage = asRecord(record.message);
	const messageId = typeof record.uuid === 'string' ? record.uuid : undefined;

	if (record.type === 'system' && record.subtype === 'init') {
		return [
			timestamped({
				kind: 'system_init',
				messageId,
				provider: 'claude',
				model: typeof record.model === 'string' ? record.model : 'unknown',
				tools: Array.isArray(record.tools) ? record.tools : [],
				agents: Array.isArray(record.agents) ? record.agents : [],
				slashCommands: Array.isArray(record.slash_commands)
					? record.slash_commands.filter(
							(entry): entry is string => typeof entry === 'string' && !entry.startsWith('._'),
						)
					: [],
				mcpServers: Array.isArray(record.mcp_servers) ? record.mcp_servers : [],
				debugRaw,
			}),
		];
	}

	if (record.type === 'assistant' && Array.isArray(nestedMessage?.content)) {
		const entries: TranscriptEntry[] = [];
		for (const rawContent of nestedMessage.content) {
			const content = asRecord(rawContent);
			if (content?.type === 'text' && typeof content.text === 'string') {
				entries.push(
					timestamped({
						kind: 'assistant_text',
						messageId,
						text: content.text,
						debugRaw,
					}),
				);
			}

			if (
				content?.type === 'tool_use' &&
				typeof content.name === 'string' &&
				typeof content.id === 'string'
			) {
				entries.push(
					timestamped({
						kind: 'tool_call',
						messageId,
						tool: normalizeToolCall({
							toolName: content.name,
							toolId: content.id,
							input: (content.input ?? {}) as Record<string, unknown>,
						}),
						debugRaw,
					}),
				);
			}
		}
		return entries;
	}

	if (record.type === 'user' && Array.isArray(nestedMessage?.content)) {
		const entries: TranscriptEntry[] = [];
		for (const rawContent of nestedMessage.content) {
			const content = asRecord(rawContent);
			if (content?.type === 'tool_result' && typeof content.tool_use_id === 'string') {
				entries.push(
					timestamped({
						kind: 'tool_result',
						messageId,
						toolId: content.tool_use_id,
						content: content.content,
						isError: Boolean(content.is_error),
						debugRaw,
					}),
				);
			}
		}
		return entries;
	}

	if (record.type === 'result') {
		if (record.subtype === 'cancelled') {
			return [timestamped({ kind: 'interrupted', messageId, debugRaw })];
		}

		return [
			timestamped({
				kind: 'result',
				messageId,
				subtype: record.is_error ? 'error' : 'success',
				isError: Boolean(record.is_error),
				durationMs: typeof record.duration_ms === 'number' ? record.duration_ms : 0,
				result:
					typeof record.result === 'string' ? record.result : stringFromUnknown(record.result),
				costUsd: typeof record.total_cost_usd === 'number' ? record.total_cost_usd : undefined,
				debugRaw,
			}),
		];
	}

	if (
		record.type === 'system' &&
		record.subtype === 'status' &&
		typeof record.status === 'string'
	) {
		return [timestamped({ kind: 'status', messageId, status: record.status, debugRaw })];
	}

	if (record.type === 'system' && record.subtype === 'compact_boundary') {
		return [timestamped({ kind: 'compact_boundary', messageId, debugRaw })];
	}

	if (record.type === 'system' && record.subtype === 'context_cleared') {
		return [timestamped({ kind: 'context_cleared', messageId, debugRaw })];
	}

	if (
		record.type === 'user' &&
		nestedMessage?.role === 'user' &&
		typeof nestedMessage.content === 'string' &&
		nestedMessage.content.startsWith('This session is being continued')
	) {
		return [
			timestamped({
				kind: 'compact_summary',
				messageId,
				summary: nestedMessage.content,
				debugRaw,
			}),
		];
	}

	return [];
}

export async function* createClaudeHarnessStream(q: Query): AsyncGenerator<HarnessEvent> {
	let seenAssistantUsageIds = new Set<string>();
	let latestUsageSnapshot: ContextWindowUsageSnapshot | null = null;
	let lastKnownContextWindow: number | undefined;

	for await (const sdkMessage of q as AsyncIterable<unknown>) {
		const sdkRecord = asRecord(sdkMessage) ?? {};
		const sessionToken = typeof sdkRecord.session_id === 'string' ? sdkRecord.session_id : null;
		if (sessionToken) {
			yield { type: 'session_token', sessionToken };
		}

		if (sdkRecord.type === 'assistant') {
			const usageId = getClaudeAssistantMessageUsageId(sdkMessage);
			const usageSnapshot = normalizeClaudeUsageSnapshot(sdkRecord.usage, lastKnownContextWindow);

			if (usageId && usageSnapshot && !seenAssistantUsageIds.has(usageId)) {
				seenAssistantUsageIds.add(usageId);
				latestUsageSnapshot = usageSnapshot;
				yield {
					type: 'transcript',
					entry: timestamped({
						kind: 'context_window_updated',
						usage: usageSnapshot,
					}),
				};
			}
		}

		if (sdkRecord.type === 'result') {
			const resultContextWindow = maxClaudeContextWindowFromModelUsage(sdkRecord.modelUsage);
			if (resultContextWindow !== undefined) {
				lastKnownContextWindow = resultContextWindow;
			}

			const accumulatedUsage = normalizeClaudeUsageSnapshot(
				sdkRecord.usage,
				resultContextWindow ?? lastKnownContextWindow,
			);

			const finalUsage = latestUsageSnapshot
				? {
						...latestUsageSnapshot,
						...(typeof (resultContextWindow ?? lastKnownContextWindow) === 'number'
							? { maxTokens: resultContextWindow ?? lastKnownContextWindow }
							: {}),
						...(accumulatedUsage && accumulatedUsage.usedTokens > latestUsageSnapshot.usedTokens
							? { totalProcessedTokens: accumulatedUsage.usedTokens }
							: {}),
					}
				: accumulatedUsage;

			if (finalUsage) {
				yield {
					type: 'transcript',
					entry: timestamped({
						kind: 'context_window_updated',
						usage: finalUsage,
					}),
				};
			}

			seenAssistantUsageIds = new Set<string>();
			latestUsageSnapshot = null;
		}

		for (const entry of normalizeClaudeStreamMessage(sdkMessage)) {
			yield { type: 'transcript', entry };
		}
	}
}

class AsyncMessageQueue<T> implements AsyncIterable<T> {
	private readonly values: T[] = [];
	private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
	private closed = false;

	push(value: T) {
		if (this.closed) {
			throw new Error('Cannot push to a closed queue');
		}

		const waiter = this.waiters.shift();
		if (waiter) {
			waiter({ done: false, value });
			return;
		}

		this.values.push(value);
	}

	close() {
		if (this.closed) return;
		this.closed = true;

		while (this.waiters.length > 0) {
			const waiter = this.waiters.shift();
			waiter?.({ done: true, value: undefined as never });
		}
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: async () => {
				if (this.values.length > 0) {
					return { done: false, value: this.values.shift() as T };
				}

				if (this.closed) {
					return { done: true, value: undefined as never };
				}

				return await new Promise<IteratorResult<T>>((resolve) => {
					this.waiters.push(resolve);
				});
			},
		};
	}
}

export async function startClaudeSession(
	args: {
		localPath: string;
		model: string;
		effort?: string;
		contextWindow?: ClaudeContextWindow;
		planMode: boolean;
		sessionToken: string | null;
		onToolRequest: (request: HarnessToolRequest) => Promise<unknown>;
	},
	deps: StartClaudeSessionDeps = {},
): Promise<ClaudeSessionHandle> {
	const canUseTool: CanUseTool = async (toolName, input, options) => {
		if (toolName !== 'AskUserQuestion' && toolName !== 'ExitPlanMode') {
			return {
				behavior: 'allow',
				updatedInput: input,
			};
		}

		const tool = normalizeToolCall({
			toolName,
			toolId: options.toolUseID,
			input: (input ?? {}) as Record<string, unknown>,
		});

		if (tool.toolKind !== 'ask_user_question' && tool.toolKind !== 'exit_plan_mode') {
			return {
				behavior: 'deny',
				message: 'Unsupported tool request',
			};
		}

		const result = await args.onToolRequest({ tool });

		if (tool.toolKind === 'ask_user_question') {
			const record =
				result && typeof result === 'object' ? (result as Record<string, unknown>) : {};

			return {
				behavior: 'allow',
				updatedInput: {
					...(tool.rawInput ?? {}),
					questions: record.questions ?? tool.input.questions,
					answers: record.answers ?? result,
				},
			} satisfies PermissionResult;
		}

		const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
		const confirmed = Boolean(record.confirmed);
		if (confirmed) {
			return {
				behavior: 'allow',
				updatedInput: {
					...(tool.rawInput ?? {}),
					...record,
				},
			} satisfies PermissionResult;
		}

		return {
			behavior: 'deny',
			message:
				typeof record.message === 'string'
					? `User wants to suggest edits to the plan: ${record.message}`
					: 'User wants to suggest edits to the plan before approving.',
		} satisfies PermissionResult;
	};

	const promptQueue = new AsyncMessageQueue<SDKUserMessage>();

	const q = (deps.queryFn ?? query)({
		prompt: promptQueue,
		options: {
			cwd: args.localPath,
			model: args.model,
			effort: args.effort as 'low' | 'medium' | 'high' | 'max' | undefined,
			betas: claudeBetasForContextWindow(args.contextWindow),
			resume: args.sessionToken ?? undefined,
			permissionMode: args.planMode ? 'plan' : 'acceptEdits',
			canUseTool,
			tools: [...CLAUDE_TOOLSET],
			settingSources: ['user', 'project', 'local'],
			env: (() => {
				const { CLAUDECODE: _, ...env } = process.env;
				return env;
			})(),
		},
	});

	return {
		provider: 'claude',
		stream: createClaudeHarnessStream(q),
		getAccountInfo: async () => {
			try {
				return await q.accountInfo();
			} catch {
				return null;
			}
		},
		interrupt: async () => {
			await q.interrupt();
		},
		sendPrompt: async (content: string) => {
			promptQueue.push({
				type: 'user',
				message: {
					role: 'user',
					content,
				},
				parent_tool_use_id: null,
				session_id: args.sessionToken ?? '',
			});
		},
		setModel: async (model: string) => {
			await q.setModel(model);
		},
		setPermissionMode: async (planMode: boolean) => {
			await q.setPermissionMode(planMode ? 'plan' : 'acceptEdits');
		},
		getCommands: async () => {
			try {
				const commands = await q.supportedCommands();
				return commands.map((command) => ({
					name: command.name,
					description: command.description || undefined,
					argumentHint: command.argumentHint || undefined,
				}));
			} catch {
				return [];
			}
		},
		close: () => {
			promptQueue.close();
			q.close();
		},
	};
}

export class AgentCoordinator {
	private readonly store: EventStore;
	private readonly onStateChange: () => void;
	private readonly onTurnSettled: NonNullable<AgentCoordinatorArgs['onTurnSettled']> | null;
	private readonly codexManager: CodexAppServerManager;
	private readonly generateTitle: (messageContent: string) => Promise<GenerateSessionTitleResult>;
	private readonly renameWorkspaceBranch: AgentCoordinatorArgs['renameWorkspaceBranch'];
	private readonly startClaudeSessionFn: NonNullable<AgentCoordinatorArgs['startClaudeSession']>;
	private reportBackgroundError: ((message: string) => void) | null = null;
	// Releases uploaded files of queued messages dropped via dequeue/stop so they don't orphan in app
	// data. Receives a server-resolved workspaceId (never derived from the client payload) plus the
	// upload stored-names, so a forged attachment path can't steer deletion to another workspace.
	private discardUploads: ((workspaceId: string, storedNames: string[]) => void) | null = null;
	readonly activeTurns = new Map<string, ActiveTurn>();
	readonly drainingStreams = new Map<string, { turn: HarnessTurn }>();
	readonly claudeSessions = new Map<string, ClaudeSessionState>();
	// Slash commands keyed by `${workspaceId}:${provider}`. Commands are workspace/provider scoped
	// (filesystem + config derived), so the cache is shared across sessions in a workspace.
	private readonly commandsCache = new Map<string, SlashCommandInfo[]>();
	private readonly commandsInFlight = new Map<string, Promise<SlashCommandInfo[]>>();
	// Queued follow-ups are persisted in EventStore; memory only tracks live startup/running state.
	// Sessions whose turn is mid-startup (reserved before activeTurns is registered) so concurrent
	// sends are treated as busy and never race past the check.
	private readonly startingSessions = new Set<string>();

	constructor(args: AgentCoordinatorArgs) {
		this.store = args.store;
		this.onStateChange = args.onStateChange;
		this.onTurnSettled = args.onTurnSettled ?? null;
		this.codexManager = args.codexManager ?? new CodexAppServerManager();
		this.generateTitle = args.generateTitle ?? generateTitleForSessionDetailed;
		this.renameWorkspaceBranch = args.renameWorkspaceBranch;
		this.startClaudeSessionFn = args.startClaudeSession ?? startClaudeSession;
	}

	setBackgroundErrorReporter(report: ((message: string) => void) | null) {
		this.reportBackgroundError = report;
	}

	setUploadCleanup(cleanup: ((workspaceId: string, storedNames: string[]) => void) | null) {
		this.discardUploads = cleanup;
	}

	private discardQueuedUploads(sessionId: string, messages: QueuedSessionMessageRecord[]) {
		// Trust only the stored-name segment of the canonical upload ref; the workspace comes from the
		// session, never from the (client-supplied) attachment path.
		const storedNames = messages.flatMap((message) =>
			(message.command.attachments ?? []).flatMap((attachment) => {
				const name = /^miko:\/\/uploads\/[^/]+\/(.+)$/.exec(attachment.relativePath)?.[1];
				return name ? [name] : [];
			}),
		);
		if (storedNames.length === 0) return;
		const session = this.store.getSession(sessionId);
		if (session) this.discardUploads?.(session.workspaceId, storedNames);
	}

	private async notifyTurnSettled(sessionId: string, outcome: 'success' | 'failed' | 'cancelled') {
		try {
			await this.onTurnSettled?.({ sessionId, outcome });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.reportBackgroundError?.(
				`[turn-settled] session ${sessionId} failed post-turn orchestration: ${message}`,
			);
		}
	}

	private async notifyActiveTurnSettled(
		active: ActiveTurn,
		outcome: 'success' | 'failed' | 'cancelled',
	) {
		if (active.settled) return;
		active.settled = true;
		await this.notifyTurnSettled(active.sessionId, outcome);
	}

	private async autoRenameWorkspaceBranchFromTitle(args: AutoRenameWorkspaceBranchArgs) {
		if (!this.renameWorkspaceBranch) return null;

		try {
			const result = await this.renameWorkspaceBranch(args);
			if (result.changed) this.onStateChange();
			return result.branchName;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.reportBackgroundError?.(
				`[branch-rename] workspace ${args.workspaceId} failed automatic branch rename: ${message}`,
			);
			return null;
		}
	}

	getActiveStatuses() {
		const statuses = new Map<string, MikoStatus>();
		for (const [sessionId, turn] of this.activeTurns.entries()) {
			statuses.set(sessionId, turn.status);
		}
		return statuses;
	}

	getPendingTool(sessionId: string): PendingToolSnapshot | null {
		const pending = this.activeTurns.get(sessionId)?.pendingTool;
		if (!pending) return null;
		return pendingToolSnapshot(pending);
	}

	/**
	 * Slash commands for a session's workspace + provider. Served from cache when warm; otherwise a
	 * live session is used, or a short-lived harness is spawned just to enumerate (no turn sent, no
	 * message required). The provider falls back to the request hint before a turn binds one.
	 * Concurrent calls share one in-flight enumeration so opening/focusing never double-spawns.
	 */
	async listCommands(sessionId: string, provider?: AgentProvider): Promise<SlashCommandInfo[]> {
		const session = this.store.getSession(sessionId);
		if (!session) return [];
		const workspace = this.store.getWorkspace(session.workspaceId);
		if (!workspace) return [];

		const effectiveProvider = session.provider ?? provider ?? 'claude';
		const cacheKey = `${workspace.id}:${effectiveProvider}`;

		const cached = this.commandsCache.get(cacheKey);
		if (cached) return cached;

		const inFlight = this.commandsInFlight.get(cacheKey);
		if (inFlight) return inFlight;

		const promise = this.enumerateCommands(sessionId, effectiveProvider, workspace.localPath)
			.then((commands) => {
				this.commandsCache.set(cacheKey, commands);
				return commands;
			})
			.catch(() => [] as SlashCommandInfo[])
			.finally(() => {
				this.commandsInFlight.delete(cacheKey);
			});

		this.commandsInFlight.set(cacheKey, promise);
		return promise;
	}

	private async enumerateCommands(
		sessionId: string,
		provider: AgentProvider,
		localPath: string,
	): Promise<SlashCommandInfo[]> {
		if (provider === 'codex') {
			return this.codexManager.enumerateSkills(localPath, normalizeServerModel('codex'));
		}

		const live = this.claudeSessions.get(sessionId);
		if (live) return live.session.getCommands();

		// Short-lived enumeration session: no prompt is ever sent and it is closed immediately.
		const handle = await this.startClaudeSessionFn({
			localPath,
			model: normalizeServerModel('claude'),
			planMode: false,
			sessionToken: null,
			onToolRequest: async () => ({}),
		});
		try {
			return await handle.getCommands();
		} finally {
			handle.close();
		}
	}

	getDrainingSessionIds(): Set<string> {
		return new Set(this.drainingStreams.keys());
	}

	async stopDraining(sessionId: string) {
		const draining = this.drainingStreams.get(sessionId);
		if (!draining) return;

		draining.turn.close();
		this.drainingStreams.delete(sessionId);
		this.onStateChange();
	}

	async closeSession(sessionId: string) {
		await this.stopDraining(sessionId);
		const claudeSession = this.claudeSessions.get(sessionId);
		if (claudeSession) {
			claudeSession.session.close();
			this.claudeSessions.delete(sessionId);
		}
		this.onStateChange();
	}

	private resolveProvider(
		command: Extract<ClientCommand, { type: 'session.send' }>,
		currentProvider: AgentProvider | null,
	) {
		if (currentProvider) return currentProvider;
		return command.provider ?? 'claude';
	}

	private getProviderSettings(
		provider: AgentProvider,
		command: Extract<ClientCommand, { type: 'session.send' }>,
	) {
		const catalog = getServerProviderCatalog(provider);
		if (provider === 'claude') {
			const model = normalizeServerModel(provider, command.model);
			const modelOptions = normalizeClaudeModelOptions(model, command.modelOptions, command.effort);

			return {
				model,
				effort: modelOptions.reasoningEffort,
				contextWindow: modelOptions.contextWindow,
				serviceTier: undefined,
				planMode: catalog.supportsPlanMode ? Boolean(command.planMode) : false,
			};
		}

		const modelOptions = normalizeCodexModelOptions(command.modelOptions, command.effort);
		return {
			model: normalizeServerModel(provider, command.model),
			effort: modelOptions.reasoningEffort,
			contextWindow: undefined,
			serviceTier: codexServiceTierFromModelOptions(modelOptions),
			planMode: catalog.supportsPlanMode ? Boolean(command.planMode) : false,
		};
	}

	private async startTurnForSession(args: {
		sessionId: string;
		provider: AgentProvider;
		content: string;
		attachments: ChatAttachment[];
		parts?: PromptPart[];
		model: string;
		effort?: string;
		contextWindow?: ClaudeContextWindow;
		serviceTier?: 'fast';
		planMode: boolean;
		appendUserPrompt: boolean;
	}) {
		// Close any lingering draining stream before starting a new turn.
		const draining = this.drainingStreams.get(args.sessionId);
		if (draining) {
			draining.turn.close();
			this.drainingStreams.delete(args.sessionId);
		}

		const session = this.store.requireSession(args.sessionId);
		if (this.activeTurns.has(args.sessionId)) {
			throw new Error('Session is already running');
		}

		if (!session.provider) {
			await this.store.setSessionProvider(args.sessionId, args.provider);
		}

		await this.store.setPlanMode(args.sessionId, args.planMode);

		const workspace = this.store.getWorkspace(session.workspaceId);
		if (!workspace) {
			throw new Error('Workspace not found');
		}

		const existingMessages = this.store.getMessages(args.sessionId);
		const shouldGenerateTitle =
			args.appendUserPrompt && session.title === 'Untitled' && existingMessages.length === 0;

		const optimisticTitle = shouldGenerateTitle ? fallbackTitleFromMessage(args.content) : null;
		let optimisticBranchRename: Promise<string | null> = Promise.resolve(null);

		if (optimisticTitle) {
			await this.store.renameSession(args.sessionId, optimisticTitle);
			optimisticBranchRename = this.autoRenameWorkspaceBranchFromTitle({
				workspaceId: workspace.id,
				branchName: optimisticTitle,
				expectedCurrentBranchName: workspace.branchName,
			});
		}

		if (args.appendUserPrompt) {
			const userPromptEntry = timestamped(
				{
					kind: 'user_prompt',
					content: args.content,
					attachments: args.attachments,
					parts: args.parts,
				},
				Date.now(),
			);
			await this.store.appendMessage(args.sessionId, userPromptEntry);
		}

		await this.store.recordTurnStarted(args.sessionId);

		if (shouldGenerateTitle) {
			void this.generateTitleInBackground(
				args.sessionId,
				args.content,
				workspace.localPath,
				optimisticTitle ?? 'Untitled',
				workspace.branchName,
				optimisticBranchRename,
			);
		}

		const onToolRequest = async (request: HarnessToolRequest): Promise<unknown> => {
			const active = this.activeTurns.get(args.sessionId);
			if (!active) {
				throw new Error('Session turn ended unexpectedly');
			}

			active.status = 'waiting_for_user';
			this.onStateChange();

			return await new Promise<unknown>((resolve) => {
				active.pendingTool = {
					toolUseId: request.tool.toolId,
					tool: request.tool,
					resolve,
				};
			});
		};

		let turn: HarnessTurn;
		if (args.provider === 'claude') {
			turn = await this.startClaudeTurn({
				sessionId: args.sessionId,
				localPath: workspace.localPath,
				model: args.model,
				effort: args.effort,
				contextWindow: args.contextWindow,
				planMode: args.planMode,
				sessionToken: session.sessionToken,
				onToolRequest,
			});
		} else {
			await this.codexManager.startSession({
				sessionId: args.sessionId,
				cwd: workspace.localPath,
				model: args.model,
				serviceTier: args.serviceTier,
				sessionToken: session.sessionToken,
			});

			turn = await this.codexManager.startTurn({
				sessionId: args.sessionId,
				content: buildPromptText(args.content, args.attachments),
				model: args.model,
				effort: args.effort as Parameters<CodexAppServerManager['startTurn']>[0]['effort'],
				serviceTier: args.serviceTier,
				planMode: args.planMode,
				onToolRequest,
			});
		}

		const active: ActiveTurn = {
			sessionId: args.sessionId,
			provider: args.provider,
			turn,
			claudeSession:
				args.provider === 'claude' ? this.claudeSessions.get(args.sessionId) : undefined,
			model: args.model,
			effort: args.effort,
			serviceTier: args.serviceTier,
			planMode: args.planMode,
			status: args.provider === 'claude' ? 'running' : 'starting',
			pendingTool: null,
			postToolFollowUp: null,
			hasFinalResult: false,
			cancelRequested: false,
			cancelRecorded: false,
			settled: false,
		};

		this.activeTurns.set(args.sessionId, active);
		this.onStateChange();

		if (turn.getAccountInfo) {
			void turn
				.getAccountInfo()
				.then(async (accountInfo) => {
					if (!accountInfo) return;
					if (args.provider === 'claude') {
						const session = this.claudeSessions.get(args.sessionId);
						if (session) {
							if (session.accountInfoLoaded) return;
							session.accountInfoLoaded = true;
						} else {
							return;
						}
					}
					await this.store.appendMessage(
						args.sessionId,
						timestamped({ kind: 'account_info', accountInfo }),
					);
					this.onStateChange();
				})
				.catch(() => undefined);
		}

		if (args.provider === 'claude') {
			const session = this.claudeSessions.get(args.sessionId);
			if (!session) {
				throw new Error('Claude session was not initialized');
			}
			await session.session.sendPrompt(buildPromptText(args.content, args.attachments));
			return;
		}

		void this.runTurn(active);
	}

	private async startClaudeTurn(args: {
		sessionId: string;
		localPath: string;
		model: string;
		effort?: string;
		contextWindow?: ClaudeContextWindow;
		planMode: boolean;
		sessionToken: string | null;
		onToolRequest: (request: HarnessToolRequest) => Promise<unknown>;
	}): Promise<HarnessTurn> {
		let session = this.claudeSessions.get(args.sessionId);

		// The 1M context beta is fixed when the query is created, so a context-window change forces
		// a fresh session just like effort does.
		if (
			!session ||
			session.localPath !== args.localPath ||
			session.effort !== args.effort ||
			session.contextWindow !== args.contextWindow
		) {
			if (session) {
				session.session.close();
				this.claudeSessions.delete(args.sessionId);
			}

			const started = await this.startClaudeSessionFn({
				localPath: args.localPath,
				model: args.model,
				effort: args.effort,
				contextWindow: args.contextWindow,
				planMode: args.planMode,
				sessionToken: args.sessionToken,
				onToolRequest: args.onToolRequest,
			});

			session = {
				sessionId: args.sessionId,
				session: started,
				localPath: args.localPath,
				model: args.model,
				effort: args.effort,
				contextWindow: args.contextWindow,
				planMode: args.planMode,
				sessionToken: args.sessionToken,
				accountInfoLoaded: false,
			};

			this.claudeSessions.set(args.sessionId, session);
			void this.runClaudeSession(session);
		} else {
			if (session.model !== args.model) {
				await session.session.setModel(args.model);
				session.model = args.model;
			}
			if (session.planMode !== args.planMode) {
				await session.session.setPermissionMode(args.planMode);
				session.planMode = args.planMode;
			}
		}

		return {
			provider: 'claude',
			stream: {
				async *[Symbol.asyncIterator]() {},
			},
			getAccountInfo: session.session.getAccountInfo,
			interrupt: session.session.interrupt,
			close: () => {},
		};
	}

	async send(command: Extract<ClientCommand, { type: 'session.send' }>) {
		let sessionId = command.sessionId;

		if (!sessionId) {
			if (!command.workspaceId) {
				throw new Error('Missing workspaceId for new session');
			}

			const created = await this.store.createSession(command.workspaceId);
			sessionId = created.id;
		}

		this.store.requireSession(sessionId);

		// A turn is running/starting — or messages are already queued behind a settling turn — so queue
		// this one and let it start when the session drains, instead of rejecting or jumping the line.
		if (this.isSessionBusy(sessionId)) {
			const queue = this.store.listQueuedSessionMessages(sessionId);
			if (queue.length >= MAX_QUEUED_MESSAGES) {
				throw new Error(`Too many queued messages (max ${MAX_QUEUED_MESSAGES}).`);
			}
			await this.store.queueSessionMessage({ ...command, sessionId });
			this.onStateChange();
			return { sessionId };
		}

		await this.startQueuedOrDirect({ ...command, sessionId });
		return { sessionId };
	}

	async sendWhenIdle(
		command: Extract<ClientCommand, { type: 'session.send' }>,
		beforeStart?: () => void,
	) {
		let sessionId = command.sessionId;

		if (!sessionId) {
			if (!command.workspaceId) {
				throw new Error('Missing workspaceId for new session');
			}

			const created = await this.store.createSession(command.workspaceId);
			sessionId = created.id;
		}

		this.store.requireSession(sessionId);

		if (this.isSessionBusy(sessionId)) {
			throw new Error('Session is busy — wait for the current turn to finish.');
		}

		await this.startQueuedOrDirect({ ...command, sessionId }, beforeStart);
		return { sessionId };
	}

	private async startQueuedOrDirect(command: QueuedSessionSendCommand, beforeStart?: () => void) {
		// Reserve synchronously (before any await) so a concurrent send/instruction sees the session as
		// busy during the async startup window — closing the check-then-start race. `activeTurns` takes
		// over once the turn is registered.
		this.startingSessions.add(command.sessionId);
		try {
			const session = this.store.requireSession(command.sessionId);
			const provider = this.resolveProvider(command, session.provider);
			const settings = this.getProviderSettings(provider, command);

			beforeStart?.();

			await this.startTurnForSession({
				sessionId: command.sessionId,
				provider,
				content: command.content,
				attachments: command.attachments ?? [],
				parts: command.parts,
				model: settings.model,
				effort: settings.effort,
				contextWindow: settings.contextWindow,
				serviceTier: settings.serviceTier,
				planMode: settings.planMode,
				appendUserPrompt: true,
			});
		} finally {
			this.startingSessions.delete(command.sessionId);
		}
	}

	/** Start the next queued message once a session has no active turn. No-op if busy or empty. */
	private async drainQueue(sessionId: string) {
		if (this.activeTurns.has(sessionId) || this.startingSessions.has(sessionId)) return;
		const next = this.store.getNextQueuedSessionMessage(sessionId);
		if (!next) return;
		const draining = await this.store.markQueuedSessionMessageDraining(sessionId, next.id);
		if (!draining) return;
		this.onStateChange();

		try {
			await this.startQueuedOrDirect(next.command);
			await this.store.completeQueuedSessionMessage(sessionId, next.id);
			this.onStateChange();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.store.failQueuedSessionMessage(sessionId, next.id, message);
			await this.store.appendMessage(
				sessionId,
				timestamped({
					kind: 'result',
					subtype: 'error',
					isError: true,
					durationMs: 0,
					result: message,
				}),
			);
			await this.store.recordTurnFailed(sessionId, message);
			this.onStateChange();
			// A start failure shouldn't strand the rest of the queue.
			await this.drainQueue(sessionId);
		}
	}

	/** Drop a still-queued message before it runs. */
	async dequeueMessage(sessionId: string, messageId: string) {
		const dropped = await this.store.dequeueQueuedSessionMessage(sessionId, messageId);
		if (!dropped) return;
		this.discardQueuedUploads(sessionId, [dropped]);
		this.onStateChange();
	}

	/** A turn is running/starting or follow-ups are queued. Keeps discrete workspace actions un-queued. */
	isSessionBusy(sessionId: string): boolean {
		return (
			this.activeTurns.has(sessionId) ||
			this.startingSessions.has(sessionId) ||
			this.store.hasQueuedSessionMessages(sessionId)
		);
	}

	getQueuedMessages(sessionId: string): QueuedMessageSnapshot[] {
		return this.store.listQueuedSessionMessages(sessionId).map((message) => ({
			id: message.id,
			content: message.command.content,
			attachmentCount: message.command.attachments?.length ?? 0,
		}));
	}

	private async runClaudeSession(session: ClaudeSessionState) {
		// Set when the persistent stream throws/closes before emitting a result, so the finally can
		// drain any queued follow-up (the result branch is the only other place that drains Claude).
		let streamFailed = false;
		try {
			for await (const event of session.session.stream) {
				if (event.type === 'session_token' && event.sessionToken) {
					session.sessionToken = event.sessionToken;
					await this.store.setSessionToken(session.sessionId, event.sessionToken);
					this.onStateChange();
					continue;
				}

				if (!event.entry) continue;
				await this.store.appendMessage(session.sessionId, event.entry);

				const active = this.activeTurns.get(session.sessionId);
				if (event.entry.kind === 'system_init' && active) {
					active.status = 'running';
				}

				if (event.entry.kind === 'result' && active) {
					active.hasFinalResult = true;
					if (event.entry.isError && !active.cancelRequested) {
						await this.store.recordTurnFailed(
							session.sessionId,
							event.entry.result || 'Turn failed',
						);
						await this.notifyActiveTurnSettled(active, 'failed');
					} else if (!active.cancelRequested) {
						await this.store.recordTurnFinished(session.sessionId);
						await this.notifyActiveTurnSettled(active, 'success');
					}
					this.activeTurns.delete(session.sessionId);
					// Start the next queued message on the same persistent session (skipped on cancel).
					if (!active.cancelRequested) await this.drainQueue(session.sessionId);
				}

				this.onStateChange();
			}
		} catch (error) {
			const active = this.activeTurns.get(session.sessionId);
			if (active && !active.cancelRequested) {
				streamFailed = true;
				const message = error instanceof Error ? error.message : String(error);
				await this.store.appendMessage(
					session.sessionId,
					timestamped({
						kind: 'result',
						subtype: 'error',
						isError: true,
						durationMs: 0,
						result: message,
					}),
				);
				await this.store.recordTurnFailed(session.sessionId, message);
				await this.notifyActiveTurnSettled(active, 'failed');
			}
		} finally {
			// A 200k<->1M (or effort/cwd) switch can swap a fresh session and turn in under the same
			// sessionId. Only retire map entries this loop actually owns so the replacement survives:
			// the session entry by identity, and the active turn by its back-reference to this session.
			if (this.claudeSessions.get(session.sessionId) === session) {
				this.claudeSessions.delete(session.sessionId);
			}
			const active = this.activeTurns.get(session.sessionId);
			if (active?.provider === 'claude' && active.claudeSession === session) {
				if (active.cancelRequested && !active.cancelRecorded) {
					await this.store.recordTurnCancelled(session.sessionId);
					await this.notifyActiveTurnSettled(active, 'cancelled');
				}
				this.activeTurns.delete(session.sessionId);
			}
			session.session.close();
			this.onStateChange();

			// Stream failed before a result: this session is torn down, so draining starts the queued
			// follow-up on a fresh session. Guarded by activeTurns inside drainQueue (no double-start
			// if a replacement turn already took over this id).
			if (streamFailed) await this.drainQueue(session.sessionId);
		}
	}

	private async generateTitleInBackground(
		sessionId: string,
		messageContent: string,
		_cwd: string,
		expectedCurrentTitle: string,
		initialBranchName: string,
		optimisticBranchRename: Promise<string | null>,
	) {
		try {
			const result = await this.generateTitle(messageContent);
			if (result.failureMessage) {
				this.reportBackgroundError?.(
					`[title-generation] session ${sessionId} failed provider title generation: ${result.failureMessage}`,
				);
			}

			if (!result.title || result.usedFallback) return;

			const session = this.store.requireSession(sessionId);
			if (session.title !== expectedCurrentTitle) return;

			await this.store.renameSession(sessionId, result.title);
			const expectedCurrentBranchName = (await optimisticBranchRename) ?? initialBranchName;
			await this.autoRenameWorkspaceBranchFromTitle({
				workspaceId: session.workspaceId,
				branchName: result.title,
				expectedCurrentBranchName,
			});
			this.onStateChange();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.reportBackgroundError?.(
				`[title-generation] session ${sessionId} failed background title generation: ${message}`,
			);
		}
	}

	private async runTurn(active: ActiveTurn) {
		try {
			for await (const event of active.turn.stream) {
				// Once cancelled, stop processing further stream events.
				// cancel() already removed us from activeTurns and notified the UI.
				if (active.cancelRequested) break;

				if (event.type === 'session_token' && event.sessionToken) {
					await this.store.setSessionToken(active.sessionId, event.sessionToken);
					this.onStateChange();
					continue;
				}

				if (!event.entry) continue;
				await this.store.appendMessage(active.sessionId, event.entry);

				if (event.entry.kind === 'system_init') {
					active.status = 'running';
				}

				if (event.entry.kind === 'result') {
					active.hasFinalResult = true;

					if (event.entry.isError && !active.cancelRequested) {
						await this.store.recordTurnFailed(
							active.sessionId,
							event.entry.result || 'Turn failed',
						);
						await this.notifyActiveTurnSettled(active, 'failed');
					} else if (!active.cancelRequested) {
						await this.store.recordTurnFinished(active.sessionId);
						await this.notifyActiveTurnSettled(active, 'success');
					}

					// Remove from activeTurns as soon as the result arrives so the UI
					// transitions to idle immediately. The stream may still be open
					// (e.g. background tasks), but the user should be able to send
					// new messages without having to hit stop first.
					this.activeTurns.delete(active.sessionId);

					// Track the still-open stream so the UI can show a draining
					// indicator and the user can stop background tasks.
					this.drainingStreams.set(active.sessionId, { turn: active.turn });

					// The turn is settled from the UI's perspective even though the stream may keep
					// emitting background output. Drain now so a queued follow-up isn't stuck behind it —
					// but not when a tool-mandated follow-up is pending (it runs first, in the finally, and
					// its own settle drains the queue); draining here would preempt it.
					if (!active.cancelRequested && !active.postToolFollowUp) {
						await this.drainQueue(active.sessionId);
					}
				}

				this.onStateChange();
			}
		} catch (error) {
			if (!active.cancelRequested) {
				const message = error instanceof Error ? error.message : String(error);
				await this.store.appendMessage(
					active.sessionId,
					timestamped({
						kind: 'result',
						subtype: 'error',
						isError: true,
						durationMs: 0,
						result: message,
					}),
				);
				await this.store.recordTurnFailed(active.sessionId, message);
				await this.notifyActiveTurnSettled(active, 'failed');
			}
		} finally {
			if (active.cancelRequested && !active.cancelRecorded) {
				await this.store.recordTurnCancelled(active.sessionId);
				await this.notifyActiveTurnSettled(active, 'cancelled');
			}

			active.turn.close();
			// Only remove if we're still the active turn for this session.
			// We may have already been removed by result handling or cancel(),
			// and a new turn may have started for the same sessionId.
			if (this.activeTurns.get(active.sessionId) === active) {
				this.activeTurns.delete(active.sessionId);
			}

			// Stream has fully ended — no longer draining.
			this.drainingStreams.delete(active.sessionId);
			this.onStateChange();

			if (active.postToolFollowUp && !active.cancelRequested) {
				try {
					await this.startTurnForSession({
						sessionId: active.sessionId,
						provider: active.provider,
						content: active.postToolFollowUp.content,
						attachments: [],
						model: active.model,
						effort: active.effort,
						serviceTier: active.serviceTier,
						planMode: active.postToolFollowUp.planMode,
						appendUserPrompt: false,
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					await this.store.appendMessage(
						active.sessionId,
						timestamped({
							kind: 'result',
							subtype: 'error',
							isError: true,
							durationMs: 0,
							result: message,
						}),
					);

					await this.store.recordTurnFailed(active.sessionId, message);
					await this.notifyActiveTurnSettled(active, 'failed');
					this.onStateChange();
				}
			}

			// Start the next queued message (skipped if a follow-up turn already started or on cancel).
			if (!active.cancelRequested) await this.drainQueue(active.sessionId);
		}
	}

	async cancel(sessionId: string) {
		// Also clean up any draining stream for this session.
		const draining = this.drainingStreams.get(sessionId);
		if (draining) {
			draining.turn.close();
			this.drainingStreams.delete(sessionId);
		}

		// Stop halts everything for this session: drop any queued follow-ups so they don't auto-start,
		// and release their uploaded attachments.
		const droppedQueue = await this.store.dequeueQueuedSessionMessages(sessionId);
		const hadQueue = droppedQueue.length > 0;
		if (hadQueue) this.discardQueuedUploads(sessionId, droppedQueue);

		const active = this.activeTurns.get(sessionId);
		if (!active) {
			if (hadQueue) this.onStateChange();
			return;
		}

		// Guards against double-cancel
		if (active.cancelRequested) return;
		active.cancelRequested = true;
		active.cancelRecorded = true;

		const pendingTool = active.pendingTool;
		active.pendingTool = null;

		if (pendingTool) {
			const result = discardedToolResult(pendingTool.tool);
			await this.store.appendMessage(
				sessionId,
				timestamped({
					kind: 'tool_result',
					toolId: pendingTool.toolUseId,
					content: result,
				}),
			);
			pendingTool.resolve(result);
		}

		await this.store.appendMessage(sessionId, timestamped({ kind: 'interrupted' }));
		await this.store.recordTurnCancelled(sessionId);
		await this.notifyActiveTurnSettled(active, 'cancelled');

		active.hasFinalResult = true;

		// Remove from activeTurns immediately so the UI reflects the cancellation
		// right away, rather than waiting for interrupt() which may hang.
		this.activeTurns.delete(sessionId);
		this.onStateChange();

		// Now attempt to interrupt/close the underlying stream in the background.
		// This is best-effort — the turn is already removed from active state above,
		// and runTurn()'s finally block will also call close().
		try {
			await Promise.race([
				active.turn.interrupt(),
				new Promise((resolve) => setTimeout(resolve, 5_000)),
			]);
		} catch {
			// interrupt() failed — force close
		}
		active.turn.close();
	}

	async respondTool(command: Extract<ClientCommand, { type: 'session.respondTool' }>) {
		const active = this.activeTurns.get(command.sessionId);
		if (!active?.pendingTool) {
			throw new Error('No pending tool request');
		}

		const pending = active.pendingTool;
		if (pending.toolUseId !== command.toolUseId) {
			throw new Error('Tool response does not match active request');
		}

		await this.store.appendMessage(
			command.sessionId,
			timestamped({
				kind: 'tool_result',
				toolId: command.toolUseId,
				content: command.result,
			}),
		);

		active.pendingTool = null;
		active.status = 'running';

		if (pending.tool.toolKind === 'exit_plan_mode') {
			const result = (command.result ?? {}) as {
				confirmed?: boolean;
				clearContext?: boolean;
				message?: string;
			};

			if (result.confirmed && result.clearContext) {
				await this.store.setSessionToken(command.sessionId, null);
				await this.store.appendMessage(command.sessionId, timestamped({ kind: 'context_cleared' }));
			}

			if (active.provider === 'codex') {
				active.postToolFollowUp = result.confirmed
					? {
							content: result.message
								? `Proceed with the approved plan. Additional guidance: ${result.message}`
								: 'Proceed with the approved plan.',
							planMode: false,
						}
					: {
							content: result.message
								? `Revise the plan using this feedback: ${result.message}`
								: 'Revise the plan using this feedback.',
							planMode: true,
						};
			}
		}

		pending.resolve(command.result);
		this.onStateChange();
	}
}
