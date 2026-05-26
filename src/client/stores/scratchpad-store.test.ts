import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerEnvelope } from '../../shared/protocol';
import { useScratchpadStore } from './scratchpad-store';
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
	for (const workspaceId of useScratchpadStore.getState().connectedWorkspaceIds) {
		useScratchpadStore.getState().disconnectScratchpad(workspaceId);
	}
	useWsStore.getState().disconnect();
	useScratchpadStore.setState({
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

describe('useScratchpadStore.connectScratchpad', () => {
	test('subscribes to a scratchpad snapshot and exposes it by workspace id', () => {
		useScratchpadStore.getState().connectScratchpad('workspace-1');

		const socket = FakeWebSocket.instances[0];
		socket.open();

		expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
			{
				type: 'subscribe',
				id: 'scratchpad:workspace-1',
				topic: { type: 'scratchpad', workspaceId: 'workspace-1' },
			},
		]);

		expect(useScratchpadStore.getState().connectedWorkspaceIds.has('workspace-1')).toBe(true);

		const snapshot = { workspaceId: 'workspace-1', content: '# Notes', updatedAt: 123 };
		socket.receive({
			type: 'snapshot',
			id: 'scratchpad:workspace-1',
			snapshot: { type: 'scratchpad', data: snapshot },
		});

		expect(useScratchpadStore.getState().getScratchpadSnapshot('workspace-1')).toEqual(snapshot);
	});
});

describe('useScratchpadStore.disconnectScratchpad', () => {
	test('unsubscribes and removes the scratchpad snapshot', () => {
		useScratchpadStore.getState().connectScratchpad('workspace-1');
		const socket = FakeWebSocket.instances[0];
		socket.open();
		socket.receive({
			type: 'snapshot',
			id: 'scratchpad:workspace-1',
			snapshot: {
				type: 'scratchpad',
				data: { workspaceId: 'workspace-1', content: '# Notes', updatedAt: 123 },
			},
		});

		useScratchpadStore.getState().disconnectScratchpad('workspace-1');

		expect(socket.sent.map((message) => JSON.parse(message)).at(-1)).toEqual({
			type: 'unsubscribe',
			id: 'scratchpad:workspace-1',
		});

		expect(useScratchpadStore.getState().connectedWorkspaceIds.has('workspace-1')).toBe(false);
		expect(useScratchpadStore.getState().getScratchpadSnapshot('workspace-1')).toBeNull();
	});
});

describe('useScratchpadStore.updateScratchpad', () => {
	test('forwards scratchpad updates through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useScratchpadStore
			.getState()
			.updateScratchpad('workspace-1', '# Updated');

		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: {
				type: 'workspace.updateScratchpad',
				workspaceId: 'workspace-1',
				content: '# Updated',
			},
		});

		socket.receive({
			type: 'ack',
			id: sent.id,
			result: { workspaceId: 'workspace-1', content: '# Updated', updatedAt: 456 },
		});

		await expect(resultPromise).resolves.toEqual({
			workspaceId: 'workspace-1',
			content: '# Updated',
			updatedAt: 456,
		});
	});
});
