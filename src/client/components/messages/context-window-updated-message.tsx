import { CaretDown } from '@phosphor-icons/react';
import type { ContextWindowUsageSnapshot } from '../../../shared/types';
import { cn } from '../../lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

export interface ContextWindowUpdatedMessageProps {
	usage: ContextWindowUsageSnapshot;
	className?: string;
}

function formatNumber(value: number): string {
	return new Intl.NumberFormat('en-US').format(value);
}

function formatPercentage(used: number, max: number): string {
	if (max <= 0) return '0.0%';
	return `${((used / max) * 100).toFixed(1)}%`;
}

function formatDurationMs(durationMs: number): string {
	if (durationMs < 1000) return `${durationMs}ms`;
	return `${(durationMs / 1000).toFixed(2)}s`;
}

/**
 * ContextWindowUpdatedMessage renders a compact transcript row for
 * context/token usage updates with optional expanded metrics.
 */
export function ContextWindowUpdatedMessage({
	usage,
	className,
}: ContextWindowUpdatedMessageProps) {
	const summary = usage.maxTokens
		? `Context window ${formatNumber(usage.usedTokens)} / ${formatNumber(usage.maxTokens)} (${formatPercentage(usage.usedTokens, usage.maxTokens)})`
		: `Context window ${formatNumber(usage.usedTokens)} tokens used`;

	const details = [
		{ label: 'Used Tokens', value: formatNumber(usage.usedTokens) },
		usage.maxTokens !== undefined
			? { label: 'Max Tokens', value: formatNumber(usage.maxTokens) }
			: null,
		usage.totalProcessedTokens !== undefined
			? { label: 'Total Processed', value: formatNumber(usage.totalProcessedTokens) }
			: null,
		usage.inputTokens !== undefined
			? { label: 'Input Tokens', value: formatNumber(usage.inputTokens) }
			: null,
		usage.cachedInputTokens !== undefined
			? { label: 'Cached Input Tokens', value: formatNumber(usage.cachedInputTokens) }
			: null,
		usage.outputTokens !== undefined
			? { label: 'Output Tokens', value: formatNumber(usage.outputTokens) }
			: null,
		usage.reasoningOutputTokens !== undefined
			? { label: 'Reasoning Tokens', value: formatNumber(usage.reasoningOutputTokens) }
			: null,
		usage.lastUsedTokens !== undefined
			? { label: 'Last Used Tokens', value: formatNumber(usage.lastUsedTokens) }
			: null,
		usage.lastInputTokens !== undefined
			? { label: 'Last Input Tokens', value: formatNumber(usage.lastInputTokens) }
			: null,
		usage.lastCachedInputTokens !== undefined
			? { label: 'Last Cached Input', value: formatNumber(usage.lastCachedInputTokens) }
			: null,
		usage.lastOutputTokens !== undefined
			? { label: 'Last Output Tokens', value: formatNumber(usage.lastOutputTokens) }
			: null,
		usage.lastReasoningOutputTokens !== undefined
			? { label: 'Last Reasoning Tokens', value: formatNumber(usage.lastReasoningOutputTokens) }
			: null,
		usage.toolUses !== undefined
			? { label: 'Tool Uses', value: formatNumber(usage.toolUses) }
			: null,
		usage.durationMs !== undefined
			? { label: 'Duration', value: formatDurationMs(usage.durationMs) }
			: null,
		{ label: 'Auto Compact', value: usage.compactsAutomatically ? 'On' : 'Off' },
	].filter((item): item is { label: string; value: string } => item !== null);

	const hasDetails = details.length > 1;

	return (
		<div className={cn('flex justify-center', className)}>
			<Collapsible>
				<CollapsibleTrigger
					className={cn(
						'group inline-flex items-center gap-1.5 text-xs text-ink-subtle',
						hasDetails && 'hover:text-ink-muted',
					)}
					disabled={!hasDetails}
				>
					<span>{summary}</span>
					{hasDetails && (
						<CaretDown
							className="size-3 transition-transform group-data-[state=open]:rotate-180"
							weight="bold"
						/>
					)}
				</CollapsibleTrigger>

				{hasDetails && (
					<CollapsibleContent className="mt-2">
						<div className="space-y-2 text-xs text-ink-muted">
							{details.map((item) => (
								<div key={item.label} className="flex gap-2">
									<span className="text-ink-subtle">{item.label}:</span>
									<span className="font-mono text-ink">{item.value}</span>
								</div>
							))}
						</div>
					</CollapsibleContent>
				)}
			</Collapsible>
		</div>
	);
}
