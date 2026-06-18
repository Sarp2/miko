import { SidebarSimple } from '@phosphor-icons/react';
import { useMemo } from 'react';
import type { WorkspaceSnapshot } from '../../../shared/types';
import { Icons } from '../../lib/icons';
import { cn } from '../../lib/utils';
import { deriveWorkspaceCondition } from '../../lib/workspace-condition';
import {
	deriveHeaderIdentity,
	deriveHeaderPullRequestBadge,
	deriveWorkspaceStage,
} from '../../lib/workspace-header-view-model';
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
import { WorkspaceStageBadge } from '../workspace-stage-badge';
import { BranchNameEditor } from './branch-name-editor';
import { ExternalOpenMenu } from './external-open-menu';

interface WorkspaceHeaderProps {
	workspaceId: string;
	snapshot: WorkspaceSnapshot;
	rightPanelOpen?: boolean;
	onToggleRightPanel?: () => void;
}

function basename(path: string) {
	return path.split('/').filter(Boolean).at(-1) ?? path;
}

function StageStatusText({ text, tone }: { text: string; tone: 'muted' | 'destructive' }) {
	return (
		<span
			className={cn(
				'text-[12px] leading-5',
				tone === 'destructive' ? 'text-destructive' : 'text-ink-subtle',
			)}
		>
			{text}
		</span>
	);
}

export function WorkspaceHeader({
	workspaceId,
	snapshot,
	rightPanelOpen,
	onToggleRightPanel,
}: WorkspaceHeaderProps) {
	const leftSidebarCollapsed = useUiStore((state) => state.leftSidebarCollapsed);
	const directoryGroup = useSidebarStore((state) =>
		state.snapshot?.directoryGroups.find(
			(group) => group.directoryId === snapshot.workspace.directoryId,
		),
	);
	const renameBranch = useWorkspaceStore((state) => state.renameBranch);

	const identity = useMemo(() => deriveHeaderIdentity(snapshot), [snapshot]);
	const stage = useMemo(() => deriveWorkspaceStage(snapshot), [snapshot]);
	const condition = useMemo(() => deriveWorkspaceCondition(snapshot), [snapshot]);
	const pullRequestBadge = useMemo(() => deriveHeaderPullRequestBadge(snapshot), [snapshot]);

	const repoTitle =
		directoryGroup?.title ??
		snapshot.workspace.localPath.split('/').filter(Boolean).at(-1) ??
		'Repository';

	const repoInitial = repoTitle.slice(0, 1).toUpperCase() || 'R';
	const worktreeFolderName = basename(snapshot.workspace.localPath);

	return (
		<header
			data-testid="workspace-header"
			className={cn(
				'flex h-11 shrink-0 items-center gap-2 border-b border-hairline bg-surface-1 pr-2.5',
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

			{onToggleRightPanel ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="size-7 text-ink-subtle hover:text-ink"
							aria-label={rightPanelOpen ? 'Hide inspector' : 'Show inspector'}
							aria-pressed={rightPanelOpen}
							onClick={onToggleRightPanel}
						>
							<SidebarSimple className="size-4 -scale-x-100" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>{rightPanelOpen ? 'Hide inspector' : 'Show inspector'}</TooltipContent>
				</Tooltip>
			) : null}

			<div className="flex shrink-0 items-center gap-1.5">
				{leftSidebarCollapsed && pullRequestBadge ? (
					<WorkspaceStageBadge
						stage={condition.stage}
						prNumber={pullRequestBadge.number}
						prUrl={pullRequestBadge.url}
					/>
				) : null}
				{stage.isBusy ? (
					<span className="flex items-center gap-1.5 text-[12px] leading-5 text-ink-subtle">
						{Icons.activeIcon({ ariaLabel: 'streaming', className: 'shrink-0 size-5' })}
					</span>
				) : stage.stage === 'merged' ? (
					<StageStatusText text="Merged" tone="muted" />
				) : stage.stage === 'closed' ? (
					<StageStatusText text="Closed" tone="muted" />
				) : stage.stage === 'failed' ? (
					<StageStatusText text="Setup failed" tone="destructive" />
				) : null}
			</div>
		</header>
	);
}
