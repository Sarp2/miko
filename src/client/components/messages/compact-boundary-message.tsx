import { cn } from '../../lib/utils';

export interface CompactBoundaryMessageProps {
	label?: string;
	className?: string;
}

/**
 * CompactBoundaryMessage marks the boundary where conversation
 * history was compacted into a summary.
 */
export function CompactBoundaryMessage({
	label = 'Compacted',
	className,
}: CompactBoundaryMessageProps) {
	const visibleLabel = label.trim();

	return (
		<div className={cn('flex items-center gap-3', className)}>
			<div className="h-px flex-1 bg-hairline/80" />
			{visibleLabel ? (
				<span className="shrink-0 text-caption uppercase tracking-[0.08em] text-ink-subtle">
					{visibleLabel}
				</span>
			) : null}
			<div className="h-px flex-1 bg-hairline/80" />
		</div>
	);
}
