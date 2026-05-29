import { useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useScratchpadStore } from '../stores/scratchpad-store';
import { useSessionStore } from '../stores/session-store';
import { useUiStore } from '../stores/ui-store';
import { useWorkspaceStore } from '../stores/workspace-store';
import { deriveWorkspaceRoutePage, type WorkspaceRouteKind } from './workspace-route-state';

interface WorkspaceRouteProps {
	kind: WorkspaceRouteKind;
}

export function WorkspaceRoute({ kind }: WorkspaceRouteProps) {
	const { workspaceId, sessionId } = useParams();
	const [searchParams] = useSearchParams();
	const workspaceSnapshot = useWorkspaceStore((state) =>
		workspaceId ? state.getWorkspaceSnapshot(workspaceId) : null,
	);
	const sessions = workspaceSnapshot?.sessions ?? [];

	useEffect(() => {
		if (!workspaceId) return;
		useWorkspaceStore.getState().connectWorkspace(workspaceId);
		useScratchpadStore.getState().connectScratchpad(workspaceId);
		useUiStore.getState().ensureScratchpadTab(workspaceId);

		return () => {
			useWorkspaceStore.getState().disconnectWorkspace(workspaceId);
			useScratchpadStore.getState().disconnectScratchpad(workspaceId);
			useSessionStore.getState().disconnectWorkspaceSessions(workspaceId);
		};
	}, [workspaceId]);

	useEffect(() => {
		if (!workspaceId || !workspaceSnapshot) return;
		useSessionStore.getState().syncWorkspaceSessions(
			workspaceId,
			workspaceSnapshot.sessions.map((session) => session.id),
			{ recentLimit: 80 },
		);
	}, [workspaceId, workspaceSnapshot]);

	const page = useMemo(() => {
		return deriveWorkspaceRoutePage({ kind, sessionId, searchParams, sessions });
	}, [kind, sessionId, searchParams, sessions]);

	useEffect(() => {
		if (!workspaceId || !page) return;
		useUiStore.getState().openMiddleTab(workspaceId, page);
	}, [workspaceId, page]);

	if (!workspaceId) return <section data-testid="workspace-route">Missing workspace</section>;

	return (
		<section data-testid="workspace-route" data-workspace-id={workspaceId}>
			Workspace {workspaceId}
			{page ? <pre data-testid="workspace-page">{JSON.stringify(page)}</pre> : null}
		</section>
	);
}
