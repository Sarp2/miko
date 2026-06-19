import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { WorkspaceDiffFile } from '../../shared/types';
import { cn } from '../lib/utils';
import { useUiStore } from '../stores/ui-store';
import { useWorkspaceStore } from '../stores/workspace-store';
import { FileExternalOpenMenu } from './workspace-header/external-open-menu';

interface RightSidebarChangesProps {
	discardablePaths: ReadonlySet<string>;
	files: WorkspaceDiffFile[];
	onOpenDiff: (path: string) => void;
	workspaceId: string;
	workspaceRoot: string;
}

interface ChangeStatusMeta {
	letter: string;
	className: string;
	label: string;
}

function changeStatusMeta(file: WorkspaceDiffFile): ChangeStatusMeta {
	switch (file.changeType) {
		case 'added':
			return file.isUntracked
				? { letter: 'U', className: 'text-success', label: 'Untracked' }
				: { letter: 'A', className: 'text-success', label: 'Added' };
		case 'deleted':
			return { letter: 'D', className: 'text-destructive', label: 'Deleted' };
		case 'renamed':
			return { letter: 'R', className: 'text-[#5e9eff]', label: 'Renamed' };
		default:
			return { letter: 'M', className: 'text-[#d99e3a]', label: 'Modified' };
	}
}

function splitPath(path: string) {
	const normalized = path.replace(/\\/g, '/');
	const index = normalized.lastIndexOf('/');
	if (index < 0) return { dir: '', name: normalized };
	return { dir: normalized.slice(0, index + 1), name: normalized.slice(index + 1) };
}

function joinWorkspacePath(root: string, relativePath: string) {
	return `${root.replace(/\/$/, '')}/${relativePath.replace(/^\/+/, '')}`;
}

function ChangeRow({
	canDiscard,
	file,
	onOpenDiff,
	workspaceId,
	workspaceRoot,
}: {
	canDiscard: boolean;
	file: WorkspaceDiffFile;
	onOpenDiff: (path: string) => void;
	workspaceId: string;
	workspaceRoot: string;
}) {
	const isViewed = useUiStore((state) =>
		state.isDiffPathViewed(workspaceId, file.path, file.patchDigest),
	);
	const setViewed = useUiStore((state) => state.setDiffPathViewed);
	const discardFile = useWorkspaceStore((state) => state.discardFile);

	const { dir, name } = splitPath(file.path);
	const status = changeStatusMeta(file);

	const openDiff = () => {
		setViewed(workspaceId, file.path, file.patchDigest, true);
		onOpenDiff(file.path);
	};

	const discard = async () => {
		try {
			await discardFile(workspaceId, file.path);
			toast.success('Discarded file changes');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not discard changes');
		}
	};

	return (
		<div className="group flex h-7 min-w-0 items-center gap-2 rounded-md px-2 outline-none hover:bg-surface-2">
			<button
				type="button"
				className="flex min-w-0 flex-1 cursor-pointer items-center overflow-hidden font-mono text-[11.5px] leading-5 outline-none focus-visible:ring-1 focus-visible:ring-primary"
				title={file.path}
				onClick={openDiff}
			>
				{dir ? <span className="min-w-0 truncate text-ink-tertiary">{dir}</span> : null}
				<span className={cn('shrink-0', isViewed ? 'text-ink-subtle' : 'text-ink')}>{name}</span>
			</button>
			<div className="ml-auto flex shrink-0 items-center">
				<div className="flex items-center gap-1.5 group-hover:hidden group-has-[[data-state=open]]:hidden">
					{file.additions > 0 ? (
						<span className="font-mono text-[10.5px] tabular-nums text-success">
							+{file.additions}
						</span>
					) : null}
					{file.deletions > 0 ? (
						<span className="font-mono text-[10.5px] tabular-nums text-destructive">
							-{file.deletions}
						</span>
					) : null}
					<span
						className={cn(
							'w-3.5 text-center font-mono text-[11px] font-semibold leading-4',
							status.className,
						)}
						title={status.label}
					>
						{status.letter}
					</span>
				</div>
				<div className="hidden items-center gap-1.5 group-hover:flex group-has-[[data-state=open]]:flex">
					{canDiscard ? (
						<button
							type="button"
							className="text-ink-tertiary transition-colors hover:text-ink focus-visible:outline-none"
							onClick={() => void discard()}
							aria-label={`Discard changes in ${file.path}`}
							title="Discard changes"
						>
							<ArrowCounterClockwise className="size-3.5" />
						</button>
					) : null}
					<FileExternalOpenMenu
						localPath={joinWorkspacePath(workspaceRoot, file.path)}
						triggerClassName="text-ink-tertiary transition-colors hover:text-ink focus-visible:outline-none"
					/>
				</div>
			</div>
		</div>
	);
}

export function RightSidebarChanges({
	discardablePaths,
	files,
	onOpenDiff,
	workspaceId,
	workspaceRoot,
}: RightSidebarChangesProps) {
	if (files.length === 0) {
		return (
			<div className="flex h-full items-center justify-center px-8 text-center text-[12px] leading-5 text-ink-tertiary">
				No file changes yet.
			</div>
		);
	}

	const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path));

	return (
		<div className="min-w-0 space-y-0.5 px-2 py-2">
			{sorted.map((file) => (
				<ChangeRow
					key={file.path}
					canDiscard={discardablePaths.has(file.path)}
					file={file}
					onOpenDiff={onOpenDiff}
					workspaceId={workspaceId}
					workspaceRoot={workspaceRoot}
				/>
			))}
		</div>
	);
}
