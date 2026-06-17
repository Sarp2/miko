import {
	Archive,
	CaretDown,
	CaretRight,
	CaretUpDown,
	Check,
	ClockCounterClockwise,
	FolderSimplePlus,
	Gear,
	GitPullRequest,
	PencilSimple,
	Plus,
	PushPinSimple,
	PushPinSimpleSlash,
	SidebarSimple,
	SlidersHorizontal,
} from '@phosphor-icons/react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Popover from '@radix-ui/react-popover';
import * as Select from '@radix-ui/react-select';
import {
	type CSSProperties,
	type FormEvent,
	type ReactNode,
	useEffect,
	useId,
	useState,
} from 'react';
import type {
	SidebarDirectoryGroup,
	SidebarWorkspaceRow,
	WorkspaceSidebarIndicator,
} from '../../shared/types';
import { useSidebarExpansion } from '../hooks/use-sidebar-expansion';
import { MAX_WIDTH, MIN_WIDTH, useSidebarResize } from '../hooks/use-sidebar-resize';
import { Icons } from '../lib/icons';
import { formatRelativeTime } from '../lib/relative-time';
import { cn } from '../lib/utils';
import { validateBranchName } from '../lib/validate-branch-name';
import type { WorkspacePrimaryAction } from '../lib/workspace-condition';
import { deriveSidebarWorkspaceCondition } from '../lib/workspace-condition';
import {
	WORKSPACE_DIFF_ADDITION_CLASS,
	WORKSPACE_DIFF_DELETION_CLASS,
	WORKSPACE_MERGED_CLASS,
} from '../lib/workspace-visuals';
import type { SidebarSortField } from '../stores/ui-store';
import { useWorkspaceStore } from '../stores/workspace-store';
import { Button } from './ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from './ui/dialog';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { Input } from './ui/input';
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
import { WorkspaceActionButton } from './workspace-action-button';

