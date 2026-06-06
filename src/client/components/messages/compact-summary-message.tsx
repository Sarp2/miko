import { ArrowsInSimple, CaretDown } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

export interface CompactSummaryMessageProps {
	summary: string;
	className?: string;
	label?: string;
}

/**
 * CompactSummaryMessage renders compaction summaries emitted by the system.
 * Compact row stays lightweight; full summary is available on expand.
 */
export function CompactSummaryMessage({
	summary,
	className,
	label = 'Summarized',
}: CompactSummaryMessageProps) {
	const trimmedSummary = summary.trim();
	const hasDetails = trimmedSummary.length > 0;

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
					<ArrowsInSimple className="size-3" weight="bold" />
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
						<div className="max-w-[68ch] text-body-sm text-ink-muted leading-[1.55] tracking-[0]">
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
								components={{
									p: ({ children }) => (
										<p className="mb-2 last:mb-0 whitespace-pre-wrap">{children}</p>
									),
									ul: ({ children }) => (
										<ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>
									),
									ol: ({ children }) => (
										<ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>
									),
									li: ({ children }) => <li>{children}</li>,
									code: ({ children, className: codeClassName }) => (
										<code
											className={cn(
												'rounded border border-hairline bg-surface-2 px-1 py-0.5 font-mono text-caption text-ink-muted',
												codeClassName,
											)}
										>
											{children}
										</code>
									),
									pre: ({ children }) => (
										<pre className="mb-2 overflow-x-auto rounded-md border border-hairline bg-surface-2 p-2.5 text-caption">
											{children}
										</pre>
									),
								}}
							>
								{summary}
							</ReactMarkdown>
						</div>
					</CollapsibleContent>
				)}
			</Collapsible>
		</div>
	);
}
