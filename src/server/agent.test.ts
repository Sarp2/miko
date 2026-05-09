import { describe, expect, test } from 'bun:test';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { ChatAttachment } from '../shared/types';
import {
	AgentCoordinator,
	buildPromptText,
	createClaudeHarnessStream,
	normalizeClaudeStreamMessage,
	startClaudeSession,
} from './agent';
import type { HarnessEvent } from './harness-types';

function makeAttachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
	return {
		id: 'att-1',
		kind: 'file',
		displayName: 'notes.md',
		absolutePath: '/tmp/notes.md',
		relativePath: 'notes.md',
		contentUrl: 'file:///tmp/notes.md',
		mimeType: 'text/markdown',
		size: 42,
		...overrides,
	};
}

function fakeQuery(messages: unknown[]): Query {
	return (async function* () {
		for (const m of messages) yield m;
	})() as unknown as Query;
}

async function collect(stream: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
	const out: HarnessEvent[] = [];
	for await (const event of stream) out.push(event);
	return out;
}

function createQueryStub(messages: unknown[] = []) {
	const calls: Array<{ prompt: AsyncIterable<unknown>; options: Record<string, unknown> }> = [];
	const state = {
		interruptCalls: 0,
		setModelCalls: [] as string[],
		setPermissionModeCalls: [] as string[],
		closeCalls: 0,
	};

	const queryFn = ((args: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
		calls.push(args);
		return Object.assign(
			(async function* () {
				for (const message of messages) {
					yield message;
				}
			})(),
			{
				accountInfo: async () => ({ ok: true }),
				interrupt: async () => {
					state.interruptCalls += 1;
				},
				setModel: async (model: string) => {
					state.setModelCalls.push(model);
				},
				setPermissionMode: async (mode: string) => {
					state.setPermissionModeCalls.push(mode);
				},
				close: () => {
					state.closeCalls += 1;
				},
			},
		) as unknown as Query;
	}) as typeof import('@anthropic-ai/claude-agent-sdk').query;

	return { queryFn, calls, state };
}

function createCoordinator(
	options:
		| {
				onStateChange?: () => void;
				store?: any;
		  }
		| (() => void) = {},
) {
	const normalized =
		typeof options === 'function' ? { onStateChange: options, store: {} as any } : options;
	const { onStateChange = () => {}, store = {} as any } = normalized;
	return new AgentCoordinator({
		store,
		onStateChange,
		codexManager: {} as any,
	});
}

describe('buildPromptText', () => {
	test('returns trimmed content when there are no attachments', () => {
		expect(buildPromptText('  hello world  ', [])).toBe('hello world');
	});

	test('appends an attachment hint block after the user content', () => {
		const result = buildPromptText('look at this', [makeAttachment()]);

		expect(result.startsWith('look at this\n\n<miko-attachments>')).toBe(true);
		expect(result).toContain('path="/tmp/notes.md"');
		expect(result).toContain('project_path="notes.md"');
		expect(result).toContain('size_bytes="42"');
		expect(result.endsWith('</miko-attachments>')).toBe(true);
	});

	test('escapes XML-significant characters in attachment fields', () => {
		const result = buildPromptText('hi', [
			makeAttachment({ displayName: 'a"b<c>&d', relativePath: 'sub/"weird".md' }),
		]);

		expect(result).toContain('display_name="a&quot;b&lt;c&gt;&amp;d"');
		expect(result).toContain('project_path="sub/&quot;weird&quot;.md"');
		expect(result).not.toContain('a"b<c>&d');
	});
});

