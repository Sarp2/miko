import { useEffect, useRef } from 'react';
import { type NavigateFunction, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type {
	KeybindingAction,
	SidebarDirectoryGroup,
	SidebarWorkspaceRow,
} from '../../shared/types';
import { actionForKeyboardEvent, shouldIgnoreKeybindingTarget } from '../lib/keybindings';
import { useKeybindingsStore } from '../stores/keybindings-store';
import { useSessionStore } from '../stores/session-store';
import { useSidebarStore } from '../stores/sidebar-store';
import { useTerminalStore } from '../stores/terminal-store';
import { type SidebarSortField, useUiStore } from '../stores/ui-store';

function activeWorkspaceIdFromPath(pathname: string) {
	const match = pathname.match(/^\/workspaces\/([^/]+)/);
	return match ? decodeURIComponent(match[1]) : null;
}

function createTerminalId() {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return `terminal-${crypto.randomUUID()}`;
	}
	return `terminal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sortTimestamp<T extends { createdAt: number; updatedAt: number }>(
	item: T,
	sort: SidebarSortField,
) {
	return sort === 'created' ? item.createdAt : item.updatedAt;
}

function sortWorkspaceTimestamp(workspace: SidebarWorkspaceRow, sort: SidebarSortField) {
	if (sort === 'created') return workspace.createdAt;
	return workspace.lastActivityAt ?? workspace.updatedAt;
}

function sortSidebarGroups(
	directoryGroups: SidebarDirectoryGroup[],
	directorySort: SidebarSortField,
	workspaceSort: SidebarSortField,
) {
	return directoryGroups
		.map((directory) => ({
			...directory,
			workspaces: directory.workspaces.toSorted(
				(a, b) =>
					sortWorkspaceTimestamp(b, workspaceSort) - sortWorkspaceTimestamp(a, workspaceSort),
			),
		}))
		.toSorted((a, b) => sortTimestamp(b, directorySort) - sortTimestamp(a, directorySort));
}

function findDirectoryForWorkspace(workspaceId: string) {
	const snapshot = useSidebarStore.getState().snapshot;
	return snapshot?.directoryGroups.find((directory) =>
		directory.workspaces.some((workspace) => workspace.workspaceId === workspaceId),
	);
}

function workspacePath(workspace: SidebarWorkspaceRow) {
	if (workspace.lastSessionId) {
		return `/workspaces/${encodeURIComponent(workspace.workspaceId)}/sessions/${encodeURIComponent(
			workspace.lastSessionId,
		)}`;
	}
	return `/workspaces/${encodeURIComponent(workspace.workspaceId)}`;
}

function nextWorkspaceAfter(workspaceId: string) {
	const snapshot = useSidebarStore.getState().snapshot;
	if (!snapshot) return null;

	const uiStore = useUiStore.getState();
	const sortedGroups = sortSidebarGroups(
		snapshot.directoryGroups,
		uiStore.sidebarDirectorySort,
		uiStore.sidebarWorkspaceSort,
	);
	const workspaceById = new Map<string, SidebarWorkspaceRow>();
	for (const directory of sortedGroups) {
		for (const workspace of directory.workspaces) {
			workspaceById.set(workspace.workspaceId, workspace);
		}
	}

	const pinned = uiStore.pinnedWorkspaceIds
		.map((pinnedWorkspaceId) => workspaceById.get(pinnedWorkspaceId))
		.filter((workspace): workspace is SidebarWorkspaceRow => Boolean(workspace));
	const pinnedIds = new Set(pinned.map((workspace) => workspace.workspaceId));
	const unpinned = sortedGroups.flatMap((directory) =>
		directory.workspaces.filter((workspace) => !pinnedIds.has(workspace.workspaceId)),
	);
	const workspaces = [...pinned, ...unpinned];
	if (workspaces.length <= 1) return null;

	const currentIndex = workspaces.findIndex((workspace) => workspace.workspaceId === workspaceId);
	if (currentIndex === -1) return null;
	return workspaces[(currentIndex + 1) % workspaces.length];
}

async function dispatchWorkspaceAction(
	action: KeybindingAction,
	workspaceId: string,
	navigate: NavigateFunction,
) {
	const uiStore = useUiStore.getState();

	if (action === 'toggleLeftSidebar') {
		uiStore.setLeftSidebarCollapsed(!uiStore.leftSidebarCollapsed);
		return;
	}

	if (action === 'toggleEmbeddedTerminal') {
		const tabs = uiStore.getTerminalTabs(workspaceId);
		if (tabs.length === 0) {
			const terminalId = createTerminalId();
			await useTerminalStore.getState().createTerminal({
				workspaceId,
				terminalId,
				cols: 120,
				rows: 24,
				scrollback: 5000,
			});
			uiStore.openTerminalTab(workspaceId, terminalId);
			uiStore.setTerminalPanelCollapsed(workspaceId, false);
			return;
		}

		const panel = uiStore.getTerminalPanel(workspaceId);
		uiStore.setTerminalPanelCollapsed(workspaceId, !panel.collapsed);
		return;
	}

	if (action === 'toggleRightSidebar') {
		uiStore.setRightSidebarCollapsed(workspaceId, !uiStore.getRightSidebarCollapsed(workspaceId));
		return;
	}

	if (action === 'addSplitTerminal') {
		const terminalId = createTerminalId();
		await useTerminalStore.getState().createTerminal({
			workspaceId,
			terminalId,
			cols: 120,
			rows: 24,
			scrollback: 5000,
		});
		uiStore.openTerminalTab(workspaceId, terminalId);
		uiStore.setTerminalPanelCollapsed(workspaceId, false);
		return;
	}

	if (action === 'createSessionInCurrentWorkspace') {
		const result = await useSessionStore.getState().createSession(workspaceId);
		navigate(
			`/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(result.sessionId)}`,
		);
		return;
	}

	if (action === 'createWorkspaceInCurrentDirectory') {
		const directory = findDirectoryForWorkspace(workspaceId);
		if (!directory) throw new Error('Could not find the active workspace directory');
		const wasExpanded = uiStore.expandedDirectoryIds.includes(directory.directoryId);
		uiStore.setDirectoryExpanded(directory.directoryId, true);
		try {
			const result = await useSidebarStore.getState().createWorkspace(directory.directoryId);
			const nextPath = result.sessionId
				? `/workspaces/${encodeURIComponent(result.workspaceId)}/sessions/${encodeURIComponent(
						result.sessionId,
					)}`
				: `/workspaces/${encodeURIComponent(result.workspaceId)}`;
			navigate(nextPath);
		} catch (error) {
			if (!wasExpanded) uiStore.setDirectoryExpanded(directory.directoryId, false);
			throw error;
		}
		return;
	}

	if (action === 'switchToNextWorkspace') return;
}

export function GlobalKeybindings() {
	const location = useLocation();
	const navigate = useNavigate();
	const snapshot = useKeybindingsStore((state) => state.snapshot);
	const optimisticWorkspaceIdRef = useRef<string | null>(null);
	const activeWorkspaceId = activeWorkspaceIdFromPath(location.pathname);

	useEffect(() => {
		useKeybindingsStore.getState().connectKeybindings();
		return () => useKeybindingsStore.getState().disconnectKeybindings();
	}, []);

	useEffect(() => {
		optimisticWorkspaceIdRef.current = activeWorkspaceId;
	}, [activeWorkspaceId]);

	useEffect(() => {
		if (!snapshot) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.repeat || shouldIgnoreKeybindingTarget(event.target)) return;

			const action = actionForKeyboardEvent(snapshot.bindings, event);
			if (!action) return;

			const workspaceId = activeWorkspaceIdFromPath(location.pathname);
			if (!workspaceId) return;

			event.preventDefault();
			if (action === 'switchToNextWorkspace') {
				const nextWorkspace = nextWorkspaceAfter(optimisticWorkspaceIdRef.current ?? workspaceId);
				if (!nextWorkspace) return;
				optimisticWorkspaceIdRef.current = nextWorkspace.workspaceId;
				navigate(workspacePath(nextWorkspace));
				return;
			}

			void dispatchWorkspaceAction(action, workspaceId, navigate).catch((error: unknown) => {
				toast.error(error instanceof Error ? error.message : 'Shortcut action failed');
			});
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [location.pathname, navigate, snapshot]);

	return null;
}
