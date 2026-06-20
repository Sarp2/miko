import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { GlobalKeybindings } from '../components/global-keybindings';
import { LeftSidebar } from '../components/left-sidebar';
import { RightSidebar } from '../components/right-sidebar';
import { useSidebarStore } from '../stores/sidebar-store';

function workspaceIdFromPath(pathname: string) {
	const match = pathname.match(/^\/workspaces\/([^/]+)/);
	return match ? decodeURIComponent(match[1]) : null;
}

export function AppShell() {
	const location = useLocation();
	const workspaceId = workspaceIdFromPath(location.pathname);

	useEffect(() => {
		useSidebarStore.getState().connectSidebar();
		return () => useSidebarStore.getState().disconnectSidebar();
	}, []);

	return (
		<div
			data-testid="app-shell"
			className="flex h-screen w-screen overflow-hidden bg-canvas text-ink"
		>
			<GlobalKeybindings />
			<LeftSidebar />
			<main data-testid="middle-surface" className="min-w-0 flex-1 overflow-hidden bg-canvas">
				<Outlet />
			</main>
			{workspaceId ? <RightSidebar workspaceId={workspaceId} /> : null}
		</div>
	);
}
