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
	TranscriptEntry,
} from '../shared/types';
import { CodexAppServerManager } from './codex-app-server';
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

interface AgentCoordinatorArgs {
	store: EventStore;
	onStateChange: () => void;
	onTurnSettled?: (event: {
		sessionId: string;
		outcome: 'success' | 'failed' | 'cancelled';
	}) => void | Promise<void>;
	codexManager?: CodexAppServerManager;
	generateTitle?: (messageContent: string) => Promise<GenerateSessionTitleResult>;
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
	private readonly startClaudeSessionFn: NonNullable<AgentCoordinatorArgs['startClaudeSession']>;
	private reportBackgroundError: ((message: string) => void) | null = null;
	readonly activeTurns = new Map<string, ActiveTurn>();
	readonly drainingStreams = new Map<string, { turn: HarnessTurn }>();
	readonly claudeSessions = new Map<string, ClaudeSessionState>();

	constructor(args: AgentCoordinatorArgs) {
		this.store = args.store;
		this.onStateChange = args.onStateChange;
		this.onTurnSettled = args.onTurnSettled ?? null;
		this.codexManager = args.codexManager ?? new CodexAppServerManager();
		this.generateTitle = args.generateTitle ?? generateTitleForSessionDetailed;
		this.startClaudeSessionFn = args.startClaudeSession ?? startClaudeSession;
	}

	setBackgroundErrorReporter(report: ((message: string) => void) | null) {
		this.reportBackgroundError = report;
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
		return { toolUseId: pending.toolUseId, toolKind: pending.tool.toolKind };
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

		const existingMessages = this.store.getMessages(args.sessionId);
		const shouldGenerateTitle =
			args.appendUserPrompt && session.title === 'Untitled' && existingMessages.length === 0;

		const optimisticTitle = shouldGenerateTitle ? fallbackTitleFromMessage(args.content) : null;

		if (optimisticTitle) {
			await this.store.renameSession(args.sessionId, optimisticTitle);
		}

		const workspace = this.store.getWorkspace(session.workspaceId);
		if (!workspace) {
			throw new Error('Workspace not found');
		}

		if (args.appendUserPrompt) {
			const userPromptEntry = timestamped(
				{ kind: 'user_prompt', content: args.content, attachments: args.attachments },
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

		const session = this.store.requireSession(sessionId);
		const provider = this.resolveProvider(command, session.provider);
		const settings = this.getProviderSettings(provider, command);

		await this.startTurnForSession({
			sessionId,
			provider,
			content: command.content,
			attachments: command.attachments ?? [],
			model: settings.model,
			effort: settings.effort,
			contextWindow: settings.contextWindow,
			serviceTier: settings.serviceTier,
			planMode: settings.planMode,
			appendUserPrompt: true,
		});

		return { sessionId };
	}

	private async runClaudeSession(session: ClaudeSessionState) {
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
				}

				this.onStateChange();
			}
		} catch (error) {
			const active = this.activeTurns.get(session.sessionId);
			if (active && !active.cancelRequested) {
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
		}
	}

	private async generateTitleInBackground(
		sessionId: string,
		messageContent: string,
		_cwd: string,
		expectedCurrentTitle: string,
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
		}
	}

	async cancel(sessionId: string) {
		// Also clean up any draining stream for this session.
		const draining = this.drainingStreams.get(sessionId);
		if (draining) {
			draining.turn.close();
			this.drainingStreams.delete(sessionId);
		}

		const active = this.activeTurns.get(sessionId);
		if (!active) return;

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
