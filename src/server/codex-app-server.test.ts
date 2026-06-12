import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import {
	AsyncQueue,
	CodexAppServerManager,
	type CodexAppServerProcess,
	fileChangeToToolCalls,
	inferQuestionAllowsMultiple,
	isRecoverableResumeError,
	itemToToolCalls,
	itemToToolResults,
	normalizeCodexTokenUsage,
	parseUnifiedDiff,
	renderPlanMarkdownFromSteps,
	timestamped,
	toToolRequestUserInputResponse,
} from './codex-app-server';
import type {
	FileChangeItem,
	ThreadItem,
	ToolRequestUserInputQuestion,
} from './codex-app-server-protocol';

class FakeCodexAppServerProcess extends EventEmitter implements CodexAppServerProcess {
	stdin: Writable;
	stdout = new PassThrough();
	stderr = new PassThrough();
	killed = false;
	messages: Record<string, unknown>[] = [];
	private pendingInput = '';

	constructor(private readonly args: { assistantText?: string; holdThreadStart?: boolean } = {}) {
		super();
		this.stdin = new Writable({
			write: (chunk, _encoding, callback) => {
				this.pendingInput += chunk.toString();
				const lines = this.pendingInput.split('\n');
				this.pendingInput = lines.pop() ?? '';
				for (const line of lines) {
					if (line.trim()) {
						this.receiveMessage(line);
					}
				}
				callback();
			},
		});
	}

	kill(): void {
		this.killed = true;
		this.stdout.end();
		this.stderr.end();
		this.emit('close', 0);
	}

	private receiveMessage(line: string) {
		const message = JSON.parse(line) as Record<string, unknown>;
		this.messages.push(message);

		if (typeof message.id !== 'string') return;

		if (message.method === 'initialize') {
			this.writeResponse(message.id, {});
			return;
		}

		if (message.method === 'thread/start') {
			if (this.args.holdThreadStart) {
				return;
			}
			this.writeResponse(message.id, { thread: { id: 'thread-1' } });
			return;
		}

		if (message.method === 'turn/start') {
			this.writeResponse(message.id, { turn: { id: 'turn-1', status: 'inProgress', error: null } });
			if (this.args.assistantText !== undefined) {
				queueMicrotask(() => {
					this.writeNotification('item/completed', {
						threadId: 'thread-1',
						turnId: 'turn-1',
						item: {
							type: 'agentMessage',
							id: 'message-1',
							text: this.args.assistantText,
						},
					});
					this.writeNotification('turn/completed', {
						threadId: 'thread-1',
						turn: { id: 'turn-1', status: 'completed', error: null },
					});
				});
			}
		}
	}

	private writeResponse(id: string, result: unknown) {
		this.stdout.write(`${JSON.stringify({ id, result })}\n`);
	}

	writeServerRequest(method: string, params: unknown, id = 'request-1') {
		this.stdout.write(`${JSON.stringify({ id, method, params })}\n`);
	}

	private writeNotification(method: string, params: unknown) {
		this.stdout.write(`${JSON.stringify({ method, params })}\n`);
	}
}

