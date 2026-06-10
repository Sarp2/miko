import { CaretDown } from '@phosphor-icons/react';
import type * as React from 'react';
import { cn } from '../../lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

export interface ToolEventRowProps {
	icon: React.ReactNode;
	title: string;
	subtitle?: string;
	className?: string;
	children?: React.ReactNode;
}

export function ToolEventRow({ icon, title, subtitle, className, children }: ToolEventRowProps) {
	const hasDetails = Boolean(children);

	return (
		<div className={cn('flex', className)}>
			<Collapsible className="inline-flex max-w-full flex-col">
				<CollapsibleTrigger
					className={cn(
						'group inline-flex max-w-full items-center gap-2 border-0 bg-transparent p-0 text-left text-[14px] font-normal leading-[1.4] transition-colors',
						hasDetails ? 'hover:text-ink-muted' : 'cursor-default',
					)}
					disabled={!hasDetails}
				>
					<span className="shrink-0 text-ink-subtle">{icon}</span>
					<span className="max-w-56 truncate font-normal text-ink">{title}</span>
					{subtitle && (
						<span className="max-w-96 truncate font-mono text-[12px] text-ink-subtle">
							{subtitle}
						</span>
					)}
					{hasDetails && (
						<CaretDown
							className="size-3 text-ink-tertiary transition-transform group-data-[state=open]:rotate-180"
							weight="bold"
						/>
					)}
				</CollapsibleTrigger>

				{hasDetails && <CollapsibleContent className="mt-2">{children}</CollapsibleContent>}
			</Collapsible>
		</div>
	);
}
