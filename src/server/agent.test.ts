import { describe, expect, test } from 'bun:test';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { ChatAttachment, TranscriptEntry } from '../shared/types';
import {
	AgentCoordinator,
	buildPromptText,
	createClaudeHarnessStream,
	normalizeClaudeStreamMessage,
	startClaudeSession,
} from './agent';
import type { CodexAppServerManager } from './codex-app-server';
import type { EventStore } from './event-store';
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

type ActiveTurnFixture = Parameters<AgentCoordinator['activeTurns']['set']>[1];
type DrainingStreamFixture = Parameters<AgentCoordinator['drainingStreams']['set']>[1];
type ClaudeSessionFixture = Parameters<AgentCoordinator['claudeSessions']['set']>[1];
type SendCommandFixture = Parameters<AgentCoordinator['send']>[0];
type RespondToolCommandFixture = Parameters<AgentCoordinator['respondTool']>[0];
type StartTurnForSessionArgsFixture = {
	sessionId: string;
	provider: 'claude' | 'codex';
	content: string;
	attachments: ChatAttachment[];
	modelOptions: Record<string, unknown>;
	planMode?: boolean;
	appendUserPrompt?: boolean;
};

function activeTurnFixture(overrides: Record<string, unknown>): ActiveTurnFixture {
	return overrides as unknown as ActiveTurnFixture;
}

