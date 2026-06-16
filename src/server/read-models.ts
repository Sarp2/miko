import type {
	DirectoryListSnapshot,
	MikoStatus,
	SessionRuntime,
	SessionSnapshot,
	SidebarDirectoryGroup,
	SidebarSnapshot,
	SidebarWorkspaceRow,
	WorkspaceGitHubSnapshot,
	WorkspaceGitSnapshot,
	WorkspaceHealthState,
	WorkspaceSidebarIndicator,
	WorkspaceSnapshot,
} from 'src/shared/types';
import type { SessionRecord, StoreState, WorkspaceRecord } from './event';
import { SERVER_PROVIDERS } from './provider-catalog';

export function deriveStatus(session: SessionRecord, activeStatus?: MikoStatus): MikoStatus {
	if (activeStatus) return activeStatus;
	if (session.lastTurnOutcome === 'failed') return 'failed';
	return 'idle';
}

function getSessionActivityTimestamp(session: SessionRecord) {
	return session.lastMessageAt ?? session.updatedAt;
}

function getWorkspaceLastActivityAt(state: StoreState, workspace: WorkspaceRecord) {
	return [...state.sessionsById.values()].reduce((latest, session) => {
		if (session.workspaceId !== workspace.id || session.removedAt) return latest;
		return Math.max(latest, getSessionActivityTimestamp(session));
	}, workspace.updatedAt);
}

function getWorkspaceLatestSession(state: StoreState, workspace: WorkspaceRecord) {
	return [...state.sessionsById.values()]
		.filter((session) => session.workspaceId === workspace.id && !session.removedAt)
		.toSorted((a, b) => getSessionActivityTimestamp(b) - getSessionActivityTimestamp(a))[0];
}

function hasPrDiffStats(github: WorkspaceGitHubSnapshot | null | undefined) {
	return typeof github?.additions === 'number' || typeof github?.deletions === 'number';
}

function getWorkspaceDiffStats(
	git: WorkspaceGitSnapshot | null | undefined,
	github: WorkspaceGitHubSnapshot | null | undefined,
) {
	if (github?.status === 'open' && hasPrDiffStats(github)) {
		return {
			additions: github.additions ?? 0,
			deletions: github.deletions ?? 0,
		};
	}

	return (git?.files ?? []).reduce(
		(stats, file) => ({
			additions: stats.additions + file.additions,
			deletions: stats.deletions + file.deletions,
		}),
		{ additions: 0, deletions: 0 },
	);
}

function getWorkspaceDisplayName(
	workspace: WorkspaceRecord,
	github: WorkspaceGitHubSnapshot | null | undefined,
) {
	return getWorkspacePrTitle(workspace, github) ?? workspace.branchName;
}

function getWorkspacePrTitle(
	workspace: WorkspaceRecord,
	github: WorkspaceGitHubSnapshot | null | undefined,
) {
	return github?.status !== 'none' && github?.title ? github.title : workspace.pullRequest?.title;
}

function workspaceHasPullRequest(workspace: WorkspaceRecord) {
	return Boolean(
		workspace.pullRequest ||
			workspace.reviewState === 'in_review' ||
			workspace.reviewState === 'done' ||
			workspace.reviewState === 'closed',
	);
}

function getWorkspaceSidebarIndicator(args: {
	workspace: WorkspaceRecord;
	hasActiveSession: boolean;
	git?: WorkspaceGitSnapshot | null;
	github?: WorkspaceGitHubSnapshot | null;
}): WorkspaceSidebarIndicator {
	const { workspace, hasActiveSession, git, github } = args;

	if (workspace.setupState === 'creating') return 'workspace_creating';
	if (workspace.setupState === 'failed') return 'workspace_failed';
	if (hasActiveSession) return 'agent_active';
	if (workspace.reviewState === 'done' || workspace.pullRequest?.status === 'merged')
		return 'merged';
	if (workspace.reviewState === 'closed' || workspace.pullRequest?.status === 'closed')
		return 'closed';
	if (github?.ciStatus === 'failing' || workspace.pullRequest?.ciStatus === 'failing') {
		return 'ci_failed';
	}
	const hasOpenPr =
		workspace.reviewState === 'in_review' || workspace.pullRequest?.status === 'open';
	if (hasOpenPr && (github?.hasMergeConflicts || workspace.pullRequest?.hasMergeConflicts)) {
		return 'merge_conflicts';
	}
	if (hasOpenPr && ((git?.files.length ?? 0) > 0 || (git?.aheadCount ?? 0) > 0)) {
		return 'commit_and_push';
	}
	if (hasOpenPr) {
		return 'pr_opened';
	}
	if (git?.hasPushedCommits) return 'create_pr';
	return 'none';
}

