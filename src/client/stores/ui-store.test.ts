import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	normalizePersistedUiState,
	type PersistedUiState,
	UI_STORAGE_KEY,
	useUiStore,
	type WorkspacePage,
} from './ui-store';

const initialState = useUiStore.getInitialState();

function resetStore() {
	useUiStore.setState(initialState, true);
	useUiStore.persist.clearStorage();
}

function installLocalStorage() {
	const values = new Map<string, string>();
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			localStorage: {
				getItem: (key: string) => values.get(key) ?? null,
				setItem: (key: string, value: string) => values.set(key, value),
				removeItem: (key: string) => values.delete(key),
			},
		},
	});
	return values;
}

function removeMockedBrowserGlobals() {
	delete (globalThis as { window?: unknown }).window;
}

beforeEach(() => {
	installLocalStorage();
	resetStore();
});

afterEach(() => {
	resetStore();
	removeMockedBrowserGlobals();
});

describe('useUiStore.setRightSidebarTab', () => {
	test('stores the selected right sidebar tab per workspace', () => {
		expect(useUiStore.getState().getRightSidebarTab('workspace-1')).toBe('all_files');

		useUiStore.getState().setRightSidebarTab('workspace-1', 'checks');
		useUiStore.getState().setRightSidebarTab('workspace-2', 'changes');

		expect(useUiStore.getState().getRightSidebarTab('workspace-1')).toBe('checks');
		expect(useUiStore.getState().getRightSidebarTab('workspace-2')).toBe('changes');
	});
});

describe('useUiStore.diff review preferences', () => {
	test('stores diff view mode per workspace', () => {
		expect(useUiStore.getState().getDiffViewMode('workspace-1')).toBe('unified');

		useUiStore.getState().setDiffViewMode('workspace-1', 'split');
		useUiStore.getState().setDiffViewMode('workspace-2', 'unified');

		expect(useUiStore.getState().getDiffViewMode('workspace-1')).toBe('split');
		expect(useUiStore.getState().getDiffViewMode('workspace-2')).toBe('unified');
	});

	test('stores viewed diff digests per workspace and path', () => {
		expect(useUiStore.getState().isDiffPathViewed('workspace-1', 'src/a.ts', 'digest-1')).toBe(
			false,
		);

		useUiStore.getState().setDiffPathViewed('workspace-1', 'src/a.ts', 'digest-1', true);
		useUiStore.getState().setDiffPathViewed('workspace-2', 'src/a.ts', 'digest-1', true);
		useUiStore.getState().setDiffPathViewed('workspace-1', 'src/b.ts', 'digest-2', true);

		expect(useUiStore.getState().isDiffPathViewed('workspace-1', 'src/a.ts', 'digest-1')).toBe(
			true,
		);
		expect(useUiStore.getState().isDiffPathViewed('workspace-1', 'src/a.ts', 'digest-2')).toBe(
			false,
		);
		expect(useUiStore.getState().isDiffPathViewed('workspace-1', 'src/b.ts', 'digest-2')).toBe(
			true,
		);
		expect(useUiStore.getState().isDiffPathViewed('workspace-2', 'src/a.ts', 'digest-1')).toBe(
			true,
		);

		useUiStore.getState().setDiffPathViewed('workspace-1', 'src/a.ts', 'digest-1', false);

		expect(useUiStore.getState().isDiffPathViewed('workspace-1', 'src/a.ts', 'digest-1')).toBe(
			false,
		);
	});
});

describe('useUiStore.setLeftSidebarCollapsed', () => {
	test('stores whether the left sidebar is collapsed', () => {
		useUiStore.getState().setLeftSidebarCollapsed(true);

		expect(useUiStore.getState().leftSidebarCollapsed).toBe(true);
	});
});

describe('useUiStore.setLeftSidebarWidth', () => {
	test('clamps the left sidebar width to a safe range', () => {
		useUiStore.getState().setLeftSidebarWidth(100);
		expect(useUiStore.getState().leftSidebarWidth).toBe(256);

		useUiStore.getState().setLeftSidebarWidth(900);
		expect(useUiStore.getState().leftSidebarWidth).toBe(420);

		useUiStore.getState().setLeftSidebarWidth(333.6);
		expect(useUiStore.getState().leftSidebarWidth).toBe(334);

		useUiStore.getState().setLeftSidebarWidth(0);
		expect(useUiStore.getState().leftSidebarWidth).toBe(0);
	});
});

