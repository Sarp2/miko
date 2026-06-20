import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerEnvelope } from '../../shared/protocol';
import type { SessionSnapshot, TranscriptEntry } from '../../shared/types';
import { useChatWindowStore } from './chat-window-store';
import { useSessionStore } from './session-store';
import { useWsStore } from './ws-store';

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readonly sent: string[] = [];
	readonly url: string;
	readyState = FakeWebSocket.CONNECTING;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}

	send(message: string) {
		this.sent.push(message);
	}

	close() {
		this.readyState = FakeWebSocket.CLOSED;
		this.onclose?.();
	}

	open() {
		this.readyState = FakeWebSocket.OPEN;
		this.onopen?.();
	}

	receive(envelope: ServerEnvelope) {
		this.onmessage?.({ data: JSON.stringify(envelope) });
	}
}

function entry(id: string, createdAt: number, text = id): TranscriptEntry {
	return {
		_id: id,
		createdAt,
		kind: 'assistant_text',
		text,
	};
}

function sessionSnapshot(
	sessionId: string,
	workspaceId = 'workspace-1',
	messages: TranscriptEntry[] = [],
	history: SessionSnapshot['history'] = { hasOlder: false, olderCursor: null, recentLimit: 300 },
): SessionSnapshot {
	return {
		runtime: {
			sessionId,
			workspaceId,
			directoryId: 'directory-1',
			localPath: '/repo/miko/atlas',
			title: 'Build the thing',
			status: 'idle',
			isDraining: false,
			provider: 'claude',
			planMode: false,
			sessionToken: null,
			pendingTool: null,
			queued: [],
		},
		messages,
		history,
		availableProviders: [],
	};
}

function resetStores() {
	for (const sessionId of useSessionStore.getState().connectedSessionIds) {
		useSessionStore.getState().disconnectSession(sessionId);
	}
	useWsStore.getState().disconnect();
	useChatWindowStore.setState({
		windowBySessionId: new Map(),
		nextGeneration: 1,
	});
	useSessionStore.setState({
		snapshotBySessionId: new Map(),
		connectedSessionIds: new Set(),
		sessionWorkspaceIdBySessionId: new Map(),
	});
	useWsStore.setState({
		status: 'idle',
		lastError: null,
		subscriptionsById: new Map(),
		snapshotsBySubscriptionId: new Map(),
		pendingCommandsById: new Map(),
	});
}

function removeMockedBrowserGlobals() {
	delete (globalThis as { window?: unknown }).window;
	delete (globalThis as { WebSocket?: unknown }).WebSocket;
}

beforeEach(() => {
	FakeWebSocket.instances = [];
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { location: { protocol: 'http:', host: 'localhost:5173' } },
	});
	Object.defineProperty(globalThis, 'WebSocket', {
		configurable: true,
		value: FakeWebSocket,
	});
	resetStores();
});

afterEach(() => {
	resetStores();
	removeMockedBrowserGlobals();
});

describe('useSessionStore.connectSession', () => {
	test('subscribes to a session snapshot and exposes it by session id', () => {
		useSessionStore.getState().connectSession('session-1', {
			workspaceId: 'workspace-1',
			recentLimit: 150,
		});

		const socket = FakeWebSocket.instances[0];
		socket.open();

		expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
			{
				type: 'subscribe',
				id: 'session:session-1',
				topic: { type: 'session', sessionId: 'session-1', recentLimit: 150 },
			},
		]);

		expect(useSessionStore.getState().connectedSessionIds.has('session-1')).toBe(true);
		expect(useSessionStore.getState().sessionWorkspaceIdBySessionId.get('session-1')).toBe(
			'workspace-1',
		);

		const snapshot = sessionSnapshot('session-1');
		socket.receive({
			type: 'snapshot',
			id: 'session:session-1',
			snapshot: { type: 'session', data: snapshot },
		});

		expect(useSessionStore.getState().getSessionSnapshot('session-1')).toEqual(snapshot);
		expect(useChatWindowStore.getState().getWindow('session-1')?.messages).toEqual(
			snapshot.messages,
		);
	});
});

