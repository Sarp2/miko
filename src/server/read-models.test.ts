import { describe, expect, test } from 'bun:test';
import type {
	MikoStatus,
	SessionHistorySnapshot,
	TranscriptEntry,
	WorkspaceGitHubSnapshot,
	WorkspaceGitSnapshot,
} from 'src/shared/types';
import { createEmptyState } from './event';
import {
	deriveDirectoryListSnapshot,
	deriveSessionSnapshot,
	deriveSidebarSnapshot,
	deriveStatus,
	deriveWorkspaceSnapshot,
} from './read-models';

const emptyTranscript: { messages: TranscriptEntry[]; history: SessionHistorySnapshot } = {
	messages: [],
	history: {
		hasOlder: false,
		olderCursor: null,
		recentLimit: 200,
	},
};

function addDirectoryWorkspaceAndSession() {
	const state = createEmptyState();
	state.directoriesById.set('directory-1', {
		id: 'directory-1',
		localPath: '/repo/miko',
		title: 'Miko',
		githubOwner: 'sarp',
		githubRepo: 'miko',
		defaultBranchName: 'main',
		createdAt: 1,
		updatedAt: 1,
	});

	state.workspacesById.set('workspace-1', {
		id: 'workspace-1',
		directoryId: 'directory-1',
		localPath: '/repo/miko/atlas',
		branchName: 'atlas',
		setupState: 'ready',
		reviewState: 'in_progress',
		visibilityState: 'active',
		hasUnreadAgentResult: false,
		createdAt: 2,
		updatedAt: 2,
	});

	state.sessionsById.set('session-1', {
		id: 'session-1',
		workspaceId: 'workspace-1',
		title: 'Session',
		createdAt: 3,
		updatedAt: 3,
		provider: 'codex',
		planMode: true,
		sessionToken: 'thread-1',
		lastTurnOutcome: null,
	});

	return state;
}

function dirtyGitSnapshot(): WorkspaceGitSnapshot {
	return {
		status: 'ready',
		branchName: 'atlas',
		defaultBranchName: 'main',
		hasOriginRemote: true,
		originRepoSlug: 'sarp/miko',
		hasUpstream: false,
		files: [
			{
				path: 'src/app.ts',
				changeType: 'modified',
				isUntracked: false,
				additions: 2,
				deletions: 1,
				patchDigest: 'digest',
			},
		],
		hasPushedCommits: false,
		branchHistory: { entries: [] },
	};
}

function openPullRequestSnapshot(): WorkspaceGitHubSnapshot {
	return {
		status: 'open',
		owner: 'sarp',
		repo: 'miko',
		prNumber: 12,
		title: 'Add workspace model',
		ciStatus: 'passing',
		additions: 52,
		deletions: 14,
		createdAt: 20,
		comments: [],
		checks: [],
	};
}

describe('deriveStatus', () => {
	test('prefers active status over stored turn outcome', () => {
		const state = addDirectoryWorkspaceAndSession();
		const session = state.sessionsById.get('session-1');
		expect(session).toBeDefined();
		if (!session) throw new Error('session missing');
		session.lastTurnOutcome = 'failed';

		expect(deriveStatus(session, 'running')).toBe('running');
	});

	test('falls back to failed when the last turn failed', () => {
		const state = addDirectoryWorkspaceAndSession();
		const session = state.sessionsById.get('session-1');
		expect(session).toBeDefined();
		if (!session) throw new Error('session missing');
		session.lastTurnOutcome = 'failed';

		expect(deriveStatus(session)).toBe('failed');
	});
});

