import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { SessionSnapshot, TranscriptEntry } from '../../shared/types';
import { useChatWindowStore } from './chat-window-store';

const initialChatWindowState = useChatWindowStore.getInitialState();

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
			pendingTool: null,
			queued: [],
		},
		messages,
		history,
		availableProviders: [],
	};
}

beforeEach(() => {
	useChatWindowStore.setState(initialChatWindowState, true);
});

afterEach(() => {
	useChatWindowStore.setState(initialChatWindowState, true);
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

	test('keeps loaded older pages while replacing the recent tail', () => {
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('m3', 3), entry('m4', 4)], {
				hasOlder: true,
				olderCursor: 'idx:2',
				recentLimit: 80,
			}),
		);
		const request = useChatWindowStore.getState().beginOlderPageLoad('session-1');
		if (!request) throw new Error('Expected request');
		useChatWindowStore.getState().applyOlderPage('session-1', request, {
			messages: [entry('m1', 1), entry('m2', 2)],
			hasOlder: false,
			olderCursor: null,
		});

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

describe('useChatWindowStore older page operations', () => {
	test('begins an older-page request and applies the page', () => {
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('m3', 3), entry('m4', 4)], {
				hasOlder: true,
				olderCursor: 'idx:2',
				recentLimit: 80,
			}),
		);

		const request = useChatWindowStore.getState().beginOlderPageLoad('session-1');

		expect(request).toMatchObject({ sessionId: 'session-1', olderCursor: 'idx:2' });
		expect(useChatWindowStore.getState().getWindow('session-1')?.loadingOlder).toBe(true);

		if (!request) throw new Error('Expected request');
		useChatWindowStore.getState().applyOlderPage('session-1', request, {
			messages: [entry('m1', 1), entry('m2', 2), entry('m3', 3)],
			hasOlder: true,
			olderCursor: 'idx:1',
		});

		const window = useChatWindowStore.getState().getWindow('session-1');

		expect(window?.messages.map((message) => message._id)).toEqual(['m1', 'm2', 'm3', 'm4']);
		expect(window).toMatchObject({
			hasOlder: true,
			olderCursor: 'idx:1',
			loadingOlder: false,
			olderPagesLoaded: true,
		});
	});

	test('does not begin a request when there is no older cursor', () => {
		useChatWindowStore
			.getState()
			.syncFromSnapshot('session-1', sessionSnapshot('session-1', [entry('m1', 1)]));

		expect(useChatWindowStore.getState().beginOlderPageLoad('session-1')).toBeNull();
	});

	test('coalesces duplicate older-page requests while one is loading', () => {
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('m2', 2)], {
				hasOlder: true,
				olderCursor: 'idx:1',
				recentLimit: 80,
			}),
		);

		const firstRequest = useChatWindowStore.getState().beginOlderPageLoad('session-1');
		const secondRequest = useChatWindowStore.getState().beginOlderPageLoad('session-1');

		expect(firstRequest).not.toBeNull();
		expect(secondRequest).toBeNull();
		expect(useChatWindowStore.getState().getWindow('session-1')?.loadingOlder).toBe(true);
	});

	test('clears loading state when an older-page request fails', () => {
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('m2', 2)], {
				hasOlder: true,
				olderCursor: 'idx:1',
				recentLimit: 80,
			}),
		);
		const request = useChatWindowStore.getState().beginOlderPageLoad('session-1');
		if (!request) throw new Error('Expected request');

		useChatWindowStore.getState().failOlderPage('session-1', request);

		expect(useChatWindowStore.getState().getWindow('session-1')?.loadingOlder).toBe(false);
	});

	test('does not resurrect a reset chat window after an in-flight history load resolves', () => {
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('m2', 2)], {
				hasOlder: true,
				olderCursor: 'idx:1',
				recentLimit: 80,
			}),
		);
		const request = useChatWindowStore.getState().beginOlderPageLoad('session-1');
		if (!request) throw new Error('Expected request');

		useChatWindowStore.getState().resetSession('session-1');
		useChatWindowStore.getState().applyOlderPage('session-1', request, {
			messages: [entry('m1', 1)],
			hasOlder: false,
			olderCursor: null,
		});

		expect(useChatWindowStore.getState().getWindow('session-1')).toBeNull();
	});

	test('ignores stale history when a reset session is recreated before the load resolves', () => {
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('m3', 3)], {
				hasOlder: true,
				olderCursor: 'idx:2',
				recentLimit: 80,
			}),
		);
		const staleRequest = useChatWindowStore.getState().beginOlderPageLoad('session-1');
		if (!staleRequest) throw new Error('Expected request');

		useChatWindowStore.getState().resetSession('session-1');
		useChatWindowStore.getState().syncFromSnapshot(
			'session-1',
			sessionSnapshot('session-1', [entry('fresh', 10)], {
				hasOlder: true,
				olderCursor: 'idx:fresh',
				recentLimit: 80,
			}),
		);

		useChatWindowStore.getState().applyOlderPage('session-1', staleRequest, {
			messages: [entry('stale', 1)],
			hasOlder: false,
			olderCursor: null,
		});

		const window = useChatWindowStore.getState().getWindow('session-1');
		expect(window?.messages.map((message) => message._id)).toEqual(['fresh']);
		expect(window?.hasOlder).toBe(true);
		expect(window?.olderCursor).toBe('idx:fresh');
		expect(window?.loadingOlder).toBe(false);
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
