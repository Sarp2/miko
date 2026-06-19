import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ChatAttachment } from '../../shared/types';
import { PASTED_TEXT_LABEL } from '../lib/prompt-parts';
import { getLocalStorage } from './persist-storage';

export const UI_STORAGE_KEY = 'miko:v1';

export type RightSidebarTab = 'all_files' | 'changes' | 'checks';

export interface ChecksTodo {
	id: string;
	text: string;
	done: boolean;
	createdAt: number;
}
export type DiffViewMode = 'unified' | 'split';
export type SidebarSortField = 'updated' | 'created';
export type ExternalOpenApp = 'finder' | 'cursor' | 'warp' | 'terminal' | 'antigravity';
export type WorkspaceFileSource =
	| 'scratchpad'
	| 'workspace_file'
	| 'ci_log'
	| 'pr_comment'
	| 'generated_attachment'
	| 'pasted_text'
	| 'external_file';

export type WorkspacePage =
	| { type: 'chat'; sessionId: string }
	| {
			type: 'diff';
			path?: string;
			source?: 'workspace' | 'transcript';
			sourceSessionId?: string;
			turnId?: string;
	  }
	| {
			type: 'file';
			path?: string;
			title: string;
			source: WorkspaceFileSource;
			sourceId?: string;
			sourceSessionId?: string;
			attachment?: ChatAttachment;
	  };

export interface MiddleTabDescriptor {
	id: string;
	fallbackTitle?: string;
	page: WorkspacePage;
	closable: boolean;
	updatedAt: number;
}

export interface TerminalTabDescriptor {
	terminalId: string;
	title: string;
	createdAt: number;
}

export interface TerminalPanelState {
	collapsed: boolean;
	height: number;
}

export interface PersistedUiState {
	leftSidebarCollapsed: boolean;
	leftSidebarWidth: number;
	externalOpenApp: ExternalOpenApp;
	expandedDirectoryIds: string[];
	pinnedWorkspaceIds: string[];
	sidebarDirectorySort: SidebarSortField;
	sidebarWorkspaceSort: SidebarSortField;
	rightSidebarTabByWorkspaceId: Record<string, RightSidebarTab>;
	rightSidebarCollapsedByWorkspaceId: Record<string, boolean>;
	rightSidebarWidthByWorkspaceId: Record<string, number>;
	middleTabsByWorkspaceId: Record<string, MiddleTabDescriptor[]>;
	activeTabIdByWorkspaceId: Record<string, string>;
	terminalPanelByWorkspaceId: Record<string, TerminalPanelState>;
	terminalTabsByWorkspaceId: Record<string, TerminalTabDescriptor[]>;
	activeTerminalIdByWorkspaceId: Record<string, string>;
	diffViewModeByWorkspaceId: Record<string, DiffViewMode>;
	viewedDiffDigestByWorkspaceId: Record<string, Record<string, string>>;
	checksTodosByWorkspaceId: Record<string, ChecksTodo[]>;
	hiddenCommentIdsByWorkspaceId: Record<string, string[]>;
}