describe('deriveSidebarSnapshot', () => {
	test('groups active workspaces by directory and includes active session and unread flags', () => {
		const state = addDirectoryWorkspaceAndSession();
		const workspace = state.workspacesById.get('workspace-1');
		expect(workspace).toBeDefined();
		if (!workspace) throw new Error('workspace missing');
		workspace.hasUnreadAgentResult = true;
		const activeStatuses = new Map<string, MikoStatus>([['session-1', 'running']]);

		const sidebar = deriveSidebarSnapshot({ state, activeStatuses });

		expect(sidebar.directoryGroups).toHaveLength(1);
		expect(sidebar.directoryGroups[0]).toMatchObject({
			groupKey: 'directory-1',
			directoryId: 'directory-1',
			title: 'Miko',
			avatarUrl: 'https://github.com/sarp.png',
		});
		expect(sidebar.directoryGroups[0]?.workspaces[0]).toMatchObject({
			workspaceId: 'workspace-1',
			displayName: 'atlas',
			indicator: 'agent_active',
			hasActiveSession: true,
			hasUnreadAgentResult: true,
			githubOwner: 'sarp',
			githubRepo: 'miko',
			defaultBranchName: 'main',
		});
	});

	test('keeps directories visible when they have no active workspaces', () => {
		const state = addDirectoryWorkspaceAndSession();
		const workspace = state.workspacesById.get('workspace-1');
		expect(workspace).toBeDefined();
		if (!workspace) throw new Error('workspace missing');
		workspace.visibilityState = 'archived';

		const sidebar = deriveSidebarSnapshot({ state, activeStatuses: new Map() });

		expect(sidebar.directoryGroups).toHaveLength(1);
		expect(sidebar.directoryGroups[0]).toMatchObject({
			directoryId: 'directory-1',
			title: 'Miko',
			workspaces: [],
		});
	});

	test('includes newly added directories before their first workspace exists', () => {
		const state = createEmptyState();
		state.directoriesById.set('directory-1', {
			id: 'directory-1',
			localPath: '/repo/miko',
			title: 'Miko',
			githubOwner: 'sarp',
			githubRepo: 'miko',
			defaultBranchName: 'main',
			createdAt: 1,
			updatedAt: 1,
		});

		const sidebar = deriveSidebarSnapshot({ state, activeStatuses: new Map() });

		expect(sidebar.directoryGroups).toEqual([
			{
				groupKey: 'directory-1',
				directoryId: 'directory-1',
				localPath: '/repo/miko',
				title: 'Miko',
				createdAt: 1,
				updatedAt: 1,
				avatarUrl: 'https://github.com/sarp.png',
				workspaces: [],
			},
		]);
	});

	test('uses git and GitHub state to derive labels and indicators', () => {
		const state = addDirectoryWorkspaceAndSession();
		const workspace = state.workspacesById.get('workspace-1');
		expect(workspace).toBeDefined();
		if (!workspace) throw new Error('workspace missing');
		workspace.reviewState = 'in_review';
		workspace.pullRequest = {
			number: 12,
			status: 'open',
			title: 'Stored PR title',
			url: 'https://github.com/sarp/miko/pull/12',
			createdAt: 20,
			lastObservedAt: 10,
		};
		const github = openPullRequestSnapshot();

		const sidebar = deriveSidebarSnapshot({
			state,
			activeStatuses: new Map(),
			gitSnapshots: new Map([['workspace-1', dirtyGitSnapshot()]]),
			githubSnapshots: new Map([['workspace-1', github]]),
		});

		expect(sidebar.directoryGroups[0]?.workspaces[0]).toMatchObject({
			displayName: 'Add workspace model',
			indicator: 'commit_and_push',
			prNumber: 12,
			prTitle: 'Add workspace model',
			prUrl: 'https://github.com/sarp/miko/pull/12',
			prCreatedAt: 20,
			hasDirtyFiles: true,
			displayDiffStats: { additions: 52, deletions: 14 },
		});
	});

	test('uses stored PR status for sidebar indicators when reviewState is stale', () => {
		const state = addDirectoryWorkspaceAndSession();
		const workspace = state.workspacesById.get('workspace-1');
		expect(workspace).toBeDefined();
		if (!workspace) throw new Error('workspace missing');
		workspace.reviewState = 'in_progress';
		workspace.pullRequest = {
			number: 1,
			status: 'open',
			title: 'Improve README tooling',
			url: 'https://github.com/sarp/miko/pull/1',
			lastObservedAt: 10,
		};

		expect(
			deriveSidebarSnapshot({ state, activeStatuses: new Map() }).directoryGroups[0]?.workspaces[0],
		).toMatchObject({
			displayName: 'Improve README tooling',
			indicator: 'pr_opened',
			prNumber: 1,
			prTitle: 'Improve README tooling',
		});

		workspace.pullRequest.status = 'merged';
		expect(
			deriveSidebarSnapshot({ state, activeStatuses: new Map() }).directoryGroups[0]?.workspaces[0]
				?.indicator,
		).toBe('merged');
	});

	test('does not show PR stage indicators for dirty workspaces without open PRs', () => {
		const state = addDirectoryWorkspaceAndSession();

		expect(
			deriveSidebarSnapshot({
				state,
				activeStatuses: new Map(),
				gitSnapshots: new Map([['workspace-1', dirtyGitSnapshot()]]),
			}).directoryGroups[0]?.workspaces[0],
		).toMatchObject({
			indicator: 'none',
			prNumber: undefined,
			displayDiffStats: { additions: 2, deletions: 1 },
		});
	});

	test('does not show commit and push for open PRs with only ahead commits', () => {
		const state = addDirectoryWorkspaceAndSession();
		const workspace = state.workspacesById.get('workspace-1');
		expect(workspace).toBeDefined();
		if (!workspace) throw new Error('workspace missing');
		workspace.reviewState = 'in_review';
		workspace.pullRequest = {
			number: 12,
			status: 'open',
			lastObservedAt: 10,
		};

		expect(
			deriveSidebarSnapshot({
				state,
				activeStatuses: new Map(),
				gitSnapshots: new Map([
					['workspace-1', { ...dirtyGitSnapshot(), files: [], aheadCount: 2 }],
				]),
				githubSnapshots: new Map([['workspace-1', openPullRequestSnapshot()]]),
			}).directoryGroups[0]?.workspaces[0],
		).toMatchObject({
			indicator: 'pr_opened',
			hasDirtyFiles: false,
			displayDiffStats: { additions: 52, deletions: 14 },
		});
	});

	test('reflects setup lifecycle state in the workspace indicator', () => {
		const state = addDirectoryWorkspaceAndSession();
		const workspace = state.workspacesById.get('workspace-1');
		expect(workspace).toBeDefined();
		if (!workspace) throw new Error('workspace missing');

		workspace.setupState = 'creating';
		expect(
			deriveSidebarSnapshot({ state, activeStatuses: new Map() }).directoryGroups[0]?.workspaces[0]
				?.indicator,
		).toBe('workspace_creating');

		workspace.setupState = 'failed';
		expect(
			deriveSidebarSnapshot({ state, activeStatuses: new Map() }).directoryGroups[0]?.workspaces[0]
				?.indicator,
		).toBe('workspace_failed');
	});

	test('orders workspaces by latest session activity', () => {
		const state = addDirectoryWorkspaceAndSession();
		state.workspacesById.set('workspace-2', {
			id: 'workspace-2',
			directoryId: 'directory-1',
			localPath: '/repo/miko/orion',
			branchName: 'orion',
			setupState: 'ready',
			reviewState: 'in_progress',
			visibilityState: 'active',
			hasUnreadAgentResult: false,
			createdAt: 4,
			updatedAt: 4,
		});
		state.sessionsById.set('session-2', {
			id: 'session-2',
			workspaceId: 'workspace-2',
			title: 'Newer activity',
			createdAt: 5,
			updatedAt: 5,
			lastMessageAt: 500,
			provider: null,
			planMode: false,
			sessionToken: null,
			lastTurnOutcome: null,
		});

		const sidebar = deriveSidebarSnapshot({ state, activeStatuses: new Map() });

		expect(
			sidebar.directoryGroups[0]?.workspaces.map((workspace) => workspace.workspaceId),
		).toEqual(['workspace-2', 'workspace-1']);
	});

	test('projects latest session title and prompt preview onto sidebar workspace rows', () => {
		const state = addDirectoryWorkspaceAndSession();
		const firstSession = state.sessionsById.get('session-1');
		expect(firstSession).toBeDefined();
		if (!firstSession) throw new Error('session missing');
		firstSession.lastMessageAt = 100;
		firstSession.lastPromptPreview = 'Older prompt';

		state.sessionsById.set('session-2', {
			id: 'session-2',
			workspaceId: 'workspace-1',
			title: 'Read pasted text files',
			createdAt: 4,
			updatedAt: 4,
			lastMessageAt: 500,
			lastPromptPreview: 'Updated the workspace condition model to include diff stats.',
			provider: null,
			planMode: false,
			sessionToken: null,
			lastTurnOutcome: null,
		});

		const sidebar = deriveSidebarSnapshot({ state, activeStatuses: new Map() });

		expect(sidebar.directoryGroups[0]?.workspaces[0]).toMatchObject({
			lastSessionId: 'session-2',
			lastSessionTitle: 'Read pasted text files',
			lastPromptPreview: 'Updated the workspace condition model to include diff stats.',
			lastActivityAt: 500,
		});
	});
});

