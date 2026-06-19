import { describe, expect, test } from 'bun:test';
import type {
	SidebarWorkspaceRow,
	WorkspaceDiffFile,
	WorkspaceGitHubSnapshot,
	WorkspaceGitSnapshot,
	WorkspaceSnapshot,
	WorkspaceSummary,
} from '../../shared/types';
import { deriveSidebarWorkspaceCondition, deriveWorkspaceCondition } from './workspace-condition';

function diffFile(
	path = 'src/app.ts',
	overrides: Partial<Pick<WorkspaceDiffFile, 'additions' | 'deletions'>> = {},
): WorkspaceDiffFile {
	return {
		path,
		changeType: 'modified',
		isUntracked: false,
		additions: 3,
		deletions: 1,
		patchDigest: `${path}:digest`,
		...overrides,
	};
}

function makeSnapshot(overrides: {
	workspace?: Partial<WorkspaceSummary>;
	git?: Partial<WorkspaceGitSnapshot> | null;
	github?: Partial<WorkspaceGitHubSnapshot> | null;
	hasActiveSession?: boolean;
}): WorkspaceSnapshot {
	const workspace: WorkspaceSummary = {
		id: 'ws1',
		directoryId: 'dir1',
		localPath: '/repo',
		branchName: 'feature/x',
		setupState: 'ready',
		reviewState: 'in_progress',
		visibilityState: 'active',
		hasUnreadAgentResult: false,
		createdAt: 1,
		updatedAt: 1,
		...overrides.workspace,
	};

	const git =
		overrides.git === null
			? null
			: ({
					status: 'ready',
					files: [],
					branchPublishState: 'local_only',
					hasPushedCommits: false,
					mainAheadCount: 0,
					...overrides.git,
				} as WorkspaceGitSnapshot);

	const github =
		overrides.github == null
			? null
			: ({
					status: 'open',
					owner: 'o',
					repo: 'r',
					comments: [],
					checks: [],
					...overrides.github,
				} as WorkspaceGitHubSnapshot);

	return {
		workspace,
		primaryLabel: workspace.branchName,
		healthState: 'healthy',
		git,
		github,
		sessions: [],
		hasActiveSession: overrides.hasActiveSession ?? false,
		hasUnreadAgentResult: false,
	};
}

describe('deriveWorkspaceCondition', () => {
	test('keeps canonical workspace states and derives setup/active stages first', () => {
		expect(
			deriveWorkspaceCondition(
				makeSnapshot({
					workspace: { setupState: 'creating' },
					git: { files: [diffFile()], hasPushedCommits: true },
				}),
			),
		).toMatchObject({
			setupState: 'creating',
			reviewState: 'in_progress',
			stage: 'creating',
			primaryAction: null,
			hasDirtyFiles: true,
			dirtyFileCount: 1,
		});

		expect(
			deriveWorkspaceCondition(
				makeSnapshot({
					hasActiveSession: true,
					git: { files: [diffFile()] },
				}),
			),
		).toMatchObject({
			stage: 'agent_active',
			primaryAction: { kind: 'active', label: '' },
		});
	});

	test('uses reviewState for terminal PR states without boolean aliases', () => {
		expect(
			deriveWorkspaceCondition(makeSnapshot({ workspace: { reviewState: 'done' } })),
		).toMatchObject({
			reviewState: 'done',
			stage: 'merged',
			primaryAction: { kind: 'archive', label: 'Archive' },
		});

		expect(
			deriveWorkspaceCondition(makeSnapshot({ workspace: { reviewState: 'closed' } })),
		).toMatchObject({
			reviewState: 'closed',
			stage: 'closed',
			primaryAction: { kind: 'archive', label: 'Archive' },
		});
	});

	test('derives PR, CI, pushed, dirty, and behind-main action stages', () => {
		expect(
			deriveWorkspaceCondition(
				makeSnapshot({
					workspace: { reviewState: 'in_review' },
					github: { status: 'open', ciStatus: 'failing' },
				}),
			),
		).toMatchObject({
			stage: 'ci_failed',
			primaryAction: { kind: 'fix_ci', label: 'Fix CI' },
		});

		expect(
			deriveWorkspaceCondition(
				makeSnapshot({
					workspace: { reviewState: 'in_review' },
					github: { status: 'open', ciStatus: 'pending' },
				}),
			),
		).toMatchObject({
			stage: 'ci_pending',
			primaryAction: null,
		});

		expect(
			deriveWorkspaceCondition(makeSnapshot({ workspace: { reviewState: 'in_review' } })),
		).toMatchObject({
			stage: 'pr_open',
			primaryAction: { kind: 'merge', label: 'Merge' },
		});

		expect(
			deriveWorkspaceCondition(
				makeSnapshot({
					workspace: { reviewState: 'in_review' },
					github: { status: 'open', isDraft: true },
				}),
			),
		).toMatchObject({
			stage: 'draft_pr',
			primaryAction: { kind: 'mark_pr_ready', label: 'Mark ready' },
		});

		expect(
			deriveWorkspaceCondition(
				makeSnapshot({
					workspace: { reviewState: 'in_review' },
					github: { status: 'open', isDraft: true, ciStatus: 'pending' },
				}),
			),
		).toMatchObject({
			stage: 'draft_pr',
			primaryAction: { kind: 'mark_pr_ready', label: 'Mark ready' },
		});

		expect(
			deriveWorkspaceCondition(
				makeSnapshot({
					workspace: {
						reviewState: 'in_review',
						pullRequest: {
							number: 12,
							status: 'open',
							isDraft: true,
							lastObservedAt: 1,
						},
					},
					github: { status: 'open', isDraft: false },
				}),
			),
		).toMatchObject({
			stage: 'draft_pr',
			primaryAction: { kind: 'mark_pr_ready', label: 'Mark ready' },
		});

		expect(
			deriveWorkspaceCondition(
				makeSnapshot({
					workspace: { reviewState: 'in_review' },
					github: { status: 'open', ciStatus: 'failing', hasMergeConflicts: true },
				}),
			),
		).toMatchObject({
			stage: 'merge_conflicts',
			primaryAction: {
				kind: 'resolve_merge_conflicts',
				label: 'Resolve conflicts',
			},
		});

		expect(
			deriveWorkspaceCondition(
				makeSnapshot({
					workspace: { reviewState: 'in_review' },
					git: { files: [diffFile()] },
				}),
			),
		).toMatchObject({
			stage: 'dirty',
			primaryAction: { kind: 'commit_and_push', label: 'Commit and push' },
		});

		expect(
			deriveWorkspaceCondition(makeSnapshot({ git: { hasPushedCommits: true } })),
		).toMatchObject({
			stage: 'ready_to_create_pr',
			primaryAction: { kind: 'create_pr', label: 'Create PR' },
		});

		expect(
			deriveWorkspaceCondition(
				makeSnapshot({
					git: {
						files: [
							diffFile('src/app.ts', { additions: 5, deletions: 2 }),
							diffFile('src/lib.ts', { additions: 8, deletions: 1 }),
						],
					},
				}),
			),
		).toMatchObject({
			stage: 'dirty',
			primaryAction: { kind: 'create_pr', label: 'Create PR' },
			hasDirtyFiles: true,
			dirtyFileCount: 2,
			diffStats: { additions: 13, deletions: 3 },
		});

		expect(deriveWorkspaceCondition(makeSnapshot({ git: { mainAheadCount: 2 } }))).toMatchObject({
			stage: 'behind_main',
			primaryAction: null,
		});
	});
});

