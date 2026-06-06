import { ProhibitInset } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';

export interface InterruptedMessageProps {
	label?: string;
	className?: string;
}

/**
 * InterruptedMessage renders a compact neutral badge indicating
 * the turn was interrupted/cancelled by the user.
 */
export function InterruptedMessage({ label = 'Interrupted', className }: InterruptedMessageProps) {
	return (
		<div className={cn('flex items-center justify-end my-3', className)}>
			<div className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border border-hairline bg-surface-2 pl-2.5 pr-3.5 text-body-sm text-ink-subtle">
				<ProhibitInset className="size-4" weight="bold" />
				<em>{label}</em>
			</div>
		</div>
	);
}