describe('useSessionStore.syncWorkspaceSessions', () => {
	test('connects desired workspace sessions and unsubscribes stale ones', () => {
		useSessionStore.getState().syncWorkspaceSessions('workspace-1', ['session-1', 'session-2']);
		const socket = FakeWebSocket.instances[0];
		socket.open();

		expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
			{
				type: 'subscribe',
				id: 'session:session-1',
				topic: { type: 'session', sessionId: 'session-1' },
			},
			{
				type: 'subscribe',
				id: 'session:session-2',
				topic: { type: 'session', sessionId: 'session-2' },
			},
		]);

		useSessionStore.getState().syncWorkspaceSessions('workspace-1', ['session-2', 'session-3']);

		expect(socket.sent.map((message) => JSON.parse(message)).slice(2)).toEqual([
			{ type: 'unsubscribe', id: 'session:session-1' },
			{
				type: 'subscribe',
				id: 'session:session-3',
				topic: { type: 'session', sessionId: 'session-3' },
			},
		]);
		expect([...useSessionStore.getState().connectedSessionIds].sort()).toEqual([
			'session-2',
			'session-3',
		]);
	});

	test('resets stale chat windows when workspace sessions are unsubscribed', () => {
		useSessionStore.getState().syncWorkspaceSessions('workspace-1', ['session-1', 'session-2']);
		const socket = FakeWebSocket.instances[0];
		socket.open();
		socket.receive({
			type: 'snapshot',
			id: 'session:session-1',
			snapshot: {
				type: 'session',
				data: sessionSnapshot('session-1', 'workspace-1', [entry('m1', 1)]),
			},
		});

		expect(useChatWindowStore.getState().getWindow('session-1')?.messages).toHaveLength(1);

		useSessionStore.getState().syncWorkspaceSessions('workspace-1', ['session-2']);

		expect(useChatWindowStore.getState().getWindow('session-1')).toBeNull();
	});
});

describe('useSessionStore.disconnectWorkspaceSessions', () => {
	test('unsubscribes every session connected for the workspace', () => {
		useSessionStore.getState().syncWorkspaceSessions('workspace-1', ['session-1', 'session-2']);
		useSessionStore.getState().connectSession('session-other', { workspaceId: 'workspace-2' });

		const socket = FakeWebSocket.instances[0];
		socket.open();

		useSessionStore.getState().disconnectWorkspaceSessions('workspace-1');

		expect(socket.sent.map((message) => JSON.parse(message)).slice(3)).toEqual([
			{ type: 'unsubscribe', id: 'session:session-1' },
			{ type: 'unsubscribe', id: 'session:session-2' },
		]);
		expect([...useSessionStore.getState().connectedSessionIds]).toEqual(['session-other']);
	});

	test('resets chat windows for sessions disconnected from the workspace', () => {
		useSessionStore.getState().syncWorkspaceSessions('workspace-1', ['session-1']);
		const socket = FakeWebSocket.instances[0];
		socket.open();
		socket.receive({
			type: 'snapshot',
			id: 'session:session-1',
			snapshot: {
				type: 'session',
				data: sessionSnapshot('session-1', 'workspace-1', [entry('m1', 1)]),
			},
		});

		useSessionStore.getState().disconnectWorkspaceSessions('workspace-1');

		expect(useChatWindowStore.getState().getWindow('session-1')).toBeNull();
	});
});

describe('useSessionStore.sendSessionMessage', () => {
	test('forwards session send through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useSessionStore.getState().sendSessionMessage({
			sessionId: 'session-1',
			workspaceId: 'workspace-1',
			content: 'Build it',
			modelOptions: {},
		});

		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: {
				type: 'session.send',
				sessionId: 'session-1',
				workspaceId: 'workspace-1',
				content: 'Build it',
				modelOptions: {},
			},
		});

		socket.receive({ type: 'ack', id: sent.id, result: { sessionId: 'session-1' } });
		await expect(resultPromise).resolves.toEqual({ sessionId: 'session-1' });
	});
});

describe('useSessionStore.loadHistory', () => {
	test('forwards history pagination through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useSessionStore.getState().loadHistory('session-1', 'idx:10', 50);
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: {
				type: 'session.loadHistory',
				sessionId: 'session-1',
				beforeCursor: 'idx:10',
				limit: 50,
			},
		});

		socket.receive({
			type: 'ack',
			id: sent.id,
			result: { messages: [], hasOlder: false, olderCursor: null },
		});

		await expect(resultPromise).resolves.toEqual({
			messages: [],
			hasOlder: false,
			olderCursor: null,
		});
	});
});

describe('useSessionStore.loadOlderChatWindow', () => {
	test('loads older transcript history and applies it to the chat window', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', 'workspace-1', [entry('m3', 3)], {
				hasOlder: true,
				olderCursor: 'idx:2',
				recentLimit: 80,
			}),
		);

		const loadPromise = useSessionStore.getState().loadOlderChatWindow('session-1', 40);
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: {
				type: 'session.loadHistory',
				sessionId: 'session-1',
				beforeCursor: 'idx:2',
				limit: 40,
			},
		});
		expect(useChatWindowStore.getState().getWindow('session-1')?.loadingOlder).toBe(true);

		socket.receive({
			type: 'ack',
			id: sent.id,
			result: {
				messages: [entry('m1', 1), entry('m2', 2)],
				hasOlder: false,
				olderCursor: null,
			},
		});
		await loadPromise;

		const window = useChatWindowStore.getState().getWindow('session-1');
		expect(window?.messages.map((message) => message._id)).toEqual(['m1', 'm2', 'm3']);
		expect(window?.loadingOlder).toBe(false);
		expect(window?.hasOlder).toBe(false);
	});
});
