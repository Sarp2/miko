import type {
	SidebarWorkspaceRow,
	WorkspaceHealthState,
	WorkspaceReviewState,
	WorkspaceSetupState,
	WorkspaceSnapshot,
} from '../../shared/types';

export type WorkspaceConditionStage =
	| 'creating'
	| 'setup_failed'
	| 'agent_active'
	| 'dirty'
	| 'ready_to_create_pr'
	| 'pr_open'
	| 'ci_failed'
	| 'merged'
	| 'closed'
	| 'behind_main'
	| 'idle';

export type WorkspacePrimaryActionKind =
	| 'active'
	| 'commit_and_push'
	| 'create_pr'
	| 'fix_ci'
	| 'merge'
	| 'archive'
	| 'pull_latest_main';

export interface WorkspacePrimaryAction {
	kind: WorkspacePrimaryActionKind;
	label: string;
}

export interface WorkspaceCondition {
	workspaceId: string;
	setupState: WorkspaceSetupState;
	reviewState: WorkspaceReviewState;
	healthState?: WorkspaceHealthState;
	stage: WorkspaceConditionStage;
	hasDirtyFiles: boolean;
	dirtyFileCount: number | null;
	diffStats: { additions: number; deletions: number };
	primaryAction: WorkspacePrimaryAction | null;
}

function action(kind: WorkspacePrimaryActionKind, label: string): WorkspacePrimaryAction {
	return { kind, label };
}

function deriveStage(args: {
	setupState: WorkspaceSetupState;
	reviewState: WorkspaceReviewState;
	hasActiveSession: boolean;
	dirtyFileCount: number;
	hasPushedCommits: boolean;
	mainAheadCount: number;
	ciStatus?: 'unknown' | 'pending' | 'passing' | 'failing';
}): Pick<WorkspaceCondition, 'stage' | 'primaryAction'> {
	if (args.setupState === 'creating') return { stage: 'creating', primaryAction: null };
	if (args.setupState === 'failed') return { stage: 'setup_failed', primaryAction: null };
	if (args.hasActiveSession) return { stage: 'agent_active', primaryAction: action('active', '') };

	if (args.reviewState === 'done') {
		return { stage: 'merged', primaryAction: action('archive', 'Archive') };
	}

	if (args.reviewState === 'closed') {
		return { stage: 'closed', primaryAction: action('archive', 'Archive') };
	}

	if (args.reviewState === 'in_review') {
		if (args.ciStatus === 'failing') {
			return { stage: 'ci_failed', primaryAction: action('fix_ci', 'Fix CI') };
		}
		if (args.dirtyFileCount > 0) {
			return {
				stage: 'dirty',
				primaryAction: action('commit_and_push', 'Commit and push'),
			};
		}
		return { stage: 'pr_open', primaryAction: action('merge', 'Merge') };
	}

	if (args.hasPushedCommits) {
		return { stage: 'ready_to_create_pr', primaryAction: action('create_pr', 'Create PR') };
	}

	if (args.dirtyFileCount > 0) {
		return { stage: 'dirty', primaryAction: action('create_pr', 'Create PR') };
	}

	if (args.mainAheadCount > 0) {
		return {
			stage: 'behind_main',
			primaryAction: action('pull_latest_main', 'Pull latest main'),
		};
	}

	return { stage: 'idle', primaryAction: null };
}

export function deriveWorkspaceCondition(snapshot: WorkspaceSnapshot): WorkspaceCondition {
	const dirtyFileCount = snapshot.git?.files.length ?? 0;
	const diffStats = (snapshot.git?.files ?? []).reduce(
		(stats, file) => ({
			additions: stats.additions + file.additions,
			deletions: stats.deletions + file.deletions,
		}),
		{ additions: 0, deletions: 0 },
	);
	const derived = deriveStage({
		setupState: snapshot.workspace.setupState,
		reviewState: snapshot.workspace.reviewState,
		hasActiveSession: snapshot.hasActiveSession,
		dirtyFileCount,
		hasPushedCommits: snapshot.git?.hasPushedCommits === true,
		mainAheadCount: snapshot.git?.mainAheadCount ?? 0,
		ciStatus: snapshot.github?.ciStatus ?? snapshot.workspace.pullRequest?.ciStatus,
	});

	return {
		workspaceId: snapshot.workspace.id,
		setupState: snapshot.workspace.setupState,
		reviewState: snapshot.workspace.reviewState,
		healthState: snapshot.healthState,
		hasDirtyFiles: dirtyFileCount > 0,
		dirtyFileCount,
		diffStats,
		...derived,
	};
}

export function deriveSidebarWorkspaceCondition(row: SidebarWorkspaceRow): WorkspaceCondition {
	const derived = deriveStage({
		setupState:
			row.indicator === 'workspace_creating'
				? 'creating'
				: row.indicator === 'workspace_failed'
					? 'failed'
					: 'ready',
		reviewState: row.reviewState,
		hasActiveSession: row.hasActiveSession || row.indicator === 'agent_active',
		dirtyFileCount: row.hasDirtyFiles ? 1 : 0,
		hasPushedCommits: row.indicator === 'create_pr',
		mainAheadCount: 0,
		ciStatus: row.indicator === 'ci_failed' ? 'failing' : undefined,
	});

	return {
		workspaceId: row.workspaceId,
		setupState:
			row.indicator === 'workspace_creating'
				? 'creating'
				: row.indicator === 'workspace_failed'
					? 'failed'
					: 'ready',
		reviewState: row.reviewState,
		hasDirtyFiles: row.hasDirtyFiles,
		dirtyFileCount: null,
		diffStats: row.displayDiffStats,
		...derived,
	};
}
