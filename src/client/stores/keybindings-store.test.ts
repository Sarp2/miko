import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerEnvelope } from '../../shared/protocol';
import { DEFAULT_KEYBINDINGS } from '../../shared/types';
import { KEYBINDINGS_SUBSCRIPTION_ID, useKeybindingsStore } from './keybindings-store';
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
	useKeybindingsStore.getState().disconnectKeybindings();
	useWsStore.getState().disconnect();
	useKeybindingsStore.setState({ snapshot: null, isSubscribed: false });
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

describe('useKeybindingsStore.connectKeybindings', () => {
	test('subscribes to keybinding snapshots', () => {
		useKeybindingsStore.getState().connectKeybindings();

		const socket = FakeWebSocket.instances[0];
		socket.open();

		expect(useKeybindingsStore.getState().isSubscribed).toBe(true);
		expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
			{
				type: 'subscribe',
				id: KEYBINDINGS_SUBSCRIPTION_ID,
				topic: { type: 'keybindings' },
			},
		]);

		socket.receive({
			type: 'snapshot',
			id: KEYBINDINGS_SUBSCRIPTION_ID,
			snapshot: {
				type: 'keybindings',
				data: {
					bindings: DEFAULT_KEYBINDINGS,
					warning: null,
					filePathDisplay: '~/.miko/keybindings.json',
				},
			},
		});

		expect(useKeybindingsStore.getState().snapshot?.bindings).toEqual(DEFAULT_KEYBINDINGS);
	});
});

describe('useKeybindingsStore.writeKeybindings', () => {
	test('writes keybindings and updates from the ack result', async () => {
		useWsStore.getState().connect();
		const socket = FakeWebSocket.instances[0];
		socket.open();

		const bindings = {
			...DEFAULT_KEYBINDINGS,
			toggleEmbeddedTerminal: ['cmd+k'],
		};
		const resultPromise = useKeybindingsStore.getState().writeKeybindings(bindings);
		const sent = JSON.parse(socket.sent[0]);

		expect(sent).toMatchObject({
			type: 'command',
			command: { type: 'settings.writeKeybindings', bindings },
		});

		socket.receive({
			type: 'ack',
			id: sent.id,
			result: { bindings, warning: null, filePathDisplay: '~/.miko/keybindings.json' },
		});

		await expect(resultPromise).resolves.toEqual({
			bindings,
			warning: null,
			filePathDisplay: '~/.miko/keybindings.json',
		});
		expect(useKeybindingsStore.getState().snapshot?.bindings.toggleEmbeddedTerminal).toEqual([
			'cmd+k',
		]);
	});
});
