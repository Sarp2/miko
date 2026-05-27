import {
	Archive,
	CaretDown,
	CaretRight,
	FolderSimplePlus,
	Gear,
	GitPullRequest,
	Plus,
	SidebarSimple,
	SlidersHorizontal,
} from '@phosphor-icons/react';
import * as React from 'react';
import type {
	SidebarDirectoryGroup,
	SidebarWorkspaceRow,
	WorkspaceSidebarIndicator,
} from '../../shared/types';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export interface SidebarProps {
	directoryGroups: SidebarDirectoryGroup[];
	activeWorkspaceId?: string;
	expandedDirectoryIds?: string[];
	collapsed?: boolean;
	width?: number;
	onCollapsedChange?: (collapsed: boolean) => void;
	onWidthChange?: (width: number) => void;
	onDirectoryExpandedChange?: (directoryId: string, expanded: boolean) => void;
	onWorkspaceSelect?: (workspaceId: string) => void;
	onCreateWorkspace?: (directoryId: string) => void;
	onFilterClick?: () => void;
	onCreateWorkspaceError?: (error: unknown) => void;
	onAddDirectory?: () => void;
	onOpenArchive?: () => void;
	onOpenSettings?: () => void;
	className?: string;
}

const DEFAULT_WIDTH = 292;
const MIN_WIDTH = 256;
const MAX_WIDTH = 420;
const CLOSE_THRESHOLD = 148;

function indicatorLabel(indicator: WorkspaceSidebarIndicator) {
	if (indicator === 'workspace_creating') return 'creating';
	if (indicator === 'workspace_failed') return 'failed';
	if (indicator === 'agent_active') return 'streaming';
	if (indicator === 'commit_and_push') return 'commit';
	if (indicator === 'create_pr') return 'create pr';
	if (indicator === 'pr_opened') return 'open pr';
	if (indicator === 'ci_failed') return 'ci failed';
	if (indicator === 'merged') return 'merged';
	if (indicator === 'closed') return 'closed';
	return 'idle';
}

function indicatorTextClass(indicator: WorkspaceSidebarIndicator) {
	if (indicator === 'agent_active' || indicator === 'workspace_creating') return 'text-primary';
	if (indicator === 'pr_opened' || indicator === 'create_pr') return 'text-success/75';
	if (indicator === 'ci_failed' || indicator === 'workspace_failed' || indicator === 'closed') {
		return 'text-destructive';
	}
	if (indicator === 'merged') return 'text-primary-hover/85';
	return 'text-ink-tertiary';
}

function WorkspaceIndicatorIcon({
	indicator,
	className,
}: {
	indicator: WorkspaceSidebarIndicator;
	className?: string;
}) {
	if (indicator === 'agent_active' || indicator === 'workspace_creating') {
		return (
			<svg
				viewBox="0 0 16 16"
				aria-label={indicatorLabel(indicator)}
				className={cn('size-3.5 animate-pulse text-ink-muted', className)}
			>
				<path
					d="M3 10.5 6 7.5"
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeWidth="1.6"
				/>
				<path
					d="M7 10.5 10 7.5"
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeWidth="1.6"
					opacity="0.72"
				/>
				<path
					d="M11 10.5 14 7.5"
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeWidth="1.6"
					opacity="0.44"
				/>
			</svg>
		);
	}

	const colorClassName = indicatorTextClass(indicator);
	const isDone = indicator === 'merged';
	const isPr = indicator === 'pr_opened' || indicator === 'create_pr';
	const isError =
		indicator === 'ci_failed' || indicator === 'workspace_failed' || indicator === 'closed';

	return (
		<svg
			viewBox="0 0 16 16"
			aria-hidden="true"
			className={cn('size-3.5', colorClassName, className)}
		>
			{isDone ? (
				<>
					<path
						d="M4 10.5 8 6.5"
						fill="none"
						stroke="currentColor"
						strokeLinecap="round"
						strokeWidth="1.55"
						opacity="0.86"
					/>
					<path
						d="M7.25 9.75 9.25 11.75 12.5 5.25"
						fill="none"
						stroke="currentColor"
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth="1.55"
						opacity="0.8"
					/>
				</>
			) : isPr ? (
				<>
					<path
						d="M4 10.5 8 6.5"
						fill="none"
						stroke="currentColor"
						strokeLinecap="round"
						strokeWidth="1.55"
						opacity="0.86"
					/>
					<path
						d="M8 10.5 12 6.5"
						fill="none"
						stroke="currentColor"
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth="1.55"
						opacity="0.62"
					/>
				</>
			) : isError ? (
				<>
					<path
						d="M5 5 11 11"
						fill="none"
						stroke="currentColor"
						strokeLinecap="round"
						strokeWidth="1.55"
					/>
					<path
						d="M11 5 5 11"
						fill="none"
						stroke="currentColor"
						strokeLinecap="round"
						strokeWidth="1.55"
					/>
				</>
			) : (
				<path
					d="M5 10.5 11 4.5"
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeWidth="1.55"
					opacity={indicator === 'none' ? '0.38' : '0.9'}
				/>
			)}
		</svg>
	);
}