describe('useUiStore.sidebar sorting', () => {
	test('stores directory and workspace sort preferences', () => {
		expect(useUiStore.getState().sidebarDirectorySort).toBe('updated');
		expect(useUiStore.getState().sidebarWorkspaceSort).toBe('updated');

		useUiStore.getState().setSidebarDirectorySort('created');
		useUiStore.getState().setSidebarWorkspaceSort('created');

		expect(useUiStore.getState().sidebarDirectorySort).toBe('created');
		expect(useUiStore.getState().sidebarWorkspaceSort).toBe('created');
	});
});

describe('useUiStore.setExternalOpenApp', () => {
	test('stores the selected external app preference', () => {
		expect(useUiStore.getState().externalOpenApp).toBe('finder');

		useUiStore.getState().setExternalOpenApp('cursor');

		expect(useUiStore.getState().externalOpenApp).toBe('cursor');
	});
});

describe('useUiStore.setDirectoryExpanded', () => {
	test('stores expanded directory ids without duplicates', () => {
		useUiStore.getState().setDirectoryExpanded('directory-1', true);
		useUiStore.getState().setDirectoryExpanded('directory-1', true);
		useUiStore.getState().setDirectoryExpanded('directory-2', true);

		expect(useUiStore.getState().expandedDirectoryIds).toEqual(['directory-1', 'directory-2']);

		useUiStore.getState().setDirectoryExpanded('directory-1', false);

		expect(useUiStore.getState().expandedDirectoryIds).toEqual(['directory-2']);
	});
});

describe('useUiStore.toggleDirectoryExpanded', () => {
	test('toggles a directory expansion preference', () => {
		useUiStore.getState().toggleDirectoryExpanded('directory-1');
		expect(useUiStore.getState().expandedDirectoryIds).toEqual(['directory-1']);

		useUiStore.getState().toggleDirectoryExpanded('directory-1');
		expect(useUiStore.getState().expandedDirectoryIds).toEqual([]);
	});
});

describe('useUiStore.workspace pinning', () => {
	test('stores pinned workspace ids without duplicates', () => {
		expect(useUiStore.getState().isWorkspacePinned('workspace-1')).toBe(false);

		useUiStore.getState().setWorkspacePinned('workspace-1', true);
		useUiStore.getState().setWorkspacePinned('workspace-1', true);
		useUiStore.getState().setWorkspacePinned('workspace-2', true);

		expect(useUiStore.getState().pinnedWorkspaceIds).toEqual(['workspace-1', 'workspace-2']);
		expect(useUiStore.getState().isWorkspacePinned('workspace-1')).toBe(true);

		useUiStore.getState().toggleWorkspacePinned('workspace-1');

		expect(useUiStore.getState().pinnedWorkspaceIds).toEqual(['workspace-2']);
	});

	test('removes pinned state with workspace ui cleanup', () => {
		useUiStore.getState().setWorkspacePinned('workspace-1', true);
		useUiStore.getState().setWorkspacePinned('workspace-2', true);

		useUiStore.getState().removeWorkspaceUi('workspace-1');

		expect(useUiStore.getState().pinnedWorkspaceIds).toEqual(['workspace-2']);
	});
});

describe('useUiStore.ensureScratchpadTab', () => {
	test('creates a pinned scratchpad tab as the first middle tab', () => {
		useUiStore.getState().ensureScratchpadTab('workspace-1');

		const tabs = useUiStore.getState().getMiddleTabs('workspace-1');
		expect(tabs).toMatchObject([
			{
				id: 'scratchpad:workspace-1',
				fallbackTitle: 'Scratchpad',
				closable: false,
				page: { type: 'file', source: 'scratchpad', sourceId: 'workspace-1' },
			},
		]);
	});
});