describe('deriveSidebarWorkspaceCondition', () => {
	function makeRow(overrides: Partial<SidebarWorkspaceRow> = {}): SidebarWorkspaceRow {
		return {
			_id: 'ws1',
			_creationTime: 1,
			workspaceId: 'ws1',
			createdAt: 1,
			updatedAt: 1,
			displayName: 'PR title',
			reviewState: 'in_review',
			visibilityState: 'active',
			indicator: 'pr_opened',
			hasUnreadAgentResult: false,
			hasActiveSession: false,
			localPath: '/repo/ws1',
			branchName: 'feature/x',
			githubOwner: 'o',
			githubRepo: 'r',
			defaultBranchName: 'main',
			prNumber: 12,
			prTitle: 'PR title',
			hasDirtyFiles: false,
			hasUnpushedCommits: false,
			hasPullRequest: true,
			displayDiffStats: { additions: 52, deletions: 14 },
			...overrides,
		};
	}

	test('does not treat PR diff stats as dirty local files', () => {
		expect(deriveSidebarWorkspaceCondition(makeRow())).toMatchObject({
			stage: 'pr_open',
			primaryAction: { kind: 'merge', label: 'Merge' },
			hasDirtyFiles: false,
			diffStats: { additions: 52, deletions: 14 },
		});

		expect(deriveSidebarWorkspaceCondition(makeRow({ hasDirtyFiles: true }))).toMatchObject({
			stage: 'dirty',
			primaryAction: { kind: 'commit_and_push', label: 'Commit and push' },
			hasDirtyFiles: true,
		});

		expect(
			deriveSidebarWorkspaceCondition(
				makeRow({ hasUnpushedCommits: true, displayDiffStats: { additions: 0, deletions: 0 } }),
			),
		).toMatchObject({
			stage: 'dirty',
			primaryAction: { kind: 'commit_and_push', label: 'Commit and push' },
			hasDirtyFiles: false,
		});
	});

	test('normalizes stale PR rows from sidebar indicators before deriving actions', () => {
		expect(
			deriveSidebarWorkspaceCondition(
				makeRow({ reviewState: 'in_progress', indicator: 'pr_opened' }),
			),
		).toMatchObject({
			reviewState: 'in_review',
			stage: 'pr_open',
			primaryAction: { kind: 'merge', label: 'Merge' },
		});

		expect(
			deriveSidebarWorkspaceCondition(
				makeRow({
					reviewState: 'in_progress',
					indicator: 'commit_and_push',
					hasUnpushedCommits: true,
				}),
			),
		).toMatchObject({
			reviewState: 'in_review',
			stage: 'dirty',
			primaryAction: { kind: 'commit_and_push', label: 'Commit and push' },
		});

		expect(
			deriveSidebarWorkspaceCondition(
				makeRow({ reviewState: 'in_progress', indicator: 'merge_conflicts' }),
			),
		).toMatchObject({
			reviewState: 'in_review',
			stage: 'merge_conflicts',
			primaryAction: {
				kind: 'resolve_merge_conflicts',
				label: 'Resolve conflicts',
			},
		});

		expect(
			deriveSidebarWorkspaceCondition(
				makeRow({ reviewState: 'in_progress', indicator: 'draft_pr' }),
			),
		).toMatchObject({
			reviewState: 'in_review',
			stage: 'draft_pr',
			primaryAction: { kind: 'mark_pr_ready', label: 'Mark ready' },
		});
	});
});
