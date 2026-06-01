import {
	Archive,
	CaretDown,
	CaretRight,
	CaretUpDown,
	Check,
	FolderSimplePlus,
	Gear,
	GitMerge,
	GitPullRequest,
	Plus,
	SidebarSimple,
	SlidersHorizontal,
} from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import * as Select from '@radix-ui/react-select';
import * as React from 'react';
import type {
	SidebarDirectoryGroup,
	SidebarWorkspaceRow,
	WorkspaceSidebarIndicator,
} from '../../shared/types';
import { cn } from '../lib/utils';
import type { SidebarSortField } from '../stores/ui-store';
import { Button } from './ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { ScrollArea } from './ui/scroll-area';
import {
	Sidebar as SidebarPrimitive,
	SidebarContent as SidebarPrimitiveContent,
	SidebarFooter as SidebarPrimitiveFooter,
	SidebarHeader as SidebarPrimitiveHeader,
	SidebarProvider as SidebarPrimitiveProvider,
	SidebarSeparator as SidebarPrimitiveSeparator,
	SidebarTrigger as SidebarPrimitiveTrigger,
	useSidebar as useSidebarPrimitive,
} from './ui/sidebar';
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
	directorySort?: SidebarSortField;
	workspaceSort?: SidebarSortField;
	onDirectorySortChange?: (sort: SidebarSortField) => void;
	onWorkspaceSortChange?: (sort: SidebarSortField) => void;
	onWorkspaceSelect?: (workspaceId: string) => void;
	onCreateWorkspace?: (directoryId: string) => void;
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

const SORT_OPTIONS: Array<{ value: SidebarSortField; label: string }> = [
	{ value: 'updated', label: 'Updated' },
	{ value: 'created', label: 'Created' },
];

function SidebarSortSelect({
	value,
	onValueChange,
}: {
	value: SidebarSortField;
	onValueChange?: (value: SidebarSortField) => void;
}) {
	return (
		<Select.Root value={value} onValueChange={(next) => onValueChange?.(next as SidebarSortField)}>
			<Select.Trigger
				className={cn(
					'flex h-7 w-[94px] items-center justify-between rounded-[8px] border border-hairline bg-canvas px-2.5 text-left text-[12px] leading-4 text-ink outline-none transition-colors',
					'hover:border-hairline-strong focus-visible:ring-1 focus-visible:ring-primary',
				)}
			>
				<Select.Value />
				<Select.Icon asChild>
					<CaretUpDown className="size-3 text-ink-subtle" />
				</Select.Icon>
			</Select.Trigger>
			<Select.Portal>
				<Select.Content
					position="popper"
					sideOffset={4}
					className="overflow-hidden rounded-[8px] border border-hairline bg-surface-1 p-0.5 shadow-none"
				>
					<Select.Viewport>
						{SORT_OPTIONS.map((option) => (
							<Select.Item
								key={option.value}
								value={option.value}
								className="flex h-6 min-w-[92px] cursor-default select-none items-center justify-between rounded-[6px] px-2 text-[11px] leading-4 text-ink outline-none data-[highlighted]:bg-surface-2"
							>
								<Select.ItemText>{option.label}</Select.ItemText>
								<Select.ItemIndicator>
									<Check className="size-3 text-ink-muted" />
								</Select.ItemIndicator>
							</Select.Item>
						))}
					</Select.Viewport>
				</Select.Content>
			</Select.Portal>
		</Select.Root>
	);
}