interface UiStoreState extends PersistedUiState {
	getRightSidebarTab: (workspaceId: string) => RightSidebarTab;
	getRightSidebarCollapsed: (workspaceId: string) => boolean;
	getRightSidebarWidth: (workspaceId: string) => number;
	getDiffViewMode: (workspaceId: string) => DiffViewMode;
	setDiffViewMode: (workspaceId: string, mode: DiffViewMode) => void;
	isDiffPathViewed: (workspaceId: string, path: string, patchDigest?: string | null) => boolean;
	setDiffPathViewed: (
		workspaceId: string,
		path: string,
		patchDigest: string,
		viewed: boolean,
	) => void;
	getChecksTodos: (workspaceId: string) => ChecksTodo[];
	addChecksTodo: (workspaceId: string, text: string) => void;
	toggleChecksTodo: (workspaceId: string, todoId: string) => void;
	removeChecksTodo: (workspaceId: string, todoId: string) => void;
	isCommentHidden: (workspaceId: string, commentId: string) => boolean;
	setCommentHidden: (workspaceId: string, commentId: string, hidden: boolean) => void;
	setRightSidebarTab: (workspaceId: string, tab: RightSidebarTab) => void;
	setRightSidebarCollapsed: (workspaceId: string, collapsed: boolean) => void;
	setRightSidebarWidth: (workspaceId: string, width: number) => void;
	setLeftSidebarCollapsed: (collapsed: boolean) => void;
	setLeftSidebarWidth: (width: number) => void;
	setExternalOpenApp: (app: ExternalOpenApp) => void;
	setDirectoryExpanded: (directoryId: string, expanded: boolean) => void;
	setSidebarDirectorySort: (sort: SidebarSortField) => void;
	setSidebarWorkspaceSort: (sort: SidebarSortField) => void;
	toggleDirectoryExpanded: (directoryId: string) => void;
	isWorkspacePinned: (workspaceId: string) => boolean;
	setWorkspacePinned: (workspaceId: string, pinned: boolean) => void;
	toggleWorkspacePinned: (workspaceId: string) => void;
	getMiddleTabs: (workspaceId: string) => MiddleTabDescriptor[];
	ensureScratchpadTab: (workspaceId: string) => void;
	openMiddleTab: (workspaceId: string, page: WorkspacePage, fallbackTitle?: string) => string;
	setActiveMiddleTab: (workspaceId: string, tabId: string) => void;
	closeMiddleTab: (workspaceId: string, tabId: string) => void;
	getTerminalPanel: (workspaceId: string) => TerminalPanelState;
	setTerminalPanelCollapsed: (workspaceId: string, collapsed: boolean) => void;
	setTerminalPanelHeight: (workspaceId: string, height: number) => void;
	getTerminalTabs: (workspaceId: string) => TerminalTabDescriptor[];
	openTerminalTab: (workspaceId: string, terminalId: string, title?: string) => void;
	setActiveTerminal: (workspaceId: string, terminalId: string) => void;
	closeTerminalTab: (workspaceId: string, terminalId: string) => void;
	removeWorkspaceUi: (workspaceId: string) => void;
	resetLocalUiState: () => void;
}

const DEFAULT_LEFT_SIDEBAR_WIDTH = 292;
const DEFAULT_TERMINAL_HEIGHT = 260;
const DEFAULT_TERMINAL_PANEL_STATE: TerminalPanelState = {
	collapsed: false,
	height: DEFAULT_TERMINAL_HEIGHT,
};
const EMPTY_TERMINAL_TABS: TerminalTabDescriptor[] = [];
const DEFAULT_EXTERNAL_OPEN_APP: ExternalOpenApp = 'finder';
const DEFAULT_UI_STATE: PersistedUiState = {
	leftSidebarCollapsed: false,
	leftSidebarWidth: DEFAULT_LEFT_SIDEBAR_WIDTH,
	externalOpenApp: DEFAULT_EXTERNAL_OPEN_APP,
	expandedDirectoryIds: [],
	pinnedWorkspaceIds: [],
	sidebarDirectorySort: 'updated',
	sidebarWorkspaceSort: 'updated',
	rightSidebarTabByWorkspaceId: {},
	rightSidebarCollapsedByWorkspaceId: {},
	rightSidebarWidthByWorkspaceId: {},
	middleTabsByWorkspaceId: {},
	activeTabIdByWorkspaceId: {},
	terminalPanelByWorkspaceId: {},
	terminalTabsByWorkspaceId: {},
	activeTerminalIdByWorkspaceId: {},
	diffViewModeByWorkspaceId: {},
	viewedDiffDigestByWorkspaceId: {},
	checksTodosByWorkspaceId: {},
	hiddenCommentIdsByWorkspaceId: {},
};

const EMPTY_TODOS: ChecksTodo[] = [];

