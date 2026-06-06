import { CaretDown, WarningCircle } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

export interface UnknownMessageProps {
	json: string | Record<string, unknown> | unknown[];
	className?: string;
	label?: string;
}

function toDisplayJson(value: UnknownMessageProps['json']): string {
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/**
 * UnknownMessage is a safe transcript fallback for entries that
 * cannot be mapped to a known message kind.
 */
export function UnknownMessage({
	json,
	className,
	label = 'Unknown Tool Call',
}: UnknownMessageProps) {
	const displayJson = toDisplayJson(json);
	const hasDetails = displayJson.trim().length > 0;

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
					<WarningCircle className="size-3.5" weight="fill" />
					<span>{label}</span>
					{hasDetails && (
						<CaretDown
							className="size-3 transition-transform group-data-[state=open]:rotate-180"
							weight="bold"
						/>
					)}
				</CollapsibleTrigger>

				{hasDetails && (
					<CollapsibleContent className="mt-2">
						<pre className="max-h-80 w-fit max-w-[68ch] overflow-auto whitespace-pre-wrap break-words rounded-md border border-hairline bg-surface-2 p-2.5 font-mono text-caption leading-relaxed text-ink-muted">
							{displayJson}
						</pre>
					</CollapsibleContent>
				)}
			</Collapsible>
		</div>
	);
}