describe('normalizeClaudeStreamMessage', () => {
	test('fans an assistant message into separate text and tool_call entries', () => {
		const entries = normalizeClaudeStreamMessage({
			type: 'assistant',
			uuid: 'msg-1',
			message: {
				content: [
					{ type: 'text', text: 'thinking...' },
					{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/x' } },
				],
			},
		});

		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({
			kind: 'assistant_text',
			text: 'thinking...',
			messageId: 'msg-1',
		});
		expect(entries[1]).toMatchObject({ kind: 'tool_call', messageId: 'msg-1' });
	});

	test('maps a tool_result block to a tool_result entry', () => {
		const entries = normalizeClaudeStreamMessage({
			type: 'user',
			uuid: 'msg-2',
			message: {
				content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok', is_error: false }],
			},
		});

		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			kind: 'tool_result',
			toolId: 'tool-1',
			content: 'ok',
			isError: false,
		});
	});

	test('maps a successful result message with cost and duration', () => {
		const entries = normalizeClaudeStreamMessage({
			type: 'result',
			subtype: 'success',
			is_error: false,
			duration_ms: 1234,
			result: 'done',
			total_cost_usd: 0.05,
		});

		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			kind: 'result',
			subtype: 'success',
			isError: false,
			durationMs: 1234,
			result: 'done',
			costUsd: 0.05,
		});
	});

	test('maps a cancelled result to an interrupted entry', () => {
		const entries = normalizeClaudeStreamMessage({ type: 'result', subtype: 'cancelled' });

		expect(entries).toHaveLength(1);
		expect(entries[0]?.kind).toBe('interrupted');
	});
});

describe('createClaudeHarnessStream', () => {
	test('emits a session_token event whenever a message has a session_id', async () => {
		const events = await collect(
			createClaudeHarnessStream(fakeQuery([{ session_id: 'sess-1', type: 'unknown' }])),
		);

		expect(events).toEqual([{ type: 'session_token', sessionToken: 'sess-1' }]);
	});

	test('dedupes assistant usage snapshots by message id', async () => {
		const assistant = {
			type: 'assistant',
			message: { id: 'asst-1', content: [] },
			usage: { input_tokens: 10, output_tokens: 5 },
		};
		const events = await collect(createClaudeHarnessStream(fakeQuery([assistant, assistant])));

		const usageEvents = events.filter(
			(e) => e.type === 'transcript' && e.entry?.kind === 'context_window_updated',
		);
		expect(usageEvents).toHaveLength(1);
	});

	test('on result, yields a final usage entry stamped with maxTokens from modelUsage', async () => {
		const events = await collect(
			createClaudeHarnessStream(
				fakeQuery([
					{
						type: 'result',
						subtype: 'success',
						is_error: false,
						duration_ms: 100,
						result: 'ok',
						usage: { input_tokens: 20, output_tokens: 10 },
						modelUsage: { 'claude-opus-4-7': { contextWindow: 200000 } },
					},
				]),
			),
		);

		const usage = events.find(
			(e) => e.type === 'transcript' && e.entry?.kind === 'context_window_updated',
		);
		expect(usage?.entry?.kind).toBe('context_window_updated');
		if (usage?.entry?.kind === 'context_window_updated') {
			expect(usage.entry.usage.maxTokens).toBe(200000);
			expect(usage.entry.usage.usedTokens).toBe(30);
		}
	});
});

