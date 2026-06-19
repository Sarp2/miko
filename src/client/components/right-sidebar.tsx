import { Eye, TreeStructure } from '@phosphor-icons/react';
import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { WorkspaceSnapshot } from '../../shared/types';
import { MAX_WIDTH, MIN_WIDTH, useSidebarResize } from '../hooks/use-sidebar-resize';
import { useWorkspacePageOpeners } from '../hooks/use-workspace-page-openers';
import { rightSidebarStageLabel } from '../lib/right-sidebar-stage';
import { cn } from '../lib/utils';
import {
	deriveWorkspaceCondition,
	type WorkspaceCondition,
	type WorkspacePrimaryAction,
} from '../lib/workspace-condition';
import { selectWorkspaceChangeFiles } from '../lib/workspace-diff-files';
import { type RightSidebarTab, useUiStore } from '../stores/ui-store';
import { useWorkspaceStore } from '../stores/workspace-store';
import { RightSidebarAllFiles } from './right-sidebar-all-files';
import { RightSidebarChanges } from './right-sidebar-changes';
import { RightSidebarChecks } from './right-sidebar-checks';
import { RightSidebarTerminalPanel } from './right-sidebar-terminal-panel';
import {
	Sidebar as SidebarPrimitive,
	SidebarContent as SidebarPrimitiveContent,
	SidebarHeader as SidebarPrimitiveHeader,
	SidebarProvider as SidebarPrimitiveProvider,
} from './ui/sidebar';
import { WorkspaceActionButton } from './workspace-action-button';
import { WorkspaceStageBadge } from './workspace-stage-badge';

interface RightSidebarProps {
	workspaceId: string;
}

const RIGHT_SIDEBAR_TABS: Array<{ value: RightSidebarTab; label: string }> = [
	{ value: 'all_files', label: 'All files' },
	{ value: 'changes', label: 'Changes' },
	{ value: 'checks', label: 'Checks' },
];

function formatCount(count: number | undefined) {
	return count && count > 0 ? ` ${count}` : count === 0 ? ' 0' : '';
}

function allFilesRevisionKey(snapshot: WorkspaceSnapshot | null) {
	if (!snapshot?.git) return undefined;
	return [
		snapshot.git.branchName ?? snapshot.workspace.branchName,
		snapshot.git.files.map((file) => `${file.path}:${file.changeType}`).join('|'),
		snapshot.git.pullRequestFiles?.map((file) => `${file.path}:${file.changeType}`).join('|') ?? '',
		snapshot.github?.files?.map((file) => `${file.path}:${file.changeType}`).join('|') ?? '',
		snapshot.workspace.pullRequest?.files
			?.map((file) => `${file.path}:${file.changeType}`)
			.join('|') ?? '',
	].join('\n');
}

function selectActionSessionId(snapshot: WorkspaceSnapshot) {
	return (
		snapshot.sessions.toSorted((a, b) => {
			const left = a.lastMessageAt ?? a.updatedAt ?? a.createdAt;
			const right = b.lastMessageAt ?? b.updatedAt ?? b.createdAt;
			return right - left;
		})[0]?.id ?? null
	);
}

