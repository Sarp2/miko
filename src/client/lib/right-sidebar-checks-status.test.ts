import { describe, expect, test } from 'bun:test';
import type {
	WorkspaceDiffFile,
	WorkspaceGitHubSnapshot,
	WorkspaceGitSnapshot,
	WorkspaceSnapshot,
	WorkspaceSummary,
} from '../../shared/types';
import { deriveChecksGitStatusRows } from './right-sidebar-checks-status';

function diffFile(path: string): WorkspaceDiffFile {
	return {
		path,
		changeType: 'modified',
		isUntracked: false,
		additions: 1,
		deletions: 0,
		patchDigest: `${path}:digest`,
	};
}

function makeSnapshot(overrides: {
	workspace?: Partial<WorkspaceSummary>;
	git?: Partial<WorkspaceGitSnapshot> | null;
	github?: Partial<WorkspaceGitHubSnapshot> | null;
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
		hasActiveSession: false,
		hasUnreadAgentResult: false,
	};
}

describe('deriveChecksGitStatusRows', () => {
	test('shows pre-PR rows with create/commit/pull actions', () => {
		const rows = deriveChecksGitStatusRows(
			makeSnapshot({
				github: null,
				git: {
					files: [diffFile('a.ts'), diffFile('b.ts')],
					hasPushedCommits: true,
					mainAheadCount: 1,
				},
			}),
		);
		expect(rows).toEqual([
			{ id: 'pr', label: 'No PR open', action: { kind: 'create_pr', label: 'Create PR' } },
			{
				id: 'uncommitted',
				label: '2 uncommitted changes',
				action: { kind: 'commit_and_push', label: 'Commit and push' },
			},
			{ id: 'behind_main', label: '1 commit behind main', action: { kind: 'pull', label: 'Pull' } },
		]);
	});

	test('omits the Create PR action with no publishable work and drops the PR row when open', () => {
		expect(
			deriveChecksGitStatusRows(makeSnapshot({ github: null, git: { files: [] } }))[0],
		).toEqual({ id: 'pr', label: 'No PR open' });

		expect(
			deriveChecksGitStatusRows(
				makeSnapshot({
					workspace: { reviewState: 'in_review' },
					github: { status: 'open', prNumber: 42 },
					git: { files: [diffFile('a.ts')] },
				}),
			).some((row) => row.id === 'pr'),
		).toBe(false);
	});

	test('returns no rows for merged or closed workspaces', () => {
		expect(
			deriveChecksGitStatusRows(
				makeSnapshot({ workspace: { reviewState: 'done' }, git: { files: [diffFile('a.ts')] } }),
			),
		).toEqual([]);
		expect(
			deriveChecksGitStatusRows(makeSnapshot({ workspace: { reviewState: 'closed' } })),
		).toEqual([]);
	});
});