export interface SidebarProps {
	directoryGroups: SidebarDirectoryGroup[];
	pinnedWorkspaces?: SidebarWorkspaceRow[];
	pinnedWorkspaceIds?: string[];
	activeWorkspaceId?: string;
	historyActive?: boolean;
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
	onWorkspacePinToggle?: (workspaceId: string) => void;
	onWorkspaceArchive?: (workspaceId: string) => void | Promise<void>;
	onCreateWorkspace?: (directoryId: string) => void;
	onCreateWorkspaceError?: (error: unknown) => void;
	onAddDirectory?: () => void;
	onOpenHistory?: () => void;
	onOpenSettings?: () => void;
	className?: string;
}

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
					'flex h-7 w-[94px] items-center justify-between rounded-md border border-hairline bg-canvas px-2.5 text-left text-[12px] leading-4 text-ink outline-none transition-colors',
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
					className="overflow-hidden rounded-md border border-hairline bg-surface-1 p-0.5 shadow-none"
				>
					<Select.Viewport>
						{SORT_OPTIONS.map((option) => (
							<Select.Item
								key={option.value}
								value={option.value}
								className="flex h-6 min-w-[92px] cursor-default select-none items-center justify-between rounded-sm px-2 text-[11px] leading-4 text-ink outline-none data-[highlighted]:bg-surface-2"
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
							<SlidersHorizontal className="size-4" />
						</Button>
					</Popover.Trigger>
				</TooltipTrigger>
				<TooltipContent>Filter</TooltipContent>
			</Tooltip>
			<Popover.Portal>
				<Popover.Content
					align="end"
					sideOffset={8}
					className="w-[194px] rounded-lg border border-hairline bg-surface-1 p-2 shadow-none outline-none"
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
	if (indicator === 'commit_and_push') return 'commit and push';
	if (indicator === 'create_pr') return 'create pr';
	if (indicator === 'pr_opened') return 'open pr';
	if (indicator === 'ci_failed') return 'ci failed';
	if (indicator === 'merge_conflicts') return 'merge conflicts';
	if (indicator === 'merged') return 'merged';
	if (indicator === 'closed') return 'closed';
	return 'idle';
}

function indicatorTextClass(indicator: WorkspaceSidebarIndicator) {
	if (indicator === 'agent_active' || indicator === 'workspace_creating') return 'text-primary';
	if (indicator === 'pr_opened' || indicator === 'create_pr' || indicator === 'commit_and_push') {
		return 'text-success/75';
	}
	if (
		indicator === 'ci_failed' ||
		indicator === 'merge_conflicts' ||
		indicator === 'workspace_failed' ||
		indicator === 'closed'
	) {
		return 'text-destructive';
	}
	if (indicator === 'merged') return WORKSPACE_MERGED_CLASS;
	return 'text-ink-tertiary';
}

function manualCreatePrUrl(workspace: SidebarWorkspaceRow) {
	const owner = encodeURIComponent(workspace.githubOwner);
	const repo = encodeURIComponent(workspace.githubRepo);
	const base = encodeURIComponent(workspace.defaultBranchName);
	const head = encodeURIComponent(workspace.branchName);
	return `https://github.com/${owner}/${repo}/compare/${base}...${head}?body=&expand=1`;
}

function manualCreatePrUrlForWorkspace(workspace: SidebarWorkspaceRow) {
	if (workspace.hasDirtyFiles || workspace.hasUnpushedCommits) return undefined;
	return manualCreatePrUrl(workspace);
}

function WorkspaceIndicatorIcon({
	indicator,
	className,
}: {
	indicator: WorkspaceSidebarIndicator;
	className?: string;
}) {
	if (indicator === 'agent_active' || indicator === 'workspace_creating') {
		return Icons.activeIcon({
			ariaLabel: indicatorLabel(indicator),
			className,
		});
	}

	const colorClassName = indicatorTextClass(indicator);
	const iconClassName = cn(colorClassName, className);

	if (indicator === 'merged') {
		return Icons.mergedIcon({ className: iconClassName });
	}

	if (indicator === 'pr_opened' || indicator === 'create_pr' || indicator === 'commit_and_push') {
		return Icons.prIcon({ className: iconClassName });
	}

	if (
		indicator === 'ci_failed' ||
		indicator === 'merge_conflicts' ||
		indicator === 'workspace_failed' ||
		indicator === 'closed'
	) {
		return Icons.errorIcon({ className: iconClassName });
	}

	return Icons.idleIcon({
		className: iconClassName,
	});
}

function workspaceTimeAt(workspace: SidebarWorkspaceRow) {
	return workspace.hasPullRequest
		? (workspace.prCreatedAt ?? workspace.lastActivityAt)
		: workspace.lastActivityAt;
}

function workspaceRowTitle(workspace: SidebarWorkspaceRow) {
	return workspace.hasPullRequest
		? (workspace.prTitle ?? workspace.displayName)
		: workspace.displayName;
}

function formatDiffStat(value: number) {
	if (value < 1000) return String(value);
	const compact = (value / 1000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, '');
	return `${compact}k`;
}

function WorkspaceDiffStats({ workspace }: { workspace: SidebarWorkspaceRow }) {
	const additions = workspace.displayDiffStats.additions;
	const deletions = workspace.displayDiffStats.deletions;
	if (additions <= 0 && deletions <= 0) return null;

	return (
		<span className="flex shrink-0 items-center justify-end gap-1 text-[11px] font-medium leading-4 tabular-nums">
			{additions > 0 && (
				<span className={WORKSPACE_DIFF_ADDITION_CLASS}>+{formatDiffStat(additions)}</span>
			)}
			{deletions > 0 && (
				<span className={WORKSPACE_DIFF_DELETION_CLASS}>-{formatDiffStat(deletions)}</span>
			)}
		</span>
	);
}

function WorkspaceContextMenuItem({
	children,
	disabled,
	onSelect,
}: {
	children: ReactNode;
	disabled?: boolean;
	onSelect?: () => void;
}) {
	return (
		<ContextMenu.Item
			disabled={disabled}
			onSelect={onSelect}
			className="flex h-8 cursor-default select-none items-center justify-between gap-6 rounded-md px-2 text-[13px] leading-5 text-ink outline-none data-[disabled]:text-ink-tertiary data-[highlighted]:bg-surface-2"
		>
			{children}
		</ContextMenu.Item>
	);
}

function WorkspaceRowContextMenu({
	isPinned,
	onPinToggle,
	onArchive,
	onRename,
}: {
	isPinned: boolean;
	onPinToggle?: () => void;
	onArchive?: () => void | Promise<void>;
	onRename?: () => void;
}) {
	return (
		<ContextMenu.Portal>
			<ContextMenu.Content className="z-50 min-w-[218px] rounded-lg border border-hairline bg-surface-1 p-1 shadow-lg outline-none">
				<WorkspaceContextMenuItem onSelect={onPinToggle}>
					<span className="flex items-center gap-3">
						{isPinned ? (
							<PushPinSimpleSlash className="size-4 text-ink-subtle" />
						) : (
							<PushPinSimple className="size-4 text-ink-subtle" />
						)}
						{isPinned ? 'Unpin' : 'Pin'}
					</span>
					<span className="font-mono text-[12px] text-ink-tertiary">P</span>
				</WorkspaceContextMenuItem>
				<WorkspaceContextMenuItem onSelect={onRename}>
					<span className="flex items-center gap-3">
						<PencilSimple className="size-4 text-ink-subtle" />
						Rename
					</span>
				</WorkspaceContextMenuItem>
				<ContextMenu.Separator className="my-1 h-px bg-hairline" />
				<WorkspaceContextMenuItem onSelect={onArchive}>
					<span className="flex items-center gap-3">
						<Archive className="size-4 text-ink-subtle" />
						Archive
					</span>
					<span className="font-mono text-[12px] text-ink-tertiary">⌘⇧A</span>
				</WorkspaceContextMenuItem>
			</ContextMenu.Content>
		</ContextMenu.Portal>
	);
}

async function runSidebarWorkspaceAction(args: {
	action: WorkspacePrimaryAction;
	workspace: SidebarWorkspaceRow;
	createPr: (workspaceId: string, sessionId: string) => Promise<unknown>;
	commitAndPush: (workspaceId: string, sessionId: string) => Promise<unknown>;
	fixCi: (workspaceId: string, sessionId: string) => Promise<unknown>;
	resolveMergeConflicts: (workspaceId: string, sessionId: string) => Promise<unknown>;
	mergePr: (workspaceId: string) => Promise<unknown>;
	onArchive?: () => void | Promise<void>;
}) {
	const {
		action,
		workspace,
		createPr,
		commitAndPush,
		fixCi,
		resolveMergeConflicts,
		mergePr,
		onArchive,
	} = args;

	if (action.kind === 'archive') {
		await onArchive?.();
		return;
	}

	if (action.kind === 'merge') {
		await mergePr(workspace.workspaceId);
		return;
	}

	if (
		action.kind !== 'create_pr' &&
		action.kind !== 'fix_ci' &&
		action.kind !== 'resolve_merge_conflicts' &&
		action.kind !== 'commit_and_push'
	) {
		return;
	}

	if (!workspace.lastSessionId) {
		console.warn(`Cannot run ${action.kind} without a workspace session id`);
		return;
	}

	if (action.kind === 'create_pr') {
		await createPr(workspace.workspaceId, workspace.lastSessionId);
		return;
	}

	if (action.kind === 'commit_and_push') {
		await commitAndPush(workspace.workspaceId, workspace.lastSessionId);
		return;
	}

	if (action.kind === 'resolve_merge_conflicts') {
		await resolveMergeConflicts(workspace.workspaceId, workspace.lastSessionId);
		return;
	}

	await fixCi(workspace.workspaceId, workspace.lastSessionId);
}

function WorkspaceHoverMeta({
	workspace,
	children,
	onArchive,
}: {
	workspace: SidebarWorkspaceRow;
	children: React.ReactElement;
	onArchive?: () => void | Promise<void>;
}) {
	const createPr = useWorkspaceStore((state) => state.createPr);
	const commitAndPush = useWorkspaceStore((state) => state.commitAndPush);
	const fixCi = useWorkspaceStore((state) => state.fixCi);
	const resolveMergeConflicts = useWorkspaceStore((state) => state.resolveMergeConflicts);
	const mergePr = useWorkspaceStore((state) => state.mergePr);
	const hasDetails =
		workspace.localPath || workspace.branchName || workspace.prNumber || workspace.lastActivityAt;
	if (!hasDetails) return children;

	const condition = deriveSidebarWorkspaceCondition(workspace);
	const hasDiffStats = condition.diffStats.additions > 0 || condition.diffStats.deletions > 0;
	const relativeTime = formatRelativeTime(workspaceTimeAt(workspace));
	const isPrStage = workspace.hasPullRequest;
	const titleText = isPrStage ? workspaceRowTitle(workspace) : workspace.lastSessionTitle;
	const bodyText = isPrStage ? null : workspace.lastAssistantPreview;
	const actionNeedsSession =
		condition.primaryAction?.kind === 'create_pr' ||
		condition.primaryAction?.kind === 'fix_ci' ||
		condition.primaryAction?.kind === 'resolve_merge_conflicts' ||
		condition.primaryAction?.kind === 'commit_and_push';
	const actionDisabled = actionNeedsSession && !workspace.lastSessionId;
	const manualCreateUrl =
		condition.primaryAction?.kind === 'create_pr'
			? manualCreatePrUrlForWorkspace(workspace)
			: undefined;

	return (
		<HoverCard openDelay={140} closeDelay={80}>
			<HoverCardTrigger asChild>{children}</HoverCardTrigger>
			<HoverCardContent
				side="right"
				align="start"
				sideOffset={6}
				className="w-[276px] rounded-md border-hairline bg-surface-1 p-0 shadow-none"
			>
				<div className="flex flex-col gap-2 px-3 py-2.5">
					<div className="flex items-start justify-between gap-1.5">
						<div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] leading-4 text-ink-muted">
							<span className="truncate">{workspace.branchName}</span>
							{hasDiffStats && (
								<span className="flex shrink-0 items-center gap-1 font-sans font-medium tabular-nums">
									{condition.diffStats.additions > 0 && (
										<span className="text-[#3ee87f]">
											+{formatDiffStat(condition.diffStats.additions)}
										</span>
									)}
									{condition.diffStats.deletions > 0 && (
										<span className="text-[#ff6b7a]">
											-{formatDiffStat(condition.diffStats.deletions)}
										</span>
									)}
								</span>
							)}
						</div>
						<WorkspaceIndicatorIcon indicator={workspace.indicator} className="size-3 shrink-0" />
					</div>

					{(titleText || bodyText) && (
						<div className="min-w-0 space-y-0.5">
							{titleText && (
								<p
									className="truncate text-[12.5px] font-semibold leading-5 text-ink"
									title={titleText}
								>
									{titleText}
								</p>
							)}
							{bodyText && (
								<p
									className="line-clamp-2 text-[11.5px] leading-4 text-ink-subtle"
									title={bodyText}
								>
									{bodyText}
								</p>
							)}
						</div>
					)}

					<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
						<div className="flex min-w-0 items-center gap-1.5">
							<WorkspaceActionButton
								action={condition.primaryAction}
								disabled={actionDisabled}
								manualCreatePrUrl={manualCreateUrl}
								onPrimaryAction={async (action) => {
									await runSidebarWorkspaceAction({
										action,
										workspace,
										createPr,
										commitAndPush,
										fixCi,
										resolveMergeConflicts,
										mergePr,
										onArchive,
									});
								}}
							/>
							{isPrStage && workspace.prNumber ? (
								workspace.prUrl ? (
									<a
										href={workspace.prUrl}
										target="_blank"
										rel="noreferrer"
										className="flex min-w-0 cursor-pointer items-center font-mono text-[11px] leading-4 text-ink-subtle tabular-nums transition-colors hover:text-ink"
									>
										<GitPullRequest className="mr-1 size-3" />
										<span>#{workspace.prNumber}</span>
										<span className="ml-1 text-[10px]">↗</span>
									</a>
								) : (
									<span className="flex min-w-0 items-center font-mono text-[11px] leading-4 text-ink-subtle tabular-nums">
										<GitPullRequest className="mr-1 size-3" />
										<span>#{workspace.prNumber}</span>
									</span>
								)
							) : null}
						</div>
						{relativeTime && (
							<span className="justify-self-end text-[11px] leading-4 text-ink-subtle tabular-nums">
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
	isPinned,
	onSelect,
	onPinToggle,
	onArchive,
	onRename,
}: {
	workspace: SidebarWorkspaceRow;
	isActive: boolean;
	isPinned: boolean;
	onSelect: () => void;
	onPinToggle?: () => void;
	onArchive?: () => void | Promise<void>;
	onRename?: () => void;
}) {
	const hasDiffStats =
		workspace.displayDiffStats.additions > 0 || workspace.displayDiffStats.deletions > 0;
	const titleClassName = workspace.hasUnreadAgentResult ? 'font-semibold text-ink' : 'font-normal';
	const hasHoverArchive = Boolean(onArchive);
	const title = workspaceRowTitle(workspace);

	return (
		<ContextMenu.Root>
			<div className="group relative">
				<WorkspaceHoverMeta workspace={workspace} onArchive={onArchive}>
					<ContextMenu.Trigger asChild>
						<button
							type="button"
							className={cn(
								'grid h-[30px] w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md px-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary',
								isActive
									? 'bg-surface-3 text-ink'
									: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
							)}
							onClick={onSelect}
						>
							<span className="grid min-w-0 grid-cols-[16px_minmax(0,1fr)] items-center gap-2">
								<WorkspaceIndicatorIcon
									indicator={workspace.indicator}
									className="justify-self-center"
								/>
								<span
									className={cn(
										'min-w-0 truncate text-[13px] leading-5 tracking-[0]',
										titleClassName,
									)}
								>
									{title}
								</span>
							</span>

							<span
								className={cn(
									'flex min-w-[56px] items-center justify-end gap-1.5',
									hasHoverArchive && 'group-hover:opacity-0',
								)}
							>
								{hasDiffStats ? <WorkspaceDiffStats workspace={workspace} /> : null}
							</span>
						</button>
					</ContextMenu.Trigger>
				</WorkspaceHoverMeta>

				{hasHoverArchive && (
					<span className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 items-center justify-end group-hover:flex">
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className="pointer-events-auto size-6 text-ink-subtle hover:bg-transparent hover:text-ink"
									aria-label="Archive workspace"
									onClick={(event) => {
										event.stopPropagation();
										void onArchive?.();
									}}
								>
									<Archive className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Archive</TooltipContent>
						</Tooltip>
					</span>
				)}
			</div>
			<WorkspaceRowContextMenu
				isPinned={isPinned}
				onPinToggle={onPinToggle}
				onArchive={onArchive}
				onRename={onRename}
			/>
		</ContextMenu.Root>
	);
}

function DirectoryGroup({
	directory,
	isExpanded,
	activeWorkspaceId,
	onToggle,
	onWorkspaceSelect,
	onWorkspacePinToggle,
	onWorkspaceArchive,
	onWorkspaceRename,
	onCreateWorkspace,
}: {
	directory: SidebarDirectoryGroup;
	isExpanded: boolean;
	activeWorkspaceId?: string;
	onToggle: () => void;
	onWorkspaceSelect?: (workspaceId: string) => void;
	onWorkspacePinToggle?: (workspaceId: string) => void;
	onWorkspaceArchive?: (workspaceId: string) => void | Promise<void>;
	onWorkspaceRename?: (workspace: SidebarWorkspaceRow) => void;
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
							isPinned={false}
							onSelect={() => {
								onWorkspaceSelect?.(workspace.workspaceId);
								if (isMobile) setOpenMobile(false);
							}}
							onPinToggle={() => onWorkspacePinToggle?.(workspace.workspaceId)}
							onArchive={
								onWorkspaceArchive ? () => onWorkspaceArchive(workspace.workspaceId) : undefined
							}
							onRename={() => onWorkspaceRename?.(workspace)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function PinnedWorkspaceSection({
	workspaces,
	pinnedWorkspaceIds,
	activeWorkspaceId,
	onWorkspaceSelect,
	onWorkspacePinToggle,
	onWorkspaceArchive,
	onWorkspaceRename,
}: {
	workspaces: SidebarWorkspaceRow[];
	pinnedWorkspaceIds: string[];
	activeWorkspaceId?: string;
	onWorkspaceSelect?: (workspaceId: string) => void;
	onWorkspacePinToggle?: (workspaceId: string) => void;
	onWorkspaceArchive?: (workspaceId: string) => void | Promise<void>;
	onWorkspaceRename?: (workspace: SidebarWorkspaceRow) => void;
}) {
	const { isMobile, setOpenMobile } = useSidebarPrimitive();
	if (workspaces.length === 0) return null;

	return (
		<div className="mb-3 flex flex-col gap-1">
			<div className="px-2 text-[11px] font-medium leading-4 text-ink-subtle">Pinned</div>
			<div className="flex flex-col gap-px">
				{workspaces.map((workspace) => (
					<WorkspaceRow
						key={workspace.workspaceId}
						workspace={workspace}
						isActive={workspace.workspaceId === activeWorkspaceId}
						isPinned={pinnedWorkspaceIds.includes(workspace.workspaceId)}
						onSelect={() => {
							onWorkspaceSelect?.(workspace.workspaceId);
							if (isMobile) setOpenMobile(false);
						}}
						onPinToggle={() => onWorkspacePinToggle?.(workspace.workspaceId)}
						onArchive={
							onWorkspaceArchive ? () => onWorkspaceArchive(workspace.workspaceId) : undefined
						}
						onRename={() => onWorkspaceRename?.(workspace)}
					/>
				))}
			</div>
		</div>
	);
}

function RenameWorkspaceBranchDialog({
	workspace,
	onOpenChange,
}: {
	workspace: SidebarWorkspaceRow | null;
	onOpenChange: (open: boolean) => void;
}) {
	const inputId = useId();
	const renameBranch = useWorkspaceStore((state) => state.renameBranch);
	const [draft, setDraft] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const open = Boolean(workspace);
	useEffect(() => {
		if (!workspace) return;
		setDraft(workspace.branchName);
		setError(null);
		setIsSubmitting(false);
	}, [workspace]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!workspace || isSubmitting) return;

		const validation = validateBranchName(draft);
		if (!validation.ok) {
			setError(validation.message);
			return;
		}

		if (validation.value === workspace.branchName) {
			onOpenChange(false);
			return;
		}

		setError(null);
		setIsSubmitting(true);
		try {
			await renameBranch(workspace.workspaceId, validation.value);
			onOpenChange(false);
		} catch (submitError) {
			setError(submitError instanceof Error ? submitError.message : 'Failed to rename branch');
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					setDraft('');
					setError(null);
					setIsSubmitting(false);
				}
				onOpenChange(nextOpen);
			}}
		>
			<DialogContent className="p-0">
				<form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
					<DialogHeader className="pr-8">
						<DialogTitle>Rename workspace</DialogTitle>
						<DialogDescription>
							Rename the workspace branch. The backend will keep the branch name safe.
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-2">
						<label htmlFor={inputId} className="text-[12px] font-medium leading-4 text-ink-muted">
							Branch name
						</label>
						<Input
							id={inputId}
							value={draft}
							onChange={(event) => {
								setDraft(event.target.value);
								setError(null);
							}}
							disabled={isSubmitting}
							aria-invalid={Boolean(error)}
							className="font-mono text-[12px]"
							autoFocus
						/>
						{error && <p className="text-[12px] leading-5 text-destructive">{error}</p>}
					</div>

					<DialogFooter>
						<Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" size="sm" disabled={!draft || isSubmitting}>
							{isSubmitting ? 'Renaming…' : 'Rename'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function Sidebar({
	directoryGroups,
	pinnedWorkspaces = [],
	pinnedWorkspaceIds = [],
	activeWorkspaceId,
	historyActive = false,
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
	onWorkspacePinToggle,
	onWorkspaceArchive,
	onCreateWorkspace,
	onCreateWorkspaceError,
	onAddDirectory,
	onOpenHistory,
	onOpenSettings,
	className,
}: SidebarProps) {
	const { currentExpandedIds, setExpanded } = useSidebarExpansion(
		directoryGroups,
		expandedDirectoryIds,
		onDirectoryExpandedChange,
	);
	const { rootRef, isCollapsed, isResizing, openWidth, setCollapsed, onResizePointerDown } =
		useSidebarResize({ collapsed, width, onCollapsedChange, onWidthChange });
	const [renameWorkspace, setRenameWorkspace] = useState<SidebarWorkspaceRow | null>(null);

	return (
		<>
			<RenameWorkspaceBranchDialog
				workspace={renameWorkspace}
				onOpenChange={(open) => {
					if (!open) setRenameWorkspace(null);
				}}
			/>
			<SidebarPrimitiveProvider
				open={!isCollapsed}
				onOpenChange={(open) => setCollapsed(!open)}
				className="contents"
				style={
					{
						'--sidebar-width': `${openWidth}px`,
						'--sidebar-width-icon': '0px',
					} as CSSProperties
				}
			>
				<div className="contents">
					<div className={cn('fixed top-1.5 left-2 z-30 md:hidden', isCollapsed && 'md:block')}>
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
							<SidebarPrimitiveHeader className="flex h-10 shrink-0 flex-row items-center justify-between gap-0 p-0 px-2.5">
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
												<FolderSimplePlus className="size-4" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Add directory</TooltipContent>
									</Tooltip>
								</div>
							</SidebarPrimitiveHeader>

							<div className="px-2 pt-0 pb-1.5">
								<button
									type="button"
									className={cn(
										'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium leading-5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
										historyActive
											? 'bg-surface-3 text-ink'
											: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
									)}
									onClick={onOpenHistory}
								>
									<ClockCounterClockwise className="size-4 shrink-0 text-ink-subtle" />
									<span className="truncate">History</span>
								</button>
							</div>

							<SidebarPrimitiveSeparator className="mx-0 bg-hairline" />

							<SidebarPrimitiveContent className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden p-2">
								<PinnedWorkspaceSection
									workspaces={pinnedWorkspaces}
									pinnedWorkspaceIds={pinnedWorkspaceIds}
									activeWorkspaceId={activeWorkspaceId}
									onWorkspaceSelect={onWorkspaceSelect}
									onWorkspacePinToggle={onWorkspacePinToggle}
									onWorkspaceArchive={onWorkspaceArchive}
									onWorkspaceRename={setRenameWorkspace}
								/>

								<div className="mb-1 flex items-center justify-between px-2">
									<span className="text-[11px] font-medium leading-4 text-ink-subtle">
										Projects
									</span>
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
													onWorkspacePinToggle={onWorkspacePinToggle}
													onWorkspaceArchive={onWorkspaceArchive}
													onWorkspaceRename={setRenameWorkspace}
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

							<SidebarPrimitiveFooter className="flex h-10 shrink-0 flex-row items-center justify-end gap-0 p-0 px-3">
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
		</>
	);
}
