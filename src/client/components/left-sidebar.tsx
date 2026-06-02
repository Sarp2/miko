import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { SidebarDirectoryGroup } from '../../shared/types';
import { useSidebarStore } from '../stores/sidebar-store';
import { type SidebarSortField, useUiStore } from '../stores/ui-store';
import { AddDirectoryDialog } from './add-directory-dialog';
import { Sidebar } from './left-sidebar-view';

function sortTimestamp<T extends { createdAt: number; updatedAt: number }>(
	item: T,
	sort: SidebarSortField,
) {
	return sort === 'created' ? item.createdAt : item.updatedAt;
}

function sortWorkspaceTimestamp(
	workspace: SidebarDirectoryGroup['workspaces'][number],
	sort: SidebarSortField,
) {
	if (sort === 'created') return workspace.createdAt;
	return workspace.lastActivityAt ?? workspace.updatedAt;
}

function sortSidebarGroups(
	directoryGroups: SidebarDirectoryGroup[],
	directorySort: SidebarSortField,
	workspaceSort: SidebarSortField,
) {
	return directoryGroups
		.map((directory) => ({
			...directory,
			workspaces: [...directory.workspaces].sort(
				(a, b) =>
					sortWorkspaceTimestamp(b, workspaceSort) - sortWorkspaceTimestamp(a, workspaceSort),
			),
		}))
		.sort((a, b) => sortTimestamp(b, directorySort) - sortTimestamp(a, directorySort));
}

function useActiveWorkspaceId() {
	const { workspaceId } = useParams();
	return workspaceId;
}

export function LeftSidebar() {
	const navigate = useNavigate();
	const activeWorkspaceId = useActiveWorkspaceId();
	const snapshot = useSidebarStore((state) => state.snapshot);
	const createWorkspace = useSidebarStore((state) => state.createWorkspace);
	const leftSidebarCollapsed = useUiStore((state) => state.leftSidebarCollapsed);
	const leftSidebarWidth = useUiStore((state) => state.leftSidebarWidth);
	const expandedDirectoryIds = useUiStore((state) => state.expandedDirectoryIds);
	const sidebarDirectorySort = useUiStore((state) => state.sidebarDirectorySort);
	const sidebarWorkspaceSort = useUiStore((state) => state.sidebarWorkspaceSort);
	const setSidebarDirectorySort = useUiStore((state) => state.setSidebarDirectorySort);
	const setSidebarWorkspaceSort = useUiStore((state) => state.setSidebarWorkspaceSort);
	const setLeftSidebarCollapsed = useUiStore((state) => state.setLeftSidebarCollapsed);
	const setLeftSidebarWidth = useUiStore((state) => state.setLeftSidebarWidth);
	const setDirectoryExpanded = useUiStore((state) => state.setDirectoryExpanded);

	const [workspaceCreateError, setWorkspaceCreateError] = useState<string | null>(null);
	const [addDirectoryOpen, setAddDirectoryOpen] = useState(false);
	const directoryGroups = useMemo(
		() =>
			sortSidebarGroups(
				snapshot?.directoryGroups ?? [],
				sidebarDirectorySort,
				sidebarWorkspaceSort,
			),
		[snapshot, sidebarDirectorySort, sidebarWorkspaceSort],
	);

	return (
		<>
			<Sidebar
				directoryGroups={directoryGroups}
				activeWorkspaceId={activeWorkspaceId}
				expandedDirectoryIds={expandedDirectoryIds}
				collapsed={leftSidebarCollapsed}
				width={leftSidebarWidth}
				onCollapsedChange={setLeftSidebarCollapsed}
				onWidthChange={setLeftSidebarWidth}
				onDirectoryExpandedChange={setDirectoryExpanded}
				directorySort={sidebarDirectorySort}
				workspaceSort={sidebarWorkspaceSort}
				onDirectorySortChange={setSidebarDirectorySort}
				onWorkspaceSortChange={setSidebarWorkspaceSort}
				onWorkspaceSelect={(workspaceId) => navigate(`/workspaces/${workspaceId}`)}
				onCreateWorkspace={async (directoryId) => {
					setWorkspaceCreateError(null);
					const wasExpanded = expandedDirectoryIds.includes(directoryId);
					setDirectoryExpanded(directoryId, true);
					try {
						const result = await createWorkspace(directoryId);
						const nextPath = result.sessionId
							? `/workspaces/${result.workspaceId}/sessions/${result.sessionId}`
							: `/workspaces/${result.workspaceId}`;
						navigate(nextPath);
					} catch (error) {
						if (!wasExpanded) setDirectoryExpanded(directoryId, false);
						throw error;
					}
				}}
				onCreateWorkspaceError={(error) => {
					const message = error instanceof Error ? error.message : 'Failed to create workspace';
					setWorkspaceCreateError(message);
				}}
				onAddDirectory={() => setAddDirectoryOpen(true)}
				onOpenArchive={() => navigate('/archive')}
				onOpenSettings={() => navigate('/settings')}
			/>
			<AddDirectoryDialog open={addDirectoryOpen} onOpenChange={setAddDirectoryOpen} />
			{workspaceCreateError && (
				<div className="fixed bottom-3 left-3 z-50 max-w-[360px] rounded-lg border border-destructive/30 bg-surface-1 px-3 py-2 text-[12px] leading-5 text-destructive shadow-lg">
					{workspaceCreateError}
				</div>
			)}
		</>
	);
}
