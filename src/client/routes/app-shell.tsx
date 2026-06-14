import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { LeftSidebar } from '../components/left-sidebar';
import { useSidebarStore } from '../stores/sidebar-store';

export function AppShell() {
	const location = useLocation();
	const showRightSidebar = location.pathname.startsWith('/workspaces/');

	useEffect(() => {
		useSidebarStore.getState().connectSidebar();
		return () => useSidebarStore.getState().disconnectSidebar();
	}, []);

	return (
		<div
			data-testid="app-shell"
			className="flex h-screen w-screen overflow-hidden bg-canvas text-ink"
		>
			<LeftSidebar />
			<main data-testid="middle-surface" className="min-w-0 flex-1 overflow-hidden bg-canvas">
				<Outlet />
			</main>
			{showRightSidebar ? (
				<aside
					data-testid="right-sidebar"
					className="w-[320px] shrink-0 border-l border-hairline bg-surface-1 text-ink-muted"
				>
					Inspector
				</aside>
			) : null}
		</div>
	);
}