function WorkspaceHoverMeta({
	workspace,
	children,
}: {
	workspace: SidebarWorkspaceRow;
	children: React.ReactElement;
}) {
	const hasDetails =
		workspace.localPath || workspace.branchName || workspace.prNumber || workspace.lastActivityAt;
	if (!hasDetails) return children;

	return (
		<HoverCard openDelay={140} closeDelay={80}>
			<HoverCardTrigger asChild>{children}</HoverCardTrigger>
			<HoverCardContent
				side="right"
				align="start"
				sideOffset={8}
				className="w-[300px] rounded-lg border-hairline bg-surface-1 p-0 shadow-none"
			>
				<div className="flex flex-col gap-2.5 px-3.5 py-3">
					<div className="flex items-center justify-between gap-2">
						<div className="flex min-w-0 items-center gap-1.5">
							<span className="truncate font-mono text-[11px] leading-4 text-ink-muted">
								{workspace.branchName}
							</span>
							{workspace.prNumber && (
								<span className="flex items-center gap-1 font-mono text-[11px] leading-4 text-success">
									<GitPullRequest className="size-3" />#{workspace.prNumber}
								</span>
							)}
						</div>
						<WorkspaceIndicatorIcon indicator={workspace.indicator} className="size-4 shrink-0" />
					</div>

					<div className="min-w-0">
						<p
							className="truncate text-[13px] font-medium leading-5 text-ink"
							title={workspace.displayName}
						>
							{workspace.displayName}
						</p>
						<p className="mt-1 truncate font-mono text-[11px] leading-4 text-ink-subtle">
							{workspace.localPath}
						</p>
					</div>

					<div className="flex flex-wrap items-center gap-2 font-mono text-[11px] leading-4">
						<span className={indicatorTextClass(workspace.indicator)}>
							{indicatorLabel(workspace.indicator)}
						</span>
						<span className="text-ink-subtle">{workspace.reviewState}</span>
						<span className="text-ink-tertiary">{workspace.branchName}</span>
					</div>
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}

function WorkspaceRow({
	workspace,
	isActive,
	onSelect,
}: {
	workspace: SidebarWorkspaceRow;
	isActive: boolean;
	onSelect: () => void;
}) {
	return (
		<WorkspaceHoverMeta workspace={workspace}>
			<button
				type="button"
				className={cn(
					'group grid h-[30px] w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left outline-none transition-colors',
					'focus-visible:ring-1 focus-visible:ring-primary',
					isActive ? 'bg-surface-3 text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
				)}
				onClick={onSelect}
			>
				<WorkspaceIndicatorIcon indicator={workspace.indicator} className="justify-self-center" />
				<span className="min-w-0 truncate text-[13px] leading-5 tracking-[0]">
					{workspace.displayName}
				</span>
				<span className="flex min-w-[56px] items-center justify-end gap-1.5 font-mono text-[11px] leading-4 text-ink-subtle tabular-nums">
					{workspace.hasUnreadAgentResult && <span className="text-primary">new</span>}
					{workspace.prNumber && <span>#{workspace.prNumber}</span>}
				</span>
			</button>
		</WorkspaceHoverMeta>
	);
}

function DirectoryGroup({
	directory,
	isExpanded,
	activeWorkspaceId,
	onToggle,
	onWorkspaceSelect,
	onCreateWorkspace,
}: {
	directory: SidebarDirectoryGroup;
	isExpanded: boolean;
	activeWorkspaceId?: string;
	onToggle: () => void;
	onWorkspaceSelect?: (workspaceId: string) => void;
	onCreateWorkspace?: () => void | Promise<void>;
}) {
	const avatar = directory.title.slice(0, 1).toUpperCase();

	return (
		<div className="flex flex-col gap-1">
			<div className="group grid h-8 grid-cols-[16px_20px_minmax(0,1fr)_24px] items-center gap-2 rounded-md px-2 hover:bg-surface-2">
				<button
					type="button"
					className="flex size-4 items-center justify-center text-ink-subtle hover:text-ink"
					onClick={onToggle}
					aria-label={isExpanded ? `Collapse ${directory.title}` : `Expand ${directory.title}`}
				>
					{isExpanded ? <CaretDown className="size-3" /> : <CaretRight className="size-3" />}
				</button>

				<div className="flex size-5 items-center justify-center rounded-md bg-surface-4 text-[11px] font-medium leading-none text-ink">
					{avatar || 'D'}
				</div>

				<button
					type="button"
					className="min-w-0 truncate text-left text-[13px] font-medium leading-5 text-ink"
					onClick={onToggle}
				>
					{directory.title}
				</button>

				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="size-6 text-ink-subtle hover:text-ink"
							aria-label={`New workspace in ${directory.title}`}
							onClick={onCreateWorkspace}
						>
							<Plus className="size-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>New workspace</TooltipContent>
				</Tooltip>
			</div>

			{isExpanded && (
				<div className="flex flex-col gap-px">
					{directory.workspaces.map((workspace) => (
						<WorkspaceRow
							key={workspace.workspaceId}
							workspace={workspace}
							isActive={workspace.workspaceId === activeWorkspaceId}
							onSelect={() => onWorkspaceSelect?.(workspace.workspaceId)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

export function Sidebar({
	directoryGroups,
	activeWorkspaceId,
	expandedDirectoryIds,
	collapsed,
	width,
	onCollapsedChange,
	onWidthChange,
	onDirectoryExpandedChange,
	onWorkspaceSelect,
	onCreateWorkspace,
	onFilterClick,
	onCreateWorkspaceError,
	onAddDirectory,
	onOpenArchive,
	onOpenSettings,
	className,
}: SidebarProps) {
	const rootRef = React.useRef<HTMLElement | null>(null);
	const isCollapsedControlled = collapsed !== undefined;
	const isExpansionControlled = expandedDirectoryIds !== undefined;
	const [internalCollapsed, setInternalCollapsed] = React.useState(false);
	const [internalWidth, setInternalWidth] = React.useState(width ?? DEFAULT_WIDTH);
	const [lastOpenWidth, setLastOpenWidth] = React.useState(width ?? DEFAULT_WIDTH);
	const [isResizing, setIsResizing] = React.useState(false);
	const resizeCleanupRef = React.useRef<(() => void) | null>(null);
	const [internalExpandedIds, setInternalExpandedIds] = React.useState<string[]>(() =>
		directoryGroups.map((directory) => directory.directoryId),
	);

	const isCollapsed = isCollapsedControlled ? collapsed : internalCollapsed;
	const currentExpandedIds = isExpansionControlled ? expandedDirectoryIds : internalExpandedIds;

	React.useEffect(() => {
		if (isExpansionControlled) return;
		setInternalExpandedIds((previous) => {
			const existing = new Set(previous);
			for (const directory of directoryGroups) existing.add(directory.directoryId);
			return [...existing];
		});
	}, [directoryGroups, isExpansionControlled]);

	React.useEffect(() => {
		if (width === undefined || isResizing) return;
		setInternalWidth(width);
		if (width >= MIN_WIDTH) setLastOpenWidth(width);
	}, [width, isResizing]);

	const setCollapsed = React.useCallback(
		(next: boolean) => {
			if (!isCollapsedControlled) setInternalCollapsed(next);
			onCollapsedChange?.(next);
			if (!next) {
				const nextWidth = internalWidth < MIN_WIDTH ? lastOpenWidth : internalWidth;
				setInternalWidth(nextWidth);
				onWidthChange?.(nextWidth);
			}
		},
		[isCollapsedControlled, internalWidth, lastOpenWidth, onCollapsedChange, onWidthChange],
	);

	const setExpanded = React.useCallback(
		(directoryId: string, expanded: boolean) => {
			if (!isExpansionControlled) {
				setInternalExpandedIds((previous) => {
					const next = new Set(previous);
					if (expanded) next.add(directoryId);
					else next.delete(directoryId);
					return [...next];
				});
			}
			onDirectoryExpandedChange?.(directoryId, expanded);
		},
		[isExpansionControlled, onDirectoryExpandedChange],
	);

	const toggleCollapsed = React.useCallback(() => {
		setCollapsed(!isCollapsed);
	}, [isCollapsed, setCollapsed]);

	React.useEffect(() => {
		return () => {
			resizeCleanupRef.current?.();
		};
	}, []);

	const onResizePointerDown = React.useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (isCollapsed || !rootRef.current) return;

			event.preventDefault();
			resizeCleanupRef.current?.();

			const left = rootRef.current.getBoundingClientRect().left;
			let nextWidth = internalWidth;
			let nextRawWidth = internalWidth;
			let didFinish = false;

			setIsResizing(true);
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';

			const cleanup = () => {
				document.removeEventListener('pointermove', onPointerMove);
				document.removeEventListener('pointerup', onPointerUp);
				document.removeEventListener('pointercancel', onPointerCancel);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				resizeCleanupRef.current = null;
				setIsResizing(false);
			};

			const finishResize = () => {
				if (didFinish) return;
				didFinish = true;
				cleanup();

				if (nextRawWidth <= CLOSE_THRESHOLD) {
					setCollapsed(true);
					setInternalWidth(0);
					onWidthChange?.(0);
					return;
				}

				const clampedWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, nextWidth));
				setInternalWidth(clampedWidth);
				setLastOpenWidth(clampedWidth);
				onWidthChange?.(clampedWidth);
				setCollapsed(false);
			};

			function onPointerMove(moveEvent: PointerEvent) {
				const rawWidth = moveEvent.clientX - left;
				nextRawWidth = rawWidth;
				nextWidth = Math.max(0, Math.min(MAX_WIDTH, rawWidth));
				setInternalWidth(nextWidth);
			}

			function onPointerUp() {
				finishResize();
			}

			function onPointerCancel() {
				finishResize();
			}

			resizeCleanupRef.current = cleanup;
			document.addEventListener('pointermove', onPointerMove);
			document.addEventListener('pointerup', onPointerUp);
			document.addEventListener('pointercancel', onPointerCancel);
		},
		[isCollapsed, setCollapsed, internalWidth, onWidthChange],
	);

	const openWidth = isResizing
		? internalWidth
		: internalWidth < MIN_WIDTH
			? lastOpenWidth
			: internalWidth;

	return (
		<aside
			ref={rootRef}
			className={cn(
				'relative flex h-full shrink-0 flex-col bg-surface-1',
				isCollapsed ? 'overflow-visible border-r-0' : 'overflow-hidden border-r border-hairline',
				!isResizing && 'transition-[width] duration-150 ease-out',
				className,
			)}
			style={{ width: isCollapsed ? 0 : openWidth }}
			aria-label="Workspace sidebar"
		>
			{isCollapsed ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="absolute top-2 left-2 z-10 size-8 text-ink-subtle hover:bg-transparent hover:text-ink"
							aria-label="Open sidebar"
							onClick={() => setCollapsed(false)}
						>
							<SidebarSimple className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right">Open sidebar</TooltipContent>
				</Tooltip>
			) : (
				<>
					<div className="flex h-11 shrink-0 items-center justify-between px-2.5">
						<div className="flex min-w-0 items-center">
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="size-7 text-ink-subtle hover:bg-transparent hover:text-ink"
										aria-label="Close sidebar"
										onClick={toggleCollapsed}
									>
										<SidebarSimple className="size-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Close sidebar</TooltipContent>
							</Tooltip>
						</div>

						<div className="flex items-center gap-0.5">
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="size-7 text-ink-subtle hover:text-ink"
										aria-label="Filter workspaces"
										onClick={onFilterClick}
									>
										<SlidersHorizontal className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Filter</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="size-7 text-ink-subtle hover:text-ink"
										aria-label="Add directory"
										onClick={onAddDirectory}
									>
										<FolderSimplePlus className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Add directory</TooltipContent>
							</Tooltip>
						</div>
					</div>

					<Separator className="bg-hairline" />

					<div className="flex min-h-0 flex-1 flex-col px-2 py-2">
						<div className="mb-1 flex items-center justify-between px-2">
							<span className="text-[11px] font-medium leading-4 text-ink-subtle">Projects</span>
						</div>

						<ScrollArea className="min-h-0 flex-1">
							<div className="flex flex-col gap-2 pr-1">
								{directoryGroups.map((directory) => {
									const isExpanded = currentExpandedIds.includes(directory.directoryId);
									return (
										<DirectoryGroup
											key={directory.directoryId}
											directory={directory}
											isExpanded={isExpanded}
											activeWorkspaceId={activeWorkspaceId}
											onToggle={() => setExpanded(directory.directoryId, !isExpanded)}
											onWorkspaceSelect={onWorkspaceSelect}
											onCreateWorkspace={async () => {
												try {
													await onCreateWorkspace?.(directory.directoryId);
												} catch (error) {
													onCreateWorkspaceError?.(error);
												}
											}}
										/>
									);
								})}
							</div>
						</ScrollArea>
					</div>

					<Separator className="bg-hairline" />

					<div className="flex h-10 shrink-0 items-center justify-between px-3">
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className="size-7 text-ink-subtle hover:text-ink"
									aria-label="Archive"
									onClick={onOpenArchive}
								>
									<Archive className="size-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Archive</TooltipContent>
						</Tooltip>

						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className="size-7 text-ink-subtle hover:text-ink"
									aria-label="Settings"
									onClick={onOpenSettings}
								>
									<Gear className="size-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Settings</TooltipContent>
						</Tooltip>
					</div>

					{/* biome-ignore lint/a11y/useFocusableInteractive: Matches the source sidebar-v2 drag rail; keyboard collapse remains available through the close button. */}
					{/* biome-ignore lint/a11y/useSemanticElements: This is a pointer drag rail, not a document separator. */}
					<div
						role="separator"
						aria-orientation="vertical"
						aria-label="Resize sidebar"
						aria-valuemin={MIN_WIDTH}
						aria-valuemax={MAX_WIDTH}
						aria-valuenow={Math.round(openWidth)}
						className="absolute top-0 right-0 h-full w-1 cursor-col-resize touch-none bg-transparent hover:bg-primary/30"
						onPointerDown={onResizePointerDown}
					/>
				</>
			)}
		</aside>
	);
}
