import { describe, expect, test } from 'bun:test';
import type { SidebarDirectoryGroup, SidebarWorkspaceRow } from '../../shared/types';
import { orderedSidebarWorkspaces, pinnedWorkspacesFromGroups } from './sidebar-order';

function workspace(workspaceId: string, createdAt = 1): SidebarWorkspaceRow {
	return {
		workspaceId,
		createdAt,
		updatedAt: createdAt,
		lastActivityAt: createdAt,
	} as SidebarWorkspaceRow;
}

function directory(workspaces: SidebarWorkspaceRow[]): SidebarDirectoryGroup {
	return {
		directoryId: 'directory-1',
		createdAt: 1,
		updatedAt: 1,
		workspaces,
	} as SidebarDirectoryGroup;
}

describe('pinnedWorkspacesFromGroups', () => {
	test('deduplicates pinned workspace ids while preserving first-seen order', () => {
		const groups = [directory([workspace('workspace-1'), workspace('workspace-2')])];

		expect(
			pinnedWorkspacesFromGroups(groups, ['workspace-2', 'workspace-2', 'workspace-1']).map(
				(candidate) => candidate.workspaceId,
			),
		).toEqual(['workspace-2', 'workspace-1']);
	});
});

describe('orderedSidebarWorkspaces', () => {
	test('does not duplicate pinned workspaces in cycling order', () => {
		const groups = [directory([workspace('workspace-1'), workspace('workspace-2')])];

		expect(
			orderedSidebarWorkspaces(groups, ['workspace-2', 'workspace-2']).map(
				(candidate) => candidate.workspaceId,
			),
		).toEqual(['workspace-2', 'workspace-1']);
	});
});