describe('deriveDirectoryListSnapshot', () => {
	test('includes directories and archived workspaces for the archive page', () => {
		const state = addDirectoryWorkspaceAndSession();
		const workspace = state.workspacesById.get('workspace-1');
		expect(workspace).toBeDefined();
		if (!workspace) throw new Error('workspace missing');
		workspace.visibilityState = 'archived';

		const snapshot = deriveDirectoryListSnapshot(state, 'Local Machine');

		expect(snapshot.machine).toEqual({ id: 'local', displayName: 'Local Machine' });
		expect(snapshot.directories).toHaveLength(1);
		expect(snapshot.workspaces).toHaveLength(1);
		expect(snapshot.workspaces[0]).toMatchObject({
			id: 'workspace-1',
			visibilityState: 'archived',
		});
	});

	test('does not include removed records', () => {
		const state = addDirectoryWorkspaceAndSession();
		const directory = state.directoriesById.get('directory-1');
		const workspace = state.workspacesById.get('workspace-1');
		expect(directory).toBeDefined();
		expect(workspace).toBeDefined();
		if (!directory || !workspace) throw new Error('seed missing');
		directory.removedAt = 10;
		workspace.removedAt = 10;

		const snapshot = deriveDirectoryListSnapshot(state, 'Local Machine');

		expect(snapshot.directories).toEqual([]);
		expect(snapshot.workspaces).toEqual([]);
	});
});