export function scratchpadTabId(workspaceId: string) {
	return `scratchpad:${workspaceId}`;
}

export function pageTabId(page: WorkspacePage) {
	if (page.type === 'chat') return `chat:${page.sessionId}`;
	if (page.type === 'diff') {
		const source = page.source ?? 'workspace';
		const identity = page.turnId ?? page.path ?? 'placeholder';
		return `diff:${source}:${identity}:${page.path ?? ''}`;
	}

	const identity = page.sourceId ?? page.path ?? page.title;
	return `file:${page.source}:${identity}`;
}

function isChatAttachment(value: unknown): value is ChatAttachment {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<ChatAttachment>;
	return (
		(candidate.kind === 'file' || candidate.kind === 'image') &&
		typeof candidate.id === 'string' &&
		candidate.id.trim().length > 0 &&
		typeof candidate.displayName === 'string' &&
		typeof candidate.absolutePath === 'string' &&
		typeof candidate.relativePath === 'string' &&
		typeof candidate.contentUrl === 'string' &&
		candidate.contentUrl.trim().length > 0 &&
		typeof candidate.mimeType === 'string' &&
		candidate.mimeType.trim().length > 0 &&
		typeof candidate.size === 'number' &&
		Number.isSafeInteger(candidate.size) &&
		candidate.size >= 0
	);
}

function normalizeFilePage(page: Extract<WorkspacePage, { type: 'file' }>) {
	if (page.source === 'pasted_text') return null;
	if (page.source !== 'generated_attachment') return page;
	if (page.attachment && isChatAttachment(page.attachment)) return page;
	// Legacy generated-attachment tabs that only stored a sourceId were backed by
	// memory-only preview state. Drop them on hydration instead of reviving dead tabs.
	if (!page.path) return null;
	return page;
}

function normalizeMiddleTab(workspaceId: string, tab: MiddleTabDescriptor) {
	if (tab.page.type === 'file' && tab.page.source === 'scratchpad') {
		const id = scratchpadTabId(workspaceId);
		return tab.id === id ? tab : { ...tab, id, closable: false };
	}

	if (tab.page.type === 'file') {
		const page = normalizeFilePage(tab.page);
		return page ? { ...tab, page, id: pageTabId(page) } : null;
	}
	if (tab.page.type !== 'diff') return tab;
	const id = pageTabId(tab.page);
	return tab.id === id ? tab : { ...tab, id };
}

export function normalizePersistedUiState(state: PersistedUiState): PersistedUiState {
	const middleTabsByWorkspaceId: Record<string, MiddleTabDescriptor[]> = {};
	const activeTabIdByWorkspaceId: Record<string, string> = {};

	for (const [workspaceId, tabs] of Object.entries(state.middleTabsByWorkspaceId)) {
		const legacyIdByNextId = new Map<string, string>();
		const normalizedTabs = tabs.flatMap((tab) => {
			const normalizedTab = normalizeMiddleTab(workspaceId, tab);
			if (!normalizedTab) return [];
			legacyIdByNextId.set(tab.id, normalizedTab.id);
			return [normalizedTab];
		});
		const normalizedTabIds = new Set(normalizedTabs.map((tab) => tab.id));
		const activeTabId = state.activeTabIdByWorkspaceId[workspaceId];
		const normalizedActiveTabId = activeTabId
			? (legacyIdByNextId.get(activeTabId) ?? activeTabId)
			: null;

		middleTabsByWorkspaceId[workspaceId] = normalizedTabs;
		if (normalizedActiveTabId && normalizedTabIds.has(normalizedActiveTabId)) {
			activeTabIdByWorkspaceId[workspaceId] = normalizedActiveTabId;
		} else if (normalizedTabs[0]) {
			activeTabIdByWorkspaceId[workspaceId] = normalizedTabs[0].id;
		}
	}

	for (const [workspaceId, activeTabId] of Object.entries(state.activeTabIdByWorkspaceId)) {
		if (workspaceId in activeTabIdByWorkspaceId) continue;
		if (workspaceId in middleTabsByWorkspaceId) continue;
		activeTabIdByWorkspaceId[workspaceId] = activeTabId;
	}

	return {
		...state,
		middleTabsByWorkspaceId,
		activeTabIdByWorkspaceId,
		// Terminal sessions are server-memory resources. Never revive tab ids
		// from localStorage after a renderer/server restart.
		terminalTabsByWorkspaceId: {},
		activeTerminalIdByWorkspaceId: {},
	};
}

