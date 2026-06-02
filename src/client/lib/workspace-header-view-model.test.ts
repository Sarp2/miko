import { describe, expect, test } from 'bun:test';
import type {
	WorkspaceGitHubSnapshot,
	WorkspaceGitSnapshot,
	WorkspaceSnapshot,
	WorkspaceSummary,
} from '../../shared/types';
import {
	deriveHeaderIdentity,
	deriveWorkspaceStage,
	isBranchEditable,
} from './workspace-header-view-model';

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

describe('deriveWorkspaceStage', () => {
	test('returns busy states for setup creation and active sessions', () => {
		expect(deriveWorkspaceStage(makeSnapshot({ workspace: { setupState: 'creating' } }))).toEqual({
			stage: 'creating',
			isBusy: true,
		});
		expect(deriveWorkspaceStage(makeSnapshot({ hasActiveSession: true }))).toEqual({
			stage: 'streaming',
			isBusy: true,
		});
	});

	test('returns passive terminal states and idle', () => {
		expect(deriveWorkspaceStage(makeSnapshot({ workspace: { setupState: 'failed' } }))).toEqual({
			stage: 'failed',
			isBusy: false,
		});
		expect(deriveWorkspaceStage(makeSnapshot({ workspace: { reviewState: 'done' } }))).toEqual({
			stage: 'merged',
			isBusy: false,
		});
		expect(deriveWorkspaceStage(makeSnapshot({ workspace: { reviewState: 'closed' } }))).toEqual({
			stage: 'closed',
			isBusy: false,
		});
		expect(deriveWorkspaceStage(makeSnapshot({}))).toEqual({ stage: 'idle', isBusy: false });
	});
});

describe('deriveHeaderIdentity', () => {
	test('shows editable branch before a PR exists', () => {
		const identity = deriveHeaderIdentity(makeSnapshot({}));
		expect(identity).toEqual({ mode: 'branch', text: 'feature/x', editable: true });
	});

	test('shows the PR title and disables editing once a PR exists', () => {
		const snapshot = makeSnapshot({ github: { status: 'open', title: 'Add header' } });
		expect(deriveHeaderIdentity(snapshot)).toEqual({ mode: 'pr', text: 'Add header' });
		expect(isBranchEditable(snapshot)).toBe(false);
	});

	test('disables editing once the branch is pushed', () => {
		expect(isBranchEditable(makeSnapshot({ git: { hasPushedCommits: true } }))).toBe(false);
		expect(isBranchEditable(makeSnapshot({ git: { hasUpstream: true } }))).toBe(false);
		expect(isBranchEditable(makeSnapshot({ git: { branchPublishState: 'unknown' } }))).toBe(false);
	});
});