function SidebarFilterPopover({
	directorySort,
	workspaceSort,
	onDirectorySortChange,
	onWorkspaceSortChange,
}: {
	directorySort: SidebarSortField;
	workspaceSort: SidebarSortField;
	onDirectorySortChange?: (sort: SidebarSortField) => void;
	onWorkspaceSortChange?: (sort: SidebarSortField) => void;
}) {
	return (
		<Popover.Root>
			<Tooltip>
				<TooltipTrigger asChild>
					<Popover.Trigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="size-7 text-ink-subtle hover:text-ink"
							aria-label="Filter workspaces"
						>
							<SlidersHorizontal className="size-3" />
						</Button>
					</Popover.Trigger>
				</TooltipTrigger>
				<TooltipContent>Filter</TooltipContent>
			</Tooltip>
			<Popover.Portal>
				<Popover.Content
					align="end"
					sideOffset={8}
					className="w-[194px] rounded-[10px] border border-hairline bg-surface-1 p-2 shadow-none outline-none"
				>
					<div className="flex flex-col gap-px">
						<div className="flex items-center justify-between gap-2">
							<span className="text-[11px] leading-4 text-ink-muted">Directories</span>
							<SidebarSortSelect value={directorySort} onValueChange={onDirectorySortChange} />
						</div>
						<div className="flex items-center justify-between gap-2">
							<span className="text-[11px] leading-4 text-ink-muted">Workspaces</span>
							<SidebarSortSelect value={workspaceSort} onValueChange={onWorkspaceSortChange} />
						</div>
					</div>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}

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

function formatRelativeTime(timestamp: number | undefined) {
	if (!timestamp) return '';
	const diffMs = Math.max(0, Date.now() - timestamp);
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;

	if (diffMs < minute) return 'now';
	if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
	if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
	return `${Math.floor(diffMs / day)}d ago`;
}

function workspaceTimeAt(workspace: SidebarWorkspaceRow) {
	return workspace.reviewState === 'in_progress'
		? workspace.lastActivityAt
		: (workspace.prCreatedAt ?? workspace.lastActivityAt);
}

function workspaceSubtitle(workspace: SidebarWorkspaceRow) {
	if (workspace.prNumber) return `Created PR #${workspace.prNumber}`;
	if (workspace.indicator === 'commit_and_push') return 'Local changes are ready to commit.';
	if (workspace.indicator === 'create_pr') return 'Branch has pushed commits.';
	if (workspace.indicator === 'agent_active') return 'Agent is working in this workspace.';
	return workspace.localPath;
}

function workspaceActionLabel(workspace: SidebarWorkspaceRow) {
	if (workspace.reviewState === 'done' || workspace.reviewState === 'closed') return 'Archive';
	if (workspace.indicator === 'ci_failed') return 'Fix CI';
	if (workspace.reviewState === 'in_review') return 'Merge';
	if (workspace.indicator === 'create_pr') return 'Create PR';
	if (workspace.indicator === 'commit_and_push') return 'Commit';
	return null;
}

function WorkspaceActionPill({ workspace }: { workspace: SidebarWorkspaceRow }) {
	const label = workspaceActionLabel(workspace);
	if (!label) return null;

	const isArchive = label === 'Archive';
	const isMerge = label === 'Merge';
	const isCreatePr = label === 'Create PR';
	const isFix = label === 'Fix CI';

	return (
		<span
			className={cn(
				'inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium leading-4',
				isArchive && 'border-transparent bg-primary text-primary-foreground',
				isMerge && 'border-transparent bg-success text-white',
				isCreatePr && 'border-hairline bg-surface-2 text-ink',
				isFix && 'border-transparent bg-destructive text-white',
				!isArchive && !isMerge && !isCreatePr && !isFix && 'border-hairline bg-surface-2 text-ink',
			)}
		>
			{isArchive ? (
				<Archive className="size-3" />
			) : isMerge ? (
				<GitMerge className="size-3" />
			) : isCreatePr ? (
				<GitPullRequest className="size-3" />
			) : null}
			{label}
		</span>
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

	const hasDiffStats = workspace.diffStats.additions > 0 || workspace.diffStats.deletions > 0;
	const relativeTime = formatRelativeTime(workspaceTimeAt(workspace));
	const subtitle = workspaceSubtitle(workspace);

	return (
		<HoverCard openDelay={140} closeDelay={80}>
			<HoverCardTrigger asChild>{children}</HoverCardTrigger>
			<HoverCardContent
				side="right"
				align="start"
				sideOffset={8}
				className="w-[286px] rounded-lg border-hairline bg-surface-1 p-0 shadow-none"
			>
				<div className="flex flex-col gap-2 px-3 py-2.5">
					<div className="flex items-start justify-between gap-2">
						<div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] leading-4 text-ink-muted">
							<span className="truncate">{workspace.branchName}</span>
							{hasDiffStats && (
								<span className="flex shrink-0 items-center gap-1 tabular-nums">
									<span className="text-success">+{workspace.diffStats.additions}</span>
									<span className="text-destructive">-{workspace.diffStats.deletions}</span>
								</span>
							)}
						</div>
						<WorkspaceIndicatorIcon indicator={workspace.indicator} className="size-3.5 shrink-0" />
					</div>

					<div className="min-w-0">
						<p
							className="truncate text-[12px] font-medium leading-4 text-ink"
							title={workspace.displayName}
						>
							{workspace.displayName}
						</p>
						<p className="mt-0.5 truncate text-[11px] leading-4 text-ink-subtle" title={subtitle}>
							{subtitle}
						</p>
					</div>

					<div className="flex min-w-0 items-center justify-between gap-1.5">
						<div className="flex min-w-0 items-center gap-1.5">
							<WorkspaceActionPill workspace={workspace} />
							{workspace.prNumber && (
								<span className="flex min-w-0 items-center gap-1 font-mono text-[11px] leading-4 text-ink-subtle">
									<GitPullRequest className="size-3" />#{workspace.prNumber}
								</span>
							)}
						</div>
						{relativeTime && (
							<span className="shrink-0 text-[11px] leading-4 text-ink-subtle tabular-nums">
								{relativeTime}
							</span>
						)}
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
	const { isMobile, setOpenMobile } = useSidebarPrimitive();

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

				<div className="flex size-5 items-center justify-center overflow-hidden rounded-md bg-surface-4 text-[11px] font-medium leading-none text-ink">
					{directory.avatarUrl ? (
						<img
							src={directory.avatarUrl}
							alt=""
							className="size-full object-cover"
							loading="lazy"
						/>
					) : (
						avatar || 'D'
					)}
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
							<Plus className="size-3" />
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
							onSelect={() => {
								onWorkspaceSelect?.(workspace.workspaceId);
								if (isMobile) setOpenMobile(false);
							}}
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
	directorySort = 'updated',
	workspaceSort = 'updated',
	onDirectorySortChange,
	onWorkspaceSortChange,
	onWorkspaceSelect,
	onCreateWorkspace,
	onCreateWorkspaceError,
	onAddDirectory,
	onOpenArchive,
	onOpenSettings,
	className,
}: SidebarProps) {
	const rootRef = React.useRef<HTMLDivElement | null>(null);
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
		<SidebarPrimitiveProvider
			open={!isCollapsed}
			onOpenChange={(open) => setCollapsed(!open)}
			className="contents"
			style={
				{
					'--sidebar-width': `${openWidth}px`,
					'--sidebar-width-icon': '0px',
				} as React.CSSProperties
			}
		>
			<div className="contents">
				<div className={cn('fixed top-2 left-2 z-30 md:hidden', isCollapsed && 'md:block')}>
					<Tooltip>
						<TooltipTrigger asChild>
							<SidebarPrimitiveTrigger
								type="button"
								variant="ghost"
								size="icon-sm"
								className="size-8 text-ink-subtle hover:bg-transparent hover:text-ink"
								aria-label="Open sidebar"
							>
								<SidebarSimple className="size-4" />
							</SidebarPrimitiveTrigger>
						</TooltipTrigger>
						<TooltipContent side="right">Open sidebar</TooltipContent>
					</Tooltip>
				</div>

				<SidebarPrimitive
					ref={rootRef}
					side="left"
					collapsible="offcanvas"
					position="inline"
					className={cn(
						'bg-surface-1 p-0 text-ink',
						!isResizing && 'transition-[width] duration-150 ease-out',
						className,
					)}
					aria-label="Workspace sidebar"
				>
					<div className="relative flex size-full flex-col bg-surface-1">
						<SidebarPrimitiveHeader className="flex h-11 shrink-0 flex-row items-center justify-between gap-0 p-0 px-2.5">
							<div className="flex min-w-0 items-center">
								<Tooltip>
									<TooltipTrigger asChild>
										<SidebarPrimitiveTrigger
											type="button"
											variant="ghost"
											size="icon-sm"
											className="size-7 text-ink-subtle hover:bg-transparent hover:text-ink"
											aria-label="Close sidebar"
										>
											<SidebarSimple className="size-4" />
										</SidebarPrimitiveTrigger>
									</TooltipTrigger>
									<TooltipContent>Close sidebar</TooltipContent>
								</Tooltip>
							</div>

							<div className="flex items-center gap-0.5">
								<SidebarFilterPopover
									directorySort={directorySort}
									workspaceSort={workspaceSort}
									onDirectorySortChange={onDirectorySortChange}
									onWorkspaceSortChange={onWorkspaceSortChange}
								/>
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
											<FolderSimplePlus className="size-3" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Add directory</TooltipContent>
								</Tooltip>
							</div>
						</SidebarPrimitiveHeader>

						<SidebarPrimitiveSeparator className="mx-0 bg-hairline" />

						<SidebarPrimitiveContent className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden px-2 py-2">
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
						</SidebarPrimitiveContent>

						<SidebarPrimitiveSeparator className="mx-0 bg-hairline" />

						<SidebarPrimitiveFooter className="flex h-10 shrink-0 flex-row items-center justify-between gap-0 p-0 px-3">
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
						</SidebarPrimitiveFooter>

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
					</div>
				</SidebarPrimitive>
			</div>
		</SidebarPrimitiveProvider>
	);
}
