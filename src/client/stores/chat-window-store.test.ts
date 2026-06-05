import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { SessionHistoryPage, SessionSnapshot, TranscriptEntry } from '../../shared/types';
import { useChatWindowStore } from './chat-window-store';
import { useSessionStore } from './session-store';

const initialChatWindowState = useChatWindowStore.getInitialState();
const initialSessionState = useSessionStore.getInitialState();

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
	messages: TranscriptEntry[],
	history: SessionSnapshot['history'] = { hasOlder: false, olderCursor: null, recentLimit: 80 },
): SessionSnapshot {
	return {
		runtime: {
			sessionId,
			workspaceId: 'workspace-1',
			directoryId: 'directory-1',
			localPath: '/repo/miko/atlas',
			title: 'Untitled',
			status: 'idle',
			isDraining: false,
			provider: 'claude',
			planMode: false,
			sessionToken: null,
		},
		messages,
		history,
		availableProviders: [],
	};
}

function useHistoryLoader(
	loader: (sessionId: string, cursor: string, limit: number) => Promise<SessionHistoryPage>,
) {
	useSessionStore.setState({
		loadHistory: loader,
	});
}

beforeEach(() => {
	useChatWindowStore.setState(initialChatWindowState, true);
	useSessionStore.setState(initialSessionState, true);
});

afterEach(() => {
	useChatWindowStore.setState(initialChatWindowState, true);
	useSessionStore.setState(initialSessionState, true);
});

describe('useChatWindowStore.syncFromSnapshot', () => {
	test('initializes a chat window from the recent session snapshot', () => {
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('m2', 2), entry('m3', 3)], {
				hasOlder: true,
				olderCursor: 'idx:2',
				recentLimit: 80,
			}),
		);

		const window = useChatWindowStore.getState().getWindow('session-1');

		expect(window).toMatchObject({
			sessionId: 'session-1',
			hasOlder: true,
			olderCursor: 'idx:2',
			loadingOlder: false,
			initialized: true,
		});
		expect(window?.messages.map((message) => message._id)).toEqual(['m2', 'm3']);
	});

	test('keeps loaded older pages while replacing the recent tail', async () => {
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('m3', 3), entry('m4', 4)], {
				hasOlder: true,
				olderCursor: 'idx:2',
				recentLimit: 80,
			}),
		);
		useHistoryLoader(async () => ({
			messages: [entry('m1', 1), entry('m2', 2)],
			hasOlder: false,
			olderCursor: null,
		}));

		await useChatWindowStore.getState().loadOlder('session-1');

		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('m4', 4, 'updated'), entry('m5', 5)], {
				hasOlder: true,
				olderCursor: 'idx:3',
				recentLimit: 80,
			}),
		);

		const window = useChatWindowStore.getState().getWindow('session-1');

		expect(window?.messages.map((message) => message._id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
		expect(window?.messages.find((message) => message._id === 'm4')).toMatchObject({
			text: 'updated',
		});
		expect(window?.hasOlder).toBe(false);
		expect(window?.olderCursor).toBeNull();
	});

	test('removes the chat window when the session snapshot disappears', () => {
		useChatWindowStore
			.getState()
			.syncFromSnapshot('session-1', sessionSnapshot('session-1', [entry('m1', 1)]));

		useChatWindowStore.getState().syncFromSnapshot('session-1', null);

		expect(useChatWindowStore.getState().getWindow('session-1')).toBeNull();
	});
});

