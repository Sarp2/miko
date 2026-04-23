import { describe, expect, test } from 'bun:test';
import type { ChatHistorySnapshot, MikoStatus, TranscriptEntry } from 'src/shared/types';
import { createEmptyState } from './event';
import { deriveChatSnapshot, deriveLocalProjectsSnapshot, deriveSidebarData } from './read-models';

const emptyTranscript: { messages: TranscriptEntry[]; history: ChatHistorySnapshot } = {
	messages: [],
	history: {
		hasOlder: false,
		olderCursor: null,
		recentLimit: 200,
	},
};

describe('deriveSidebarData', () => {
	test('includes provider and unread flags on sidebar rows', () => {
		const state = createEmptyState();
		state.projectsById.set('project-1', {
			id: 'project-1',
			localPath: '/tmp/project',
			title: 'Project',
			createdAt: 1,
			updatedAt: 1,
		});

		state.projectIdsByPath.set('/tmp/project', 'project-1');

		state.chatsById.set('chat-1', {
			id: 'chat-1',
			projectId: 'project-1',
			title: 'Chat',
			createdAt: 1,
			updatedAt: 1,
			unread: true,
			provider: 'codex',
			planMode: false,
			sessionToken: 'thread-1',
			lastTurnOutcome: null,
		});

		const activeStatuses = new Map<string, MikoStatus>();
		const sidebar = deriveSidebarData(state, activeStatuses);

		const firstRow = sidebar.projectGroups[0]?.chats[0];
		expect(firstRow?.provider).toBe('codex');
		expect(firstRow?.unread).toBe(true);
	});

	test('orders sidebar chats by latest message time', () => {
		const state = createEmptyState();
		state.projectsById.set('project-1', {
			id: 'project-1',
			localPath: '/tmp/project',
			title: 'Project',
			createdAt: 1,
			updatedAt: 1,
		});

		state.projectIdsByPath.set('/tmp/project', 'project-1');

		state.chatsById.set('chat-older-activity', {
			id: 'chat-older-activity',
			projectId: 'project-1',
			title: 'Older user activity',
			createdAt: 10,
			updatedAt: 500,
			unread: false,
			provider: 'claude',
			planMode: false,
			sessionToken: null,
			lastMessageAt: 100,
			lastTurnOutcome: null,
		});

		state.chatsById.set('chat-newer-activity', {
			id: 'chat-newer-activity',
			projectId: 'project-1',
			title: 'Newer user activity',
			createdAt: 20,
			updatedAt: 50,
			unread: false,
			provider: 'claude',
			planMode: false,
			sessionToken: null,
			lastMessageAt: 200,
			lastTurnOutcome: null,
		});
		const activeStatuses = new Map<string, MikoStatus>();

		const sidebar = deriveSidebarData(state, activeStatuses);

		const chatIdsInOrder = sidebar.projectGroups[0]?.chats.map((chat) => chat.chatId);
		expect(chatIdsInOrder).toEqual(['chat-newer-activity', 'chat-older-activity']);
	});
});

describe('deriveChatSnapshot', () => {
	test('includes available providers in the chat snapshot', () => {
		const state = createEmptyState();
		state.projectsById.set('project-1', {
			id: 'project-1',
			localPath: '/tmp/project',
			title: 'Project',
			createdAt: 1,
			updatedAt: 1,
		});

		state.projectIdsByPath.set('/tmp/project', 'project-1');

		state.chatsById.set('chat-1', {
			id: 'chat-1',
			projectId: 'project-1',
			title: 'Chat',
			createdAt: 1,
			updatedAt: 1,
			unread: false,
			provider: 'claude',
			planMode: true,
			sessionToken: 'session-1',
			lastTurnOutcome: null,
		});

		const activeStatuses = new Map<string, MikoStatus>();
		const drainingChatIds = new Set<string>();

		const getMessages = () => emptyTranscript;
		const chat = deriveChatSnapshot(state, activeStatuses, drainingChatIds, 'chat-1', getMessages);

		expect(chat?.runtime.provider).toBe('claude');
		expect(chat?.history.recentLimit).toBe(200);
		expect(chat?.availableProviders.length).toBeGreaterThan(1);
		expect(chat?.availableProviders.some((provider) => provider.id === 'codex')).toBe(true);
	});
});

describe('deriveLocalProjectsSnapshot', () => {
	test('prefers saved project metadata over discovered entries for the same path', () => {
		const state = createEmptyState();
		state.projectsById.set('project-1', {
			id: 'project-1',
			localPath: '/tmp/project',
			title: 'Saved Project',
			createdAt: 1,
			updatedAt: 50,
		});

		state.projectIdsByPath.set('/tmp/project', 'project-1');

		state.chatsById.set('chat-1', {
			id: 'chat-1',
			projectId: 'project-1',
			title: 'Chat',
			createdAt: 1,
			updatedAt: 75,
			unread: false,
			provider: 'codex',
			planMode: false,
			sessionToken: null,
			lastMessageAt: 100,
			lastTurnOutcome: null,
		});

		const discoveredProjects = [
			{ localPath: '/tmp/project', title: 'Discovered Project', modifiedAt: 10 },
		];

		const snapshot = deriveLocalProjectsSnapshot(state, discoveredProjects, 'Local Machine');

		expect(snapshot.projects).toEqual([
			{
				localPath: '/tmp/project',
				title: 'Saved Project',
				source: 'saved',
				lastOpenedAt: 100,
				chatCount: 1,
			},
		]);
	});
});
