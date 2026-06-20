import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
	pinnedWorkspacesFromGroups,
	sortSidebarGroups,
	withoutPinnedWorkspaces,
} from '../lib/sidebar-order';
import { useSidebarStore } from '../stores/sidebar-store';
import { useUiStore } from '../stores/ui-store';
import { AddDirectoryDialog } from './add-directory-dialog';
import { Sidebar } from './left-sidebar-view';

function useActiveWorkspaceId() {
	const { workspaceId } = useParams();
	return workspaceId;
}

export function LeftSidebar() {
	const navigate = useNavigate();
	const location = useLocation();
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
	const pinnedWorkspaceIds = useUiStore((state) => state.pinnedWorkspaceIds);
	const toggleWorkspacePinned = useUiStore((state) => state.toggleWorkspacePinned);
	const removeWorkspaceUi = useUiStore((state) => state.removeWorkspaceUi);
	const setWorkspaceVisibility = useSidebarStore((state) => state.setWorkspaceVisibility);

	const [workspaceCreateError, setWorkspaceCreateError] = useState<string | null>(null);
	const [addDirectoryOpen, setAddDirectoryOpen] = useState(false);
	const allDirectoryGroups = useMemo(
		() =>
			sortSidebarGroups(
				snapshot?.directoryGroups ?? [],
				sidebarDirectorySort,
				sidebarWorkspaceSort,
			),
		[snapshot, sidebarDirectorySort, sidebarWorkspaceSort],
	);
	const pinnedWorkspaces = useMemo(
		() => pinnedWorkspacesFromGroups(allDirectoryGroups, pinnedWorkspaceIds),
		[allDirectoryGroups, pinnedWorkspaceIds],
	);
	const directoryGroups = useMemo(
		() => withoutPinnedWorkspaces(allDirectoryGroups, pinnedWorkspaceIds),
		[allDirectoryGroups, pinnedWorkspaceIds],
	);

	return (
		<>
			<Sidebar
				directoryGroups={directoryGroups}
				pinnedWorkspaces={pinnedWorkspaces}
				pinnedWorkspaceIds={pinnedWorkspaceIds}
				activeWorkspaceId={activeWorkspaceId}
				historyActive={location.pathname === '/history'}
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
				onWorkspacePinToggle={toggleWorkspacePinned}
				onWorkspaceArchive={async (workspaceId) => {
					setWorkspaceCreateError(null);
					try {
						await setWorkspaceVisibility(workspaceId, 'archived');
						removeWorkspaceUi(workspaceId);
						if (workspaceId === activeWorkspaceId) navigate('/');
					} catch (error) {
						const message = error instanceof Error ? error.message : 'Failed to archive workspace';
						setWorkspaceCreateError(message);
					}
				}}
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
				onOpenHistory={() => navigate('/history')}
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
