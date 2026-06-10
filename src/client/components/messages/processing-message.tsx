import { XCircle } from '@phosphor-icons/react';
import { Icons } from '../../lib/icons';
import { cn } from '../../lib/utils';

export interface ProcessingMessageProps {
	status?: string;
	className?: string;
}

const STATUS_LABELS: Record<string, string> = {
	connecting: 'Connecting...',
	acquiring_sandbox: 'Booting...',
	initializing: 'Initializing...',
	starting: 'Starting...',
	running: 'Running...',
	waiting_for_user: 'Waiting...',
	failed: 'Failed',
};

/**
 * ProcessingMessage renders active runtime status for the current turn.
 * It is shown while streaming/processing and switches to failure styling
 * when runtime status is `failed`.
 */
export function ProcessingMessage({ status, className }: ProcessingMessageProps) {
	const label = (status ? STATUS_LABELS[status] : undefined) || 'Processing...';
	const isFailed = status === 'failed';

	return (
		<div className={cn('flex', className)}>
			<div className="inline-flex items-center gap-1.5 text-[13px] leading-5">
				{isFailed ? (
					<XCircle className="size-3.5 text-destructive" weight="fill" />
				) : (
					Icons.activeIcon({ ariaLabel: label, className: 'size-3.5 shrink-0' })
				)}
				<span
					className={cn(
						'tracking-[0] ',
						isFailed ? 'text-destructive' : 'animate-pulse text-ink-subtle',
					)}
				>
					{label}
				</span>
			</div>
		</div>
	);
}
