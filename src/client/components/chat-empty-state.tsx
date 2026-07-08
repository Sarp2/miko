import { CircleNotch } from '@phosphor-icons/react';
import type { WorkspaceSnapshot } from '../../shared/types';
import { useSidebarStore } from '../stores/sidebar-store';
import { WorktreeLocationMenu } from './workspace-header/external-open-menu';

interface EmptyChatIntroProps {
	workspaceSnapshot: WorkspaceSnapshot;
}

function repoNameFromSlug(slug?: string) {
	return slug?.split('/').filter(Boolean).at(-1) ?? null;
}

function PlateRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="grid grid-cols-[118px_minmax(0,1fr)] items-center gap-3">
			<dt className="text-label-mono text-ink-tertiary">{label}</dt>
			<dd className="m-0 flex min-w-0 items-center gap-1.5">{children}</dd>
		</div>
	);
}

/**
 * Nameplate for a fresh worktree: the branch is the workspace's identity, so it
 * gets the display slot; the machine facts sit under it as an engraved spec sheet.
 */
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

	return (
		<div className="w-full max-w-[680px] px-8 pt-10 md:px-12 md:pt-14">
			<h1 className="truncate font-mono text-[26px] font-medium leading-tight tracking-[-0.01em] text-ink">
				{branchName}
			</h1>
			<p className="mt-1.5 text-[13px] leading-5 text-ink-subtle">New worktree of {repoTitle}</p>

			<dl className="mt-7 flex flex-col gap-3 border-t border-hairline pt-5">
				<PlateRow label="Branched from">
					<span className="truncate font-mono text-[12px] leading-4 text-ink-muted">{baseRef}</span>
				</PlateRow>

				<PlateRow label="Worktree">
					<WorktreeLocationMenu localPath={workspaceSnapshot.workspace.localPath} />
					{fileCount > 0 && (
						<span className="shrink-0 text-[12px] leading-4 text-ink-subtle">
							{fileCount} changed files
						</span>
					)}
				</PlateRow>

				<PlateRow label="Status">
					{creating ? (
						<>
							<CircleNotch className="size-3.5 shrink-0 animate-spin text-ink-subtle" />
							<span className="text-[13px] leading-5 text-ink-subtle">Creating worktree…</span>
						</>
					) : (
						<span className="text-[13px] leading-5 text-ink-muted">
							Ready for your first prompt
						</span>
					)}
				</PlateRow>
			</dl>
		</div>
	);
}
