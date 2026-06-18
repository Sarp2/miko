import type { WorkspaceSnapshot } from '../../shared/types';

// Header read-model derivation. These helpers turn a WorkspaceSnapshot into the
// small set of values the WorkspaceHeader renders. Keep this file pure so the
// precedence rules can be tested without React.

export type WorkspaceStage = 'creating' | 'failed' | 'streaming' | 'merged' | 'closed' | 'idle';

export interface WorkspaceStageInfo {
	stage: WorkspaceStage;
	// While the workspace is changing we show a loader and hide future action UI.
	isBusy: boolean;
}

export interface WorkspaceHeaderPullRequestBadge {
	number: number;
	url?: string;
}

export function deriveWorkspaceStage(snapshot: WorkspaceSnapshot): WorkspaceStageInfo {
	const { workspace, hasActiveSession } = snapshot;

	if (workspace.setupState === 'creating') return { stage: 'creating', isBusy: true };
	if (workspace.setupState === 'failed') return { stage: 'failed', isBusy: false };
	if (hasActiveSession) return { stage: 'streaming', isBusy: true };
	if (workspace.reviewState === 'done') return { stage: 'merged', isBusy: false };
	if (workspace.reviewState === 'closed') return { stage: 'closed', isBusy: false };

	return { stage: 'idle', isBusy: false };
}

export function deriveHeaderPullRequestBadge(
	snapshot: WorkspaceSnapshot,
): WorkspaceHeaderPullRequestBadge | null {
	const github = snapshot.github;
	if (
		github &&
		github.status !== 'none' &&
		github.status !== 'unknown' &&
		typeof github.prNumber === 'number'
	) {
		return { number: github.prNumber, url: github.url };
	}

	const pullRequest = snapshot.workspace.pullRequest;
	if (!pullRequest || typeof pullRequest.number !== 'number') return null;
	return { number: pullRequest.number, url: pullRequest.url };
}

export function hasPullRequest(snapshot: WorkspaceSnapshot): boolean {
	if (snapshot.workspace.pullRequest) return true;
	const status = snapshot.github?.status;
	return status === 'open' || status === 'merged' || status === 'closed';
}

// Prefer a real PR title; fall back to the summary persisted on the workspace.
export function resolvePullRequestTitle(snapshot: WorkspaceSnapshot): string | null {
	const github = snapshot.github;
	if (github && github.status !== 'none' && github.status !== 'unknown' && github.title) {
		return github.title;
	}
	return snapshot.workspace.pullRequest?.title ?? null;
}

export type WorkspaceHeaderIdentity =
	| { mode: 'pr'; text: string }
	| { mode: 'branch'; text: string; editable: boolean };

export function isBranchEditable(snapshot: WorkspaceSnapshot): boolean {
	const { workspace, git } = snapshot;
	if (workspace.setupState !== 'ready') return false;
	if (workspace.reviewState !== 'in_progress') return false;
	if (hasPullRequest(snapshot)) return false;
	if (!git || git.status === 'no_repo') return false;
	if (git.hasPushedCommits) return false;
	if (git.branchPublishState !== 'local_only') return false;
	if (git.hasUpstream) return false;
	return true;
}

export function deriveHeaderIdentity(snapshot: WorkspaceSnapshot): WorkspaceHeaderIdentity {
	const prTitle = resolvePullRequestTitle(snapshot);
	if (prTitle) return { mode: 'pr', text: prTitle };
	return {
		mode: 'branch',
		text: snapshot.workspace.branchName,
		editable: isBranchEditable(snapshot),
	};
}
