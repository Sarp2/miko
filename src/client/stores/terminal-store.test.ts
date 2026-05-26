import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerEnvelope, TerminalSnapshot } from '../../shared/protocol';
import { useTerminalStore } from './terminal-store';
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

function terminalSnapshot(terminalId: string): TerminalSnapshot {
	return {
		terminalId,
		title: 'Terminal',
		cwd: '/repo/miko/atlas',
		shell: '/bin/zsh',
		cols: 120,
		rows: 30,
		scrollback: 5000,
		serializedState: 'serialized',
		status: 'running',
		exitCode: null,
	};
}

function resetStores() {
	for (const terminalId of useTerminalStore.getState().connectedTerminalIds) {
		useTerminalStore.getState().disconnectTerminal(terminalId);
	}
	useWsStore.getState().disconnect();
	useTerminalStore.setState({
		snapshotByTerminalId: new Map(),
		connectedTerminalIds: new Set(),
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

describe('useTerminalStore.connectTerminal', () => {
	test('subscribes to a terminal snapshot and exposes it by terminal id', () => {
		useTerminalStore.getState().connectTerminal('terminal-1');

		const socket = FakeWebSocket.instances[0];
		socket.open();

		expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
			{
				type: 'subscribe',
				id: 'terminal:terminal-1',
				topic: { type: 'terminal', terminalId: 'terminal-1' },
			},
		]);

		expect(useTerminalStore.getState().connectedTerminalIds.has('terminal-1')).toBe(true);

		const snapshot = terminalSnapshot('terminal-1');
		socket.receive({
			type: 'snapshot',
			id: 'terminal:terminal-1',
			snapshot: { type: 'terminal', data: snapshot },
		});

		expect(useTerminalStore.getState().getTerminalSnapshot('terminal-1')).toEqual(snapshot);
	});

	test('stores null when the backend has no terminal snapshot', () => {
		useTerminalStore.getState().connectTerminal('terminal-1');
		const socket = FakeWebSocket.instances[0];
		socket.open();

		socket.receive({
			type: 'snapshot',
			id: 'terminal:terminal-1',
			snapshot: { type: 'terminal', data: null },
		});

		expect(useTerminalStore.getState().snapshotByTerminalId.has('terminal-1')).toBe(true);
		expect(useTerminalStore.getState().getTerminalSnapshot('terminal-1')).toBeNull();
	});
});

describe('useTerminalStore.disconnectTerminal', () => {
	test('unsubscribes and removes the terminal snapshot', () => {
		useTerminalStore.getState().connectTerminal('terminal-1');
		const socket = FakeWebSocket.instances[0];
		socket.open();
		socket.receive({
			type: 'snapshot',
			id: 'terminal:terminal-1',
			snapshot: { type: 'terminal', data: terminalSnapshot('terminal-1') },
		});

		useTerminalStore.getState().disconnectTerminal('terminal-1');

		expect(socket.sent.map((message) => JSON.parse(message)).at(-1)).toEqual({
			type: 'unsubscribe',
			id: 'terminal:terminal-1',
		});
		expect(useTerminalStore.getState().connectedTerminalIds.has('terminal-1')).toBe(false);
		expect(useTerminalStore.getState().getTerminalSnapshot('terminal-1')).toBeNull();
	});
});

describe('useTerminalStore.createTerminal', () => {
	test('forwards terminal creation through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useTerminalStore.getState().createTerminal({
			workspaceId: 'workspace-1',
			terminalId: 'terminal-1',
			cols: 120,
			rows: 30,
			scrollback: 5000,
		});
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: {
				type: 'terminal.create',
				workspaceId: 'workspace-1',
				terminalId: 'terminal-1',
				cols: 120,
				rows: 30,
				scrollback: 5000,
			},
		});

		const snapshot = terminalSnapshot('terminal-1');
		socket.receive({ type: 'ack', id: sent.id, result: snapshot });

		await expect(resultPromise).resolves.toEqual(snapshot);
	});
});

describe('useTerminalStore.writeTerminal', () => {
	test('forwards terminal input through the websocket command flow', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useTerminalStore.getState().writeTerminal('terminal-1', 'ls\n');
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: { type: 'terminal.input', terminalId: 'terminal-1', data: 'ls\n' },
		});

		socket.receive({ type: 'ack', id: sent.id });
		await expect(resultPromise).resolves.toBeUndefined();
	});
});

describe('useTerminalStore.closeTerminal', () => {
	test('forwards terminal close and disconnects the terminal subscription', async () => {
		useTerminalStore.getState().connectTerminal('terminal-1');
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const resultPromise = useTerminalStore.getState().closeTerminal('terminal-1');
		const sent = JSON.parse(socket.sent.at(-1) ?? '{}');

		expect(sent).toMatchObject({
			type: 'command',
			command: { type: 'terminal.close', terminalId: 'terminal-1' },
		});

		socket.receive({ type: 'ack', id: sent.id });

		await expect(resultPromise).resolves.toBeUndefined();
		expect(socket.sent.map((message) => JSON.parse(message)).at(-1)).toEqual({
			type: 'unsubscribe',
			id: 'terminal:terminal-1',
		});
		expect(useTerminalStore.getState().connectedTerminalIds.has('terminal-1')).toBe(false);
	});
});

describe('useTerminalStore.addTerminalEventListener', () => {
	test('forwards terminal events from the websocket store', () => {
		const receivedEvents: unknown[] = [];
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();
		const unsubscribe = useTerminalStore.getState().addTerminalEventListener((event, id) => {
			receivedEvents.push({ event, id });
		});

		socket.receive({
			type: 'event',
			id: 'terminal:terminal-1',
			event: { type: 'terminal.output', terminalId: 'terminal-1', data: 'hello' },
		});

		expect(receivedEvents).toEqual([
			{
				id: 'terminal:terminal-1',
				event: { type: 'terminal.output', terminalId: 'terminal-1', data: 'hello' },
			},
		]);

		unsubscribe();
	});
});
