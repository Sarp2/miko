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
		<div className={cn('flex justify-center', className)}>
			<Collapsible>
				<CollapsibleTrigger
					className={cn(
						'group inline-flex items-center gap-2 text-caption transition-colors',
						hasDetails ? 'hover:text-ink-muted' : 'cursor-default',
					)}
					disabled={!hasDetails}
				>
					<span className="text-ink-subtle">{icon}</span>
					<span className="max-w-56 truncate font-medium text-ink">{title}</span>
					{subtitle && (
						<span className="max-w-96 truncate font-mono text-ink-subtle">{subtitle}</span>
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
