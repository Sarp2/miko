import {
	Archive,
	ArrowSquareOut,
	ArrowUp,
	CaretDown,
	GitMerge,
	GitPullRequest,
	WarningCircle,
} from '@phosphor-icons/react';
import { Icons } from '../lib/icons';
import { cn } from '../lib/utils';
import type { WorkspacePrimaryAction } from '../lib/workspace-condition';
import { WORKSPACE_ARCHIVE_BUTTON_CLASS } from '../lib/workspace-visuals';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from './ui/dropdown-menu';

function WorkspaceActionIcon({ action }: { action: WorkspacePrimaryAction }) {
	if (action.kind === 'archive') return <Archive className="size-3" />;
	if (action.kind === 'merge') return <GitMerge className="size-3" />;
	if (action.kind === 'create_pr') return <GitPullRequest className="size-3" />;
	if (action.kind === 'fix_ci') return <WarningCircle className="size-3" />;
	if (action.kind === 'resolve_merge_conflicts') return <WarningCircle className="size-3" />;
	if (action.kind === 'commit_and_push') return <ArrowUp className="size-3" />;
	return null;
}

export function WorkspaceActionButton({
	action,
	className,
	disabled,
	manualCreatePrUrl,
	onPrimaryAction,
}: {
	action: WorkspacePrimaryAction | null;
	className?: string;
	disabled?: boolean;
	manualCreatePrUrl?: string;
	onPrimaryAction?: (action: WorkspacePrimaryAction) => void | Promise<void>;
}) {
	if (!action) return null;

	if (action.kind === 'active') {
		return Icons.activeIcon({ className: cn('size-3.5', className) });
	}

	if (action.kind === 'create_pr') {
		return (
			<DropdownMenu modal={false}>
				<span
					className={cn(
						'inline-flex h-6 max-w-full overflow-hidden rounded-md border border-hairline bg-surface-2 text-[11px] font-medium leading-4 text-ink',
						className,
					)}
				>
					<button
						type="button"
						disabled={disabled}
						className="inline-flex min-w-0 cursor-pointer items-center gap-1 px-1.5 outline-none transition-colors hover:bg-surface-3 focus-visible:bg-surface-3 disabled:pointer-events-none disabled:opacity-50"
						onClick={() => {
							void onPrimaryAction?.(action);
						}}
					>
						<GitPullRequest className="size-3 shrink-0" />
						<span className="truncate">{action.label}</span>
					</button>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label={`${action.label} options`}
							className="flex w-6 shrink-0 cursor-pointer items-center justify-center border-l border-hairline text-ink-subtle outline-none transition-colors hover:bg-surface-3 hover:text-ink focus-visible:bg-surface-3 focus-visible:text-ink"
						>
							<CaretDown className="size-2.5" />
						</button>
					</DropdownMenuTrigger>
				</span>
				<DropdownMenuContent
					align="start"
					sideOffset={4}
					className="w-[176px] rounded-md border-hairline bg-surface-1 p-1 shadow-none"
				>
					<DropdownMenuItem
						className="cursor-pointer rounded-md px-1.5 py-0.5 text-[11.5px] font-medium leading-5 text-ink focus:bg-surface-2 focus:text-ink"
						disabled={disabled}
						onSelect={() => {
							void onPrimaryAction?.(action);
						}}
					>
						<GitPullRequest className="size-3 text-ink-muted" />
						Create draft PR
					</DropdownMenuItem>
					<DropdownMenuItem
						className="cursor-pointer rounded-md px-1.5 py-0.5 text-[11.5px] font-medium leading-5 text-ink focus:bg-surface-2 focus:text-ink"
						disabled={!manualCreatePrUrl}
						onSelect={() => {
							if (!manualCreatePrUrl) return;
							window.open(manualCreatePrUrl, '_blank', 'noopener,noreferrer');
						}}
					>
						<ArrowSquareOut className="size-3 text-ink-muted" />
						Create PR manually
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		);
	}

	return (
		<button
			type="button"
			disabled={disabled}
			className={cn(
				'inline-flex h-6 max-w-full cursor-pointer items-center gap-1 overflow-hidden rounded-md border border-hairline bg-surface-2 px-1.5 text-[11px] font-medium leading-4 text-ink outline-none transition-colors hover:bg-surface-3 focus-visible:bg-surface-3 disabled:pointer-events-none disabled:opacity-50',
				action.kind === 'merge' &&
					'border-transparent bg-success px-2 text-white hover:bg-success/90 focus-visible:bg-success/90',
				action.kind === 'archive' && WORKSPACE_ARCHIVE_BUTTON_CLASS,
				className,
			)}
			onClick={() => {
				void onPrimaryAction?.(action);
			}}
		>
			<WorkspaceActionIcon action={action} />
			<span className="truncate">{action.label}</span>
		</button>
	);
}