describe('useChatWindowStore.loadOlder', () => {
	test('prepends an older history page and advances the cursor', async () => {
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('m3', 3), entry('m4', 4)], {
				hasOlder: true,
				olderCursor: 'idx:2',
				recentLimit: 80,
			}),
		);
		useHistoryLoader(async (sessionId, cursor, limit) => {
			expect(sessionId).toBe('session-1');
			expect(cursor).toBe('idx:2');
			expect(limit).toBe(40);
			return {
				messages: [entry('m1', 1), entry('m2', 2), entry('m3', 3)],
				hasOlder: true,
				olderCursor: 'idx:1',
			};
		});

		await useChatWindowStore.getState().loadOlder('session-1', 40);

		const window = useChatWindowStore.getState().getWindow('session-1');

		expect(window?.messages.map((message) => message._id)).toEqual(['m1', 'm2', 'm3', 'm4']);
		expect(window).toMatchObject({
			hasOlder: true,
			olderCursor: 'idx:1',
			loadingOlder: false,
			olderPagesLoaded: true,
		});
	});

	test('does not request history when there is no older cursor', async () => {
		let calls = 0;
		useHistoryLoader(async () => {
			calls += 1;
			return { messages: [], hasOlder: false, olderCursor: null };
		});
		useChatWindowStore
			.getState()
			.syncFromSnapshot('session-1', sessionSnapshot('session-1', [entry('m1', 1)]));

		await useChatWindowStore.getState().loadOlder('session-1');

		expect(calls).toBe(0);
	});

	test('coalesces duplicate older-page requests while one is loading', async () => {
		let calls = 0;
		let resolvePage: (page: SessionHistoryPage) => void = () => undefined;
		useHistoryLoader(
			async () =>
				new Promise<SessionHistoryPage>((resolve) => {
					calls += 1;
					resolvePage = resolve;
				}),
		);
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('m2', 2)], {
				hasOlder: true,
				olderCursor: 'idx:1',
				recentLimit: 80,
			}),
		);

		const firstLoad = useChatWindowStore.getState().loadOlder('session-1');
		const secondLoad = useChatWindowStore.getState().loadOlder('session-1');

		expect(calls).toBe(1);
		expect(useChatWindowStore.getState().getWindow('session-1')?.loadingOlder).toBe(true);

		resolvePage({ messages: [entry('m1', 1)], hasOlder: false, olderCursor: null });
		await Promise.all([firstLoad, secondLoad]);

		expect(useChatWindowStore.getState().getWindow('session-1')?.messages).toHaveLength(2);
	});

	test('clears loading state when history loading fails', async () => {
		useHistoryLoader(async () => {
			throw new Error('history failed');
		});
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('m2', 2)], {
				hasOlder: true,
				olderCursor: 'idx:1',
				recentLimit: 80,
			}),
		);

		await expect(useChatWindowStore.getState().loadOlder('session-1')).rejects.toThrow(
			'history failed',
		);

		expect(useChatWindowStore.getState().getWindow('session-1')?.loadingOlder).toBe(false);
	});

	test('does not resurrect a reset chat window after an in-flight history load resolves', async () => {
		let resolvePage: (page: SessionHistoryPage) => void = () => undefined;
		useHistoryLoader(
			async () =>
				new Promise<SessionHistoryPage>((resolve) => {
					resolvePage = resolve;
				}),
		);
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('m2', 2)], {
				hasOlder: true,
				olderCursor: 'idx:1',
				recentLimit: 80,
			}),
		);

		const load = useChatWindowStore.getState().loadOlder('session-1');
		useChatWindowStore.getState().resetSession('session-1');

		resolvePage({ messages: [entry('m1', 1)], hasOlder: false, olderCursor: null });
		await load;

		expect(useChatWindowStore.getState().getWindow('session-1')).toBeNull();
	});
});

describe('useChatWindowStore.resetSessions', () => {
	test('removes only the requested chat windows', () => {
		useChatWindowStore
			.getState()
			.syncFromSnapshot('session-1', sessionSnapshot('session-1', [entry('m1', 1)]));
		useChatWindowStore
			.getState()
			.syncFromSnapshot('session-2', sessionSnapshot('session-2', [entry('m2', 2)]));

		useChatWindowStore.getState().resetSessions(['session-1']);

		expect(useChatWindowStore.getState().getWindow('session-1')).toBeNull();
		expect(useChatWindowStore.getState().getWindow('session-2')?.messages).toHaveLength(1);
	});
});
