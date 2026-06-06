import { cn } from '../../lib/utils';

export interface ContextClearedMessageProps {
	label?: string;
	className?: string;
}

/**
 * ContextClearedMessage renders a compact divider row when
 * transcript context has been explicitly cleared/reset.
 */
export function ContextClearedMessage({
	label = 'Context Cleared',
	className,
}: ContextClearedMessageProps) {
	return (
		<div className={cn('flex items-center gap-3', className)}>
			<div className="h-px flex-1 bg-hairline/80" />
			<span className="shrink-0 text-caption uppercase tracking-[0.08em] text-ink-subtle">
				{label}
			</span>
			<div className="h-px flex-1 bg-hairline/80" />
		</div>
	);
}
