import type { WorkspaceSnapshot } from '../../shared/types';

export type ChecksStatusActionKind = 'create_pr' | 'commit_and_push' | 'pull';

export interface ChecksStatusRow {
	id: 'pr' | 'uncommitted' | 'behind_main';
	label: string;
	action?: { kind: ChecksStatusActionKind; label: string };
}

function pluralize(count: number, singular: string) {
	return count === 1 ? singular : `${singular}s`;
}

/**
 * Git-status rows for the Checks panel. Shown for pre-PR and open-PR stages, but
 * never for merged/closed workspaces (their review is over and the local branch
 * state is no longer actionable).
 */
export function deriveChecksGitStatusRows(snapshot: WorkspaceSnapshot): ChecksStatusRow[] {
	const reviewState = snapshot.workspace.reviewState;
	if (reviewState === 'done' || reviewState === 'closed') return [];

	const git = snapshot.git;
	const rows: ChecksStatusRow[] = [];

	const hasOpenPr = snapshot.github?.status === 'open' || reviewState === 'in_review';

	if (!hasOpenPr) {
		const hasPublishableWork = (git?.files.length ?? 0) > 0 || git?.hasPushedCommits === true;
		rows.push({
			id: 'pr',
			label: 'No PR open',
			action: hasPublishableWork ? { kind: 'create_pr', label: 'Create PR' } : undefined,
		});
	}

	const dirtyCount = git?.files.length ?? 0;
	if (dirtyCount > 0) {
		rows.push({
			id: 'uncommitted',
			label: `${dirtyCount} uncommitted ${pluralize(dirtyCount, 'change')}`,
			action: { kind: 'commit_and_push', label: 'Commit and push' },
		});
	}

	const behindCount = git?.mainAheadCount ?? 0;
	if (behindCount > 0) {
		rows.push({
			id: 'behind_main',
			label: `${behindCount} ${pluralize(behindCount, 'commit')} behind main`,
			action: { kind: 'pull', label: 'Pull' },
		});
	}

	return rows;
}