async function waitFor(predicate: () => boolean) {
	for (let index = 0; index < 20; index += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error('Timed out waiting for condition');
}

function userInputQuestion(
	overrides: Partial<ToolRequestUserInputQuestion> = {},
): ToolRequestUserInputQuestion {
	return {
		id: 'model',
		header: 'Choose model',
		isOther: false,
		isSecret: false,
		options: [],
		question: 'Which model should be used?',
		...overrides,
	};
}

function dynamicToolItem(): ThreadItem {
	return {
		type: 'dynamicToolCall',
		id: 'dynamic-1',
		tool: 'miko.demo',
		arguments: { value: true },
		contentItems: [{ type: 'inputText', text: 'done' }],
		status: 'completed',
	};
}

function collabAgentToolItem(): ThreadItem {
	return {
		type: 'collabAgentToolCall',
		id: 'agent-1',
		tool: 'spawnAgent',
		status: 'completed',
		senderThreadId: 'sender-1',
		receiverThreadIds: ['receiver-1'],
	};
}

function commandExecutionItem(): ThreadItem {
	return {
		type: 'commandExecution',
		id: 'command-1',
		command: 'bun test',
		status: 'completed',
		exitCode: 1,
	};
}

function webSearchItem(): ThreadItem {
	return {
		type: 'webSearch',
		id: 'search-1',
		query: 'Codex app server',
	};
}

function mcpToolItem(): ThreadItem {
	return {
		type: 'mcpToolCall',
		id: 'mcp-1',
		server: 'linear',
		tool: 'get_issue',
		arguments: { id: 'ABC-123' },
		status: 'failed',
	};
}

function addFileChangeItem(): FileChangeItem {
	return {
		type: 'fileChange',
		id: 'file-1',
		status: 'completed',
		changes: [
			{
				path: 'src/new.ts',
				kind: 'add',
				diff: ['--- /dev/null', '+++ b/src/new.ts', '@@ -0,0 +1 @@', '+export {};'].join('\n'),
			},
		],
	};
}

function errorItem(): ThreadItem {
	return {
		type: 'error',
		id: 'error-1',
		message: 'boom',
	};
}

describe('timestamped', () => {
	test('adds generated metadata while preserving the entry payload', () => {
		const entry = { kind: 'assistant_text', text: 'hello' } as const;

		const result = timestamped(entry, 1234);

		expect(result).toMatchObject({
			kind: 'assistant_text',
			text: 'hello',
			createdAt: 1234,
		});
		expect(result._id).toEqual(expect.any(String));
		expect(result._id).not.toHaveLength(0);
		expect(entry).toEqual({ kind: 'assistant_text', text: 'hello' });
	});

	test('keeps explicit zero timestamps instead of falling back to Date.now', () => {
		const result = timestamped({ kind: 'compact_boundary' }, 0);

		expect(result.createdAt).toBe(0);
	});
});

describe('isRecoverableResumeError', () => {
	test('accepts missing thread errors from thread/resume', () => {
		expect(isRecoverableResumeError(new Error('thread/resume failed: missing thread'))).toBe(true);
	});

	test('rejects recoverable text for other methods', () => {
		expect(isRecoverableResumeError(new Error('thread/start failed: missing thread'))).toBe(false);
	});

	test('rejects thread/resume errors without missing-thread text', () => {
		expect(isRecoverableResumeError(new Error('thread/resume failed: permission denied'))).toBe(
			false,
		);
	});
});

describe('inferQuestionAllowsMultiple', () => {
	test('accepts questions that ask for all matching options', () => {
		expect(
			inferQuestionAllowsMultiple({
				id: 'files',
				header: 'Choose files',
				isOther: false,
				isSecret: false,
				options: [],
				question: 'Select all that apply.',
			}),
		).toBe(true);
	});

	test('rejects ordinary single-answer questions', () => {
		expect(
			inferQuestionAllowsMultiple({
				id: 'model',
				header: 'Choose model',
				isOther: false,
				isSecret: false,
				options: [],
				question: 'Which model should be used?',
			}),
		).toBe(false);
	});
});

describe('toToolRequestUserInputResponse', () => {
	test('converts a plain answer into the Codex response shape', () => {
		const result = toToolRequestUserInputResponse({ model: 'gpt-5.4' }, [userInputQuestion()]);

		expect(result).toEqual({
			answers: {
				model: { answers: ['gpt-5.4'] },
			},
		});
	});

	test('keeps array answers and stringifies entries', () => {
		const result = toToolRequestUserInputResponse({ files: ['a.ts', 7] }, [
			userInputQuestion({ id: 'files', question: 'Which files?' }),
		]);

		expect(result.answers.files).toEqual({ answers: ['a.ts', '7'] });
	});

	test('accepts nested answers from the tool result', () => {
		const result = toToolRequestUserInputResponse(
			{ answers: { model: { answers: ['gpt-5.4'] } } },
			[userInputQuestion()],
		);

		expect(result.answers.model).toEqual({ answers: ['gpt-5.4'] });
	});

	test('uses question text as a fallback and defaults missing answers to empty', () => {
		const result = toToolRequestUserInputResponse({ 'Which model should be used?': 'gpt-5.4' }, [
			userInputQuestion(),
			userInputQuestion({ id: 'notes', question: 'Any notes?' }),
		]);

		expect(result).toEqual({
			answers: {
				model: { answers: ['gpt-5.4'] },
				notes: { answers: [] },
			},
		});
	});
});

describe('normalizeCodexTokenUsage', () => {
	test('maps Codex token usage into the app snapshot shape', () => {
		const result = normalizeCodexTokenUsage({
			threadId: 'thread-1',
			turnId: 'turn-1',
			tokenUsage: {
				last_token_usage: {
					total_tokens: 100,
					input_tokens: 70,
					cached_input_tokens: 20,
					output_tokens: 30,
					reasoning_output_tokens: 10,
				},
				model_context_window: 200,
				total_token_usage: {
					total_tokens: 150,
				},
			},
		});

		expect(result).toMatchObject({
			usedTokens: 100,
			totalProcessedTokens: 150,
			maxTokens: 200,
			inputTokens: 70,
			cachedInputTokens: 20,
			outputTokens: 30,
			reasoningOutputTokens: 10,
			lastUsedTokens: 100,
			compactsAutomatically: true,
		});
	});
});

describe('renderPlanMarkdownFromSteps', () => {
	test('renders completed steps as checked markdown items', () => {
		expect(
			renderPlanMarkdownFromSteps([
				{ step: 'Inspect current behavior', status: 'completed' },
				{ step: 'Add focused test', status: 'inProgress' },
				{ step: 'Run checks', status: 'pending' },
			]),
		).toBe('- [x] Inspect current behavior\n- [ ] Add focused test\n- [ ] Run checks');
	});
});

describe('parseUnifiedDiff', () => {
	test('extracts old and new strings from a unified diff', () => {
		const result = parseUnifiedDiff(
			[
				'--- a/file.ts',
				'+++ b/file.ts',
				'@@ -1,3 +1,3 @@',
				' const keep = true;',
				'-const oldName = "before";',
				'+const newName = "after";',
				' console.log(keep);',
			].join('\n'),
		);

		expect(result).toEqual({
			oldString: 'const keep = true;\nconst oldName = "before";\nconsole.log(keep);',
			newString: 'const keep = true;\nconst newName = "after";\nconsole.log(keep);',
		});
	});
});

describe('fileChangeToToolCalls', () => {
	test('converts an update diff into an edit tool call', () => {
		const item: FileChangeItem = {
			type: 'fileChange',
			id: 'change-1',
			status: 'completed',
			changes: [
				{
					path: 'src/file.ts',
					kind: 'update',
					diff: [
						'--- a/src/file.ts',
						'+++ b/src/file.ts',
						'@@ -1 +1 @@',
						'-const value = "old";',
						'+const value = "new";',
					].join('\n'),
				},
			],
		};

		expect(fileChangeToToolCalls(item)[0]).toMatchObject({
			kind: 'tool_call',
			tool: {
				toolKind: 'edit_file',
				toolName: 'Edit',
				toolId: 'change-1',
				input: {
					filePath: 'src/file.ts',
					oldString: 'const value = "old";',
					newString: 'const value = "new";',
				},
			},
		});
	});

	test('converts a delete change into a delete tool call', () => {
		const item: FileChangeItem = {
			type: 'fileChange',
			id: 'del-1',
			status: 'completed',
			changes: [
				{
					path: 'src/gone.ts',
					kind: 'delete',
					diff: ['--- a/src/gone.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-const x = 1;'].join('\n'),
				},
			],
		};

		expect(fileChangeToToolCalls(item)[0]).toMatchObject({
			kind: 'tool_call',
			tool: {
				toolKind: 'delete_file',
				toolName: 'Delete',
				toolId: 'del-1',
				input: { filePath: 'src/gone.ts', oldString: 'const x = 1;' },
			},
		});
	});

	test('keeps move changes as generic FileChange tool calls', () => {
		const item: FileChangeItem = {
			type: 'fileChange',
			id: 'move-1',
			status: 'completed',
			changes: [
				{
					path: 'src/old.ts',
					kind: { type: 'update', move_path: 'src/new.ts' },
					diff: null,
				},
			],
		};

		expect(fileChangeToToolCalls(item)[0]).toMatchObject({
			kind: 'tool_call',
			tool: {
				toolKind: 'unknown_tool',
				toolName: 'FileChange',
				toolId: 'move-1',
				input: {
					payload: item,
				},
				rawInput: item,
			},
		});
	});
});

describe('itemToToolCalls', () => {
	test('maps dynamic tool calls to unknown tool calls', () => {
		expect(itemToToolCalls(dynamicToolItem())[0]).toMatchObject({
			kind: 'tool_call',
			tool: { toolKind: 'unknown_tool', toolName: 'miko.demo', toolId: 'dynamic-1' },
		});
	});

	test('maps collab agent tool calls to subagent task tool calls', () => {
		expect(itemToToolCalls(collabAgentToolItem())[0]).toMatchObject({
			kind: 'tool_call',
			tool: { toolKind: 'subagent_task', toolName: 'Task', toolId: 'agent-1' },
		});
	});

	test('maps command execution items to bash tool calls', () => {
		expect(itemToToolCalls(commandExecutionItem())[0]).toMatchObject({
			kind: 'tool_call',
			tool: { toolKind: 'bash', toolName: 'Bash', toolId: 'command-1' },
		});
	});

	test('maps web search items to web search tool calls', () => {
		expect(itemToToolCalls(webSearchItem())[0]).toMatchObject({
			kind: 'tool_call',
			tool: { toolKind: 'web_search', toolName: 'WebSearch', toolId: 'search-1' },
		});
	});

	test('maps MCP tool call items to generic MCP tool calls', () => {
		expect(itemToToolCalls(mcpToolItem())[0]).toMatchObject({
			kind: 'tool_call',
			tool: { toolKind: 'mcp_generic', toolName: 'mcp__linear__get_issue', toolId: 'mcp-1' },
		});
	});

	test('maps file change items to file tool calls', () => {
		expect(itemToToolCalls(addFileChangeItem())[0]).toMatchObject({
			kind: 'tool_call',
			tool: { toolKind: 'write_file', toolName: 'Write', toolId: 'file-1' },
		});
	});

	test('maps error items to unknown tool calls', () => {
		expect(itemToToolCalls(errorItem())[0]).toMatchObject({
			kind: 'tool_call',
			tool: { toolKind: 'unknown_tool', toolName: 'Error', toolId: 'error-1' },
		});
	});

	test('does not emit tool calls for plan items', () => {
		expect(itemToToolCalls({ type: 'plan', id: 'plan-1', text: 'Do the work' })).toEqual([]);
	});
});

describe('itemToToolResults', () => {
	test('maps dynamic tool calls to successful tool results', () => {
		expect(itemToToolResults(dynamicToolItem())[0]).toMatchObject({
			kind: 'tool_result',
			toolId: 'dynamic-1',
			isError: false,
		});
	});

	test('maps collab agent tool calls to successful tool results', () => {
		expect(itemToToolResults(collabAgentToolItem())[0]).toMatchObject({
			kind: 'tool_result',
			toolId: 'agent-1',
			isError: false,
		});
	});

	test('marks nonzero command execution results as errors', () => {
		expect(itemToToolResults(commandExecutionItem())[0]).toMatchObject({
			kind: 'tool_result',
			toolId: 'command-1',
			isError: true,
		});
	});

	test('maps web search items to tool results', () => {
		expect(itemToToolResults(webSearchItem())[0]).toMatchObject({
			kind: 'tool_result',
			toolId: 'search-1',
		});
	});

	test('marks failed MCP tool call results as errors', () => {
		expect(itemToToolResults(mcpToolItem())[0]).toMatchObject({
			kind: 'tool_result',
			toolId: 'mcp-1',
			isError: true,
		});
	});

	test('maps file change items to file change results', () => {
		expect(itemToToolResults(addFileChangeItem())[0]).toMatchObject({
			kind: 'tool_result',
			toolId: 'file-1',
			isError: false,
		});
	});

	test('maps error items to error tool results', () => {
		expect(itemToToolResults(errorItem())[0]).toMatchObject({
			kind: 'tool_result',
			toolId: 'error-1',
			isError: true,
		});
	});

	test('does not emit tool results for plan items', () => {
		expect(itemToToolResults({ type: 'plan', id: 'plan-1', text: 'Do the work' })).toEqual([]);
	});
});

describe('AsyncQueue', () => {
	test('yields buffered values in FIFO order', async () => {
		const queue = new AsyncQueue<number>();
		queue.push(1);
		queue.push(2);

		const iterator = queue[Symbol.asyncIterator]();

		expect(await iterator.next()).toEqual({ value: 1, done: false });
		expect(await iterator.next()).toEqual({ value: 2, done: false });
	});

	test('resolves a waiting consumer when a value is pushed', async () => {
		const queue = new AsyncQueue<number>();
		const iterator = queue[Symbol.asyncIterator]();
		const next = iterator.next();

		queue.push(1);

		expect(await next).toEqual({ value: 1, done: false });
	});

	test('finishes waiting consumers and ignores later pushes', async () => {
		const queue = new AsyncQueue<number>();
		const iterator = queue[Symbol.asyncIterator]();
		const next = iterator.next();

		queue.finish();
		queue.push(1);

		expect(await next).toEqual({ value: undefined, done: true });
		expect(await iterator.next()).toEqual({ value: undefined, done: true });
	});
});

describe('CodexAppServerManager.startSession', () => {
	test('initializes Codex app-server and starts a thread', async () => {
		const child = new FakeCodexAppServerProcess();
		const manager = new CodexAppServerManager({
			spawnProcess: (cwd) => {
				expect(cwd).toBe('/tmp/project');
				return child;
			},
		});

		try {
			await manager.startSession({
				sessionId: 'chat-1',
				cwd: '/tmp/project',
				model: 'gpt-5.4',
				serviceTier: 'fast',
				sessionToken: null,
			});

			expect(child.messages.map((message) => message.method)).toEqual([
				'initialize',
				'initialized',
				'thread/start',
			]);

			expect(child.messages[0]).toMatchObject({
				method: 'initialize',
				params: {
					clientInfo: {
						name: 'miko_desktop',
						version: '0.1.0',
					},
					capabilities: {
						experimentalApi: true,
					},
				},
			});

			expect(child.messages[2]).toMatchObject({
				method: 'thread/start',
				params: {
					model: 'gpt-5.4',
					cwd: '/tmp/project',
					serviceTier: 'fast',
					approvalPolicy: 'never',
					sandbox: 'danger-full-access',
					experimentalRawEvents: false,
					persistExtendedHistory: false,
				},
			});
		} finally {
			manager.stopAll();
		}
	});
});

describe('CodexAppServerManager.startTurn', () => {
	test('starts a Codex turn and returns initial stream events', async () => {
		const child = new FakeCodexAppServerProcess();
		const manager = new CodexAppServerManager({
			spawnProcess: () => child,
		});

		try {
			await manager.startSession({
				sessionId: 'chat-1',
				cwd: '/tmp/project',
				model: 'gpt-5.4',
				serviceTier: 'fast',
				sessionToken: null,
			});

			const turn = await manager.startTurn({
				sessionId: 'chat-1',
				model: 'gpt-5.4',
				effort: 'medium',
				serviceTier: 'fast',
				content: 'Write tests',
				planMode: false,
				onToolRequest: async () => ({}),
			});
			const iterator = turn.stream[Symbol.asyncIterator]();

			expect(child.messages.at(-1)).toMatchObject({
				method: 'turn/start',
				params: {
					threadId: 'thread-1',
					model: 'gpt-5.4',
					effort: 'medium',
					serviceTier: 'fast',
					approvalPolicy: 'never',
					collaborationMode: {
						mode: 'default',
					},
					input: [
						{
							type: 'text',
							text: 'Write tests',
							text_elements: [],
						},
					],
				},
			});

			expect(await iterator.next()).toEqual({
				value: { type: 'session_token', sessionToken: 'thread-1' },
				done: false,
			});

			expect((await iterator.next()).value).toMatchObject({
				type: 'transcript',
				entry: {
					kind: 'system_init',
					provider: 'codex',
					model: 'gpt-5.4',
				},
			});
		} finally {
			manager.stopAll();
		}
	});

	test('responds with a JSON-RPC error when server request handling throws', async () => {
		const child = new FakeCodexAppServerProcess();
		const manager = new CodexAppServerManager({
			spawnProcess: () => child,
		});

		try {
			await manager.startSession({
				sessionId: 'chat-1',
				cwd: '/tmp/project',
				model: 'gpt-5.4',
				serviceTier: 'fast',
				sessionToken: null,
			});

			await manager.startTurn({
				sessionId: 'chat-1',
				model: 'gpt-5.4',
				content: 'Write tests',
				planMode: false,
				onToolRequest: async () => {
					throw new Error('tool failed');
				},
			});

			child.writeServerRequest('item/tool/requestUserInput', {
				threadId: 'thread-1',
				turnId: 'turn-1',
				itemId: 'ask-1',
				questions: [
					{
						id: 'choice',
						header: 'Choose',
						question: 'Which option?',
						isOther: false,
						isSecret: false,
						options: [],
					},
				],
			});

			await waitFor(() =>
				child.messages.some(
					(message) => message.id === 'request-1' && typeof message.error === 'object',
				),
			);

			expect(child.messages.at(-1)).toEqual({
				id: 'request-1',
				error: {
					message: 'tool failed',
				},
			});
		} finally {
			manager.stopAll();
		}
	});
});

describe('CodexAppServerManager.generateStructured', () => {
	test('returns assistant text from a completed quick turn', async () => {
		const child = new FakeCodexAppServerProcess({ assistantText: 'Generated title' });
		const manager = new CodexAppServerManager({
			spawnProcess: () => child,
		});

		const result = await manager.generateStructured({
			cwd: '/tmp/project',
			model: 'gpt-5.4',
			effort: 'low',
			serviceTier: 'fast',
			prompt: 'Generate a title',
		});

		expect(result).toBe('Generated title');
		expect(child.messages.map((message) => message.method)).toEqual([
			'initialize',
			'initialized',
			'thread/start',
			'turn/start',
		]);

		expect(child.messages.at(-1)).toMatchObject({
			method: 'turn/start',
			params: {
				effort: 'low',
				input: [{ text: 'Generate a title' }],
				model: 'gpt-5.4',
				serviceTier: 'fast',
			},
		});

		expect(child.killed).toBe(true);
	});
});

describe('CodexAppServerManager.stopSession', () => {
	test('kills the child process and finishes an active turn stream', async () => {
		const child = new FakeCodexAppServerProcess();
		const manager = new CodexAppServerManager({
			spawnProcess: () => child,
		});

		await manager.startSession({
			sessionId: 'chat-1',
			cwd: '/tmp/project',
			model: 'gpt-5.4',
			serviceTier: 'fast',
			sessionToken: null,
		});

		const turn = await manager.startTurn({
			sessionId: 'chat-1',
			model: 'gpt-5.4',
			content: 'Write tests',
			planMode: false,
			onToolRequest: async () => ({}),
		});
		const iterator = turn.stream[Symbol.asyncIterator]();

		await iterator.next();
		await iterator.next();
		const pending = iterator.next();

		manager.stopSession('chat-1');

		expect(child.killed).toBe(true);
		expect(await pending).toEqual({ value: undefined, done: true });
	});

	test('rejects pending JSON-RPC requests', async () => {
		const child = new FakeCodexAppServerProcess({ holdThreadStart: true });
		const manager = new CodexAppServerManager({
			spawnProcess: () => child,
		});

		const startSession = manager.startSession({
			sessionId: 'chat-1',
			cwd: '/tmp/project',
			model: 'gpt-5.4',
			serviceTier: 'fast',
			sessionToken: null,
		});

		await waitFor(() => child.messages.some((message) => message.method === 'thread/start'));

		manager.stopSession('chat-1');

		await expect(startSession).rejects.toThrow('Codex session stopped');
		expect(child.killed).toBe(true);
	});
});
