import { ArrowUpRight } from '@phosphor-icons/react';
import type { WorkspaceSnapshot } from '../../shared/types';
import { cn } from '../lib/utils';

interface WorkspaceStageBadgeProps {
	snapshot: WorkspaceSnapshot;
	className?: string;
}

export function WorkspaceStageBadge({ snapshot, className }: WorkspaceStageBadgeProps) {
	const prNumber = snapshot.github?.prNumber ?? snapshot.workspace.pullRequest?.number;
	const prUrl = snapshot.github?.url ?? snapshot.workspace.pullRequest?.url;
	if (!prNumber) return null;

	const classes = cn(
		'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 font-mono text-[12px] font-medium leading-4 tabular-nums transition-colors',
		className ?? 'border-hairline bg-surface-1 text-ink-subtle hover:bg-surface-2 hover:text-ink',
	);

	if (!prUrl) {
		return (
			<span className={classes}>
				#{prNumber}
				<ArrowUpRight className="size-3 shrink-0" />
			</span>
		);
	}

	return (
		<a
			href={prUrl}
			target="_blank"
			rel="noreferrer"
			className={classes}
			title={`Open PR #${prNumber}`}
		>
			#{prNumber}
			<ArrowUpRight className="size-3 shrink-0" />
		</a>
	);
}