describe('useUiStore.openMiddleTab', () => {
	test('opens chat, file, and diff tabs after the pinned scratchpad tab', () => {
		useUiStore.getState().openMiddleTab('workspace-1', { type: 'chat', sessionId: 'session-1' });
		useUiStore.getState().openMiddleTab('workspace-1', {
			type: 'file',
			path: 'src/server/foo.ts',
			title: 'foo.ts',
			source: 'workspace_file',
		});
		useUiStore.getState().openMiddleTab('workspace-1', { type: 'diff', path: 'src/server/foo.ts' });

		const tabs = useUiStore.getState().getMiddleTabs('workspace-1');

		expect(tabs.map((tab) => tab.id)).toEqual([
			'scratchpad:workspace-1',
			'chat:session-1',
			'file:workspace_file:src/server/foo.ts',
			'diff:workspace:src/server/foo.ts:src/server/foo.ts',
		]);
		expect(useUiStore.getState().activeTabIdByWorkspaceId['workspace-1']).toBe(
			'diff:workspace:src/server/foo.ts:src/server/foo.ts',
		);
		expect(tabs.map((tab) => tab.fallbackTitle)).toEqual([
			'Scratchpad',
			undefined,
			'foo.ts',
			'foo.ts',
		]);
	});

	test('uses specific fallback titles for empty diff placeholders and PR comments', () => {
		useUiStore.getState().openMiddleTab('workspace-1', { type: 'diff' });
		useUiStore.getState().openMiddleTab('workspace-1', {
			type: 'file',
			title: 'Comment by CodeRabbit',
			source: 'pr_comment',
			sourceId: 'comment-1',
		});

		const tabs = useUiStore.getState().getMiddleTabs('workspace-1');
		expect(tabs.map((tab) => [tab.id, tab.fallbackTitle])).toEqual([
			['scratchpad:workspace-1', 'Scratchpad'],
			['diff:workspace:placeholder:', 'Select a changed file'],
			['file:pr_comment:comment-1', 'Comment by CodeRabbit'],
		]);
	});

	test('dedupes an already opened tab and updates its fallback title', () => {
		const page: WorkspacePage = {
			type: 'file',
			path: 'src/server/foo.ts',
			title: 'foo.ts',
			source: 'workspace_file',
		};

		useUiStore.getState().openMiddleTab('workspace-1', page);
		useUiStore.getState().openMiddleTab('workspace-1', page, 'Renamed foo.ts');

		const tabs = useUiStore.getState().getMiddleTabs('workspace-1');
		expect(tabs).toHaveLength(2);
		expect(tabs[1]).toMatchObject({
			id: 'file:workspace_file:src/server/foo.ts',
			fallbackTitle: 'Renamed foo.ts',
		});
	});
});

describe('useUiStore.setActiveMiddleTab', () => {
	test('stores the active middle tab id per workspace', () => {
		useUiStore.getState().setActiveMiddleTab('workspace-1', 'chat:session-1');

		expect(useUiStore.getState().activeTabIdByWorkspaceId['workspace-1']).toBe('chat:session-1');
	});
});

describe('useUiStore.closeMiddleTab', () => {
	test('does not close the scratchpad tab', () => {
		useUiStore.getState().ensureScratchpadTab('workspace-1');
		useUiStore.getState().closeMiddleTab('workspace-1', 'scratchpad:workspace-1');

		expect(useUiStore.getState().getMiddleTabs('workspace-1')).toHaveLength(1);
	});

	test('closes a regular tab and moves active tab to the adjacent remaining tab', () => {
		useUiStore.getState().openMiddleTab('workspace-1', { type: 'chat', sessionId: 'session-1' });
		useUiStore.getState().openMiddleTab('workspace-1', {
			type: 'file',
			path: 'src/server/foo.ts',
			title: 'foo.ts',
			source: 'workspace_file',
		});
		useUiStore.getState().openMiddleTab('workspace-1', { type: 'chat', sessionId: 'session-2' });

		useUiStore.getState().closeMiddleTab('workspace-1', 'file:workspace_file:src/server/foo.ts');

		expect(
			useUiStore
				.getState()
				.getMiddleTabs('workspace-1')
				.map((tab) => tab.id),
		).toEqual(['scratchpad:workspace-1', 'chat:session-1', 'chat:session-2']);
		expect(useUiStore.getState().activeTabIdByWorkspaceId['workspace-1']).toBe('chat:session-2');
	});
});

describe('useUiStore.setTerminalPanelCollapsed', () => {
	test('stores terminal panel collapsed state per workspace', () => {
		useUiStore.getState().setTerminalPanelCollapsed('workspace-1', true);

		expect(useUiStore.getState().getTerminalPanel('workspace-1')).toEqual({
			collapsed: true,
			height: 260,
		});
	});
});

describe('useUiStore.setTerminalPanelHeight', () => {
	test('clamps terminal panel height to a safe range', () => {
		useUiStore.getState().setTerminalPanelHeight('workspace-1', 50);
		expect(useUiStore.getState().getTerminalPanel('workspace-1').height).toBe(120);

		useUiStore.getState().setTerminalPanelHeight('workspace-1', 900);
		expect(useUiStore.getState().getTerminalPanel('workspace-1').height).toBe(720);
	});
});

