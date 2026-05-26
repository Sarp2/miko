import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerEnvelope } from '../../shared/protocol';
import type { WorkspaceSnapshot } from '../../shared/types';
import { useWorkspaceStore } from './workspace-store';
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

function workspaceSnapshot(workspaceId: string): WorkspaceSnapshot {
	return {
		workspace: {
			id: workspaceId,
			directoryId: 'directory-1',
			localPath: '/repo/miko/atlas',
			branchName: 'atlas',
			setupState: 'ready',
			reviewState: 'in_progress',
			visibilityState: 'active',
			hasUnreadAgentResult: false,
			createdAt: 1,
			updatedAt: 1,
		},
		primaryLabel: 'atlas',
		healthState: 'healthy',
		git: null,
		github: null,
		sessions: [],
		hasActiveSession: false,
		hasUnreadAgentResult: false,
	};
}

function resetStores() {
	for (const workspaceId of useWorkspaceStore.getState().connectedWorkspaceIds) {
		useWorkspaceStore.getState().disconnectWorkspace(workspaceId);
	}
	useWsStore.getState().disconnect();
	useWorkspaceStore.setState({
		snapshotByWorkspaceId: new Map(),
		connectedWorkspaceIds: new Set(),
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

describe('useWorkspaceStore.connectWorkspace', () => {
	test('subscribes to a workspace snapshot and exposes it by workspace id', () => {
		useWorkspaceStore.getState().connectWorkspace('workspace-1');

		const socket = FakeWebSocket.instances[0];
		socket.open();

		expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
			{
				type: 'subscribe',
				id: 'workspace:workspace-1',
				topic: { type: 'workspace', workspaceId: 'workspace-1' },
			},
		]);
		expect(useWorkspaceStore.getState().connectedWorkspaceIds.has('workspace-1')).toBe(true);

		const snapshot = workspaceSnapshot('workspace-1');
		socket.receive({
			type: 'snapshot',
			id: 'workspace:workspace-1',
			snapshot: { type: 'workspace', data: snapshot },
		});

		expect(useWorkspaceStore.getState().getWorkspaceSnapshot('workspace-1')).toEqual(snapshot);
	});
});

describe('useWorkspaceStore.disconnectWorkspace', () => {
	test('unsubscribes and removes the workspace snapshot', () => {
		useWorkspaceStore.getState().connectWorkspace('workspace-1');
		const socket = FakeWebSocket.instances[0];
		socket.open();
		socket.receive({
			type: 'snapshot',
			id: 'workspace:workspace-1',
			snapshot: { type: 'workspace', data: workspaceSnapshot('workspace-1') },
		});

		useWorkspaceStore.getState().disconnectWorkspace('workspace-1');

		expect(socket.sent.map((message) => JSON.parse(message)).at(-1)).toEqual({
			type: 'unsubscribe',
			id: 'workspace:workspace-1',
		});

		expect(useWorkspaceStore.getState().connectedWorkspaceIds.has('workspace-1')).toBe(false);
		expect(useWorkspaceStore.getState().getWorkspaceSnapshot('workspace-1')).toBeNull();
	});
});

describe('useWorkspaceStore.refreshGit', () => {
	test('forwards refresh git through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useWorkspaceStore.getState().refreshGit('workspace-1');
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: { type: 'workspace.refreshGit', workspaceId: 'workspace-1' },
		});

		socket.receive({ type: 'ack', id: sent.id, result: { ok: true } });
		await expect(resultPromise).resolves.toEqual({ ok: true });
	});
});

describe('useWorkspaceStore.renameBranch', () => {
	test('forwards branch rename through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useWorkspaceStore.getState().renameBranch('workspace-1', 'orion');
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: {
				type: 'workspace.renameBranch',
				workspaceId: 'workspace-1',
				branchName: 'orion',
			},
		});

		socket.receive({ type: 'ack', id: sent.id, result: { workspaceId: 'workspace-1' } });
		await expect(resultPromise).resolves.toEqual({ workspaceId: 'workspace-1' });
	});
});

describe('useWorkspaceStore.createPr', () => {
	test('forwards create PR instruction through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useWorkspaceStore.getState().createPr('workspace-1', 'session-1');
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: {
				type: 'workspace.createPr',
				workspaceId: 'workspace-1',
				sessionId: 'session-1',
			},
		});

		socket.receive({ type: 'ack', id: sent.id, result: { sessionId: 'session-1' } });
		await expect(resultPromise).resolves.toEqual({ sessionId: 'session-1' });
	});
});

describe('useWorkspaceStore.addressReviewComments', () => {
	test('forwards selected review comments through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useWorkspaceStore
			.getState()
			.addressReviewComments('workspace-1', 'session-1', ['comment-1', 'comment-2']);
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: {
				type: 'workspace.addressReviewComments',
				workspaceId: 'workspace-1',
				sessionId: 'session-1',
				commentIds: ['comment-1', 'comment-2'],
			},
		});

		socket.receive({ type: 'ack', id: sent.id, result: { sessionId: 'session-1' } });
		await expect(resultPromise).resolves.toEqual({ sessionId: 'session-1' });
	});
});
