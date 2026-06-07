import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionSnapshot, TranscriptEntry, WorkspaceSnapshot } from '../../shared/types';
import { useChatWindowStore } from '../stores/chat-window-store';
import { ChatPageView } from './chat-page';

const initialChatWindowState = useChatWindowStore.getInitialState();

function workspaceSnapshot(
	setupState: WorkspaceSnapshot['workspace']['setupState'] = 'ready',
): WorkspaceSnapshot {
	return {
		workspace: {
			id: 'workspace-1',
			directoryId: 'directory-1',
			localPath: '/Users/sarp/.miko-dev/worktrees/directory-1/atlas',
			branchName: 'atlas',
			setupState,
			reviewState: 'in_progress',
			visibilityState: 'active',
			hasUnreadAgentResult: false,
			createdAt: 1,
			updatedAt: 1,
		},
		primaryLabel: 'atlas',
		healthState: 'healthy',
		git: {
			status: 'ready',
			branchName: 'atlas',
			defaultBranchName: 'main',
			files: [],
		},
		github: null,
		sessions: [
			{
				id: 'session-1',
				workspaceId: 'workspace-1',
				title: 'Untitled',
				createdAt: 1,
				updatedAt: 1,
				provider: 'claude',
				planMode: false,
				sessionToken: null,
				lastTurnOutcome: null,
			},
		],
		hasActiveSession: false,
		hasUnreadAgentResult: false,
	};
}

function entry(id: string, text: string): TranscriptEntry {
	return {
		_id: id,
		createdAt: 1,
		kind: 'assistant_text',
		text,
	};
}

function sessionSnapshot(messages: TranscriptEntry[]): SessionSnapshot {
	return {
		runtime: {
			sessionId: 'session-1',
			workspaceId: 'workspace-1',
			directoryId: 'directory-1',
			localPath: '/Users/sarp/.miko-dev/worktrees/directory-1/atlas',
			title: 'Untitled',
			status: 'idle',
			isDraining: false,
			provider: 'claude',
			planMode: false,
			sessionToken: null,
		},
		messages,
		history: { hasOlder: false, olderCursor: null, recentLimit: 80 },
		availableProviders: [],
	};
}

function renderChatPage() {
	return renderToStaticMarkup(
		<ChatPageView
			workspaceId="workspace-1"
			sessionId="session-1"
			workspaceSnapshot={workspaceSnapshot()}
			chatWindow={useChatWindowStore.getState().getWindow('session-1')}
		/>,
	);
}

beforeEach(() => {
	useChatWindowStore.setState(initialChatWindowState, true);
});

afterEach(() => {
	useChatWindowStore.setState(initialChatWindowState, true);
});

describe('ChatPage', () => {
	test('renders the workspace intro for an initialized empty session', () => {
		useChatWindowStore.getState().syncFromSnapshot('session-1', sessionSnapshot([]));

		const html = renderChatPage();

		expect(html).toContain('new worktree');
		expect(html).toContain('atlas');
		expect(html).toContain('origin/main');
		expect(html).toContain('Ready for your first prompt');
		expect(html).not.toContain('Ask to make changes');
	});

	test('renders a quiet empty state for non-first sessions', () => {
		useChatWindowStore.getState().syncFromSnapshot('session-2', sessionSnapshot([]));
		const snapshot = workspaceSnapshot();
		snapshot.sessions.push({
			id: 'session-2',
			workspaceId: 'workspace-1',
			title: 'Untitled',
			createdAt: 2,
			updatedAt: 2,
			provider: 'claude',
			planMode: false,
			sessionToken: null,
			lastTurnOutcome: null,
		});

		const html = renderToStaticMarkup(
			<ChatPageView
				workspaceId="workspace-1"
				sessionId="session-2"
				workspaceSnapshot={snapshot}
				chatWindow={useChatWindowStore.getState().getWindow('session-2')}
			/>,
		);

		expect(html).toContain('New Chat in');
		expect(html).toContain('/atlas');
		expect(html).not.toContain('new worktree');
	});

	test('shows creating copy while workspace setup is still running', () => {
		useChatWindowStore.getState().syncFromSnapshot('session-1', sessionSnapshot([]));

		const html = renderToStaticMarkup(
			<ChatPageView
				workspaceId="workspace-1"
				sessionId="session-1"
				workspaceSnapshot={workspaceSnapshot('creating')}
				chatWindow={useChatWindowStore.getState().getWindow('session-1')}
			/>,
		);

		expect(html).toContain('Creating');
		expect(html).not.toContain('Created</span>');
	});

	test('renders hydrated transcript messages for a session', () => {
		useChatWindowStore
			.getState()
			.syncFromSnapshot('session-1', sessionSnapshot([entry('assistant-1', '**Done**')]));

		const html = renderChatPage();

		expect(html).toContain('<strong');
		expect(html).toContain('Done');
		expect(html).not.toContain('new worktree');
	});

	test('renders loading state before the session window initializes', () => {
		const html = renderChatPage();

		expect(html).toContain('Loading chat');
	});
});
