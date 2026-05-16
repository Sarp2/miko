import { describe, expect, test } from 'bun:test';
import { createEmptyState } from './event';
import { createWsRouter } from './ws-router';

class FakeWebSocket {
	readonly sent: unknown[] = [];
	readonly data = {
		subscriptions: new Map(),
		snapshotSignatures: new Map(),
	};

	send(message: string) {
		this.sent.push(JSON.parse(message));
	}
}

function createRouter(overrides: Record<string, unknown> = {}) {
	return createWsRouter({
		store: { state: createEmptyState(), pruneStaleEmptyChats: async () => {} } as never,
		agent: { getActiveStatuses: () => new Map(), getDrainingChatIds: () => new Set() } as never,
		terminals: { getSnapshot: () => null, onEvent: () => () => {} } as never,
		keybindings: {
			getSnapshot: () => ({ bindings: {}, warnings: [], filePath: '/tmp/keybindings.json' }),
			onChange: () => () => {},
		} as never,
		refreshDiscovery: async () => [],
		getDiscoveredProjects: () => [],
		machineDisplayName: 'Local Machine',
		updateManager: null,
		...overrides,
	} as never);
}

describe('createWsRouter', () => {
	describe('createWsRouter.createEnvelope', () => {
		test('creates a sidebar snapshot', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({ v: 1, type: 'subscribe', id: 'sub-1', topic: { type: 'sidebar' } }),
			);

			expect(ws.sent[0]).toMatchObject({
				id: 'sub-1',
				snapshot: { type: 'sidebar' },
			});
		});

		test('creates a local projects snapshot', async () => {
			const router = createRouter({
				getDiscoveredProjects: () => [
					{ localPath: '/tmp/project', title: 'Project', modifiedAt: 1 },
				],
			});
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({
					v: 1,
					type: 'subscribe',
					id: 'sub-1',
					topic: { type: 'local-projects' },
				}),
			);
			await Bun.sleep(0);

			expect(ws.sent[0]).toMatchObject({
				id: 'sub-1',
				snapshot: { type: 'local-projects' },
			});
		});

		test('creates a keybindings snapshot', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({ v: 1, type: 'subscribe', id: 'sub-1', topic: { type: 'keybindings' } }),
			);

			expect(ws.sent[0]).toMatchObject({
				id: 'sub-1',
				snapshot: { type: 'keybindings' },
			});
		});

		test('creates an update snapshot', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({ v: 1, type: 'subscribe', id: 'sub-1', topic: { type: 'update' } }),
			);

			expect(ws.sent[0]).toMatchObject({
				id: 'sub-1',
				snapshot: { type: 'update' },
			});
		});

		test('creates a terminal snapshot', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({
					v: 1,
					type: 'subscribe',
					id: 'sub-1',
					topic: { type: 'terminal', terminalId: 'terminal-1' },
				}),
			);

			expect(ws.sent[0]).toMatchObject({
				id: 'sub-1',
				snapshot: { type: 'terminal' },
			});
		});

		test('creates a project git snapshot', async () => {
			const state = createEmptyState();
			state.projectsById.set('project-1', {
				id: 'project-1',
				localPath: '/tmp/project',
				title: 'Project',
				createdAt: 1,
				updatedAt: 1,
			});
			const router = createRouter({
				store: {
					state,
					getProject: (projectId: string) => state.projectsById.get(projectId) ?? null,
					pruneStaleEmptyChats: async () => {},
				},
			});
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({
					v: 1,
					type: 'subscribe',
					id: 'sub-1',
					topic: { type: 'project-git', projectId: 'project-1' },
				}),
			);

			expect(ws.sent[0]).toMatchObject({
				id: 'sub-1',
				snapshot: { type: 'project-git' },
			});
		});

		test('creates a chat snapshot', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({
					v: 1,
					type: 'subscribe',
					id: 'sub-1',
					topic: { type: 'chat', chatId: 'chat-1' },
				}),
			);

			expect(ws.sent[0]).toMatchObject({
				id: 'sub-1',
				snapshot: { type: 'chat' },
			});
		});
	});

	describe('createWsRouter.pushSnapshots', () => {
		test('prunes before sending snapshots by default', async () => {
			let pruneCalls = 0;
			const router = createRouter({
				store: {
					state: createEmptyState(),
					pruneStaleEmptyChats: async () => {
						pruneCalls += 1;
					},
				},
			});
			
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({ v: 1, type: 'subscribe', id: 'sub-1', topic: { type: 'sidebar' } }),
			);

			expect(pruneCalls).toBe(1);
		});

		test('sends snapshots for subscriptions', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			ws.data.subscriptions.set('sidebar-1', { type: 'sidebar' });
			ws.data.subscriptions.set('keys-1', { type: 'keybindings' });
			await router.broadcastSnapshots();

			expect(ws.sent).toHaveLength(0);

			router.handleOpen(ws as never);
			await router.broadcastSnapshots();

			expect(ws.sent).toHaveLength(2);
		});

		test('does not resend unchanged snapshots', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({ v: 1, type: 'subscribe', id: 'sub-1', topic: { type: 'sidebar' } }),
			);
			await router.broadcastSnapshots();

			expect(ws.sent).toHaveLength(1);
		});
	});

	describe('createWsRouter.broadcastError', () => {
		test('sends errors to open sockets', () => {
			let reportError = (_message: string) => {};
			const router = createRouter({
				agent: {
					getActiveStatuses: () => new Map(),
					getDrainingChatIds: () => new Set(),
					setBackgroundErrorReporter: (reporter: (message: string) => void) => {
						reportError = reporter;
					},
				},
			});
			const ws = new FakeWebSocket();

			router.handleOpen(ws as never);
			reportError('boom');

			expect(ws.sent).toEqual([{ type: 'error', message: 'boom' }]);
		});
	});

	describe('createWsRouter.pushTerminalSnapshot', () => {
		test('sends terminal snapshots to matching subscriptions', async () => {
			const router = createRouter({
				terminals: {
					getSnapshot: () => ({ terminalId: 'terminal-1' }),
					onEvent: () => () => {},
					close: () => {},
				},
			});
			const ws = new FakeWebSocket();

			router.handleOpen(ws as never);
			ws.data.subscriptions.set('sub-1', { type: 'terminal', terminalId: 'terminal-1' });

			await router.handleMessage(
				ws as never,
				JSON.stringify({
					v: 1,
					type: 'command',
					id: 'close-1',
					command: { type: 'terminal.close', terminalId: 'terminal-1' },
				}),
			);

			expect(ws.sent.at(-1)).toMatchObject({
				id: 'sub-1',
				snapshot: { type: 'terminal' },
			});
		});

		test('skips non-matching terminal subscriptions', async () => {
			const router = createRouter({
				terminals: {
					getSnapshot: () => ({ terminalId: 'terminal-1' }),
					onEvent: () => () => {},
					close: () => {},
				},
			});
			const ws = new FakeWebSocket();

			router.handleOpen(ws as never);
			ws.data.subscriptions.set('sub-1', { type: 'terminal', terminalId: 'terminal-2' });

			await router.handleMessage(
				ws as never,
				JSON.stringify({
					v: 1,
					type: 'command',
					id: 'close-1',
					command: { type: 'terminal.close', terminalId: 'terminal-1' },
				}),
			);

			expect(ws.sent).toEqual([{ type: 'ack', id: 'close-1' }]);
		});

	});

	describe('createWsRouter.pushTerminalEvent', () => {
		test('sends events to matching terminal subscriptions', () => {
			let emitTerminalEvent = (_event: unknown) => {};
			const router = createRouter({
				terminals: {
					getSnapshot: () => null,
					onEvent: (listener: (event: unknown) => void) => {
						emitTerminalEvent = listener;
						return () => {};
					},
				},
			});
			const ws = new FakeWebSocket();

			router.handleOpen(ws as never);
			ws.data.subscriptions.set('sub-1', { type: 'terminal', terminalId: 'terminal-1' });
			emitTerminalEvent({ type: 'terminal.output', terminalId: 'terminal-1', data: 'hello' });

			expect(ws.sent).toEqual([
				{
					type: 'event',
					id: 'sub-1',
					event: { type: 'terminal.output', terminalId: 'terminal-1', data: 'hello' },
				},
			]);
		});

	});

	describe('createWsRouter.disposeKeybindingEvents', () => {
		test('sends changed keybinding snapshots to subscribers', () => {
			let emitKeybindingsChange = () => {};
			const router = createRouter({
				keybindings: {
					getSnapshot: () => ({ bindings: {}, warnings: [], filePath: '/tmp/keybindings.json' }),
					onChange: (listener: () => void) => {
						emitKeybindingsChange = listener;
						return () => {};
					},
				},
			});
			const ws = new FakeWebSocket();

			router.handleOpen(ws as never);
			ws.data.subscriptions.set('sub-1', { type: 'keybindings' });
			emitKeybindingsChange();

			expect(ws.sent[0]).toMatchObject({
				id: 'sub-1',
				snapshot: { type: 'keybindings' },
			});
		});
	});

	describe('createWsRouter.disposeUpdateEvents', () => {
		test('sends changed update snapshots to subscribers', () => {
			let emitUpdateChange = () => {};
			const router = createRouter({
				updateManager: {
					getSnapshot: () => ({
						currentVersion: '1.0.0',
						latestVersion: null,
						status: 'idle',
						updateAvailable: false,
						lastCheckedAt: null,
						error: null,
						installAction: 'restart',
					}),
					onChange: (listener: () => void) => {
						emitUpdateChange = listener;
						return () => {};
					},
				},
			});
			const ws = new FakeWebSocket();

			router.handleOpen(ws as never);
			ws.data.subscriptions.set('sub-1', { type: 'update' });
			emitUpdateChange();

			expect(ws.sent[0]).toMatchObject({
				id: 'sub-1',
				snapshot: { type: 'update' },
			});
		});
	});

	describe('createWsRouter.handleCommand', () => {
		test('acks system ping commands without broadcasting snapshots', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({
					v: 1,
					type: 'command',
					id: 'ping-1',
					command: { type: 'system.ping' },
				}),
			);

			expect(ws.sent).toEqual([{ type: 'ack', id: 'ping-1' }]);
		});

		test('returns an error when update installation is unavailable', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({
					v: 1,
					type: 'command',
					id: 'install-1',
					command: { type: 'update.install' },
				}),
			);

			expect(ws.sent).toEqual([
				{ type: 'error', id: 'install-1', message: 'Update manager unavailable.' },
			]);
		});

		test('reads project diff patches', async () => {
			const state = createEmptyState();
			state.projectsById.set('project-1', {
				id: 'project-1',
				localPath: '/tmp/project',
				title: 'Project',
				createdAt: 1,
				updatedAt: 1,
			});
			const router = createRouter({
				store: {
					state,
					getProject: (projectId: string) => state.projectsById.get(projectId) ?? null,
					pruneStaleEmptyChats: async () => {},
				},
				diffStore: {
					readPatch: async () => ({ patch: 'diff' }),
				},
			});
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({
					v: 1,
					type: 'command',
					id: 'patch-1',
					command: { type: 'project.readDiffPatch', projectId: 'project-1', path: 'app.txt' },
				}),
			);

			expect(ws.sent).toEqual([{ type: 'ack', id: 'patch-1', result: { patch: 'diff' } }]);
		});

		test('broadcasts sidebar snapshots after marking a chat as read', async () => {
			const state = createEmptyState();
			state.projectsById.set('project-1', {
				id: 'project-1',
				localPath: '/tmp/project',
				title: 'Project',
				createdAt: 1,
				updatedAt: 1,
			});
			state.projectIdsByPath.set('/tmp/project', 'project-1');
			state.chatsById.set('chat-1', {
				id: 'chat-1',
				projectId: 'project-1',
				title: 'Chat',
				createdAt: 1,
				updatedAt: 1,
				unread: true,
				provider: null,
				planMode: false,
				sessionToken: null,
				lastTurnOutcome: null,
			});
			const router = createRouter({
				store: {
					state,
					pruneStaleEmptyChats: async () => {},
					setChatReadState: async (chatId: string, unread: boolean) => {
						const chat = state.chatsById.get(chatId);
						if (chat) chat.unread = unread;
					},
				},
			});
			const ws = new FakeWebSocket();

			router.handleOpen(ws as never);
			ws.data.subscriptions.set('sub-1', { type: 'sidebar' });

			await router.handleMessage(
				ws as never,
				JSON.stringify({
					v: 1,
					type: 'command',
					id: 'read-1',
					command: { type: 'chat.markRead', chatId: 'chat-1' },
				}),
			);

			expect(ws.sent[0]).toEqual({ type: 'ack', id: 'read-1' });
			expect(ws.sent[1]).toMatchObject({
				id: 'sub-1',
				snapshot: {
					type: 'sidebar',
					data: {
						projectGroups: [
							{
								chats: [{ chatId: 'chat-1', unread: false }],
							},
						],
					},
				},
			});
		});
	});

	describe('createWsRouter.handleOpen', () => {
		test('adds sockets to future broadcasts', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			ws.data.subscriptions.set('sub-1', { type: 'sidebar' });
			router.handleOpen(ws as never);
			await router.broadcastSnapshots();

			expect(ws.sent[0]).toMatchObject({
				id: 'sub-1',
				snapshot: { type: 'sidebar' },
			});
		});
	});

	describe('createWsRouter.handleClose', () => {
		test('removes sockets from future broadcasts', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			ws.data.subscriptions.set('sub-1', { type: 'sidebar' });
			router.handleOpen(ws as never);
			router.handleClose(ws as never);
			await router.broadcastSnapshots();

			expect(ws.sent).toEqual([]);
		});
	});

	describe('createWsRouter.handleMessage', () => {
		test('returns an error for invalid JSON', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			await router.handleMessage(ws as never, '{');

			expect(ws.sent).toEqual([{ type: 'error', message: 'Invalid JSON' }]);
		});

		test('returns an error for invalid envelopes', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			await router.handleMessage(ws as never, JSON.stringify({ hello: 'world' }));

			expect(ws.sent).toEqual([{ type: 'error', message: 'Invalid envolope' }]);
		});

		test('subscribes and sends snapshots', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({ v: 1, type: 'subscribe', id: 'sub-1', topic: { type: 'sidebar' } }),
			);

			expect(ws.data.subscriptions.get('sub-1')).toEqual({ type: 'sidebar' });
			expect(ws.sent[0]).toMatchObject({
				id: 'sub-1',
				snapshot: { type: 'sidebar' },
			});
		});

		test('refreshes discovery before local project snapshots', async () => {
			let refreshed = false;
			const router = createRouter({
				refreshDiscovery: async () => {
					refreshed = true;
					return [];
				},
			});
			const ws = new FakeWebSocket();

			await router.handleMessage(
				ws as never,
				JSON.stringify({
					v: 1,
					type: 'subscribe',
					id: 'sub-1',
					topic: { type: 'local-projects' },
				}),
			);
			
			await Bun.sleep(0);

			expect(refreshed).toBe(true);
			expect(ws.sent[0]).toMatchObject({
				id: 'sub-1',
				snapshot: { type: 'local-projects' },
			});
		});

		test('unsubscribes and acknowledges the request', async () => {
			const router = createRouter();
			const ws = new FakeWebSocket();
			ws.data.subscriptions.set('sub-1', { type: 'sidebar' });

			await router.handleMessage(
				ws as never,
				JSON.stringify({ v: 1, type: 'unsubscribe', id: 'sub-1' }),
			);

			expect(ws.data.subscriptions.has('sub-1')).toBe(false);
			expect(ws.sent).toEqual([{ type: 'ack', id: 'sub-1' }]);
		});
	});

	describe('createWsRouter.dispose', () => {
		test('clears the reporter and disposes listeners', () => {
			let clearedReporter: unknown;
			let terminalDisposed = false;
			let keybindingsDisposed = false;
			let updateDisposed = false;
			const router = createRouter({
				agent: {
					getActiveStatuses: () => new Map(),
					getDrainingChatIds: () => new Set(),
					setBackgroundErrorReporter: (reporter: unknown) => {
						clearedReporter = reporter;
					},
				},
				terminals: {
					getSnapshot: () => null,
					onEvent: () => () => {
						terminalDisposed = true;
					},
				},
				keybindings: {
					getSnapshot: () => ({ bindings: {}, warnings: [], filePath: '/tmp/keybindings.json' }),
					onChange: () => () => {
						keybindingsDisposed = true;
					},
				},
				updateManager: {
					onChange: () => () => {
						updateDisposed = true;
					},
				},
			});

			router.dispose();

			expect(clearedReporter).toBeNull();
			expect(terminalDisposed).toBe(true);
			expect(keybindingsDisposed).toBe(true);
			expect(updateDisposed).toBe(true);
		});
	});
});
