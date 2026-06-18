import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerEnvelope } from '../../shared/protocol';
import { DIRECTORY_LIST_SUBSCRIPTION_ID, useDirectoryListStore } from './directory-list-store';
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

function resetStores() {
	useDirectoryListStore.getState().disconnectDirectoryList();
	useWsStore.getState().disconnect();
	useDirectoryListStore.setState({ snapshot: null, isSubscribed: false });
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

describe('useDirectoryListStore.connectDirectoryList', () => {
	test('subscribes to directory snapshots and exposes workspace activity', () => {
		useDirectoryListStore.getState().connectDirectoryList();

		const socket = FakeWebSocket.instances[0];
		socket.open();

		expect(useDirectoryListStore.getState().isSubscribed).toBe(true);
		expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
			{
				type: 'subscribe',
				id: DIRECTORY_LIST_SUBSCRIPTION_ID,
				topic: { type: 'directories' },
			},
		]);

		socket.receive({
			type: 'snapshot',
			id: DIRECTORY_LIST_SUBSCRIPTION_ID,
			snapshot: {
				type: 'directories',
				data: {
					machine: { id: 'local', displayName: 'Sarp’s MacBook' },
					directories: [
						{
							id: 'directory-1',
							localPath: '/repo/miko',
							title: 'miko',
							githubOwner: 'Sarp2',
							githubRepo: 'miko',
							defaultBranchName: 'main',
							createdAt: 1,
							updatedAt: 2,
						},
					],
					workspaces: [
						{
							id: 'workspace-1',
							directoryId: 'directory-1',
							localPath: '/repo/miko/atlas',
							branchName: 'atlas',
							setupState: 'ready',
							reviewState: 'in_progress',
							visibilityState: 'active',
							hasUnreadAgentResult: false,
							createdAt: 3,
							updatedAt: 4,
						},
					],
				},
			},
		});

		expect(useDirectoryListStore.getState().snapshot?.directories).toHaveLength(1);
		expect(useDirectoryListStore.getState().snapshot?.workspaces[0]?.visibilityState).toBe(
			'active',
		);
	});
});

describe('useDirectoryListStore management commands', () => {
	test('forwards directory removal through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useDirectoryListStore.getState().removeDirectory('directory-1');
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: { type: 'directory.remove', directoryId: 'directory-1' },
		});

		socket.receive({ type: 'ack', id: sent.id });
		await expect(resultPromise).resolves.toBeUndefined();
	});

	test('forwards workspace removal through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useDirectoryListStore.getState().removeWorkspace('workspace-1');
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: { type: 'workspace.remove', workspaceId: 'workspace-1' },
		});

		socket.receive({ type: 'ack', id: sent.id });
		await expect(resultPromise).resolves.toBeUndefined();
	});

	test('forwards workspace visibility changes through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useDirectoryListStore
			.getState()
			.setWorkspaceVisibility('workspace-1', 'archived');
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: {
				type: 'workspace.setVisibility',
				workspaceId: 'workspace-1',
				visibilityState: 'archived',
			},
		});

		socket.receive({ type: 'ack', id: sent.id });
		await expect(resultPromise).resolves.toBeUndefined();
	});
});