export function deriveSidebarSnapshot(args: {
	state: StoreState;
	activeStatuses: Map<string, MikoStatus>;
	gitSnapshots?: Map<string, WorkspaceGitSnapshot>;
	githubSnapshots?: Map<string, WorkspaceGitHubSnapshot>;
}): SidebarSnapshot {
	const directories = [...args.state.directoriesById.values()]
		.filter((directory) => !directory.removedAt)
		.sort((a, b) => b.updatedAt - a.updatedAt);

	const directoryGroups: SidebarDirectoryGroup[] = directories.map((directory) => {
		const workspaces: SidebarWorkspaceRow[] = [...args.state.workspacesById.values()]
			.filter(
				(workspace) =>
					workspace.directoryId === directory.id &&
					!workspace.removedAt &&
					workspace.visibilityState === 'active',
			)
			.sort(
				(a, b) =>
					getWorkspaceLastActivityAt(args.state, b) - getWorkspaceLastActivityAt(args.state, a),
			)
			.map((workspace) => {
				const hasActiveSession = [...args.state.sessionsById.values()].some(
					(session) =>
						session.workspaceId === workspace.id &&
						!session.removedAt &&
						args.activeStatuses.has(session.id),
				);

				const git = args.gitSnapshots?.get(workspace.id) ?? null;
				const github = args.githubSnapshots?.get(workspace.id) ?? null;
				const latestSession = getWorkspaceLatestSession(args.state, workspace);

				return {
					_id: workspace.id,
					_creationTime: workspace.createdAt,
					workspaceId: workspace.id,
					createdAt: workspace.createdAt,
					updatedAt: workspace.updatedAt,
					displayName: getWorkspaceDisplayName(workspace, github),
					reviewState: workspace.reviewState,
					visibilityState: workspace.visibilityState,
					indicator: getWorkspaceSidebarIndicator({
						workspace,
						hasActiveSession,
						git,
						github,
					}),
					hasUnreadAgentResult: workspace.hasUnreadAgentResult,
					hasActiveSession,
					localPath: workspace.localPath,
					branchName: workspace.branchName,
					githubOwner: directory.githubOwner,
					githubRepo: directory.githubRepo,
					defaultBranchName: directory.defaultBranchName,
					hasPullRequest: workspaceHasPullRequest(workspace),
					prNumber: workspace.pullRequest?.number,
					prTitle: getWorkspacePrTitle(workspace, github),
					prUrl: workspace.pullRequest?.url,
					prCreatedAt: workspace.pullRequest?.createdAt,
					hasDirtyFiles: (git?.files.length ?? 0) > 0,
					hasUnpushedCommits: (git?.aheadCount ?? 0) > 0,
					displayDiffStats: getWorkspaceDiffStats(git, github),
					lastActivityAt: getWorkspaceLastActivityAt(args.state, workspace),
					lastSessionId: latestSession?.id,
					lastSessionTitle:
						latestSession && latestSession.title !== 'Untitled' ? latestSession.title : undefined,
					lastPromptPreview: latestSession?.lastPromptPreview,
				};
			});

		return {
			groupKey: directory.id,
			directoryId: directory.id,
			localPath: directory.localPath,
			title: directory.title,
			createdAt: directory.createdAt,
			updatedAt: directory.updatedAt,
			avatarUrl: `https://github.com/${directory.githubOwner}.png`,
			workspaces,
		};
	});

	return { directoryGroups };
}

export function deriveDirectoryListSnapshot(
	state: StoreState,
	machineName: string,
): DirectoryListSnapshot {
	return {
		machine: {
			id: 'local',
			displayName: machineName,
		},
		directories: [...state.directoriesById.values()]
			.filter((directory) => !directory.removedAt)
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map(({ removedAt: _removedAt, ...directory }) => directory),
		workspaces: [...state.workspacesById.values()]
			.filter((workspace) => {
				if (workspace.removedAt) return false;
				const directory = state.directoriesById.get(workspace.directoryId);
				return Boolean(directory && !directory.removedAt);
			})
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map(({ removedAt: _removedAt, ...workspace }) => workspace),
	};
}

export function deriveWorkspaceSnapshot(args: {
	state: StoreState;
	activeStatuses: Map<string, MikoStatus>;
	workspaceId: string;
	healthState?: WorkspaceHealthState;
	git?: WorkspaceGitSnapshot | null;
	github?: WorkspaceGitHubSnapshot | null;
}): WorkspaceSnapshot | null {
	const workspace = args.state.workspacesById.get(args.workspaceId);
	if (!workspace || workspace.removedAt) return null;
	const directory = args.state.directoriesById.get(workspace.directoryId);
	if (!directory || directory.removedAt) return null;

	const { removedAt: _removedAt, ...workspaceSummary } = workspace;
	const sessions = [...args.state.sessionsById.values()]
		.filter((session) => session.workspaceId === workspace.id && !session.removedAt)
		.map(({ removedAt: _removedAt, ...session }) => session);

	return {
		workspace: workspaceSummary,
		primaryLabel: getWorkspaceDisplayName(workspace, args.github),
		healthState: args.healthState ?? 'healthy',
		git: args.git ?? null,
		github: args.github ?? null,
		sessions,
		hasActiveSession: sessions.some((session) => args.activeStatuses.has(session.id)),
		hasUnreadAgentResult: workspace.hasUnreadAgentResult,
	};
}

export function deriveSessionSnapshot(
	state: StoreState,
	activeStatuses: Map<string, MikoStatus>,
	drainingSessionIds: Set<string>,
	sessionId: string,
	getMessages: (sessionId: string) => Pick<SessionSnapshot, 'messages' | 'history'>,
): SessionSnapshot | null {
	const session = state.sessionsById.get(sessionId);
	if (!session || session.removedAt) return null;

	const workspace = state.workspacesById.get(session.workspaceId);
	if (!workspace || workspace.removedAt) return null;

	const directory = state.directoriesById.get(workspace.directoryId);
	if (!directory || directory.removedAt) return null;

	const runtime: SessionRuntime = {
		sessionId: session.id,
		workspaceId: workspace.id,
		directoryId: directory.id,
		localPath: workspace.localPath,
		title: session.title,
		status: deriveStatus(session, activeStatuses.get(session.id)),
		isDraining: drainingSessionIds.has(session.id),
		provider: session.provider,
		planMode: session.planMode,
		sessionToken: session.sessionToken,
	};

	const transcript = getMessages(session.id);

	return {
		runtime,
		messages: transcript.messages,
		history: transcript.history,
		availableProviders: [...SERVER_PROVIDERS],
	};
}
