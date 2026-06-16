import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { PASTED_TEXT_LABEL } from '../lib/prompt-parts';
import { getLocalStorage } from './persist-storage';

export const UI_STORAGE_KEY = 'miko:v1';

export type RightSidebarTab = 'all_files' | 'changes' | 'checks';
export type DiffViewMode = 'unified' | 'split';
export type SidebarSortField = 'updated' | 'created';
export type ExternalOpenApp = 'finder' | 'cursor' | 'warp' | 'terminal' | 'antigravity';
export type WorkspaceFileSource =
	| 'scratchpad'
	| 'workspace_file'
	| 'ci_log'
	| 'pr_comment'
	| 'generated_attachment'
	| 'pasted_text';

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
	middleTabsByWorkspaceId: Record<string, MiddleTabDescriptor[]>;
	activeTabIdByWorkspaceId: Record<string, string>;
	terminalPanelByWorkspaceId: Record<string, TerminalPanelState>;
	terminalTabsByWorkspaceId: Record<string, TerminalTabDescriptor[]>;
	activeTerminalIdByWorkspaceId: Record<string, string>;
	diffViewModeByWorkspaceId: Record<string, DiffViewMode>;
	viewedDiffDigestByWorkspaceId: Record<string, Record<string, string>>;
}

interface UiStoreState extends PersistedUiState {
	getRightSidebarTab: (workspaceId: string) => RightSidebarTab;
	getDiffViewMode: (workspaceId: string) => DiffViewMode;
	setDiffViewMode: (workspaceId: string, mode: DiffViewMode) => void;
	isDiffPathViewed: (workspaceId: string, path: string, patchDigest?: string | null) => boolean;
	setDiffPathViewed: (
		workspaceId: string,
		path: string,
		patchDigest: string,
		viewed: boolean,
	) => void;
	setRightSidebarTab: (workspaceId: string, tab: RightSidebarTab) => void;
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
}

const DEFAULT_LEFT_SIDEBAR_WIDTH = 292;
const DEFAULT_TERMINAL_HEIGHT = 260;
const DEFAULT_EXTERNAL_OPEN_APP: ExternalOpenApp = 'finder';

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

function normalizeMiddleTab(tab: MiddleTabDescriptor) {
	if (tab.page.type !== 'diff') return tab;
	const id = pageTabId(tab.page);
	return tab.id === id ? tab : { ...tab, id };
}

export function normalizePersistedUiState(state: PersistedUiState): PersistedUiState {
	const middleTabsByWorkspaceId: Record<string, MiddleTabDescriptor[]> = {};
	const activeTabIdByWorkspaceId: Record<string, string> = {};

	for (const [workspaceId, tabs] of Object.entries(state.middleTabsByWorkspaceId)) {
		const legacyIdByNextId = new Map<string, string>();
		const normalizedTabs = tabs.map((tab) => {
			const normalizedTab = normalizeMiddleTab(tab);
			legacyIdByNextId.set(tab.id, normalizedTab.id);
			return normalizedTab;
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
		activeTabIdByWorkspaceId[workspaceId] = activeTabId;
	}

	return {
		...state,
		middleTabsByWorkspaceId,
		activeTabIdByWorkspaceId,
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
	const existingScratchpad = tabs.find((tab) => tab.id === scratchpadId);
	const rest = tabs.filter((tab) => tab.id !== scratchpadId);
	return [existingScratchpad ?? scratchpadTab(workspaceId), ...rest];
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
			leftSidebarCollapsed: false,
			leftSidebarWidth: DEFAULT_LEFT_SIDEBAR_WIDTH,
			externalOpenApp: DEFAULT_EXTERNAL_OPEN_APP,
			expandedDirectoryIds: [],
			pinnedWorkspaceIds: [],
			sidebarDirectorySort: 'updated',
			sidebarWorkspaceSort: 'updated',
			rightSidebarTabByWorkspaceId: {},
			middleTabsByWorkspaceId: {},
			activeTabIdByWorkspaceId: {},
			terminalPanelByWorkspaceId: {},
			terminalTabsByWorkspaceId: {},
			activeTerminalIdByWorkspaceId: {},
			diffViewModeByWorkspaceId: {},
			viewedDiffDigestByWorkspaceId: {},

			getRightSidebarTab: (workspaceId) => {
				return get().rightSidebarTabByWorkspaceId[workspaceId] ?? 'all_files';
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

			setRightSidebarTab: (workspaceId, tab) => {
				set((state) => ({
					rightSidebarTabByWorkspaceId: {
						...state.rightSidebarTabByWorkspaceId,
						[workspaceId]: tab,
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

					const nextTab: MiddleTabDescriptor = {
						id: tabId,
						fallbackTitle: fallbackTitle ?? fallbackTitleForPage(page),
						page,
						closable: tabId !== scratchpadTabId(workspaceId),
						updatedAt: now,
					};

					const nextTabs = [...tabs];

					if (existingIndex >= 0)
						nextTabs[existingIndex] = { ...nextTabs[existingIndex], ...nextTab };
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
				return (
					get().terminalPanelByWorkspaceId[workspaceId] ?? {
						collapsed: false,
						height: DEFAULT_TERMINAL_HEIGHT,
					}
				);
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
				return get().terminalTabsByWorkspaceId[workspaceId] ?? [];
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
					pinnedWorkspaceIds: state.pinnedWorkspaceIds.filter((id) => id !== workspaceId),
				}));
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
				middleTabsByWorkspaceId: state.middleTabsByWorkspaceId,
				activeTabIdByWorkspaceId: state.activeTabIdByWorkspaceId,
				terminalPanelByWorkspaceId: state.terminalPanelByWorkspaceId,
				terminalTabsByWorkspaceId: state.terminalTabsByWorkspaceId,
				activeTerminalIdByWorkspaceId: state.activeTerminalIdByWorkspaceId,
				diffViewModeByWorkspaceId: state.diffViewModeByWorkspaceId,
				viewedDiffDigestByWorkspaceId: state.viewedDiffDigestByWorkspaceId,
			}),
		},
	),
);
