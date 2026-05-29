import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { LeftSidebar } from '../components/left-sidebar';
import { useSidebarStore } from '../stores/sidebar-store';

export function AppShell() {
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
			<aside
				data-testid="right-sidebar"
				className="w-[320px] shrink-0 border-l border-hairline bg-surface-1 text-ink-muted"
			>
				Inspector
			</aside>
		</div>
	);
}
