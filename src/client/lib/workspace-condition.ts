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
	| 'draft_pr'
	| 'ci_failed'
	| 'ci_pending'
	| 'merge_conflicts'
	| 'merged'
	| 'closed'
	| 'behind_main'
	| 'idle';

export type WorkspacePrimaryActionKind =
	| 'active'
	| 'commit_and_push'
	| 'create_pr'
	| 'fix_ci'
	| 'resolve_merge_conflicts'
	| 'mark_pr_ready'
	| 'merge'
	| 'archive';

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

function setupStateFromSidebarIndicator(row: SidebarWorkspaceRow): WorkspaceSetupState {
	if (row.indicator === 'workspace_creating') return 'creating';
	if (row.indicator === 'workspace_failed') return 'failed';
	return 'ready';
}

function reviewStateFromSidebarIndicator(row: SidebarWorkspaceRow): WorkspaceReviewState {
	if (row.indicator === 'merged') return 'done';
	if (row.indicator === 'closed') return 'closed';
	if (
		row.indicator === 'pr_opened' ||
		row.indicator === 'draft_pr' ||
		row.indicator === 'ci_failed' ||
		row.indicator === 'merge_conflicts' ||
		row.indicator === 'commit_and_push'
	) {
		return 'in_review';
	}
	return row.reviewState;
}

function deriveStage(args: {
	setupState: WorkspaceSetupState;
	reviewState: WorkspaceReviewState;
	hasActiveSession: boolean;
	dirtyFileCount: number;
	hasPushedCommits: boolean;
	mainAheadCount: number;
	ciStatus?: 'unknown' | 'pending' | 'passing' | 'failing';
	hasMergeConflicts: boolean;
	isDraft: boolean;
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
		if (args.hasMergeConflicts) {
			return {
				stage: 'merge_conflicts',
				primaryAction: action('resolve_merge_conflicts', 'Resolve conflicts'),
			};
		}
		if (args.isDraft) {
			return { stage: 'draft_pr', primaryAction: action('mark_pr_ready', 'Mark ready') };
		}
		if (args.ciStatus === 'failing') {
			return { stage: 'ci_failed', primaryAction: action('fix_ci', 'Fix CI') };
		}
		if (args.dirtyFileCount > 0) {
			return {
				stage: 'dirty',
				primaryAction: action('commit_and_push', 'Commit and push'),
			};
		}
		if (args.ciStatus === 'pending') {
			return { stage: 'ci_pending', primaryAction: null };
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
			primaryAction: null,
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
		hasMergeConflicts:
			snapshot.github?.hasMergeConflicts === true ||
			snapshot.workspace.pullRequest?.hasMergeConflicts === true,
		isDraft: snapshot.github?.isDraft === true || snapshot.workspace.pullRequest?.isDraft === true,
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
	const setupState = setupStateFromSidebarIndicator(row);
	const reviewState = reviewStateFromSidebarIndicator(row);
	const hasLocalPrWork = row.hasDirtyFiles || row.hasUnpushedCommits;
	const derived = deriveStage({
		setupState,
		reviewState,
		hasActiveSession: row.hasActiveSession || row.indicator === 'agent_active',
		dirtyFileCount: hasLocalPrWork ? 1 : 0,
		hasPushedCommits: row.indicator === 'create_pr',
		mainAheadCount: 0,
		ciStatus: row.indicator === 'ci_failed' ? 'failing' : undefined,
		hasMergeConflicts: row.indicator === 'merge_conflicts',
		isDraft: row.indicator === 'draft_pr',
	});

	return {
		workspaceId: row.workspaceId,
		setupState,
		reviewState,
		hasDirtyFiles: row.hasDirtyFiles,
		dirtyFileCount: null,
		diffStats: row.displayDiffStats,
		...derived,
	};
}
