import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export const UI_STORAGE_KEY = 'miko:v1';

export type RightSidebarTab = 'all_files' | 'changes' | 'checks';
export type SidebarSortField = 'updated' | 'created';
export type ExternalOpenApp = 'finder' | 'cursor' | 'warp' | 'terminal' | 'antigravity';
export type WorkspaceFileSource =
	| 'scratchpad'
	| 'workspace_file'
	| 'ci_log'
	| 'pr_comment'
	| 'generated_attachment';

export type WorkspacePage =
	| { type: 'chat'; sessionId: string }
	| { type: 'diff'; path?: string }
	| {
			type: 'file';
			path?: string;
			title: string;
			source: WorkspaceFileSource;
			sourceId?: string;
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

interface PersistedUiState {
	leftSidebarCollapsed: boolean;
	leftSidebarWidth: number;
	externalOpenApp: ExternalOpenApp;
	expandedDirectoryIds: string[];
	sidebarDirectorySort: SidebarSortField;
	sidebarWorkspaceSort: SidebarSortField;
	rightSidebarTabByWorkspaceId: Record<string, RightSidebarTab>;
	middleTabsByWorkspaceId: Record<string, MiddleTabDescriptor[]>;
	activeTabIdByWorkspaceId: Record<string, string>;
	terminalPanelByWorkspaceId: Record<string, TerminalPanelState>;
	terminalTabsByWorkspaceId: Record<string, TerminalTabDescriptor[]>;
	activeTerminalIdByWorkspaceId: Record<string, string>;
}

interface UiStoreState extends PersistedUiState {
	getRightSidebarTab: (workspaceId: string) => RightSidebarTab;
	setRightSidebarTab: (workspaceId: string, tab: RightSidebarTab) => void;
	setLeftSidebarCollapsed: (collapsed: boolean) => void;
	setLeftSidebarWidth: (width: number) => void;
	setExternalOpenApp: (app: ExternalOpenApp) => void;
	setDirectoryExpanded: (directoryId: string, expanded: boolean) => void;
	setSidebarDirectorySort: (sort: SidebarSortField) => void;
	setSidebarWorkspaceSort: (sort: SidebarSortField) => void;
	toggleDirectoryExpanded: (directoryId: string) => void;
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

const memoryStorage = new Map<string, string>();

const fallbackStorage: StateStorage = {
	getItem: (name) => memoryStorage.get(name) ?? null,
	setItem: (name, value) => {
		memoryStorage.set(name, value);
	},
	removeItem: (name) => {
		memoryStorage.delete(name);
	},
};

function getLocalStorage(): StateStorage {
	if (typeof window === 'undefined') return fallbackStorage;
	return window.localStorage;
}

export function scratchpadTabId(workspaceId: string) {
	return `scratchpad:${workspaceId}`;
}

export function pageTabId(page: WorkspacePage) {
	if (page.type === 'chat') return `chat:${page.sessionId}`;
	if (page.type === 'diff') return page.path ? `diff:${page.path}` : 'diff:all_changes';

	const identity = page.sourceId ?? page.path ?? page.title;
	return `file:${page.source}:${identity}`;
}

function basename(path: string) {
	return path.split('/').filter(Boolean).at(-1) ?? path;
}

export function fallbackTitleForPage(page: WorkspacePage) {
	if (page.type === 'chat') return undefined;
	if (page.type === 'diff') return 'All changes';

	if (page.source === 'scratchpad') return 'Scratchpad';
	if (page.source === 'workspace_file') return page.path ? basename(page.path) : page.title;
	if (page.source === 'ci_log') return page.title || 'CI Log';
	if (page.source === 'pr_comment') return page.title || 'PR Comment';
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
			sidebarDirectorySort: 'updated',
			sidebarWorkspaceSort: 'updated',
			rightSidebarTabByWorkspaceId: {},
			middleTabsByWorkspaceId: {},
			activeTabIdByWorkspaceId: {},
			terminalPanelByWorkspaceId: {},
			terminalTabsByWorkspaceId: {},
			activeTerminalIdByWorkspaceId: {},

			getRightSidebarTab: (workspaceId) => {
				return get().rightSidebarTabByWorkspaceId[workspaceId] ?? 'all_files';
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
				}));
			},
		}),
		{
			name: UI_STORAGE_KEY,
			storage: createJSONStorage(getLocalStorage),
			partialize: (state): PersistedUiState => ({
				leftSidebarCollapsed: state.leftSidebarCollapsed,
				leftSidebarWidth: state.leftSidebarWidth,
				externalOpenApp: state.externalOpenApp,
				expandedDirectoryIds: state.expandedDirectoryIds,
				sidebarDirectorySort: state.sidebarDirectorySort,
				sidebarWorkspaceSort: state.sidebarWorkspaceSort,
				rightSidebarTabByWorkspaceId: state.rightSidebarTabByWorkspaceId,
				middleTabsByWorkspaceId: state.middleTabsByWorkspaceId,
				activeTabIdByWorkspaceId: state.activeTabIdByWorkspaceId,
				terminalPanelByWorkspaceId: state.terminalPanelByWorkspaceId,
				terminalTabsByWorkspaceId: state.terminalTabsByWorkspaceId,
				activeTerminalIdByWorkspaceId: state.activeTerminalIdByWorkspaceId,
			}),
		},
	),
);