describe('startClaudeSession', () => {
	test('configures query options and forwards prompt messages', async () => {
		const stub = createQueryStub();
		const onToolRequest = async () => ({});
		const session = await startClaudeSession(
			{
				localPath: '/tmp/project',
				model: 'claude-opus-4-1',
				effort: 'high',
				planMode: true,
				sessionToken: 'sess-123',
				onToolRequest,
			},
			{ queryFn: stub.queryFn },
		);

		expect(stub.calls).toHaveLength(1);
		expect(stub.calls[0]?.options).toMatchObject({
			cwd: '/tmp/project',
			model: 'claude-opus-4-1',
			effort: 'high',
			resume: 'sess-123',
			permissionMode: 'plan',
		});

		const promptIterator = stub.calls[0]!.prompt[Symbol.asyncIterator]();
		await session.sendPrompt('hello');
		const sent = await promptIterator.next();

		expect(sent.value).toMatchObject({
			type: 'user',
			message: { role: 'user', content: 'hello' },
			parent_tool_use_id: null,
			session_id: 'sess-123',
		});

		await session.interrupt();
		await session.setModel('claude-sonnet-4-5');
		await session.setPermissionMode(false);
		session.close();

		expect(stub.state.interruptCalls).toBe(1);
		expect(stub.state.setModelCalls).toEqual(['claude-sonnet-4-5']);
		expect(stub.state.setPermissionModeCalls).toEqual(['acceptEdits']);
		expect(stub.state.closeCalls).toBe(1);

		const afterClose = await promptIterator.next();
		expect(afterClose.done).toBe(true);
	});

	test('canUseTool allows AskUserQuestion and injects answers from onToolRequest', async () => {
		const stub = createQueryStub();
		const session = await startClaudeSession(
			{
				localPath: '/tmp/project',
				model: 'claude-opus-4-1',
				planMode: false,
				sessionToken: null,
				onToolRequest: async () => ({
					questions: [{ id: 'q1', question: 'Proceed?' }],
					answers: { q1: 'yes' },
				}),
			},
			{ queryFn: stub.queryFn },
		);

		const canUseTool = stub.calls[0]?.options.canUseTool as (
			toolName: string,
			input: unknown,
			options: { toolUseID: string },
		) => Promise<Record<string, unknown>>;

		const result = await canUseTool(
			'AskUserQuestion',
			{ questions: [{ id: 'fallback', question: 'Fallback?' }] },
			{ toolUseID: 'tool-1' },
		);

		expect(result).toMatchObject({
			behavior: 'allow',
			updatedInput: {
				questions: [{ id: 'q1', question: 'Proceed?' }],
				answers: { q1: 'yes' },
			},
		});

		session.close();
	});

	test('canUseTool denies ExitPlanMode when user does not confirm', async () => {
		const stub = createQueryStub();
		const session = await startClaudeSession(
			{
				localPath: '/tmp/project',
				model: 'claude-opus-4-1',
				planMode: false,
				sessionToken: null,
				onToolRequest: async () => ({ confirmed: false, message: 'need one edit' }),
			},
			{ queryFn: stub.queryFn },
		);

		const canUseTool = stub.calls[0]?.options.canUseTool as (
			toolName: string,
			input: unknown,
			options: { toolUseID: string },
		) => Promise<Record<string, unknown>>;

		const denied = await canUseTool('ExitPlanMode', {}, { toolUseID: 'tool-2' });
		expect(denied).toMatchObject({
			behavior: 'deny',
			message: 'User wants to suggest edits to the plan: need one edit',
		});

		const passthrough = await canUseTool('Bash', { command: 'pwd' }, { toolUseID: 'tool-3' });
		expect(passthrough).toMatchObject({
			behavior: 'allow',
			updatedInput: { command: 'pwd' },
		});

		session.close();
	});
});

describe('AgentCoordinator.getActiveStatuses', () => {
	test('returns an empty map when there are no active turns', () => {
		const coordinator = createCoordinator();
		expect(Array.from(coordinator.getActiveStatuses().entries())).toEqual([]);
	});

	test('returns statuses for all active chat turns', () => {
		const coordinator = createCoordinator();
		coordinator.activeTurns.set('chat-1', { status: 'running' } as any);
		coordinator.activeTurns.set('chat-2', { status: 'waiting_for_user' } as any);

		expect(Array.from(coordinator.getActiveStatuses().entries())).toEqual([
			['chat-1', 'running'],
			['chat-2', 'waiting_for_user'],
		]);
	});
});

describe('AgentCoordinator.getPendingTool', () => {
	test('returns null when chat has no active turn', () => {
		const coordinator = createCoordinator();
		expect(coordinator.getPendingTool('chat-1')).toBeNull();
	});

	test('returns toolUseId and toolKind from pending tool snapshot', () => {
		const coordinator = createCoordinator();
		coordinator.activeTurns.set('chat-1', {
			pendingTool: {
				toolUseId: 'tool-123',
				tool: {
					toolKind: 'ask_user_question',
				},
				resolve: () => {},
			},
		} as any);

		expect(coordinator.getPendingTool('chat-1')).toEqual({
			toolUseId: 'tool-123',
			toolKind: 'ask_user_question',
		});
	});
});

describe('AgentCoordinator.stopDraining', () => {
	test('is a no-op when chat has no draining stream', async () => {
		let stateChanges = 0;
		const coordinator = createCoordinator(() => {
			stateChanges += 1;
		});

		await coordinator.stopDraining('chat-1');

		expect(stateChanges).toBe(0);
	});

	test('closes draining turn, removes it, and notifies state change', async () => {
		let stateChanges = 0;
		let closed = 0;
		const coordinator = createCoordinator(() => {
			stateChanges += 1;
		});

		coordinator.drainingStreams.set('chat-1', {
			turn: {
				close: () => {
					closed += 1;
				},
			} as any,
		});

		await coordinator.stopDraining('chat-1');

		expect(closed).toBe(1);
		expect(coordinator.drainingStreams.has('chat-1')).toBe(false);
		expect(stateChanges).toBe(1);
	});
});

