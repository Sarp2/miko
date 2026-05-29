import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerEnvelope } from '../../shared/protocol';
import { SIDEBAR_SUBSCRIPTION_ID, useSidebarStore } from './sidebar-store';
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
	useSidebarStore.getState().disconnectSidebar();
	useWsStore.getState().disconnect();
	useSidebarStore.setState({ snapshot: null, isSubscribed: false });
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

describe('useSidebarStore.connectSidebar', () => {
	test('subscribes to the sidebar snapshot and exposes the latest data', () => {
		useSidebarStore.getState().connectSidebar();

		const socket = FakeWebSocket.instances[0];
		socket.open();

		expect(useSidebarStore.getState().isSubscribed).toBe(true);
		expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
			{ type: 'subscribe', id: SIDEBAR_SUBSCRIPTION_ID, topic: { type: 'sidebar' } },
		]);

		socket.receive({
			type: 'snapshot',
			id: SIDEBAR_SUBSCRIPTION_ID,
			snapshot: {
				type: 'sidebar',
				data: {
					directoryGroups: [
						{
							groupKey: 'directory-1',
							directoryId: 'directory-1',
							localPath: '/repo/miko',
							title: 'Miko',
							createdAt: 1,
							updatedAt: 1,
							workspaces: [],
						},
					],
				},
			},
		});

		expect(useSidebarStore.getState().snapshot?.directoryGroups).toHaveLength(1);
		expect(useSidebarStore.getState().snapshot?.directoryGroups[0]?.title).toBe('Miko');
	});
});

describe('useSidebarStore.addDirectory', () => {
	test('forwards directory add through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useSidebarStore.getState().addDirectory('/Users/sarp/code/miko');
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: { type: 'directory.add', localPath: '/Users/sarp/code/miko' },
		});

		socket.receive({ type: 'ack', id: sent.id, result: { directoryId: 'directory-1' } });
		await expect(resultPromise).resolves.toEqual({ directoryId: 'directory-1' });
	});
});

describe('useSidebarStore.createWorkspace', () => {
	test('forwards workspace creation through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useSidebarStore.getState().createWorkspace('directory-1');
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: { type: 'workspace.create', directoryId: 'directory-1' },
		});

		socket.receive({
			type: 'ack',
			id: sent.id,
			result: { workspaceId: 'workspace-1', sessionId: 'session-1' },
		});

		await expect(resultPromise).resolves.toEqual({
			workspaceId: 'workspace-1',
			sessionId: 'session-1',
		});
	});
});

describe('useSidebarStore.setWorkspaceVisibility', () => {
	test('forwards visibility changes through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useSidebarStore
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
