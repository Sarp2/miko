import { create } from 'zustand';
import type {
	ClientCommand,
	ServerEnvelope,
	ServerSnapshot,
	SubscriptionTopic,
	TerminalEvent,
} from '../../shared/protocol';

export type WsConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface PendingCommand {
	id: string;
	command: ClientCommand;
	createdAt: number;
}

interface PendingResolver {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout> | null;
}

interface CommandOptions {
	timeoutMs?: number;
}

interface WsStoreState {
	status: WsConnectionStatus;
	lastError: string | null;
	subscriptionsById: Map<string, SubscriptionTopic>;
	snapshotsBySubscriptionId: Map<string, ServerSnapshot>;
	pendingCommandsById: Map<string, PendingCommand>;
	connect: () => void;
	disconnect: () => void;
	subscribeTopic: (id: string, topic: SubscriptionTopic) => void;
	unsubscribeTopic: (id: string) => void;
	command: <TResult = unknown>(
		command: ClientCommand,
		options?: CommandOptions,
	) => Promise<TResult>;
	addEventListener: (listener: WsEventListener) => () => void;
}

type WsEventListener = (event: TerminalEvent, subscriptionId: string) => void;

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const RECONNECT_DELAY_MS = 750;

let socket: WebSocket | null = null;
let shouldReconnect = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const pendingResolversById = new Map<string, PendingResolver>();
const eventListeners = new Set<WsEventListener>();

function createRequestId(prefix: string) {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getWebSocketUrl() {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${protocol}//${window.location.host}/ws`;
}

function sendEnvelope(envelope: unknown) {
	if (!socket || socket.readyState !== WebSocket.OPEN) {
		throw new Error('WebSocket is not open');
	}
	socket.send(JSON.stringify(envelope));
}

function topicsEqual(left: SubscriptionTopic, right: SubscriptionTopic) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function clearReconnectTimer() {
	if (!reconnectTimer) return;
	clearTimeout(reconnectTimer);
	reconnectTimer = null;
}

function scheduleReconnect() {
	if (!shouldReconnect || reconnectTimer) return;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		useWsStore.getState().connect();
	}, RECONNECT_DELAY_MS);
}

function rejectPendingCommands(message: string) {
	for (const [id, pending] of pendingResolversById.entries()) {
		if (pending.timeout) clearTimeout(pending.timeout);
		pending.reject(new Error(message));
		pendingResolversById.delete(id);
	}
	useWsStore.setState({ pendingCommandsById: new Map() });
}

function removePendingCommand(id: string) {
	useWsStore.setState((state) => {
		const pendingCommandsById = new Map(state.pendingCommandsById);
		pendingCommandsById.delete(id);
		return { pendingCommandsById };
	});
}

function resendSubscriptions() {
	for (const [id, topic] of useWsStore.getState().subscriptionsById.entries()) {
		sendEnvelope({ type: 'subscribe', id, topic });
	}
}

function handleSnapshot(envelope: Extract<ServerEnvelope, { type: 'snapshot' }>) {
	useWsStore.setState((state) => {
		const snapshotsBySubscriptionId = new Map(state.snapshotsBySubscriptionId);
		snapshotsBySubscriptionId.set(envelope.id, envelope.snapshot);
		return { snapshotsBySubscriptionId };
	});
}

function handleAck(envelope: Extract<ServerEnvelope, { type: 'ack' }>) {
	const pending = pendingResolversById.get(envelope.id);
	if (!pending) return;
	if (pending.timeout) clearTimeout(pending.timeout);

	pendingResolversById.delete(envelope.id);
	removePendingCommand(envelope.id);
	pending.resolve(envelope.result);
}

function handleError(envelope: Extract<ServerEnvelope, { type: 'error' }>) {
	if (!envelope.id) {
		useWsStore.setState({ lastError: envelope.message });
		return;
	}

	const pending = pendingResolversById.get(envelope.id);

	if (!pending) return;
	if (pending.timeout) clearTimeout(pending.timeout);

	pendingResolversById.delete(envelope.id);
	removePendingCommand(envelope.id);
	pending.reject(new Error(envelope.message));
}

function handleEvent(envelope: Extract<ServerEnvelope, { type: 'event' }>) {
	for (const listener of eventListeners) {
		listener(envelope.event, envelope.id);
	}
}