describe('AgentCoordinator.closeChat', () => {
	test('still notifies state change when there is nothing to close', async () => {
		let stateChanges = 0;
		const coordinator = createCoordinator(() => {
			stateChanges += 1;
		});

		await coordinator.closeChat('chat-1');

		expect(stateChanges).toBe(1);
	});

	test('closes draining turn and Claude session, removes both from maps', async () => {
		let stateChanges = 0;
		let drainingClosed = 0;
		let sessionClosed = 0;
		const coordinator = createCoordinator(() => {
			stateChanges += 1;
		});

		coordinator.drainingStreams.set('chat-1', {
			turn: {
				close: () => {
					drainingClosed += 1;
				},
			} as any,
		});

		coordinator.claudeSessions.set('chat-1', {
			chatId: 'chat-1',
			session: {
				close: () => {
					sessionClosed += 1;
				},
			},
		} as any);

		await coordinator.closeChat('chat-1');

		expect(drainingClosed).toBe(1);
		expect(sessionClosed).toBe(1);

		expect(coordinator.drainingStreams.has('chat-1')).toBe(false);
		expect(coordinator.claudeSessions.has('chat-1')).toBe(false);
		expect(stateChanges).toBe(2);
	});
});

describe('AgentCoordinator.send', () => {
	test('throws when creating a new chat without projectId', async () => {
		const coordinator = createCoordinator();

		await expect(
			coordinator.send({
				type: 'chat.send',
				content: 'hello',
				modelOptions: {},
			} as any),
		).rejects.toThrow('Missing projectId for new chat');
	});

	test('creates a chat when chatId is missing and forwards payload to startTurnForChat', async () => {
		const store = {
			createChat: async (_projectId: string) => ({ id: 'chat-1' }),
			requireChat: (_chatId: string) => ({ provider: null }),
		};

		const coordinator = createCoordinator({ store });
		let startArgs: any = null;

		(coordinator as any).startTurnForChat = async (args: any) => {
			startArgs = args;
		};

		const result = await coordinator.send({
			type: 'chat.send',
			projectId: 'project-1',
			content: 'ship it',
			modelOptions: {},
		} as any);

		expect(result).toEqual({ chatId: 'chat-1' });
		expect(startArgs).toMatchObject({
			chatId: 'chat-1',
			provider: 'claude',
			content: 'ship it',
			attachments: [],
			appendUserPrompt: true,
		});
	});
});