describe('useUiStore.openTerminalTab', () => {
	test('stores terminal tab descriptors without output history', () => {
		useUiStore.getState().openTerminalTab('workspace-1', 'terminal-1', 'Server');
		useUiStore.getState().openTerminalTab('workspace-1', 'terminal-1', 'Server');

		expect(useUiStore.getState().getTerminalTabs('workspace-1')).toMatchObject([
			{ terminalId: 'terminal-1', title: 'Server' },
		]);
		expect(useUiStore.getState().activeTerminalIdByWorkspaceId['workspace-1']).toBe('terminal-1');
	});
});

describe('useUiStore.setActiveTerminal', () => {
	test('stores the active terminal id per workspace', () => {
		useUiStore.getState().setActiveTerminal('workspace-1', 'terminal-1');

		expect(useUiStore.getState().activeTerminalIdByWorkspaceId['workspace-1']).toBe('terminal-1');
	});
});

describe('useUiStore.closeTerminalTab', () => {
	test('closes a terminal tab and falls back to the previous terminal', () => {
		useUiStore.getState().openTerminalTab('workspace-1', 'terminal-1');
		useUiStore.getState().openTerminalTab('workspace-1', 'terminal-2');

		useUiStore.getState().closeTerminalTab('workspace-1', 'terminal-2');

		expect(
			useUiStore
				.getState()
				.getTerminalTabs('workspace-1')
				.map((tab) => tab.terminalId),
		).toEqual(['terminal-1']);
		expect(useUiStore.getState().activeTerminalIdByWorkspaceId['workspace-1']).toBe('terminal-1');
	});
});

describe('useUiStore.removeWorkspaceUi', () => {
	test('removes all local UI memory for a workspace', () => {
		useUiStore.getState().setRightSidebarTab('workspace-1', 'checks');
		useUiStore.getState().openMiddleTab('workspace-1', { type: 'chat', sessionId: 'session-1' });
		useUiStore.getState().setTerminalPanelCollapsed('workspace-1', true);
		useUiStore.getState().openTerminalTab('workspace-1', 'terminal-1');

		useUiStore.getState().removeWorkspaceUi('workspace-1');

		expect(useUiStore.getState().rightSidebarTabByWorkspaceId['workspace-1']).toBeUndefined();
		expect(useUiStore.getState().middleTabsByWorkspaceId['workspace-1']).toBeUndefined();
		expect(useUiStore.getState().terminalPanelByWorkspaceId['workspace-1']).toBeUndefined();
		expect(useUiStore.getState().terminalTabsByWorkspaceId['workspace-1']).toBeUndefined();
	});
});

describe('useUiStore.persist', () => {
	test('uses the miko:v1 storage key', () => {
		expect(useUiStore.persist.getOptions().name).toBe(UI_STORAGE_KEY);
	});

	test('normalizes legacy diff tab ids and stale active tab ids', () => {
		const persisted: PersistedUiState = {
			leftSidebarCollapsed: false,
			leftSidebarWidth: 292,
			externalOpenApp: 'finder',
			expandedDirectoryIds: [],
			pinnedWorkspaceIds: [],
			sidebarDirectorySort: 'updated',
			sidebarWorkspaceSort: 'updated',
			rightSidebarTabByWorkspaceId: {},
			middleTabsByWorkspaceId: {
				'workspace-1': [
					{
						id: 'diff:src/a.ts',
						page: { type: 'diff', path: 'src/a.ts' },
						closable: true,
						updatedAt: 1,
					},
				],
				'workspace-2': [
					{
						id: 'chat:session-1',
						page: { type: 'chat', sessionId: 'session-1' },
						closable: true,
						updatedAt: 1,
					},
				],
			},
			activeTabIdByWorkspaceId: {
				'workspace-1': 'diff:src/a.ts',
				'workspace-2': 'missing-tab',
			},
			terminalPanelByWorkspaceId: {},
			terminalTabsByWorkspaceId: {},
			activeTerminalIdByWorkspaceId: {},
			diffViewModeByWorkspaceId: {},
			viewedDiffDigestByWorkspaceId: {},
		};

		expect(normalizePersistedUiState(persisted).middleTabsByWorkspaceId['workspace-1'][0].id).toBe(
			'diff:workspace:src/a.ts:src/a.ts',
		);
		expect(normalizePersistedUiState(persisted).activeTabIdByWorkspaceId).toEqual({
			'workspace-1': 'diff:workspace:src/a.ts:src/a.ts',
			'workspace-2': 'chat:session-1',
		});
	});
});