describe('deriveWorkspaceSnapshot', () => {
	test('returns workspace detail with sessions, health, git, and GitHub state', () => {
		const state = addDirectoryWorkspaceAndSession();
		const activeStatuses = new Map<string, MikoStatus>([['session-1', 'running']]);
		const git = dirtyGitSnapshot();
		const github = openPullRequestSnapshot();

		const snapshot = deriveWorkspaceSnapshot({
			state,
			activeStatuses,
			workspaceId: 'workspace-1',
			healthState: 'branch_missing',
			git,
			github,
		});

		expect(snapshot).toMatchObject({
			primaryLabel: 'Add workspace model',
			healthState: 'branch_missing',
			hasActiveSession: true,
			hasUnreadAgentResult: false,
			git,
			github,
		});
		expect(snapshot?.sessions.map((session) => session.id)).toEqual(['session-1']);
	});

	test('returns null when the workspace is removed', () => {
		const state = addDirectoryWorkspaceAndSession();
		const workspace = state.workspacesById.get('workspace-1');
		expect(workspace).toBeDefined();
		if (!workspace) throw new Error('workspace missing');
		workspace.removedAt = 10;

		expect(
			deriveWorkspaceSnapshot({
				state,
				activeStatuses: new Map(),
				workspaceId: 'workspace-1',
			}),
		).toBeNull();
	});
});

describe('deriveSessionSnapshot', () => {
	test('includes runtime, messages, history, and providers for a session', () => {
		const state = addDirectoryWorkspaceAndSession();
		const activeStatuses = new Map<string, MikoStatus>([['session-1', 'running']]);
		const drainingSessionIds = new Set<string>(['session-1']);

		const session = deriveSessionSnapshot(
			state,
			activeStatuses,
			drainingSessionIds,
			'session-1',
			() => emptyTranscript,
		);

		expect(session?.runtime).toMatchObject({
			sessionId: 'session-1',
			workspaceId: 'workspace-1',
			directoryId: 'directory-1',
			localPath: '/repo/miko/atlas',
			title: 'Session',
			status: 'running',
			isDraining: true,
			provider: 'codex',
			planMode: true,
			sessionToken: 'thread-1',
		});
		expect(session?.messages).toEqual([]);
		expect(session?.history.recentLimit).toBe(200);
		expect(session?.availableProviders.some((provider) => provider.id === 'codex')).toBe(true);
	});

	test('returns null when the parent workspace is removed', () => {
		const state = addDirectoryWorkspaceAndSession();
		const workspace = state.workspacesById.get('workspace-1');
		expect(workspace).toBeDefined();
		if (!workspace) throw new Error('workspace missing');
		workspace.removedAt = 10;

		const session = deriveSessionSnapshot(
			state,
			new Map(),
			new Set(),
			'session-1',
			() => emptyTranscript,
		);

		expect(session).toBeNull();
	});
});
