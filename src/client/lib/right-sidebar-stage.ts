import type { WorkspaceSnapshot } from '../../shared/types';
import type { WorkspaceCondition } from './workspace-condition';

function pluralize(count: number, singular: string) {
	return count === 1 ? singular : `${singular}s`;
}

export function rightSidebarStageLabel(
	condition: WorkspaceCondition,
	snapshot: WorkspaceSnapshot,
): string | null {
	if (condition.stage === 'agent_active') return 'Working...';
	if (condition.stage === 'merge_conflicts') return 'Merge conflicts';
	if (condition.stage === 'merged') return 'Merged';
	if (condition.stage === 'pr_open') return 'Ready to merge';
	if (condition.stage === 'ci_failed') return 'Checks failed';
	if (condition.stage === 'ci_pending') {
		const pendingCount =
			snapshot.github?.checks.filter((check) => check.status === 'pending').length ?? 0;
		if (pendingCount > 0) return `${pendingCount} ${pluralize(pendingCount, 'check')} pending...`;
		return 'Checks pending...';
	}
	if (condition.stage === 'draft_pr') return 'Marked as draft';
	if (condition.stage === 'ready_to_create_pr') return 'Ready for PR';
	if (condition.stage === 'closed') return 'Closed';
	if (condition.stage === 'creating') return 'Creating workspace...';
	if (condition.stage === 'setup_failed') return 'Setup failed';
	return null;
}
