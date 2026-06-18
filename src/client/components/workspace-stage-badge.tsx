import { ArrowSquareOut } from '@phosphor-icons/react';
import { cn } from '../lib/utils';
import type { WorkspaceConditionStage } from '../lib/workspace-condition';

function stageClassName(stage: WorkspaceConditionStage) {
	if (stage === 'ci_failed' || stage === 'closed') {
		return 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15';
	}

	if (stage === 'merge_conflicts') {
		return 'border-[#f59e0b]/45 bg-[#f59e0b]/10 text-[#fbbf24] hover:bg-[#f59e0b]/15';
	}

	if (stage === 'dirty' || stage === 'ready_to_create_pr') {
		return 'border-success/35 bg-success/10 text-success hover:bg-success/15';
	}

	if (stage === 'agent_active' || stage === 'creating') {
		return 'border-primary/35 bg-primary/10 text-primary hover:bg-primary/15';
	}

	if (stage === 'pr_open' || stage === 'draft_pr' || stage === 'merged') {
		return 'border-[#a12df2]/45 bg-[#a12df2]/10 text-[#c27aff] hover:bg-[#a12df2]/15';
	}

	return 'border-hairline bg-surface-2 text-ink-subtle hover:bg-surface-3 hover:text-ink';
}

export function WorkspaceStageBadge({
	stage,
	prNumber,
	prUrl,
	className,
}: {
	stage: WorkspaceConditionStage;
	prNumber?: number;
	prUrl?: string;
	className?: string;
}) {
	if (typeof prNumber !== 'number') return null;

	const content = (
		<>
			<span className="tabular-nums">#{prNumber}</span>
			{prUrl ? <ArrowSquareOut className="size-3.5 shrink-0" weight="bold" /> : null}
		</>
	);
	const badgeClassName = cn(
		'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[13px] font-semibold leading-5 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary',
		stageClassName(stage),
		className,
	);

	if (!prUrl) return <span className={badgeClassName}>{content}</span>;

	return (
		<a href={prUrl} target="_blank" rel="noreferrer" className={badgeClassName}>
			{content}
		</a>
	);
}