describe('AgentCoordinator.respondTool', () => {
	test('records tool_result, clears pending tool, sets running, and resolves pending promise', async () => {
		const appended: any[] = [];
		const store = {
			appendMessage: async (_chatId: string, entry: any) => {
				appended.push(entry);
			},
		};

		let stateChanges = 0;
		let resolvedValue: unknown = null;
		const coordinator = createCoordinator({
			store,
			onStateChange: () => {
				stateChanges += 1;
			},
		});

		coordinator.activeTurns.set('chat-1', {
			status: 'waiting_for_user',
			provider: 'claude',
			pendingTool: {
				toolUseId: 'tool-1',
				tool: { toolKind: 'ask_user_question' },
				resolve: (value: unknown) => {
					resolvedValue = value;
				},
			},
		} as any);

		await coordinator.respondTool({
			type: 'chat.respondTool',
			chatId: 'chat-1',
			toolUseId: 'tool-1',
			result: { answers: { q1: 'yes' } },
		} as any);

		expect(appended).toHaveLength(1);
		expect(appended[0]).toMatchObject({
			kind: 'tool_result',
			toolId: 'tool-1',
			content: { answers: { q1: 'yes' } },
		});

		expect(coordinator.activeTurns.get('chat-1')?.pendingTool).toBeNull();
		expect(coordinator.activeTurns.get('chat-1')?.status).toBe('running');

		expect(resolvedValue).toEqual({ answers: { q1: 'yes' } });
		expect(stateChanges).toBe(1);
	});

	test('for codex exit_plan_mode confirmed+clearContext, clears session and prepares follow-up', async () => {
		const appended: any[] = [];
		const clearedTokens: Array<{ chatId: string; token: string | null }> = [];

		const store = {
			appendMessage: async (_chatId: string, entry: any) => {
				appended.push(entry);
			},
			setSessionToken: async (chatId: string, token: string | null) => {
				clearedTokens.push({ chatId, token });
			},
		};

		const coordinator = createCoordinator({ store });

		coordinator.activeTurns.set('chat-2', {
			status: 'waiting_for_user',
			provider: 'codex',
			pendingTool: {
				toolUseId: 'tool-2',
				tool: { toolKind: 'exit_plan_mode' },
				resolve: () => {},
			},
		} as any);

		await coordinator.respondTool({
			type: 'chat.respondTool',
			chatId: 'chat-2',
			toolUseId: 'tool-2',
			result: {
				confirmed: true,
				clearContext: true,
				message: 'Ship with small refactor',
			},
		} as any);

		expect(clearedTokens).toEqual([{ chatId: 'chat-2', token: null }]);
		expect(appended.some((entry) => entry.kind === 'context_cleared')).toBe(true);

		expect(coordinator.activeTurns.get('chat-2')?.postToolFollowUp).toEqual({
			content: 'Proceed with the approved plan. Additional guidance: Ship with small refactor',
			planMode: false,
		});
	});
});

describe('AgentCoordinator.cancel', () => {
	test('cancels an active turn, records interruption/cancel, and closes the turn', async () => {
		const appended: any[] = [];
		let cancelledCount = 0;

		const store = {
			appendMessage: async (_chatId: string, entry: any) => {
				appended.push(entry);
			},
			recordTurnCancelled: async () => {
				cancelledCount += 1;
			},
		};

		let stateChanges = 0;
		let interruptCalls = 0;
		let closeCalls = 0;
		let pendingResolved = false;

		const coordinator = createCoordinator({
			store,
			onStateChange: () => {
				stateChanges += 1;
			},
		});

		coordinator.activeTurns.set('chat-1', {
			chatId: 'chat-1',
			provider: 'claude',
			pendingTool: {
				toolUseId: 'tool-1',
				tool: { toolKind: 'ask_user_question' },
				resolve: () => {
					pendingResolved = true;
				},
			},
			cancelRequested: false,
			cancelRecorded: false,
			hasFinalResult: false,
			turn: {
				interrupt: async () => {
					interruptCalls += 1;
				},
				close: () => {
					closeCalls += 1;
				},
			},
		} as any);

		await coordinator.cancel('chat-1');

		expect(cancelledCount).toBe(1);
		expect(interruptCalls).toBe(1);
		expect(closeCalls).toBe(1);
		expect(stateChanges).toBe(1);

		expect(coordinator.activeTurns.has('chat-1')).toBe(false);
		expect(pendingResolved).toBe(false);

		expect(appended.map((entry) => entry.kind)).toEqual(['tool_result', 'interrupted']);
		expect(appended[0]).toMatchObject({
			kind: 'tool_result',
			toolId: 'tool-1',
			content: { discarded: true, answers: {} },
		});
	});

	test('resolves discarded pending exit_plan_mode tool for codex provider', async () => {
		const store = {
			appendMessage: async () => {},
			recordTurnCancelled: async () => {},
		};
		let resolvedValue: unknown = null;
		const coordinator = createCoordinator({ store });

		coordinator.activeTurns.set('chat-2', {
			chatId: 'chat-2',
			provider: 'codex',
			pendingTool: {
				toolUseId: 'tool-2',
				tool: { toolKind: 'exit_plan_mode' },
				resolve: (value: unknown) => {
					resolvedValue = value;
				},
			},
			cancelRequested: false,
			cancelRecorded: false,
			hasFinalResult: false,
			turn: {
				interrupt: async () => {},
				close: () => {},
			},
		} as any);

		await coordinator.cancel('chat-2');

		expect(resolvedValue).toEqual({ discarded: true });
	});
});
