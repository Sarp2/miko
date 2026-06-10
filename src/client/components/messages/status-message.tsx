import { ArrowsInSimple } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';

export interface StatusMessageProps {
	status: string;
	className?: string;
}

const STATUS_LABELS: Record<string, string> = {
	compacting: 'Compacting...',
};

function normalizeLabel(status: string): string {
	const mapped = STATUS_LABELS[status];
	if (mapped) return mapped;
	return status
		.replace(/[_-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\w/, (char) => char.toUpperCase());
}

/**
 * StatusMessage renders transient system statuses in the transcript.
 * Lightweight, centered, and visually distinct from user/assistant text.
 */
export function StatusMessage({ status, className }: StatusMessageProps) {
	const label = normalizeLabel(status);

	return (
		<div className={cn('flex', className)}>
			<div className="inline-flex items-center gap-1.5 text-xs text-ink-subtle animate-pulse">
				<ArrowsInSimple className="size-3" weight="bold" />
				<span>{label}</span>
			</div>
		</div>
	);
}
