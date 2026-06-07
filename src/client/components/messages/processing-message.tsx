import { CircleNotch, XCircle } from '@phosphor-icons/react';
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
		<div className={cn('flex justify-center', className)}>
			<div className="inline-flex items-center gap-1.5 text-body-sm">
				{isFailed ? (
					<XCircle className="size-4 text-destructive" weight="fill" />
				) : (
					<CircleNotch className="size-4 animate-spin text-ink-subtle" weight="bold" />
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
