import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSidebarStore } from '../stores/sidebar-store';
import { useUiStore } from '../stores/ui-store';
import { Sidebar } from './sidebar';

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
	const setLeftSidebarCollapsed = useUiStore((state) => state.setLeftSidebarCollapsed);
	const setLeftSidebarWidth = useUiStore((state) => state.setLeftSidebarWidth);
	const setDirectoryExpanded = useUiStore((state) => state.setDirectoryExpanded);

	const [workspaceCreateError, setWorkspaceCreateError] = useState<string | null>(null);
	const directoryGroups = useMemo(() => snapshot?.directoryGroups ?? [], [snapshot]);

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
				onWorkspaceSelect={(workspaceId) => navigate(`/workspaces/${workspaceId}`)}
				onCreateWorkspace={async (directoryId) => {
					setWorkspaceCreateError(null);
					const result = await createWorkspace(directoryId);
					navigate(`/workspaces/${result.workspaceId}`);
				}}
				onCreateWorkspaceError={(error) => {
					const message = error instanceof Error ? error.message : 'Failed to create workspace';
					setWorkspaceCreateError(message);
				}}
				onAddDirectory={() => navigate('/')}
				onOpenArchive={() => navigate('/archive')}
				onOpenSettings={() => navigate('/settings')}
			/>
			{workspaceCreateError && (
				<div className="fixed bottom-3 left-3 z-50 max-w-[360px] rounded-lg border border-destructive/30 bg-surface-1 px-3 py-2 text-[12px] leading-5 text-destructive shadow-lg">
					{workspaceCreateError}
				</div>
			)}
		</>
	);
}
