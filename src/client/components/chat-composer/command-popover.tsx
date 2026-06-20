import type { SlashCommandInfo } from '../../../shared/types';
import { cn } from '../../lib/utils';

interface CommandListProps {
	query: string;
	options: SlashCommandInfo[];
	isLoading?: boolean;
	onSelect: (option: SlashCommandInfo) => void;
}

/** Body of the slash-command menu. Hosted inside the composer's shared suggestion popover. */
export function CommandList({ query, options, isLoading = false, onSelect }: CommandListProps) {
	const showEmpty = !isLoading && options.length === 0;

	return (
		<div className="scrollbar-miko max-h-[260px] overflow-y-auto p-1">
			{isLoading ? (
				<div className="px-2 py-2.5 text-[12px] leading-4 text-ink-subtle">Loading commands…</div>
			) : null}

			{showEmpty ? (
				<div className="px-2 py-2.5 text-[12px] leading-4 text-ink-subtle">
					{query ? 'No commands found.' : 'No commands available yet.'}
				</div>
			) : null}

			{options.length > 0 ? (
				<div className="flex flex-col gap-px">
					<div className="px-2 py-1 text-[11px] font-medium text-ink-subtle">Commands</div>
					{options.map((option) => (
						<button
							key={option.name}
							type="button"
							onClick={() => onSelect(option)}
							className={cn(
								'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors',
								'hover:bg-surface-2 focus-visible:bg-surface-2',
							)}
						>
							<span className="shrink-0 font-medium text-[12px] leading-4 text-ink">
								/{option.name}
							</span>
							{option.argumentHint ? (
								<span className="shrink-0 font-mono text-[11px] leading-4 text-ink-tertiary">
									{option.argumentHint}
								</span>
							) : null}
							{option.description ? (
								<span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-ink-muted">
									{option.description}
								</span>
							) : null}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