function handleServerEnvelope(envelope: ServerEnvelope) {
	if (envelope.type === 'snapshot') {
		handleSnapshot(envelope);
		return;
	}
	if (envelope.type === 'ack') {
		handleAck(envelope);
		return;
	}
	if (envelope.type === 'error') {
		handleError(envelope);
		return;
	}
	if (envelope.type === 'event') {
		handleEvent(envelope);
		return;
	}
	useWsStore.setState({ lastError: 'Unknown WebSocket envelope type' });
}

export const useWsStore = create<WsStoreState>((set, get) => ({
	status: 'idle',
	lastError: null,
	subscriptionsById: new Map(),
	snapshotsBySubscriptionId: new Map(),
	pendingCommandsById: new Map(),

	connect: () => {
		shouldReconnect = true;
		clearReconnectTimer();

		if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
			return;
		}

		set({ status: 'connecting', lastError: null });
		const nextSocket = new WebSocket(getWebSocketUrl());
		socket = nextSocket;

		nextSocket.onopen = () => {
			if (socket !== nextSocket) return;
			set({ status: 'open', lastError: null });
			resendSubscriptions();
		};

		nextSocket.onmessage = (event) => {
			if (socket !== nextSocket) return;
			try {
				handleServerEnvelope(JSON.parse(String(event.data)) as ServerEnvelope);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				set({ lastError: `Invalid WebSocket message: ${message}` });
			}
		};

		nextSocket.onerror = () => {
			if (socket !== nextSocket) return;
			set({ status: 'error', lastError: 'WebSocket connection error' });
		};

		nextSocket.onclose = () => {
			if (socket !== nextSocket) return;
			socket = null;
			set({ status: 'closed' });
			rejectPendingCommands('WebSocket closed before command completed');
			scheduleReconnect();
		};
	},

	disconnect: () => {
		shouldReconnect = false;
		clearReconnectTimer();
		const currentSocket = socket;
		socket = null;
		currentSocket?.close();
		rejectPendingCommands('WebSocket disconnected');
		eventListeners.clear();
		set({ status: 'closed' });
	},

	subscribeTopic: (id, topic) => {
		const previousTopic = get().subscriptionsById.get(id);
		if (previousTopic && topicsEqual(previousTopic, topic)) return;

		set((state) => {
			const subscriptionsById = new Map(state.subscriptionsById);
			subscriptionsById.set(id, topic);
			return { subscriptionsById };
		});

		if (!socket || socket.readyState !== WebSocket.OPEN) {
			get().connect();
			return;
		}

		sendEnvelope({ type: 'subscribe', id, topic });
	},

	unsubscribeTopic: (id) => {
		set((state) => {
			const subscriptionsById = new Map(state.subscriptionsById);
			const snapshotsBySubscriptionId = new Map(state.snapshotsBySubscriptionId);

			subscriptionsById.delete(id);
			snapshotsBySubscriptionId.delete(id);
			return { subscriptionsById, snapshotsBySubscriptionId };
		});

		if (!socket || socket.readyState !== WebSocket.OPEN) return;
		sendEnvelope({ type: 'unsubscribe', id });
	},

	command: <TResult = unknown>(command: ClientCommand, options: CommandOptions = {}) => {
		const id = createRequestId('cmd');
		const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error('WebSocket is not open'));
		}

		const pendingCommand: PendingCommand = { id, command, createdAt: Date.now() };
		set((state) => {
			const pendingCommandsById = new Map(state.pendingCommandsById);
			pendingCommandsById.set(id, pendingCommand);
			return { pendingCommandsById };
		});

		return new Promise<TResult>((resolve, reject) => {
			const timeout = setTimeout(() => {
				pendingResolversById.delete(id);
				removePendingCommand(id);
				reject(new Error(`Command timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			pendingResolversById.set(id, {
				resolve: (value) => resolve(value as TResult),
				reject,
				timeout,
			});

			try {
				sendEnvelope({ type: 'command', id, command });
			} catch (error) {
				clearTimeout(timeout);
				pendingResolversById.delete(id);
				removePendingCommand(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	},

	addEventListener: (listener) => {
		eventListeners.add(listener);
		return () => {
			eventListeners.delete(listener);
		};
	},
}));
