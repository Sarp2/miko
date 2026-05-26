import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useSidebarStore } from '../stores/sidebar-store';

export function AppShell() {
	useEffect(() => {
		useSidebarStore.getState().connectSidebar();
		return () => useSidebarStore.getState().disconnectSidebar();
	}, []);

	return (
		<div data-testid="app-shell">
			<aside data-testid="left-sidebar">Sidebar</aside>
			<main data-testid="middle-surface">
				<Outlet />
			</main>
			<aside data-testid="right-sidebar">Inspector</aside>
		</div>
	);
}
