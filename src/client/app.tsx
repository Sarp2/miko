import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { AppShell } from './routes/app-shell';
import { HistoryRoute } from './routes/history-route';
import { HomeRoute } from './routes/home-route';
import { NotFoundRoute } from './routes/not-found-route';
import { SettingsRoute } from './routes/settings-route';
import { WorkspaceRoute } from './routes/workspace-route';
import { useWsStore } from './stores/ws-store';

export function App() {
	useEffect(() => {
		useWsStore.getState().connect();
		return () => useWsStore.getState().disconnect();
	}, []);

	return (
		<>
			<Routes>
				<Route element={<AppShell />}>
					<Route index element={<HomeRoute />} />
					<Route path="workspaces/:workspaceId" element={<WorkspaceRoute kind="workspace" />} />
					<Route
						path="workspaces/:workspaceId/sessions/:sessionId"
						element={<WorkspaceRoute kind="session" />}
					/>
					<Route path="workspaces/:workspaceId/diff" element={<WorkspaceRoute kind="diff" />} />
					<Route path="workspaces/:workspaceId/file" element={<WorkspaceRoute kind="file" />} />
					<Route path="history" element={<HistoryRoute />} />
				</Route>
				<Route path="settings" element={<SettingsRoute />} />
				<Route path="*" element={<NotFoundRoute />} />
			</Routes>
			<Toaster />
		</>
	);
}

export default App;
