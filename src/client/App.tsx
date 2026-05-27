import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './routes/AppShell';
import { ArchiveRoute } from './routes/ArchiveRoute';
import { HomeRoute } from './routes/HomeRoute';
import { NotFoundRoute } from './routes/NotFoundRoute';
import { SettingsRoute } from './routes/SettingsRoute';
import { WorkspaceRoute } from './routes/WorkspaceRoute';
import { useWsStore } from './stores/ws-store';

export function App() {
	useEffect(() => {
		useWsStore.getState().connect();
		return () => useWsStore.getState().disconnect();
	}, []);

	return (
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
			</Route>
			<Route path="archive" element={<ArchiveRoute />} />
			<Route path="settings" element={<SettingsRoute />} />
			<Route path="*" element={<NotFoundRoute />} />
		</Routes>
	);
}

export default App;
