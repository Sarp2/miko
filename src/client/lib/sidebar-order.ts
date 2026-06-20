import type { SidebarDirectoryGroup, SidebarWorkspaceRow } from '../../shared/types';
import type { SidebarSortField } from '../stores/ui-store';

function sortTimestamp<T extends { createdAt: number; updatedAt: number }>(
	item: T,
	sort: SidebarSortField,
) {
	return sort === 'created' ? item.createdAt : item.updatedAt;
}

function sortWorkspaceTimestamp(workspace: SidebarWorkspaceRow, sort: SidebarSortField) {
	if (sort === 'created') return workspace.createdAt;
	return workspace.lastActivityAt ?? workspace.updatedAt;
}

export function sortSidebarGroups(
	directoryGroups: SidebarDirectoryGroup[],
	directorySort: SidebarSortField,
	workspaceSort: SidebarSortField,
) {
	return directoryGroups
		.map((directory) => ({
			...directory,
			workspaces: directory.workspaces.toSorted(
				(a, b) =>
					sortWorkspaceTimestamp(b, workspaceSort) - sortWorkspaceTimestamp(a, workspaceSort),
			),
		}))
		.toSorted((a, b) => sortTimestamp(b, directorySort) - sortTimestamp(a, directorySort));
}

export function pinnedWorkspacesFromGroups(
	directoryGroups: SidebarDirectoryGroup[],
	pinnedWorkspaceIds: string[],
) {
	const workspaceById = new Map<string, SidebarWorkspaceRow>();
	for (const directory of directoryGroups) {
		for (const workspace of directory.workspaces) {
			workspaceById.set(workspace.workspaceId, workspace);
		}
	}

	return pinnedWorkspaceIds
		.map((workspaceId) => workspaceById.get(workspaceId))
		.filter((workspace): workspace is SidebarWorkspaceRow => Boolean(workspace));
}

export function withoutPinnedWorkspaces(
	directoryGroups: SidebarDirectoryGroup[],
	pinnedWorkspaceIds: string[],
) {
	const pinnedIds = new Set(pinnedWorkspaceIds);
	return directoryGroups.map((directory) => ({
		...directory,
		workspaces: directory.workspaces.filter((workspace) => !pinnedIds.has(workspace.workspaceId)),
	}));
}

export function orderedSidebarWorkspaces(
	directoryGroups: SidebarDirectoryGroup[],
	pinnedWorkspaceIds: string[],
) {
	const pinned = pinnedWorkspacesFromGroups(directoryGroups, pinnedWorkspaceIds);
	const pinnedIds = new Set(pinned.map((workspace) => workspace.workspaceId));
	const unpinned = directoryGroups.flatMap((directory) =>
		directory.workspaces.filter((workspace) => !pinnedIds.has(workspace.workspaceId)),
	);
	return [...pinned, ...unpinned];
}
