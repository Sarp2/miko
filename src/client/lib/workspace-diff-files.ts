import type { WorkspaceDiffFile, WorkspaceSnapshot } from '../../shared/types';

function isPullRequestStatus(status: string | undefined) {
	return status === 'open' || status === 'merged' || status === 'closed';
}

export function workspaceHasPullRequest(snapshot: WorkspaceSnapshot | null) {
	return (
		isPullRequestStatus(snapshot?.github?.status) ||
		isPullRequestStatus(snapshot?.workspace.pullRequest?.status)
	);
}

export function mergeWorkspaceDiffFiles(
	baseFiles: WorkspaceDiffFile[],
	overrideFiles: WorkspaceDiffFile[],
) {
	const filesByPath = new Map<string, WorkspaceDiffFile>();
	for (const file of baseFiles) filesByPath.set(file.path, file);
	for (const file of overrideFiles) filesByPath.set(file.path, file);
	return Array.from(filesByPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

export function selectWorkspaceChangeFiles(snapshot: WorkspaceSnapshot | null) {
	if (!snapshot?.git) return [];
	if (!workspaceHasPullRequest(snapshot)) return snapshot.git.files;
	return mergeWorkspaceDiffFiles(
		snapshot.github?.files ??
			snapshot.workspace.pullRequest?.files ??
			snapshot.git.pullRequestFiles ??
			[],
		snapshot.git.files,
	);
}
