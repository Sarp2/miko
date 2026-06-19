import { SidebarSimple } from '@phosphor-icons/react';
import { useMemo } from 'react';
import type { WorkspaceSnapshot } from '../../../shared/types';
import { cn } from '../../lib/utils';
import {
	deriveWorkspaceCondition,
	type WorkspacePrimaryAction,
} from '../../lib/workspace-condition';
import { deriveHeaderIdentity } from '../../lib/workspace-header-view-model';
import { useSidebarStore } from '../../stores/sidebar-store';
import { useUiStore } from '../../stores/ui-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '../ui/breadcrumb';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { WorkspaceActionButton } from '../workspace-action-button';
import { WorkspaceStageBadge } from '../workspace-stage-badge';
import { BranchNameEditor } from './branch-name-editor';
import { ExternalOpenMenu } from './external-open-menu';

interface WorkspaceHeaderProps {
	workspaceId: string;
	snapshot: WorkspaceSnapshot;
}

function basename(path: string) {
	return path.split('/').filter(Boolean).at(-1) ?? path;
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
	if ((snapshot.git?.files.length ?? 0) > 0 || git.hasPushedCommits) return undefined;
	const [owner, repo] = git.originRepoSlug.split('/');
	if (!owner || !repo) return undefined;
	return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(git.defaultBranchName)}...${encodeURIComponent(git.branchName)}?body=&expand=1`;
}

export function WorkspaceHeader({ workspaceId, snapshot }: WorkspaceHeaderProps) {
	const leftSidebarCollapsed = useUiStore((state) => state.leftSidebarCollapsed);
	const rightSidebarCollapsed = useUiStore((state) => state.getRightSidebarCollapsed(workspaceId));
	const setRightSidebarCollapsed = useUiStore((state) => state.setRightSidebarCollapsed);
	const directoryGroup = useSidebarStore((state) =>
		state.snapshot?.directoryGroups.find(
			(group) => group.directoryId === snapshot.workspace.directoryId,
		),
	);
	const renameBranch = useWorkspaceStore((state) => state.renameBranch);
	const createPr = useWorkspaceStore((state) => state.createPr);
	const commitAndPush = useWorkspaceStore((state) => state.commitAndPush);
	const fixCi = useWorkspaceStore((state) => state.fixCi);
	const resolveMergeConflicts = useWorkspaceStore((state) => state.resolveMergeConflicts);
	const markPrReady = useWorkspaceStore((state) => state.markPrReady);
	const mergePr = useWorkspaceStore((state) => state.mergePr);

	const identity = useMemo(() => deriveHeaderIdentity(snapshot), [snapshot]);
	const condition = useMemo(() => deriveWorkspaceCondition(snapshot), [snapshot]);
	const actionSessionId = useMemo(() => selectActionSessionId(snapshot), [snapshot]);
	const manualCreateUrl = useMemo(() => manualCreatePrUrl(snapshot), [snapshot]);

	const repoTitle =
		directoryGroup?.title ??
		snapshot.workspace.localPath.split('/').filter(Boolean).at(-1) ??
		'Repository';

	const repoInitial = repoTitle.slice(0, 1).toUpperCase() || 'R';
	const worktreeFolderName = basename(snapshot.workspace.localPath);

	async function runHeaderAction(action: WorkspacePrimaryAction) {
		if (action.kind === 'active') return;
		if (action.kind === 'merge') {
			await mergePr(workspaceId);
			return;
		}
		if (action.kind === 'mark_pr_ready') {
			await markPrReady(workspaceId);
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

	return (
		<header
			data-testid="workspace-header"
			className={cn(
				'flex h-11 shrink-0 items-center gap-2 border-b border-hairline bg-surface-1 pr-3.5',
				// Reserve room for the floating open-sidebar trigger when collapsed.
				leftSidebarCollapsed ? 'pl-12' : 'pl-3',
			)}
		>
			<Avatar className="size-4">
				{directoryGroup?.avatarUrl ? <AvatarImage src={directoryGroup.avatarUrl} alt="" /> : null}
				<AvatarFallback>{repoInitial}</AvatarFallback>
			</Avatar>

			<Breadcrumb className="min-w-0 flex-1">
				<BreadcrumbList>
					<BreadcrumbItem className="shrink-0">
						<span
							className="truncate text-[13px] font-medium leading-5 text-ink-muted"
							title={repoTitle}
						>
							{repoTitle}
						</span>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem className="min-w-0">
						{identity.mode === 'branch' && identity.editable ? (
							<BranchNameEditor
								branchName={identity.text}
								onRename={(next) => renameBranch(workspaceId, next).then(() => undefined)}
							/>
						) : (
							<BreadcrumbPage
								className="px-1.5 text-[13px] font-medium leading-5"
								title={identity.text}
							>
								{identity.text}
							</BreadcrumbPage>
						)}
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			<div className="flex shrink-0 items-center gap-2">
				<span
					className="max-w-[160px] truncate text-[13px] mr-1.5 font-normal leading-5 text-ink-subtle"
					title={worktreeFolderName}
				>
					{worktreeFolderName}
				</span>
				<ExternalOpenMenu localPath={snapshot.workspace.localPath} />
			</div>

			<div className="ml-1 flex shrink-0 items-center gap-1.5">
				{rightSidebarCollapsed ? <WorkspaceStageBadge snapshot={snapshot} /> : null}

				{rightSidebarCollapsed ? (
					<WorkspaceActionButton
						action={condition.primaryAction}
						disabled={
							!actionSessionId &&
							(condition.primaryAction?.kind === 'create_pr' ||
								condition.primaryAction?.kind === 'commit_and_push' ||
								condition.primaryAction?.kind === 'fix_ci' ||
								condition.primaryAction?.kind === 'resolve_merge_conflicts')
						}
						manualCreatePrUrl={manualCreateUrl}
						onPrimaryAction={runHeaderAction}
					/>
				) : null}

				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="size-7 text-ink-subtle hover:text-ink"
							aria-label={rightSidebarCollapsed ? 'Open right sidebar' : 'Close right sidebar'}
							aria-pressed={!rightSidebarCollapsed}
							onClick={() => setRightSidebarCollapsed(workspaceId, !rightSidebarCollapsed)}
						>
							<SidebarSimple className="size-4 -scale-x-100" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						{rightSidebarCollapsed ? 'Open right sidebar' : 'Close right sidebar'}
					</TooltipContent>
				</Tooltip>
			</div>
		</header>
	);
}
