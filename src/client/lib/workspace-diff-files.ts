import type { WorkspaceDiffFile, WorkspaceSnapshot } from '../../shared/types';

export function workspaceHasPullRequest(snapshot: WorkspaceSnapshot | null) {
	const status = snapshot?.github?.status;
	return status === 'open' || status === 'merged' || status === 'closed';
}

export function mergeWorkspaceDiffFiles(
	primary: WorkspaceDiffFile[],
	secondary: WorkspaceDiffFile[],
) {
	const filesByPath = new Map(primary.map((file) => [file.path, file]));
	for (const file of secondary) filesByPath.set(file.path, file);
	return [...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function selectWorkspaceChangeFiles(snapshot: WorkspaceSnapshot | null) {
	if (!snapshot?.git) return [];
	if (!workspaceHasPullRequest(snapshot)) return snapshot.git.files;
	return mergeWorkspaceDiffFiles(
		snapshot.github?.files ?? snapshot.git.pullRequestFiles ?? [],
		snapshot.git.files,
	);
}
