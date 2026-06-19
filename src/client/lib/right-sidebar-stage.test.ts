import { describe, expect, test } from 'bun:test';
import type { PullRequestCheckSnapshot, WorkspaceSnapshot } from '../../shared/types';
import { rightSidebarStageLabel } from './right-sidebar-stage';
import type { WorkspaceCondition, WorkspaceConditionStage } from './workspace-condition';

function condition(stage: WorkspaceConditionStage): WorkspaceCondition {
	return {
		workspaceId: 'workspace-1',
		setupState: 'ready',
		reviewState: 'in_progress',
		stage,
		hasDirtyFiles: false,
		dirtyFileCount: 0,
		diffStats: { additions: 0, deletions: 0 },
		primaryAction: null,
	};
}

function check(status: PullRequestCheckSnapshot['status']): PullRequestCheckSnapshot {
	return { name: `check-${status}`, status, canFetchLogs: status === 'failing' };
}

function snapshot(checks: PullRequestCheckSnapshot[] = []): WorkspaceSnapshot {
	return {
		workspace: {
			id: 'workspace-1',
			directoryId: 'directory-1',
			localPath: '/repo/worktree',
			branchName: 'feature/work',
			setupState: 'ready',
			reviewState: 'in_review',
			visibilityState: 'active',
			hasUnreadAgentResult: false,
			createdAt: 1,
			updatedAt: 1,
		},
		primaryLabel: 'feature/work',
		healthState: 'healthy',
		git: null,
		github: {
			status: 'open',
			owner: 'sarp',
			repo: 'miko',
			comments: [],
			checks,
		},
		sessions: [],
		hasActiveSession: false,
		hasUnreadAgentResult: false,
	};
}

describe('rightSidebarStageLabel', () => {
	test('returns user-facing labels for active review states', () => {
		expect(rightSidebarStageLabel(condition('agent_active'), snapshot())).toBe('Working...');
		expect(rightSidebarStageLabel(condition('merge_conflicts'), snapshot())).toBe(
			'Merge conflicts',
		);
		expect(rightSidebarStageLabel(condition('draft_pr'), snapshot())).toBe('Marked as draft');
		expect(rightSidebarStageLabel(condition('ci_failed'), snapshot())).toBe('Checks failed');
		expect(rightSidebarStageLabel(condition('pr_open'), snapshot())).toBe('Ready to merge');
		expect(rightSidebarStageLabel(condition('merged'), snapshot())).toBe('Merged');
	});

	test('pluralizes pending check labels from the snapshot', () => {
		expect(rightSidebarStageLabel(condition('ci_pending'), snapshot([check('pending')]))).toBe(
			'1 check pending...',
		);
		expect(
			rightSidebarStageLabel(
				condition('ci_pending'),
				snapshot([check('pending'), check('pending')]),
			),
		).toBe('2 checks pending...');
		expect(rightSidebarStageLabel(condition('ci_pending'), snapshot([check('passing')]))).toBe(
			'Checks pending...',
		);
	});

	test('stays quiet for non-message states', () => {
		for (const stage of ['dirty', 'idle', 'behind_main'] as const) {
			expect(rightSidebarStageLabel(condition(stage), snapshot())).toBeNull();
		}
	});
});
