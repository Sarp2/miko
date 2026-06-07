import { CircleNotch, Folder, GitBranch, Info } from '@phosphor-icons/react';
import type { WorkspaceSnapshot } from '../../shared/types';
import { useSidebarStore } from '../stores/sidebar-store';
import { AssistantText } from './messages';
import { WorktreeLocationMenu } from './workspace-header/external-open-menu';

interface EmptyChatIntroProps {
	workspaceSnapshot: WorkspaceSnapshot;
}

function repoNameFromSlug(slug?: string) {
	return slug?.split('/').filter(Boolean).at(-1) ?? null;
}

export function EmptyChatIntro({ workspaceSnapshot }: EmptyChatIntroProps) {
	const directoryGroup = useSidebarStore((state) =>
		state.snapshot?.directoryGroups.find(
			(group) => group.directoryId === workspaceSnapshot.workspace.directoryId,
		),
	);
	const repoTitle =
		directoryGroup?.title ??
		repoNameFromSlug(workspaceSnapshot.git?.originRepoSlug) ??
		'repository';
	const branchName = workspaceSnapshot.workspace.branchName;
	const baseRef = `origin/${workspaceSnapshot.git?.defaultBranchName ?? 'main'}`;
	const fileCount = workspaceSnapshot.git?.files.length ?? 0;
	const creating = workspaceSnapshot.workspace.setupState === 'creating';
	const headline = `You’re in a new worktree of ${repoTitle} called ${branchName}`;

	return (
		<div className="w-full max-w-[680px] px-8 pt-8 md:px-12 md:pt-10">
			<div className="mb-5 inline-flex max-w-full rounded-lg border border-hairline bg-surface-1 px-[15px] py-[11px] shadow-sm">
				<AssistantText
					text={headline}
					mode="plain"
					className="[&_.text-body]:!text-[14px] [&_.text-body]:!font-normal [&_.text-body]:!leading-[1.4]"
				/>
			</div>

			<div className="space-y-3 text-caption leading-5 text-ink-subtle">
				<div className="flex items-center gap-2">
					<GitBranch className="size-4 shrink-0 text-ink-muted" />
					<p className="min-w-0 truncate">
						Branched <span className="font-mono font-normal text-ink-muted">{branchName}</span> from{' '}
						<span className="font-mono font-normal text-ink-muted">{baseRef}</span>
					</p>
				</div>

				<div className="flex items-center gap-2">
					{creating ? (
						<CircleNotch className="size-4 shrink-0 animate-spin text-ink-muted" />
					) : (
						<Folder className="size-4 shrink-0 text-ink-muted" />
					)}
					<p className="flex min-w-0 items-center gap-1.5">
						<span className="shrink-0">{creating ? 'Creating' : 'Created'}</span>
						<WorktreeLocationMenu localPath={workspaceSnapshot.workspace.localPath} />
						<span className="min-w-0 truncate">
							worktree{fileCount > 0 ? ` with ${fileCount} changed files` : ''}
						</span>
					</p>
				</div>

				<div className="flex items-center gap-2">
					<Info className="size-4 shrink-0 text-ink-muted" />
					<p className="min-w-0 truncate">Ready for your first prompt</p>
				</div>
			</div>
		</div>
	);
}
