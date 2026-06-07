import { CaretDown, CircleNotch, Copy, Folder, GitBranch, Info } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { WorkspaceSnapshot } from '../../shared/types';
import { useSidebarStore } from '../stores/sidebar-store';
import { useWorkspaceStore } from '../stores/workspace-store';
import { AssistantText } from './messages';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface EmptyChatIntroProps {
	workspaceSnapshot: WorkspaceSnapshot;
}

function basename(path: string) {
	return path.split('/').filter(Boolean).at(-1) ?? path;
}

function repoNameFromSlug(slug?: string) {
	return slug?.split('/').filter(Boolean).at(-1) ?? null;
}

function toErrorMessage(error: unknown, fallback: string) {
	return error instanceof Error && error.message ? error.message : fallback;
}

function WorktreeLocationMenu({ localPath }: { localPath: string }) {
	const openExternal = useWorkspaceStore((state) => state.openExternal);
	const folderName = basename(localPath);

	const open = async (action: 'open_finder' | 'open_terminal' | 'open_editor') => {
		try {
			if (action === 'open_editor') {
				await openExternal({ localPath, action, editor: { preset: 'cursor' } });
				return;
			}
			await openExternal({ localPath, action });
		} catch (error) {
			toast.error(toErrorMessage(error, 'Could not open workspace'));
		}
	};

	const copyPath = async () => {
		try {
			await navigator.clipboard.writeText(localPath);
			toast.success('Workspace path copied');
		} catch (error) {
			toast.error(toErrorMessage(error, 'Could not copy workspace path'));
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="inline-flex h-5 items-center gap-1 rounded-md bg-surface-2 px-2 font-mono text-[11px] font-medium leading-none text-ink-muted outline-none transition-colors hover:bg-surface-3 focus-visible:ring-1 focus-visible:ring-primary"
					title={localPath}
				>
					<span>{folderName}</span>
					<CaretDown className="size-2.5" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="min-w-[190px] rounded-xl border-hairline bg-surface-2 p-1 shadow-xl"
			>
				<DropdownMenuItem
					className="flex h-9 cursor-default items-center gap-2 rounded-lg px-2 text-[13px] text-ink focus:bg-surface-3 focus:text-ink"
					onSelect={() => void open('open_finder')}
				>
					<img src="/finder.png" alt="" className="size-5 rounded-[5px]" draggable={false} />
					<span className="min-w-0 flex-1 truncate">Finder</span>
				</DropdownMenuItem>
				<DropdownMenuItem
					className="flex h-9 cursor-default items-center gap-2 rounded-lg px-2 text-[13px] text-ink focus:bg-surface-3 focus:text-ink"
					onSelect={() => void open('open_editor')}
				>
					<img src="/cursor.png" alt="" className="size-5 rounded-[5px]" draggable={false} />
					<span className="min-w-0 flex-1 truncate">Cursor</span>
				</DropdownMenuItem>
				<DropdownMenuItem
					className="flex h-9 cursor-default items-center gap-2 rounded-lg px-2 text-[13px] text-ink focus:bg-surface-3 focus:text-ink"
					onSelect={() => void open('open_terminal')}
				>
					<img src="/terminal.png" alt="" className="size-5 rounded-[5px]" draggable={false} />
					<span className="min-w-0 flex-1 truncate">Terminal</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator className="bg-hairline" />
				<DropdownMenuItem
					className="flex h-9 cursor-default items-center gap-2 rounded-lg px-2 text-[13px] text-ink focus:bg-surface-3 focus:text-ink"
					onSelect={() => void copyPath()}
				>
					<span className="flex size-5 items-center justify-center text-ink-subtle">
						<Copy className="size-4" />
					</span>
					<span className="min-w-0 flex-1 truncate">Copy path</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
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
