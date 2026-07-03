import { lazy, type ReactNode, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SessionSummary } from '../../shared/types';
import { ChatComposer } from '../components/chat-composer/chat-composer';
import { ComposerSessionPicker } from '../components/chat-composer/composer-session-picker';
import { ChatPage } from '../components/chat-page';
import { ErrorBoundary } from '../components/error-boundary';
import { MiddleTabs } from '../components/middle-tabs';
import { WorkspaceDiffPage } from '../components/workspace-diff-page';
import { WorkspaceFilePage } from '../components/workspace-file-page';
import { WorkspaceHeader } from '../components/workspace-header/workspace-header';
import { selectWorkspaceChangeFiles } from '../lib/workspace-diff-files';
import { useScratchpadStore } from '../stores/scratchpad-store';
import { useSessionStore } from '../stores/session-store';
import { mergeWorkspacePages, pageTabId, useUiStore } from '../stores/ui-store';
import { useWorkspaceStore } from '../stores/workspace-store';
import {
	deriveWorkspaceRoutePage,
	selectFirstSessionId,
	selectSessionRouteTarget,
	type WorkspaceRouteKind,
} from './workspace-route-state';

const EMPTY_SESSIONS: SessionSummary[] = [];

interface WorkspaceRouteProps {
	kind: WorkspaceRouteKind;
}

const ScratchpadPage = lazy(() =>
	import('../components/scratchpad-page').then((module) => ({ default: module.ScratchpadPage })),
);

function selectComposerSessionId(sessions: SessionSummary[], preferredSessionId?: string | null) {
	if (preferredSessionId && sessions.some((session) => session.id === preferredSessionId)) {
		return preferredSessionId;
	}

	return (
		sessions.toSorted((a, b) => {
			const left = a.lastMessageAt ?? a.updatedAt ?? a.createdAt;
			const right = b.lastMessageAt ?? b.updatedAt ?? b.createdAt;
			return right - left;
		})[0]?.id ?? null
	);
}

