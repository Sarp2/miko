import { CaretDown, CaretUp, Plus, X } from '@phosphor-icons/react';
import type { PointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import type { WorkspaceSetupState } from '../../shared/types';
import { cn } from '../lib/utils';
import { useTerminalStore } from '../stores/terminal-store';
import { useUiStore } from '../stores/ui-store';
import { RightSidebarTerminalView } from './right-sidebar-terminal-view';
import { Button } from './ui/button';

const TERMINAL_SCROLLBACK = 10_000;
const DEFAULT_TERMINAL_COLS = 80;
const DEFAULT_TERMINAL_ROWS = 24;
const TERMINAL_HEADER_HEIGHT = 32;
const MIN_TERMINAL_HEIGHT = 120;
const MAX_TERMINAL_HEIGHT = 720;

interface RightSidebarTerminalPanelProps {
	setupState: WorkspaceSetupState;
	workspaceId: string;
}

function createTerminalId(workspaceId: string) {
	const id =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now();
	return `${workspaceId}:${id}`;
}

export function RightSidebarTerminalPanel({
	setupState,
	workspaceId,
}: RightSidebarTerminalPanelProps) {
	const panel = useUiStore((state) => state.getTerminalPanel(workspaceId));
	const tabs = useUiStore((state) => state.getTerminalTabs(workspaceId));
	const activeTerminalId = useUiStore((state) => state.activeTerminalIdByWorkspaceId[workspaceId]);
	const setTerminalPanelCollapsed = useUiStore((state) => state.setTerminalPanelCollapsed);
	const setTerminalPanelHeight = useUiStore((state) => state.setTerminalPanelHeight);
	const openTerminalTab = useUiStore((state) => state.openTerminalTab);
	const setActiveTerminal = useUiStore((state) => state.setActiveTerminal);
	const closeTerminalTab = useUiStore((state) => state.closeTerminalTab);
	const createTerminal = useTerminalStore((state) => state.createTerminal);
	const closeTerminal = useTerminalStore((state) => state.closeTerminal);
	const dragStartRef = useRef<{ height: number; y: number } | null>(null);
	const creatingInitialTerminalRef = useRef(false);

	const activeTab = useMemo(
		() => tabs.find((tab) => tab.terminalId === activeTerminalId) ?? tabs.at(-1) ?? null,
		[activeTerminalId, tabs],
	);

	const terminalReady = setupState === 'ready';
	const openNewTerminal = useCallback(async () => {
		if (!terminalReady) return;
		const terminalId = createTerminalId(workspaceId);
		setTerminalPanelCollapsed(workspaceId, false);
		try {
			await createTerminal({
				workspaceId,
				terminalId,
				cols: DEFAULT_TERMINAL_COLS,
				rows: DEFAULT_TERMINAL_ROWS,
				scrollback: TERMINAL_SCROLLBACK,
			});
			openTerminalTab(workspaceId, terminalId, 'Terminal');
		} catch (error) {
			console.warn('[right-sidebar-terminal] failed to create terminal', error);
		}
	}, [createTerminal, openTerminalTab, setTerminalPanelCollapsed, terminalReady, workspaceId]);

	const closeTab = useCallback(
		async (terminalId: string) => {
			try {
				await closeTerminal(terminalId);
				closeTerminalTab(workspaceId, terminalId);
			} catch (error) {
				console.warn('[right-sidebar-terminal] failed to close terminal', error);
				toast.error('Could not close terminal');
			}
		},
		[closeTerminal, closeTerminalTab, workspaceId],
	);

	useEffect(() => {
		if (!terminalReady || panel.collapsed || tabs.length > 0 || creatingInitialTerminalRef.current)
			return;
		creatingInitialTerminalRef.current = true;
		void openNewTerminal().finally(() => {
			creatingInitialTerminalRef.current = false;
		});
	}, [openNewTerminal, panel.collapsed, tabs.length, terminalReady]);

	const onResizePointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			dragStartRef.current = { height: panel.height, y: event.clientY };
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[panel.height],
	);

	const onResizePointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (!dragStartRef.current) return;
			const delta = dragStartRef.current.y - event.clientY;
			setTerminalPanelHeight(workspaceId, dragStartRef.current.height + delta);
		},
		[setTerminalPanelHeight, workspaceId],
	);

	const onResizePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
		dragStartRef.current = null;
		event.currentTarget.releasePointerCapture(event.pointerId);
	}, []);

	const expanded = !panel.collapsed;
	const bodyHeight = expanded ? panel.height : 0;
	const ToggleIcon = expanded ? CaretDown : CaretUp;
	const openOrToggleTerminal = () => {
		if (!terminalReady) return;
		if (tabs.length === 0) {
			void openNewTerminal();
			return;
		}
		setTerminalPanelCollapsed(workspaceId, expanded);
	};

	return (
		<section
			className="relative shrink-0 border-t border-hairline/70 bg-surface-1 text-ink"
			style={{ height: TERMINAL_HEADER_HEIGHT + bodyHeight }}
			aria-label="Workspace terminal"
		>
			{expanded ? (
				<hr
					aria-orientation="horizontal"
					aria-label="Resize terminal"
					aria-valuemin={MIN_TERMINAL_HEIGHT}
					aria-valuemax={MAX_TERMINAL_HEIGHT}
					aria-valuenow={panel.height}
					className="absolute top-0 left-0 z-10 h-1 w-full cursor-row-resize touch-none border-0 bg-transparent hover:bg-hairline-tertiary"
					onPointerDown={onResizePointerDown}
					onPointerMove={onResizePointerMove}
					onPointerUp={onResizePointerUp}
					onPointerCancel={onResizePointerUp}
				/>
			) : null}

			<div className="flex h-8 items-center border-b border-hairline/50 bg-surface-1 px-3">
				<button
					type="button"
					className="-ml-1 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2/70 hover:text-ink-subtle"
					onClick={openOrToggleTerminal}
					aria-label={expanded ? 'Collapse terminal' : 'Open terminal'}
					disabled={!terminalReady}
				>
					<ToggleIcon className="size-3.5" />
				</button>

				<div className="ml-1.5 flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
					<span className="shrink-0 text-[11px] font-medium leading-none text-ink-muted">
						Terminal
					</span>
					{tabs.length > 1 ? (
						<div className="scrollbar-miko flex min-w-0 items-center gap-1 overflow-x-auto">
							{tabs.map((tab, index) => {
								const active = tab.terminalId === activeTab?.terminalId;
								const label = String(index + 1);
								return (
									<button
										key={tab.terminalId}
										type="button"
										className={cn(
											'inline-flex h-4 min-w-4 shrink-0 cursor-pointer items-center justify-center rounded-sm px-1 font-mono text-[10px] leading-none text-ink-tertiary transition-colors hover:bg-surface-2/70 hover:text-ink-subtle',
											active && 'bg-surface-2 text-ink-muted',
										)}
										onClick={() => {
											setActiveTerminal(workspaceId, tab.terminalId);
											setTerminalPanelCollapsed(workspaceId, false);
										}}
										aria-label={`Open terminal ${label}`}
									>
										{label}
									</button>
								);
							})}
						</div>
					) : null}
				</div>

				<div className="flex shrink-0 items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="size-5 rounded-md text-ink-tertiary hover:bg-surface-2/70 hover:text-ink-subtle"
						disabled={!terminalReady}
						onClick={() => {
							void openNewTerminal();
						}}
						aria-label="New terminal"
					>
						<Plus className="size-3" />
					</Button>
					{activeTab ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="size-5 rounded-md text-ink-tertiary hover:bg-surface-2/70 hover:text-ink-subtle"
							onClick={() => {
								void closeTab(activeTab.terminalId);
							}}
							aria-label="Close active terminal"
						>
							<X className="size-2.5" />
						</Button>
					) : null}
				</div>
			</div>
			{expanded ? (
				activeTab ? (
					<div className="h-[calc(100%-32px)] min-h-0 bg-surface-1">
						<RightSidebarTerminalView terminalId={activeTab.terminalId} />
					</div>
				) : !terminalReady ? (
					<div className="flex h-[calc(100%-32px)] items-center justify-center text-[12px] text-ink-tertiary">
						Preparing workspace...
					</div>
				) : null
			) : null}
		</section>
	);
}