function basename(path: string) {
	return path.split('/').filter(Boolean).at(-1) ?? path;
}

export function fallbackTitleForPage(page: WorkspacePage) {
	if (page.type === 'chat') return undefined;
	if (page.type === 'diff') return page.path ? basename(page.path) : 'Select a changed file';

	if (page.source === 'scratchpad') return 'Scratchpad';
	if (page.source === 'workspace_file') return page.path ? basename(page.path) : page.title;
	if (page.source === 'ci_log') return page.title || 'CI Log';
	if (page.source === 'pr_comment') return page.title || 'PR Comment';
	if (page.source === 'pasted_text') return page.title || PASTED_TEXT_LABEL;
	return page.title || 'Attachment';
}

export function scratchpadTab(workspaceId: string, now = Date.now()): MiddleTabDescriptor {
	return {
		id: scratchpadTabId(workspaceId),
		fallbackTitle: 'Scratchpad',
		page: {
			type: 'file',
			title: 'Scratchpad',
			source: 'scratchpad',
			sourceId: workspaceId,
		},
		closable: false,
		updatedAt: now,
	};
}

export function withScratchpadFirst(workspaceId: string, tabs: MiddleTabDescriptor[]) {
	const scratchpadId = scratchpadTabId(workspaceId);
	const existingScratchpad = tabs.find(
		(tab) =>
			tab.id === scratchpadId || (tab.page.type === 'file' && tab.page.source === 'scratchpad'),
	);
	const rest = tabs.filter(
		(tab) =>
			tab.id !== scratchpadId && !(tab.page.type === 'file' && tab.page.source === 'scratchpad'),
	);
	return [
		existingScratchpad
			? { ...existingScratchpad, id: scratchpadId, closable: false }
			: scratchpadTab(workspaceId),
		...rest,
	];
}

export function mergeWorkspacePages(existing: WorkspacePage, next: WorkspacePage): WorkspacePage {
	if (existing.type !== next.type) return next;
	if (existing.type === 'file' && next.type === 'file') {
		return {
			...existing,
			...next,
			attachment: next.attachment ?? existing.attachment,
		};
	}
	return next;
}

function removeWorkspaceKey<T>(record: Record<string, T>, workspaceId: string) {
	const next = { ...record };
	delete next[workspaceId];
	return next;
}

function clampPanelSize(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, Math.round(value)));
}