function manualCreatePrUrl(snapshot: WorkspaceSnapshot) {
	const git = snapshot.git;
	if (!git?.originRepoSlug || !git.defaultBranchName || !git.branchName) return undefined;
	if (git.files.length > 0 || (git.aheadCount ?? 0) > 0 || !git.hasPushedCommits) return undefined;
	const [owner, repo] = git.originRepoSlug.split('/');
	if (!owner || !repo) return undefined;
	return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(git.defaultBranchName)}...${encodeURIComponent(git.branchName)}?body=&expand=1`;
}

function RightSidebarPlaceholder({ tab }: { tab: Exclude<RightSidebarTab, 'all_files'> }) {
	const copy =
		tab === 'changes'
			? { title: 'No file changes yet', body: 'Changed files will appear here.' }
			: { title: 'Checks', body: 'PR checks, comments, and todos will appear here.' };

	return (
		<div className="flex h-full items-center justify-center px-8 text-center">
			<div className="flex max-w-[220px] flex-col items-center gap-2 text-ink-tertiary">
				<TreeStructure className="size-8 text-ink-tertiary" />
				<div className="text-[13px] font-medium leading-5 text-ink-muted">{copy.title}</div>
				<div className="text-[12px] leading-5 text-ink-tertiary">{copy.body}</div>
			</div>
		</div>
	);
}

function RightSidebarHeader({
	action,
	condition,
	disabled,
	manualCreatePrUrl,
	onPrimaryAction,
	snapshot,
}: {
	action: WorkspacePrimaryAction | null;
	condition: WorkspaceCondition | null;
	disabled?: boolean;
	manualCreatePrUrl?: string;
	onPrimaryAction: (action: WorkspacePrimaryAction) => void | Promise<void>;
	snapshot: WorkspaceSnapshot | null;
}) {
	const label = condition && snapshot ? rightSidebarStageLabel(condition, snapshot) : null;

	return (
		<>
			{snapshot ? <WorkspaceStageBadge snapshot={snapshot} /> : null}
			{label ? (
				<div className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-ink-muted">
					{label}
				</div>
			) : (
				<div className="min-w-0 flex-1" />
			)}
			<WorkspaceActionButton
				action={action}
				disabled={disabled}
				manualCreatePrUrl={manualCreatePrUrl}
				onPrimaryAction={onPrimaryAction}
			/>
		</>
	);
}

export function RightSidebar({ workspaceId }: RightSidebarProps) {
	const snapshot = useWorkspaceStore((state) => state.getWorkspaceSnapshot(workspaceId));
	const tab = useUiStore((state) => state.getRightSidebarTab(workspaceId));
	const collapsed = useUiStore((state) => state.getRightSidebarCollapsed(workspaceId));
	const width = useUiStore((state) => state.getRightSidebarWidth(workspaceId));
	const setTab = useUiStore((state) => state.setRightSidebarTab);
	const setCollapsed = useUiStore((state) => state.setRightSidebarCollapsed);
	const setWidth = useUiStore((state) => state.setRightSidebarWidth);
	const { openWorkspaceDiff, openWorkspaceFile } = useWorkspacePageOpeners(
		workspaceId,
		undefined,
		snapshot?.workspace.localPath,
	);
	const { rootRef, isCollapsed, isResizing, openWidth, onResizePointerDown } = useSidebarResize({
		collapsed,
		width,
		onCollapsedChange: (next) => setCollapsed(workspaceId, next),
		onWidthChange: (next) => setWidth(workspaceId, next),
		side: 'right',
	});
	const changeFiles = useMemo(() => selectWorkspaceChangeFiles(snapshot), [snapshot]);
	const discardableChangePaths = useMemo(
		() => new Set(snapshot?.git?.files.map((file) => file.path) ?? []),
		[snapshot],
	);
	const changeCount = changeFiles.length;
	const fileListRevisionKey = useMemo(() => allFilesRevisionKey(snapshot), [snapshot]);

	const condition = useMemo(
		() => (snapshot ? deriveWorkspaceCondition(snapshot) : null),
		[snapshot],
	);
	const actionSessionId = useMemo(
		() => (snapshot ? selectActionSessionId(snapshot) : null),
		[snapshot],
	);
	const manualCreateUrl = useMemo(
		() => (snapshot ? manualCreatePrUrl(snapshot) : undefined),
		[snapshot],
	);
	const createPr = useWorkspaceStore((state) => state.createPr);
	const commitAndPush = useWorkspaceStore((state) => state.commitAndPush);
	const fixCi = useWorkspaceStore((state) => state.fixCi);
	const resolveMergeConflicts = useWorkspaceStore((state) => state.resolveMergeConflicts);
	const markPrReady = useWorkspaceStore((state) => state.markPrReady);
	const archiveWorkspace = useWorkspaceStore((state) => state.archiveWorkspace);
	const mergePr = useWorkspaceStore((state) => state.mergePr);
	const reviewChanges = useWorkspaceStore((state) => state.reviewChanges);
	const navigate = useNavigate();
	const [reviewing, setReviewing] = useState(false);

	async function startReview() {
		if (reviewing) return;
		setReviewing(true);
		try {
			const { sessionId } = await reviewChanges(workspaceId);
			navigate(
				`/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`,
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not start review');
		} finally {
			setReviewing(false);
		}
	}

	async function runSidebarHeaderAction(action: WorkspacePrimaryAction) {
		if (action.kind === 'active') return;
		if (action.kind === 'merge') {
			await mergePr(workspaceId);
			return;
		}
		if (action.kind === 'mark_pr_ready') {
			await markPrReady(workspaceId);
			return;
		}
		if (action.kind === 'archive') {
			await archiveWorkspace(workspaceId);
			return;
		}
		if (!actionSessionId) return;
		if (action.kind === 'create_pr') await createPr(workspaceId, actionSessionId);
		else if (action.kind === 'commit_and_push') await commitAndPush(workspaceId, actionSessionId);
		else if (action.kind === 'fix_ci') await fixCi(workspaceId, actionSessionId);
		else if (action.kind === 'resolve_merge_conflicts') {
			await resolveMergeConflicts(workspaceId, actionSessionId);
		}
	}

	if (isCollapsed) return null;

	return (
		<SidebarPrimitiveProvider
			open={!isCollapsed}
			onOpenChange={(open) => setCollapsed(workspaceId, !open)}
			className="contents"
			style={
				{
					'--sidebar-width': `${openWidth}px`,
					'--sidebar-width-icon': '0px',
				} as CSSProperties
			}
		>
			<SidebarPrimitive
				ref={rootRef}
				data-testid="right-sidebar"
				side="right"
				collapsible="none"
				position="inline"
				className={cn(
					'border-l border-hairline bg-surface-1 p-0 text-ink',
					!isResizing && 'transition-[width] duration-150 ease-out',
				)}
				aria-label="Workspace detail sidebar"
			>
				<div className="relative flex size-full flex-col bg-surface-1">
					<SidebarPrimitiveHeader className="flex h-11 shrink-0 flex-row items-center gap-2 border-b border-hairline bg-surface-1 p-0 px-3">
						<RightSidebarHeader
							action={condition?.primaryAction ?? null}
							condition={condition}
							disabled={
								!actionSessionId &&
								(condition?.primaryAction?.kind === 'create_pr' ||
									condition?.primaryAction?.kind === 'commit_and_push' ||
									condition?.primaryAction?.kind === 'fix_ci' ||
									condition?.primaryAction?.kind === 'resolve_merge_conflicts')
							}
							manualCreatePrUrl={manualCreateUrl}
							onPrimaryAction={runSidebarHeaderAction}
							snapshot={snapshot}
						/>
					</SidebarPrimitiveHeader>

					<div className="flex h-10 shrink-0 items-center px-3">
						<div className="flex min-w-0 items-center gap-2">
							{RIGHT_SIDEBAR_TABS.map((item) => {
								const count = item.value === 'changes' ? formatCount(changeCount) : '';
								const active = tab === item.value;
								return (
									<button
										key={item.value}
										type="button"
										className={cn(
											'h-7 max-w-[76px] truncate whitespace-nowrap rounded-md px-2.5 text-[11px] font-medium leading-4 transition-colors',
											active
												? 'bg-surface-2 text-ink'
												: 'text-ink-subtle hover:bg-surface-2 hover:text-ink',
										)}
										onClick={() => setTab(workspaceId, item.value)}
									>
										{item.label}
										{count ? <span className="text-ink-subtle">{count}</span> : null}
									</button>
								);
							})}
							<button
								type="button"
								className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium leading-4 text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
								aria-label="Start a code review in a new session"
								disabled={reviewing}
								onClick={() => void startReview()}
							>
								<Eye className="size-3.5 shrink-0" />
								<span>{reviewing ? 'Starting...' : 'Review'}</span>
							</button>
						</div>
					</div>

					<SidebarPrimitiveContent className="scrollbar-miko min-h-0 flex-1 overflow-y-auto p-0">
						{tab === 'all_files' ? (
							<RightSidebarAllFiles
								workspaceId={workspaceId}
								onOpenFile={openWorkspaceFile}
								revisionKey={fileListRevisionKey}
							/>
						) : tab === 'changes' && snapshot ? (
							<RightSidebarChanges
								discardablePaths={discardableChangePaths}
								files={changeFiles}
								onOpenDiff={openWorkspaceDiff}
								workspaceId={workspaceId}
								workspaceRoot={snapshot.workspace.localPath}
							/>
						) : tab === 'checks' && snapshot ? (
							<RightSidebarChecks
								workspaceId={workspaceId}
								snapshot={snapshot}
								actionSessionId={actionSessionId}
							/>
						) : (
							<RightSidebarPlaceholder tab={tab} />
						)}
					</SidebarPrimitiveContent>

					<RightSidebarTerminalPanel workspaceId={workspaceId} />

					{/* biome-ignore lint/a11y/useFocusableInteractive: Pointer drag rail; keyboard collapse is available from the workspace header toggle. */}
					{/* biome-ignore lint/a11y/useSemanticElements: This is a pointer drag rail, not a document separator. */}
					<div
						role="separator"
						aria-orientation="vertical"
						aria-label="Resize right sidebar"
						aria-valuemin={MIN_WIDTH}
						aria-valuemax={MAX_WIDTH}
						aria-valuenow={Math.round(openWidth)}
						className="absolute top-0 left-0 h-full w-1 cursor-col-resize touch-none bg-transparent hover:bg-primary/30"
						onPointerDown={onResizePointerDown}
					/>
				</div>
			</SidebarPrimitive>
		</SidebarPrimitiveProvider>
	);
}
