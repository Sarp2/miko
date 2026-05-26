import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerEnvelope } from '../../shared/protocol';
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
	onerror: (() => void) | null = null;
	onclose: (() => void) | null = null;

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

function resetStore() {
	useWsStore.getState().disconnect();
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
	resetStore();
});

afterEach(() => {
	resetStore();
	removeMockedBrowserGlobals();
});

describe('useWsStore.subscribe', () => {
	test('connects and sends the subscription when the socket opens', () => {
		useWsStore.getState().subscribeTopic('sidebar', { type: 'sidebar' });

		const socket = FakeWebSocket.instances[0];
		expect(socket.url).toBe('ws://localhost:5173/ws');
		expect(useWsStore.getState().status).toBe('connecting');

		socket.open();

		expect(useWsStore.getState().status).toBe('open');
		expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
			{ type: 'subscribe', id: 'sidebar', topic: { type: 'sidebar' } },
		]);
	});

	test('stores snapshots by subscription id', () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		socket.receive({
			type: 'snapshot',
			id: 'sidebar',
			snapshot: { type: 'sidebar', data: { directoryGroups: [] } },
		});

		expect(useWsStore.getState().snapshotsBySubscriptionId.get('sidebar')).toEqual({
			type: 'sidebar',
			data: { directoryGroups: [] },
		});
	});

	test('does not resend an unchanged subscription id and topic', () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		useWsStore.getState().subscribeTopic('sidebar', { type: 'sidebar' });
		useWsStore.getState().subscribeTopic('sidebar', { type: 'sidebar' });

		expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
			{ type: 'subscribe', id: 'sidebar', topic: { type: 'sidebar' } },
		]);
	});
});

describe('useWsStore.command', () => {
	test('resolves with the matching ack result', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useWsStore.getState().command<{ ok: true }>({ type: 'system.ping' });
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({ type: 'command', command: { type: 'system.ping' } });
		expect(useWsStore.getState().pendingCommandsById.has(sent.id)).toBe(true);

		socket.receive({ type: 'ack', id: sent.id, result: { ok: true } });

		await expect(resultPromise).resolves.toEqual({ ok: true });
		expect(useWsStore.getState().pendingCommandsById.has(sent.id)).toBe(false);
	});

	test('rejects with the matching command error', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useWsStore.getState().command({ type: 'system.ping' });
		const sent = JSON.parse(socket.sent[0]);
		socket.receive({ type: 'error', id: sent.id, message: 'boom' });

		await expect(resultPromise).rejects.toThrow('boom');
		expect(useWsStore.getState().lastError).toBeNull();
		expect(useWsStore.getState().pendingCommandsById.has(sent.id)).toBe(false);
	});

	test('stores global errors without command ids as lastError', () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		socket.receive({ type: 'error', message: 'protocol broke' });

		expect(useWsStore.getState().lastError).toBe('protocol broke');
	});
});

describe('useWsStore.message handling', () => {
	test('does not dispatch unknown envelope types as events', () => {
		const receivedEvents: unknown[] = [];
		useWsStore.getState().connect();
		const unsubscribe = useWsStore
			.getState()
			.addEventListener((event) => receivedEvents.push(event));
		const socket = FakeWebSocket.instances[0];
		socket.open();

		socket.onmessage?.({ data: JSON.stringify({ type: 'future-envelope' }) });

		expect(receivedEvents).toEqual([]);
		expect(useWsStore.getState().lastError).toBe('Unknown WebSocket envelope type');
		unsubscribe();
	});
});

describe('useWsStore.disconnect', () => {
	test('rejects pending commands, clears listeners, and preserves no pending command state', async () => {
		const receivedEvents: unknown[] = [];
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();
		useWsStore.getState().addEventListener((event) => receivedEvents.push(event));

		const resultPromise = useWsStore.getState().command({ type: 'system.ping' });
		expect(useWsStore.getState().pendingCommandsById.size).toBe(1);

		useWsStore.getState().disconnect();

		await expect(resultPromise).rejects.toThrow('WebSocket disconnected');
		expect(useWsStore.getState().pendingCommandsById.size).toBe(0);
		expect(useWsStore.getState().status).toBe('closed');

		useWsStore.getState().connect();
		const nextSocket = FakeWebSocket.instances[1];
		nextSocket.open();
		nextSocket.receive({
			type: 'event',
			id: 'terminal-sub',
			event: { type: 'terminal.output', terminalId: 'terminal-1', data: 'ghost' },
		});

		expect(receivedEvents).toEqual([]);
	});
});