export const useUiStore = create<UiStoreState>()(
	persist(
		(set, get) => ({
			...DEFAULT_UI_STATE,

			getRightSidebarTab: (workspaceId) => {
				return get().rightSidebarTabByWorkspaceId[workspaceId] ?? 'all_files';
			},

			getRightSidebarCollapsed: (workspaceId) => {
				return get().rightSidebarCollapsedByWorkspaceId[workspaceId] ?? false;
			},

			getRightSidebarWidth: (workspaceId) => {
				return get().rightSidebarWidthByWorkspaceId[workspaceId] ?? DEFAULT_LEFT_SIDEBAR_WIDTH;
			},

			getDiffViewMode: (workspaceId) => {
				return get().diffViewModeByWorkspaceId[workspaceId] ?? 'unified';
			},

			setDiffViewMode: (workspaceId, mode) => {
				set((state) => ({
					diffViewModeByWorkspaceId: {
						...state.diffViewModeByWorkspaceId,
						[workspaceId]: mode,
					},
				}));
			},

			isDiffPathViewed: (workspaceId, path, patchDigest) => {
				if (!patchDigest) return false;
				return get().viewedDiffDigestByWorkspaceId[workspaceId]?.[path] === patchDigest;
			},

			setDiffPathViewed: (workspaceId, path, patchDigest, viewed) => {
				set((state) => {
					const workspaceViewedDiffs = {
						...(state.viewedDiffDigestByWorkspaceId[workspaceId] ?? {}),
					};
					if (viewed) workspaceViewedDiffs[path] = patchDigest;
					else delete workspaceViewedDiffs[path];

					return {
						viewedDiffDigestByWorkspaceId: {
							...state.viewedDiffDigestByWorkspaceId,
							[workspaceId]: workspaceViewedDiffs,
						},
					};
				});
			},

			getChecksTodos: (workspaceId) => {
				return get().checksTodosByWorkspaceId[workspaceId] ?? EMPTY_TODOS;
			},

			addChecksTodo: (workspaceId, text) => {
				const trimmed = text.trim();
				if (!trimmed) return;
				set((state) => {
					const todos = state.checksTodosByWorkspaceId[workspaceId] ?? [];
					const todo: ChecksTodo = {
						id: crypto.randomUUID(),
						text: trimmed,
						done: false,
						createdAt: Date.now(),
					};
					return {
						checksTodosByWorkspaceId: {
							...state.checksTodosByWorkspaceId,
							[workspaceId]: [...todos, todo],
						},
					};
				});
			},

			toggleChecksTodo: (workspaceId, todoId) => {
				set((state) => {
					const todos = state.checksTodosByWorkspaceId[workspaceId];
					if (!todos) return state;
					return {
						checksTodosByWorkspaceId: {
							...state.checksTodosByWorkspaceId,
							[workspaceId]: todos.map((todo) =>
								todo.id === todoId ? { ...todo, done: !todo.done } : todo,
							),
						},
					};
				});
			},

			removeChecksTodo: (workspaceId, todoId) => {
				set((state) => {
					const todos = state.checksTodosByWorkspaceId[workspaceId];
					if (!todos) return state;
					return {
						checksTodosByWorkspaceId: {
							...state.checksTodosByWorkspaceId,
							[workspaceId]: todos.filter((todo) => todo.id !== todoId),
						},
					};
				});
			},

			isCommentHidden: (workspaceId, commentId) => {
				return get().hiddenCommentIdsByWorkspaceId[workspaceId]?.includes(commentId) ?? false;
			},

			setCommentHidden: (workspaceId, commentId, hidden) => {
				set((state) => {
					const current = state.hiddenCommentIdsByWorkspaceId[workspaceId] ?? [];
					const next = hidden
						? current.includes(commentId)
							? current
							: [...current, commentId]
						: current.filter((id) => id !== commentId);
					if (next === current) return state;
					return {
						hiddenCommentIdsByWorkspaceId: {
							...state.hiddenCommentIdsByWorkspaceId,
							[workspaceId]: next,
						},
					};
				});
			},

			setRightSidebarTab: (workspaceId, tab) => {
				set((state) => ({
					rightSidebarTabByWorkspaceId: {
						...state.rightSidebarTabByWorkspaceId,
						[workspaceId]: tab,
					},
				}));
			},

			setRightSidebarCollapsed: (workspaceId, collapsed) => {
				set((state) => ({
					rightSidebarCollapsedByWorkspaceId: {
						...state.rightSidebarCollapsedByWorkspaceId,
						[workspaceId]: collapsed,
					},
				}));
			},

			setRightSidebarWidth: (workspaceId, width) => {
				set((state) => ({
					rightSidebarWidthByWorkspaceId: {
						...state.rightSidebarWidthByWorkspaceId,
						[workspaceId]: width <= 0 ? 0 : clampPanelSize(width, 256, 420),
					},
				}));
			},

			setLeftSidebarCollapsed: (collapsed) => {
				set({ leftSidebarCollapsed: collapsed });
			},

			setLeftSidebarWidth: (width) => {
				set({ leftSidebarWidth: width <= 0 ? 0 : clampPanelSize(width, 256, 420) });
			},

			setExternalOpenApp: (app) => {
				set({ externalOpenApp: app });
			},

			setDirectoryExpanded: (directoryId, expanded) => {
				set((state) => {
					const ids = new Set(state.expandedDirectoryIds);
					if (expanded) ids.add(directoryId);
					else ids.delete(directoryId);
					return { expandedDirectoryIds: [...ids] };
				});
			},

			setSidebarDirectorySort: (sort) => {
				set({ sidebarDirectorySort: sort });
			},

			setSidebarWorkspaceSort: (sort) => {
				set({ sidebarWorkspaceSort: sort });
			},

			toggleDirectoryExpanded: (directoryId) => {
				const expanded = get().expandedDirectoryIds.includes(directoryId);
				get().setDirectoryExpanded(directoryId, !expanded);
			},

			isWorkspacePinned: (workspaceId) => {
				return get().pinnedWorkspaceIds.includes(workspaceId);
			},

			setWorkspacePinned: (workspaceId, pinned) => {
				set((state) => {
					const ids = new Set(state.pinnedWorkspaceIds);
					if (pinned) ids.add(workspaceId);
					else ids.delete(workspaceId);
					return { pinnedWorkspaceIds: [...ids] };
				});
			},

			toggleWorkspacePinned: (workspaceId) => {
				get().setWorkspacePinned(workspaceId, !get().isWorkspacePinned(workspaceId));
			},

			getMiddleTabs: (workspaceId) => {
				return withScratchpadFirst(workspaceId, get().middleTabsByWorkspaceId[workspaceId] ?? []);
			},

			ensureScratchpadTab: (workspaceId) => {
				set((state) => ({
					middleTabsByWorkspaceId: {
						...state.middleTabsByWorkspaceId,
						[workspaceId]: withScratchpadFirst(
							workspaceId,
							state.middleTabsByWorkspaceId[workspaceId] ?? [],
						),
					},
				}));
			},

			openMiddleTab: (workspaceId, page, fallbackTitle) => {
				const tabId =
					page.type === 'file' && page.source === 'scratchpad'
						? scratchpadTabId(workspaceId)
						: pageTabId(page);
				set((state) => {
					const tabs = withScratchpadFirst(
						workspaceId,
						state.middleTabsByWorkspaceId[workspaceId] ?? [],
					);

					const now = Date.now();
					const existingIndex = tabs.findIndex((tab) => tab.id === tabId);

					const existingTab = existingIndex >= 0 ? tabs[existingIndex] : null;
					const nextTab: MiddleTabDescriptor = {
						id: tabId,
						fallbackTitle:
							fallbackTitle ?? existingTab?.fallbackTitle ?? fallbackTitleForPage(page),
						page: existingTab ? mergeWorkspacePages(existingTab.page, page) : page,
						closable: tabId !== scratchpadTabId(workspaceId),
						updatedAt: now,
					};

					const nextTabs = [...tabs];

					if (existingIndex >= 0) nextTabs[existingIndex] = nextTab;
					else nextTabs.push(nextTab);

					return {
						middleTabsByWorkspaceId: {
							...state.middleTabsByWorkspaceId,
							[workspaceId]: withScratchpadFirst(workspaceId, nextTabs),
						},
						activeTabIdByWorkspaceId: {
							...state.activeTabIdByWorkspaceId,
							[workspaceId]: tabId,
						},
					};
				});
				return tabId;
			},

			setActiveMiddleTab: (workspaceId, tabId) => {
				set((state) => ({
					activeTabIdByWorkspaceId: {
						...state.activeTabIdByWorkspaceId,
						[workspaceId]: tabId,
					},
				}));
			},

			closeMiddleTab: (workspaceId, tabId) => {
				if (tabId === scratchpadTabId(workspaceId)) return;
				set((state) => {
					const tabs = withScratchpadFirst(
						workspaceId,
						state.middleTabsByWorkspaceId[workspaceId] ?? [],
					);

					const closedIndex = tabs.findIndex((tab) => tab.id === tabId);
					const nextTabs = tabs.filter((tab) => tab.id !== tabId);
					const activeTabId = state.activeTabIdByWorkspaceId[workspaceId];

					const nextActiveTabId =
						activeTabId === tabId
							? (nextTabs[closedIndex]?.id ?? nextTabs[closedIndex - 1]?.id ?? nextTabs[0]?.id)
							: activeTabId;

					return {
						middleTabsByWorkspaceId: {
							...state.middleTabsByWorkspaceId,
							[workspaceId]: nextTabs,
						},
						activeTabIdByWorkspaceId: {
							...state.activeTabIdByWorkspaceId,
							[workspaceId]: nextActiveTabId,
						},
					};
				});
			},

			getTerminalPanel: (workspaceId) => {
				return get().terminalPanelByWorkspaceId[workspaceId] ?? DEFAULT_TERMINAL_PANEL_STATE;
			},

			setTerminalPanelCollapsed: (workspaceId, collapsed) => {
				set((state) => ({
					terminalPanelByWorkspaceId: {
						...state.terminalPanelByWorkspaceId,
						[workspaceId]: { ...get().getTerminalPanel(workspaceId), collapsed },
					},
				}));
			},

			setTerminalPanelHeight: (workspaceId, height) => {
				set((state) => ({
					terminalPanelByWorkspaceId: {
						...state.terminalPanelByWorkspaceId,
						[workspaceId]: {
							...get().getTerminalPanel(workspaceId),
							height: clampPanelSize(height, 120, 720),
						},
					},
				}));
			},

			getTerminalTabs: (workspaceId) => {
				return get().terminalTabsByWorkspaceId[workspaceId] ?? EMPTY_TERMINAL_TABS;
			},

			openTerminalTab: (workspaceId, terminalId, title = 'Terminal') => {
				set((state) => {
					const tabs = state.terminalTabsByWorkspaceId[workspaceId] ?? [];
					const exists = tabs.some((tab) => tab.terminalId === terminalId);
					const nextTabs = exists ? tabs : [...tabs, { terminalId, title, createdAt: Date.now() }];

					return {
						terminalTabsByWorkspaceId: {
							...state.terminalTabsByWorkspaceId,
							[workspaceId]: nextTabs,
						},
						activeTerminalIdByWorkspaceId: {
							...state.activeTerminalIdByWorkspaceId,
							[workspaceId]: terminalId,
						},
					};
				});
			},

			setActiveTerminal: (workspaceId, terminalId) => {
				set((state) => ({
					activeTerminalIdByWorkspaceId: {
						...state.activeTerminalIdByWorkspaceId,
						[workspaceId]: terminalId,
					},
				}));
			},

			closeTerminalTab: (workspaceId, terminalId) => {
				set((state) => {
					const tabs = state.terminalTabsByWorkspaceId[workspaceId] ?? [];
					const nextTabs = tabs.filter((tab) => tab.terminalId !== terminalId);
					const activeTerminalId = state.activeTerminalIdByWorkspaceId[workspaceId];

					const nextActiveTerminalId =
						activeTerminalId === terminalId ? nextTabs.at(-1)?.terminalId : activeTerminalId;

					return {
						terminalTabsByWorkspaceId: {
							...state.terminalTabsByWorkspaceId,
							[workspaceId]: nextTabs,
						},
						activeTerminalIdByWorkspaceId: nextActiveTerminalId
							? { ...state.activeTerminalIdByWorkspaceId, [workspaceId]: nextActiveTerminalId }
							: removeWorkspaceKey(state.activeTerminalIdByWorkspaceId, workspaceId),
					};
				});
			},

			removeWorkspaceUi: (workspaceId) => {
				set((state) => ({
					rightSidebarTabByWorkspaceId: removeWorkspaceKey(
						state.rightSidebarTabByWorkspaceId,
						workspaceId,
					),
					rightSidebarCollapsedByWorkspaceId: removeWorkspaceKey(
						state.rightSidebarCollapsedByWorkspaceId,
						workspaceId,
					),
					rightSidebarWidthByWorkspaceId: removeWorkspaceKey(
						state.rightSidebarWidthByWorkspaceId,
						workspaceId,
					),
					middleTabsByWorkspaceId: removeWorkspaceKey(state.middleTabsByWorkspaceId, workspaceId),
					activeTabIdByWorkspaceId: removeWorkspaceKey(state.activeTabIdByWorkspaceId, workspaceId),
					terminalPanelByWorkspaceId: removeWorkspaceKey(
						state.terminalPanelByWorkspaceId,
						workspaceId,
					),
					terminalTabsByWorkspaceId: removeWorkspaceKey(
						state.terminalTabsByWorkspaceId,
						workspaceId,
					),
					activeTerminalIdByWorkspaceId: removeWorkspaceKey(
						state.activeTerminalIdByWorkspaceId,
						workspaceId,
					),
					diffViewModeByWorkspaceId: removeWorkspaceKey(
						state.diffViewModeByWorkspaceId,
						workspaceId,
					),
					viewedDiffDigestByWorkspaceId: removeWorkspaceKey(
						state.viewedDiffDigestByWorkspaceId,
						workspaceId,
					),
					checksTodosByWorkspaceId: removeWorkspaceKey(state.checksTodosByWorkspaceId, workspaceId),
					hiddenCommentIdsByWorkspaceId: removeWorkspaceKey(
						state.hiddenCommentIdsByWorkspaceId,
						workspaceId,
					),
					pinnedWorkspaceIds: state.pinnedWorkspaceIds.filter((id) => id !== workspaceId),
				}));
			},

			resetLocalUiState: () => {
				set(structuredClone(DEFAULT_UI_STATE));
			},
		}),
		{
			name: UI_STORAGE_KEY,
			storage: createJSONStorage(getLocalStorage),
			merge: (persistedState, currentState) => {
				const state = {
					...currentState,
					...(persistedState as Partial<PersistedUiState>),
				};
				return {
					...currentState,
					...normalizePersistedUiState(state),
				};
			},
			partialize: (state): PersistedUiState => ({
				leftSidebarCollapsed: state.leftSidebarCollapsed,
				leftSidebarWidth: state.leftSidebarWidth,
				externalOpenApp: state.externalOpenApp,
				expandedDirectoryIds: state.expandedDirectoryIds,
				pinnedWorkspaceIds: state.pinnedWorkspaceIds,
				sidebarDirectorySort: state.sidebarDirectorySort,
				sidebarWorkspaceSort: state.sidebarWorkspaceSort,
				rightSidebarTabByWorkspaceId: state.rightSidebarTabByWorkspaceId,
				rightSidebarCollapsedByWorkspaceId: state.rightSidebarCollapsedByWorkspaceId,
				rightSidebarWidthByWorkspaceId: state.rightSidebarWidthByWorkspaceId,
				middleTabsByWorkspaceId: state.middleTabsByWorkspaceId,
				activeTabIdByWorkspaceId: state.activeTabIdByWorkspaceId,
				terminalPanelByWorkspaceId: state.terminalPanelByWorkspaceId,
				terminalTabsByWorkspaceId: {},
				activeTerminalIdByWorkspaceId: {},
				diffViewModeByWorkspaceId: state.diffViewModeByWorkspaceId,
				viewedDiffDigestByWorkspaceId: state.viewedDiffDigestByWorkspaceId,
				checksTodosByWorkspaceId: state.checksTodosByWorkspaceId,
				hiddenCommentIdsByWorkspaceId: state.hiddenCommentIdsByWorkspaceId,
			}),
		},
	),
);