function createCoordinator(
	options:
		| {
				onStateChange?: () => void;
				store?: unknown;
				codexManager?: unknown;
				generateTitle?: (messageContent: string) => Promise<unknown>;
				renameWorkspaceBranch?: (args: {
					workspaceId: string;
					branchName: string;
					expectedCurrentBranchName?: string;
				}) => Promise<{ branchName: string; changed: boolean }>;
		  }
		| (() => void) = {},
) {
	const normalized =
		typeof options === 'function' ? { onStateChange: options, store: {} as unknown } : options;
	const {
		onStateChange = () => {},
		store = {},
		codexManager = {} as CodexAppServerManager,
		generateTitle,
		renameWorkspaceBranch,
	} = normalized;
	return new AgentCoordinator({
		store: store as EventStore,
		onStateChange,
		codexManager: codexManager as CodexAppServerManager,
		generateTitle: generateTitle as ConstructorParameters<
			typeof AgentCoordinator
		>[0]['generateTitle'],
		renameWorkspaceBranch,
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

		const firstCall = stub.calls[0];
		if (!firstCall) throw new Error('Expected query to be invoked once');
		const promptIterator = firstCall.prompt[Symbol.asyncIterator]();
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

	test('returns statuses for all active session turns', () => {
		const coordinator = createCoordinator();
		coordinator.activeTurns.set('session-1', activeTurnFixture({ status: 'running' }));
		coordinator.activeTurns.set('session-2', activeTurnFixture({ status: 'waiting_for_user' }));

		expect(Array.from(coordinator.getActiveStatuses().entries())).toEqual([
			['session-1', 'running'],
			['session-2', 'waiting_for_user'],
		]);
	});
});

describe('AgentCoordinator.getPendingTool', () => {
	test('returns null when session has no active turn', () => {
		const coordinator = createCoordinator();
		expect(coordinator.getPendingTool('session-1')).toBeNull();
	});

	test('returns toolUseId, kind, and payload from a pending ask_user_question', () => {
		const coordinator = createCoordinator();
		coordinator.activeTurns.set(
			'session-1',
			activeTurnFixture({
				pendingTool: {
					toolUseId: 'tool-123',
					tool: {
						toolKind: 'ask_user_question',
						input: { questions: [{ question: 'Pick one', options: [{ label: 'A' }] }] },
					},
					resolve: () => {},
				},
			}),
		);

		expect(coordinator.getPendingTool('session-1')).toEqual({
			toolUseId: 'tool-123',
			toolKind: 'ask_user_question',
			questions: [{ question: 'Pick one', options: [{ label: 'A' }] }],
		});
	});

	test('returns plan and summary from a pending exit_plan_mode', () => {
		const coordinator = createCoordinator();
		coordinator.activeTurns.set(
			'session-1',
			activeTurnFixture({
				pendingTool: {
					toolUseId: 'tool-9',
					tool: {
						toolKind: 'exit_plan_mode',
						input: { plan: 'Step 1\nStep 2', summary: 'Two steps' },
					},
					resolve: () => {},
				},
			}),
		);

		expect(coordinator.getPendingTool('session-1')).toEqual({
			toolUseId: 'tool-9',
			toolKind: 'exit_plan_mode',
			plan: 'Step 1\nStep 2',
			summary: 'Two steps',
		});
	});
});

describe('AgentCoordinator.listCommands', () => {
	const workspaceStore = (provider: 'claude' | 'codex' | null) => ({
		getSession: () => ({ provider, workspaceId: 'workspace-1' }),
		getWorkspace: () => ({ id: 'workspace-1', localPath: '/repo/atlas' }),
	});

	test('returns [] when the session does not exist', async () => {
		const coordinator = createCoordinator({ store: { getSession: () => undefined } });
		expect(await coordinator.listCommands('session-1', 'claude')).toEqual([]);
	});

	test('enumerates Claude commands from a live session', async () => {
		const commands = [{ name: 'review', description: 'Review the diff' }];
		const coordinator = createCoordinator({ store: workspaceStore('claude') });
		coordinator.claudeSessions.set('session-1', {
			sessionId: 'session-1',
			session: { getCommands: async () => commands },
		} as ClaudeSessionFixture);

		expect(await coordinator.listCommands('session-1', 'claude')).toEqual(commands);
	});

	test('enumerates Codex skills via a throwaway app-server', async () => {
		const skills = [{ name: 'draftpr', description: 'Draft a PR' }];
		const coordinator = createCoordinator({
			store: workspaceStore('codex'),
			codexManager: { enumerateSkills: async () => skills },
		});

		expect(await coordinator.listCommands('session-1', 'codex')).toEqual(skills);
	});

	test('serves the cached list on repeat calls without re-enumerating', async () => {
		let calls = 0;
		const coordinator = createCoordinator({
			store: workspaceStore('codex'),
			codexManager: {
				enumerateSkills: async () => {
					calls += 1;
					return [{ name: 'draftpr' }];
				},
			},
		});

		await coordinator.listCommands('session-1', 'codex');
		await coordinator.listCommands('session-1', 'codex');
		expect(calls).toBe(1);
	});
});

describe('AgentCoordinator queue', () => {
	const sendCommand = (content: string) =>
		({
			type: 'session.send',
			sessionId: 'session-1',
			content,
			modelOptions: {},
		}) as unknown as SendCommandFixture;

	test('queues a send while a turn is active instead of starting it', async () => {
		const coordinator = createCoordinator({
			store: { requireSession: () => ({ provider: 'claude' }) },
		});
		coordinator.activeTurns.set('session-1', activeTurnFixture({}));

		const result = await coordinator.send(sendCommand('do this next'));

		expect(result).toEqual({ sessionId: 'session-1' });
		expect(coordinator.getQueuedMessages('session-1')).toEqual([
			{ id: expect.any(String), content: 'do this next', attachmentCount: 0 },
		]);
	});

	test('dequeueMessage drops a queued message by id', async () => {
		const coordinator = createCoordinator({
			store: { requireSession: () => ({ provider: 'claude' }) },
		});
		coordinator.activeTurns.set('session-1', activeTurnFixture({}));
		await coordinator.send(sendCommand('one'));
		await coordinator.send(sendCommand('two'));

		const [first] = coordinator.getQueuedMessages('session-1');
		coordinator.dequeueMessage('session-1', first.id);

		expect(coordinator.getQueuedMessages('session-1').map((m) => m.content)).toEqual(['two']);
	});

	test('cancel clears the queue so nothing auto-starts', async () => {
		let stateChanges = 0;
		const coordinator = createCoordinator({
			store: { requireSession: () => ({ provider: 'claude' }) },
			onStateChange: () => {
				stateChanges += 1;
			},
		});
		coordinator.activeTurns.set('session-1', activeTurnFixture({}));
		await coordinator.send(sendCommand('queued'));
		coordinator.activeTurns.delete('session-1');

		await coordinator.cancel('session-1');

		expect(coordinator.getQueuedMessages('session-1')).toEqual([]);
		expect(stateChanges).toBeGreaterThan(0);
	});

	test('drains queued messages FIFO, one at a time as each turn settles', async () => {
		const started: string[] = [];
		const coordinator = createCoordinator({
			store: { requireSession: () => ({ provider: 'claude' }) },
		});
		// Replace the real turn start with a recorder that marks the session active, so we can observe
		// the drain ordering without a live harness.
		(
			coordinator as unknown as {
				startQueuedOrDirect: (command: { sessionId: string; content: string }) => Promise<void>;
			}
		).startQueuedOrDirect = async (command) => {
			started.push(command.content);
			coordinator.activeTurns.set(command.sessionId, activeTurnFixture({}));
		};
		const drain = () =>
			(coordinator as unknown as { drainQueue: (sessionId: string) => Promise<void> }).drainQueue(
				'session-1',
			);

		coordinator.activeTurns.set('session-1', activeTurnFixture({}));
		await coordinator.send(sendCommand('first'));
		await coordinator.send(sendCommand('second'));

		// Turn active → nothing drains.
		await drain();
		expect(started).toEqual([]);

		// First settles → first starts; second still waits while first runs.
		coordinator.activeTurns.delete('session-1');
		await drain();
		expect(started).toEqual(['first']);
		await drain();
		expect(started).toEqual(['first']);

		// First settles → second starts, preserving order.
		coordinator.activeTurns.delete('session-1');
		await drain();
		expect(started).toEqual(['first', 'second']);
		expect(coordinator.getQueuedMessages('session-1')).toEqual([]);
	});

	test('rejects sends beyond the per-session queue cap', async () => {
		const coordinator = createCoordinator({
			store: { requireSession: () => ({ provider: 'claude' }) },
		});
		coordinator.activeTurns.set('session-1', activeTurnFixture({}));
		for (let i = 0; i < 25; i++) await coordinator.send(sendCommand(`m${i}`));

		await expect(coordinator.send(sendCommand('overflow'))).rejects.toThrow('Too many queued');
		expect(coordinator.getQueuedMessages('session-1')).toHaveLength(25);
	});

	test('releases uploaded attachments when a queued message is dropped', async () => {
		const released: string[] = [];
		const coordinator = createCoordinator({
			store: { requireSession: () => ({ provider: 'claude' }) },
		});
		coordinator.setUploadCleanup((attachments) => {
			for (const attachment of attachments) released.push(attachment.id);
		});
		coordinator.activeTurns.set('session-1', activeTurnFixture({}));
		await coordinator.send({
			...sendCommand('with file'),
			attachments: [makeAttachment({ id: 'up-1' })],
		} as SendCommandFixture);

		const [queued] = coordinator.getQueuedMessages('session-1');
		coordinator.dequeueMessage('session-1', queued.id);

		expect(released).toEqual(['up-1']);
	});
});

describe('AgentCoordinator.stopDraining', () => {
	test('is a no-op when session has no draining stream', async () => {
		let stateChanges = 0;
		const coordinator = createCoordinator(() => {
			stateChanges += 1;
		});

		await coordinator.stopDraining('session-1');

		expect(stateChanges).toBe(0);
	});

	test('closes draining turn, removes it, and notifies state change', async () => {
		let stateChanges = 0;
		let closed = 0;
		const coordinator = createCoordinator(() => {
			stateChanges += 1;
		});

		coordinator.drainingStreams.set('session-1', {
			turn: {
				close: () => {
					closed += 1;
				},
			} as DrainingStreamFixture['turn'],
		});

		await coordinator.stopDraining('session-1');

		expect(closed).toBe(1);
		expect(coordinator.drainingStreams.has('session-1')).toBe(false);
		expect(stateChanges).toBe(1);
	});
});

describe('AgentCoordinator.closeSession', () => {
	test('still notifies state change when there is nothing to close', async () => {
		let stateChanges = 0;
		const coordinator = createCoordinator(() => {
			stateChanges += 1;
		});

		await coordinator.closeSession('session-1');

		expect(stateChanges).toBe(1);
	});

	test('closes draining turn and Claude session, removes both from maps', async () => {
		let stateChanges = 0;
		let drainingClosed = 0;
		let sessionClosed = 0;
		const coordinator = createCoordinator(() => {
			stateChanges += 1;
		});

		coordinator.drainingStreams.set('session-1', {
			turn: {
				close: () => {
					drainingClosed += 1;
				},
			} as DrainingStreamFixture['turn'],
		});

		coordinator.claudeSessions.set('session-1', {
			sessionId: 'session-1',
			session: {
				close: () => {
					sessionClosed += 1;
				},
			},
		} as ClaudeSessionFixture);

		await coordinator.closeSession('session-1');

		expect(drainingClosed).toBe(1);
		expect(sessionClosed).toBe(1);

		expect(coordinator.drainingStreams.has('session-1')).toBe(false);
		expect(coordinator.claudeSessions.has('session-1')).toBe(false);
		expect(stateChanges).toBe(2);
	});
});

describe('AgentCoordinator.runClaudeSession', () => {
	function emptyStreamSession(sessionId: string): ClaudeSessionFixture {
		return {
			sessionId,
			session: {
				stream: (async function* () {})(),
				close: () => {},
			},
		} as unknown as ClaudeSessionFixture;
	}

	function runClaudeSession(coordinator: AgentCoordinator, session: ClaudeSessionFixture) {
		return (
			coordinator as unknown as {
				runClaudeSession: (session: ClaudeSessionFixture) => Promise<void>;
			}
		).runClaudeSession(session);
	}

	test('keeps a replacement session and its active turn under the same id', async () => {
		const coordinator = createCoordinator();
		const replacement = emptyStreamSession('session-1');
		const newTurn = activeTurnFixture({ provider: 'claude', claudeSession: replacement });
		// Simulate a 200k<->1M switch having already swapped in a fresh session and turn.
		coordinator.claudeSessions.set('session-1', replacement);
		coordinator.activeTurns.set('session-1', newTurn);

		await runClaudeSession(coordinator, emptyStreamSession('session-1'));

		expect(coordinator.claudeSessions.get('session-1')).toBe(replacement);
		expect(coordinator.activeTurns.get('session-1')).toBe(newTurn);
	});

	test('evicts its own session and active turn when it is still the active handle', async () => {
		const coordinator = createCoordinator();
		const session = emptyStreamSession('session-2');
		coordinator.claudeSessions.set('session-2', session);
		coordinator.activeTurns.set(
			'session-2',
			activeTurnFixture({ provider: 'claude', claudeSession: session }),
		);

		await runClaudeSession(coordinator, session);

		expect(coordinator.claudeSessions.has('session-2')).toBe(false);
		expect(coordinator.activeTurns.has('session-2')).toBe(false);
	});

	test('does not clear a replacement turn once its own session entry is gone', async () => {
		const coordinator = createCoordinator();
		const session = emptyStreamSession('session-3');
		// closeSession already removed the map entry, and a replacement turn (owned by a different
		// session) is now live under the same id; the stale loop must not evict it.
		const replacementTurn = activeTurnFixture({
			provider: 'claude',
			claudeSession: emptyStreamSession('session-3'),
		});
		coordinator.activeTurns.set('session-3', replacementTurn);

		await runClaudeSession(coordinator, session);

		expect(coordinator.activeTurns.get('session-3')).toBe(replacementTurn);
	});
});

describe('AgentCoordinator.send', () => {
	test('throws when creating a new session without workspaceId', async () => {
		const coordinator = createCoordinator();

		await expect(
			coordinator.send({
				type: 'session.send',
				content: 'hello',
				modelOptions: {},
			} as unknown as SendCommandFixture),
		).rejects.toThrow('Missing workspaceId for new session');
	});

	test('creates a session when sessionId is missing and forwards payload to startTurnForSession', async () => {
		const store = {
			createSession: async (_workspaceId: string) => ({ id: 'session-1' }),
			requireSession: (_sessionId: string) => ({ provider: null }),
		};

		const coordinator = createCoordinator({ store });
		let startArgs: StartTurnForSessionArgsFixture | null = null;

		(
			coordinator as unknown as {
				startTurnForSession: (args: StartTurnForSessionArgsFixture) => Promise<void>;
			}
		).startTurnForSession = async (args) => {
			startArgs = args;
		};

		const result = await coordinator.send({
			type: 'session.send',
			workspaceId: 'workspace-1',
			content: 'ship it',
			modelOptions: {},
		} as unknown as SendCommandFixture);

		expect(result).toEqual({ sessionId: 'session-1' });
		expect(startArgs).toMatchObject({
			sessionId: 'session-1',
			provider: 'claude',
			content: 'ship it',
			attachments: [],
			appendUserPrompt: true,
		});
	});

	test('renames the workspace branch from the first prompt title', async () => {
		const session: {
			id: string;
			workspaceId: string;
			provider: 'claude' | 'codex' | null;
			title: string;
		} = {
			id: 'session-1',
			workspaceId: 'workspace-1',
			provider: null,
			title: 'Untitled',
		};
		const workspace = {
			id: 'workspace-1',
			localPath: '/repo/miko/atlas',
			branchName: 'atlas',
		};
		const renamedSessions: string[] = [];
		const renamedBranches: Array<{
			workspaceId: string;
			branchName: string;
			expectedCurrentBranchName?: string;
		}> = [];
		let resolveBranchRenamed!: () => void;
		const branchRenamed = new Promise<void>((resolve) => {
			resolveBranchRenamed = resolve;
		});

		const store = {
			requireSession: () => session,
			setSessionProvider: async (_sessionId: string, provider: 'claude' | 'codex') => {
				session.provider = provider;
			},
			setPlanMode: async () => {},
			getWorkspace: () => workspace,
			getMessages: () => [],
			renameSession: async (_sessionId: string, title: string) => {
				renamedSessions.push(title);
				session.title = title;
			},
			appendMessage: async () => {},
			recordTurnStarted: async () => {},
		};
		const codexManager = {
			startSession: async () => {},
			startTurn: async () => ({
				provider: 'codex',
				stream: (async function* () {})(),
				interrupt: async () => {},
				close: () => {},
			}),
		};

		let stateChanges = 0;
		const coordinator = createCoordinator({
			store,
			codexManager,
			onStateChange: () => {
				stateChanges += 1;
			},
			generateTitle: async () => ({ title: null, usedFallback: true, failureMessage: null }),
			renameWorkspaceBranch: async (args) => {
				renamedBranches.push(args);
				workspace.branchName = 'ship-login-flow';
				resolveBranchRenamed();
				return { branchName: workspace.branchName, changed: true };
			},
		});

		await (
			coordinator as unknown as {
				startTurnForSession: (args: {
					sessionId: string;
					provider: 'codex';
					content: string;
					attachments: ChatAttachment[];
					model: string;
					planMode: boolean;
					appendUserPrompt: boolean;
				}) => Promise<void>;
			}
		).startTurnForSession({
			sessionId: 'session-1',
			provider: 'codex',
			content: 'Ship login flow',
			attachments: [],
			model: 'gpt-5.1-codex',
			planMode: false,
			appendUserPrompt: true,
		});
		await branchRenamed;

		expect(renamedSessions).toEqual(['Ship login flow']);
		expect(renamedBranches).toEqual([
			{
				workspaceId: 'workspace-1',
				branchName: 'Ship login flow',
				expectedCurrentBranchName: 'atlas',
			},
		]);
		expect(stateChanges).toBeGreaterThan(0);
	});

	test('does not fail first prompt when automatic branch rename is rejected', async () => {
		const session: {
			id: string;
			workspaceId: string;
			provider: 'claude' | 'codex' | null;
			title: string;
		} = {
			id: 'session-1',
			workspaceId: 'workspace-1',
			provider: null,
			title: 'Untitled',
		};
		const workspace = {
			id: 'workspace-1',
			localPath: '/repo/miko/atlas',
			branchName: 'atlas',
		};
		const errors: string[] = [];
		let promptAppended = false;
		let resolveBackgroundError!: () => void;
		const backgroundErrorReported = new Promise<void>((resolve) => {
			resolveBackgroundError = resolve;
		});

		const store = {
			requireSession: () => session,
			setSessionProvider: async (_sessionId: string, provider: 'claude' | 'codex') => {
				session.provider = provider;
			},
			setPlanMode: async () => {},
			getWorkspace: () => workspace,
			getMessages: () => [],
			renameSession: async (_sessionId: string, title: string) => {
				session.title = title;
			},
			appendMessage: async () => {
				promptAppended = true;
			},
			recordTurnStarted: async () => {},
		};
		const codexManager = {
			startSession: async () => {},
			startTurn: async () => ({
				provider: 'codex',
				stream: (async function* () {})(),
				interrupt: async () => {},
				close: () => {},
			}),
		};
		const coordinator = createCoordinator({
			store,
			codexManager,
			generateTitle: async () => ({ title: null, usedFallback: true, failureMessage: null }),
			renameWorkspaceBranch: async () => {
				throw new Error('Cannot rename a workspace branch after it has been pushed');
			},
		});
		coordinator.setBackgroundErrorReporter((message) => {
			errors.push(message);
			resolveBackgroundError();
		});

		await (
			coordinator as unknown as {
				startTurnForSession: (args: {
					sessionId: string;
					provider: 'codex';
					content: string;
					attachments: ChatAttachment[];
					model: string;
					planMode: boolean;
					appendUserPrompt: boolean;
				}) => Promise<void>;
			}
		).startTurnForSession({
			sessionId: 'session-1',
			provider: 'codex',
			content: 'Ship login flow',
			attachments: [],
			model: 'gpt-5.1-codex',
			planMode: false,
			appendUserPrompt: true,
		});
		await backgroundErrorReported;

		expect(promptAppended).toBe(true);
		expect(errors[0]).toContain('[branch-rename] workspace workspace-1 failed');
	});
});

describe('AgentCoordinator.respondTool', () => {
	test('records tool_result, clears pending tool, sets running, and resolves pending promise', async () => {
		const appended: TranscriptEntry[] = [];
		const store = {
			appendMessage: async (_sessionId: string, entry: TranscriptEntry) => {
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

		coordinator.activeTurns.set(
			'session-1',
			activeTurnFixture({
				status: 'waiting_for_user',
				provider: 'claude',
				pendingTool: {
					toolUseId: 'tool-1',
					tool: { toolKind: 'ask_user_question' },
					resolve: (value: unknown) => {
						resolvedValue = value;
					},
				},
			}),
		);

		await coordinator.respondTool({
			type: 'session.respondTool',
			sessionId: 'session-1',
			toolUseId: 'tool-1',
			result: { answers: { q1: 'yes' } },
		} as unknown as RespondToolCommandFixture);

		expect(appended).toHaveLength(1);
		expect(appended[0]).toMatchObject({
			kind: 'tool_result',
			toolId: 'tool-1',
			content: { answers: { q1: 'yes' } },
		});

		expect(coordinator.activeTurns.get('session-1')?.pendingTool).toBeNull();
		expect(coordinator.activeTurns.get('session-1')?.status).toBe('running');

		expect(resolvedValue).toEqual({ answers: { q1: 'yes' } });
		expect(stateChanges).toBe(1);
	});

	test('for codex exit_plan_mode confirmed+clearContext, clears session and prepares follow-up', async () => {
		const appended: TranscriptEntry[] = [];
		const clearedTokens: Array<{ sessionId: string; token: string | null }> = [];

		const store = {
			appendMessage: async (_sessionId: string, entry: TranscriptEntry) => {
				appended.push(entry);
			},
			setSessionToken: async (sessionId: string, token: string | null) => {
				clearedTokens.push({ sessionId, token });
			},
		};

		const coordinator = createCoordinator({ store });

		coordinator.activeTurns.set(
			'session-2',
			activeTurnFixture({
				status: 'waiting_for_user',
				provider: 'codex',
				pendingTool: {
					toolUseId: 'tool-2',
					tool: { toolKind: 'exit_plan_mode' },
					resolve: () => {},
				},
			}),
		);

		await coordinator.respondTool({
			type: 'session.respondTool',
			sessionId: 'session-2',
			toolUseId: 'tool-2',
			result: {
				confirmed: true,
				clearContext: true,
				message: 'Ship with small refactor',
			},
		} as unknown as RespondToolCommandFixture);

		expect(clearedTokens).toEqual([{ sessionId: 'session-2', token: null }]);
		expect(appended.some((entry) => entry.kind === 'context_cleared')).toBe(true);

		expect(coordinator.activeTurns.get('session-2')?.postToolFollowUp).toEqual({
			content: 'Proceed with the approved plan. Additional guidance: Ship with small refactor',
			planMode: false,
		});
	});
});

describe('AgentCoordinator.cancel', () => {
	test('cancels a Claude turn and resolves pending ask_user_question tool', async () => {
		const appended: TranscriptEntry[] = [];
		let cancelledCount = 0;

		const store = {
			appendMessage: async (_sessionId: string, entry: TranscriptEntry) => {
				appended.push(entry);
			},
			recordTurnCancelled: async () => {
				cancelledCount += 1;
			},
		};

		let stateChanges = 0;
		let interruptCalls = 0;
		let closeCalls = 0;
		let pendingResolved: unknown = null;

		const coordinator = createCoordinator({
			store,
			onStateChange: () => {
				stateChanges += 1;
			},
		});

		coordinator.activeTurns.set(
			'session-1',
			activeTurnFixture({
				sessionId: 'session-1',
				provider: 'claude',
				pendingTool: {
					toolUseId: 'tool-1',
					tool: { toolKind: 'ask_user_question' },
					resolve: (value: unknown) => {
						pendingResolved = value;
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
			}),
		);

		await coordinator.cancel('session-1');

		expect(cancelledCount).toBe(1);
		expect(interruptCalls).toBe(1);
		expect(closeCalls).toBe(1);
		expect(stateChanges).toBe(1);

		expect(coordinator.activeTurns.has('session-1')).toBe(false);
		expect(pendingResolved).toEqual({ discarded: true, answers: {} });

		expect(appended.map((entry) => entry.kind)).toEqual(['tool_result', 'interrupted']);
		expect(appended[0]).toMatchObject({
			kind: 'tool_result',
			toolId: 'tool-1',
			content: { discarded: true, answers: {} },
		});
	});

	test('cancels a Codex turn and resolves pending exit_plan_mode tool', async () => {
		const store = {
			appendMessage: async () => {},
			recordTurnCancelled: async () => {},
		};
		let resolvedValue: unknown = null;
		const coordinator = createCoordinator({ store });

		coordinator.activeTurns.set(
			'session-2',
			activeTurnFixture({
				sessionId: 'session-2',
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
			}),
		);

		await coordinator.cancel('session-2');

		expect(resolvedValue).toEqual({ discarded: true });
	});
});
