import { WarningCircle } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';

export interface ResultMessageProps {
	success: boolean;
	cancelled?: boolean;
	result: string;
	durationMs: number;
	costUsd?: number;
	className?: string;
}

/**
 * ResultMessage renders only visible error feedback.
 * Success/cancelled metadata is intentionally omitted from transcript UI.
 */
export function ResultMessage({
	success,
	cancelled = false,
	result,
	durationMs: _durationMs,
	costUsd: _costUsd,
	className,
}: ResultMessageProps) {
	const errorText = result?.trim();
	if (success || cancelled || !errorText) {
		return null;
	}

	return (
		<div className={cn('flex', className)}>
			<div className="inline-flex w-fit max-w-[68ch] items-start gap-2 rounded-lg border border-hairline bg-surface-2 px-3 py-2">
				<WarningCircle className="mt-0.5 size-4 flex-shrink-0 text-ink-subtle" weight="fill" />
				<span className="text-body text-ink-muted whitespace-pre-wrap break-words">
					{errorText}
				</span>
			</div>
		</div>
	);
}