function PageWithComposer({ children, composer }: { children: ReactNode; composer: ReactNode }) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="min-h-0 flex-1 overflow-hidden">{children}</div>
			{composer}
		</div>
	);
}

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

	useEffect(() => {
		if (
			!workspaceId ||
			workspaceSnapshot?.workspace.setupState !== 'ready' ||
			workspaceSnapshot.workspace.visibilityState !== 'active'
		) {
			return;
		}
		void useWorkspaceStore
			.getState()
			.refreshGit(workspaceId, { fetchRemote: false })
			.catch(() => undefined);
	}, [
		workspaceId,
		workspaceSnapshot?.workspace.setupState,
		workspaceSnapshot?.workspace.visibilityState,
	]);

	const firstSessionId = useMemo(() => selectFirstSessionId(sessions), [sessions]);
	const routePage = useMemo(() => {
		return deriveWorkspaceRoutePage({ kind, sessionId, searchParams });
	}, [kind, sessionId, searchParams]);
	const storedRoutePage = useUiStore((state) => {
		if (!workspaceId || !routePage) return null;
		const tabId = pageTabId(routePage);
		return (
			state.middleTabsByWorkspaceId[workspaceId]?.find((tab) => tab.id === tabId)?.page ?? null
		);
	});
	const page = useMemo(() => {
		if (!routePage || !storedRoutePage || routePage.type !== storedRoutePage.type) return routePage;
		return mergeWorkspacePages(storedRoutePage, routePage);
	}, [routePage, storedRoutePage]);
	const sessionRouteTargetId = useMemo(() => {
		if (page?.type !== 'chat') return null;
		return selectSessionRouteTarget(sessions, page.sessionId);
	}, [page, sessions]);
	const sourceSessionId =
		page?.type === 'diff' || page?.type === 'file' ? page.sourceSessionId : null;
	const computedComposerSessionId = useMemo(
		() => selectComposerSessionId(sessions, sourceSessionId),
		[sessions, sourceSessionId],
	);
	// User can override which session the diff/file composer routes to. The override
	// only applies while it points at a session that still exists.
	const [selectedComposerSessionId, setSelectedComposerSessionId] = useState<string | null>(null);
	const composerSessionId =
		selectedComposerSessionId &&
		sessions.some((session) => session.id === selectedComposerSessionId)
			? selectedComposerSessionId
			: computedComposerSessionId;
	const composerSessionSnapshot = useSessionStore((state) =>
		composerSessionId ? (state.snapshotBySessionId.get(composerSessionId) ?? null) : null,
	);
	const showSessionPicker =
		(page?.type === 'diff' || page?.type === 'file') && sessions.length >= 2;

	useEffect(() => {
		if (!workspaceId || kind !== 'workspace' || !firstSessionId) return;
		navigate(
			`/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(firstSessionId)}`,
			{ replace: true },
		);
	}, [firstSessionId, kind, navigate, workspaceId]);

	useEffect(() => {
		if (!workspaceId || !workspaceSnapshot || page?.type !== 'chat') return;
		if (!sessionRouteTargetId || sessionRouteTargetId === page.sessionId) return;

		navigate(
			`/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionRouteTargetId)}`,
			{ replace: true },
		);
	}, [navigate, page, sessionRouteTargetId, workspaceId, workspaceSnapshot]);

	useEffect(() => {
		if (!workspaceId || !routePage) return;
		if (routePage.type === 'chat' && sessionRouteTargetId !== routePage.sessionId) return;
		useUiStore.getState().openMiddleTab(workspaceId, routePage);
	}, [workspaceId, routePage, sessionRouteTargetId]);

	if (!workspaceId) return <section data-testid="workspace-route">Missing workspace</section>;

	const scratchpadActive = page?.type === 'file' && page.source === 'scratchpad';
	const chatActive = page?.type === 'chat';
	const chatSessionIsReady = chatActive && sessionRouteTargetId === page.sessionId;
	const activeDiffFile =
		page?.type === 'diff' && page.path
			? (selectWorkspaceChangeFiles(workspaceSnapshot).find((file) => file.path === page.path) ??
				null)
			: null;
	const activeFileRevisionKey =
		page?.type === 'file' && page.path && workspaceSnapshot?.git
			? (selectWorkspaceChangeFiles(workspaceSnapshot).find((file) => file.path === page.path)
					?.patchDigest ??
				selectWorkspaceChangeFiles(workspaceSnapshot)
					.map((file) => `${file.path}:${file.patchDigest}`)
					.join('\n'))
			: null;
	const composer =
		workspaceSnapshot && computedComposerSessionId && composerSessionId ? (
			// The draft stays keyed to the stable computed session; the picker only changes the send
			// target, so switching it never remounts the composer or drops in-progress text/attachments.
			<ChatComposer
				key={computedComposerSessionId}
				workspaceId={workspaceId}
				sessionId={computedComposerSessionId}
				targetSessionId={composerSessionId}
				workspaceSnapshot={workspaceSnapshot}
				sessionSnapshot={composerSessionSnapshot}
				sessionPicker={
					showSessionPicker ? (
						<ComposerSessionPicker
							sessions={sessions}
							selectedSessionId={composerSessionId}
							onSelect={setSelectedComposerSessionId}
						/>
					) : undefined
				}
			/>
		) : null;

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
				) : chatSessionIsReady && workspaceSnapshot ? (
					<ChatPage
						workspaceId={workspaceId}
						sessionId={page.sessionId}
						workspaceSnapshot={workspaceSnapshot}
					/>
				) : chatActive && workspaceSnapshot ? (
					<div className="flex h-full items-center justify-center text-caption text-ink-tertiary">
						{sessionRouteTargetId ? 'Opening chat…' : 'Chat not found.'}
					</div>
				) : page?.type === 'diff' && workspaceSnapshot ? (
					<PageWithComposer composer={composer}>
						<ErrorBoundary
							resetKey={`${page.source ?? 'workspace'}:${page.turnId ?? ''}:${page.path ?? 'diff'}`}
							message="Could not render this diff."
						>
							<WorkspaceDiffPage
								key={`${page.source ?? 'workspace'}:${page.turnId ?? ''}:${page.path ?? 'diff'}`}
								workspaceId={workspaceId}
								path={page.path}
								expectedPatchDigest={
									page.source === 'transcript' ? undefined : activeDiffFile?.patchDigest
								}
								source={page.source}
								sourceSessionId={page.sourceSessionId}
								turnId={page.turnId}
								workspaceRoot={workspaceSnapshot.workspace.localPath}
								composerSessionId={composerSessionId}
								composerSessionSnapshot={composerSessionSnapshot}
							/>
						</ErrorBoundary>
					</PageWithComposer>
				) : page?.type === 'file' &&
					(page.source === 'workspace_file' ||
						page.source === 'pasted_text' ||
						page.source === 'generated_attachment' ||
						page.source === 'external_file') &&
					workspaceSnapshot ? (
					<PageWithComposer composer={composer}>
						<ErrorBoundary
							resetKey={`${workspaceId}:${page.source}:${page.path ?? page.sourceId ?? ''}:${activeFileRevisionKey ?? ''}`}
							message="Could not render this file."
						>
							<WorkspaceFilePage
								workspaceId={workspaceId}
								page={page}
								revisionKey={activeFileRevisionKey}
								workspaceRoot={workspaceSnapshot.workspace.localPath}
							/>
						</ErrorBoundary>
					</PageWithComposer>
				) : (
					<div className="h-full overflow-auto p-3 text-ink-muted">
						{page ? <pre data-testid="workspace-page">{JSON.stringify(page)}</pre> : null}
					</div>
				)}
			</div>
		</section>
	);
}
