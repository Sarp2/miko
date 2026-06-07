import { lazy, Suspense, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SessionSummary } from '../../shared/types';
import { ChatPage } from '../components/chat-page';
import { ErrorBoundary } from '../components/error-boundary';
import { MiddleTabs } from '../components/middle-tabs';
import { WorkspaceHeader } from '../components/workspace-header/workspace-header';
import { useScratchpadStore } from '../stores/scratchpad-store';
import { useSessionStore } from '../stores/session-store';
import { useUiStore } from '../stores/ui-store';
import { useWorkspaceStore } from '../stores/workspace-store';
import {
	deriveWorkspaceRoutePage,
	selectFirstSessionId,
	type WorkspaceRouteKind,
} from './workspace-route-state';

const EMPTY_SESSIONS: SessionSummary[] = [];

interface WorkspaceRouteProps {
	kind: WorkspaceRouteKind;
}

const ScratchpadPage = lazy(() =>
	import('../components/scratchpad-page').then((module) => ({ default: module.ScratchpadPage })),
);

export function WorkspaceRoute({ kind }: WorkspaceRouteProps) {
	const navigate = useNavigate();
	const { workspaceId, sessionId } = useParams();
	const [searchParams] = useSearchParams();
	const workspaceSnapshot = useWorkspaceStore((state) =>
		workspaceId ? state.getWorkspaceSnapshot(workspaceId) : null,
	);
	const sessions = workspaceSnapshot?.sessions ?? EMPTY_SESSIONS;

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

	const firstSessionId = useMemo(() => selectFirstSessionId(sessions), [sessions]);
	const page = useMemo(() => {
		return deriveWorkspaceRoutePage({ kind, sessionId, searchParams });
	}, [kind, sessionId, searchParams]);

	useEffect(() => {
		if (!workspaceId || kind !== 'workspace' || !firstSessionId) return;
		navigate(
			`/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(firstSessionId)}`,
			{ replace: true },
		);
	}, [firstSessionId, kind, navigate, workspaceId]);

	useEffect(() => {
		if (!workspaceId || !page) return;
		useUiStore.getState().openMiddleTab(workspaceId, page);
	}, [workspaceId, page]);

	if (!workspaceId) return <section data-testid="workspace-route">Missing workspace</section>;

	const scratchpadActive = page?.type === 'file' && page.source === 'scratchpad';
	const chatActive = page?.type === 'chat';

	return (
		<section
			data-testid="workspace-route"
			data-workspace-id={workspaceId}
			className="flex h-full flex-col"
		>
			{workspaceSnapshot ? (
				<>
					<WorkspaceHeader workspaceId={workspaceId} snapshot={workspaceSnapshot} />
					<MiddleTabs workspaceId={workspaceId} sessions={workspaceSnapshot.sessions} />
				</>
			) : null}
			<div className="min-h-0 flex-1 overflow-hidden">
				{scratchpadActive ? (
					<ErrorBoundary
						resetKey={workspaceId}
						message="Could not load scratchpad."
						resetLabel="Reload"
						onReset={() => window.location.reload()}
					>
						<Suspense
							fallback={
								<div className="p-4 text-caption text-ink-tertiary">Loading scratchpad…</div>
							}
						>
							<ScratchpadPage key={workspaceId} workspaceId={workspaceId} />
						</Suspense>
					</ErrorBoundary>
				) : chatActive && workspaceSnapshot ? (
					<ChatPage
						workspaceId={workspaceId}
						sessionId={page.sessionId}
						workspaceSnapshot={workspaceSnapshot}
					/>
				) : (
					<div className="h-full overflow-auto p-3 text-ink-muted">
						{page ? <pre data-testid="workspace-page">{JSON.stringify(page)}</pre> : null}
					</div>
				)}
			</div>
		</section>
	);
}
