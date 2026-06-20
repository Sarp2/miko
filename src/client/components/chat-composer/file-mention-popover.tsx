import { MagnifyingGlass } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import type * as React from 'react';
import { cn } from '../../lib/utils';
import { FileNameIcon } from '../icons/file-name-icon';

export interface FileMentionOption {
	id: string;
	name: string;
	relativePath: string;
}

interface FileMentionPopoverProps {
	open: boolean;
	anchor: React.ReactElement;
	query: string;
	options: FileMentionOption[];
	isLoading?: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (option: FileMentionOption) => void;
}

function directoryName(relativePath: string) {
	const index = relativePath.lastIndexOf('/');
	return index === -1 ? '' : relativePath.slice(0, index);
}

export function FileMentionPopover({
	open,
	anchor,
	query,
	options,
	isLoading = false,
	onOpenChange,
	onSelect,
}: FileMentionPopoverProps) {
	const hasQuery = query.trim().length > 0;
	const showEmpty = !isLoading && hasQuery && options.length === 0;

	return (
		<Popover.Root open={open} onOpenChange={onOpenChange}>
			<Popover.Anchor asChild>{anchor}</Popover.Anchor>
			<Popover.Portal>
				<Popover.Content
					side="top"
					align="start"
					alignOffset={8}
					sideOffset={0}
					onOpenAutoFocus={(event) => event.preventDefault()}
					className="w-[calc(var(--radix-popover-trigger-width)-16px)] overflow-hidden rounded-t-[10px] rounded-b-none border border-b-0 border-hairline bg-canvas p-0 text-ink shadow-none outline-none"
				>
					<div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
						<MagnifyingGlass className="size-3.5 shrink-0 text-ink-subtle" />
						<span className="min-w-0 flex-1 truncate text-[12px] leading-5 text-ink-muted">
							{hasQuery ? query : 'Type a file path after @'}
						</span>
					</div>

					<div className="scrollbar-miko max-h-[220px] overflow-y-auto p-1">
						{!hasQuery ? (
							<div className="px-2 py-2.5 text-[12px] leading-4 text-ink-subtle">
								Showing recent changed files.
							</div>
						) : null}

						{isLoading ? (
							<div className="px-2 py-2.5 text-[12px] leading-4 text-ink-subtle">
								Searching files…
							</div>
						) : null}

						{showEmpty ? (
							<div className="px-2 py-2.5 text-[12px] leading-4 text-ink-subtle">
								No files found.
							</div>
						) : null}

						{options.length > 0 ? (
							<div className="flex flex-col gap-px">
								<div className="px-2 py-1 text-[11px] font-medium text-ink-subtle">Files</div>
								{options.map((option) => {
									const directory = directoryName(option.relativePath);

									return (
										<button
											key={option.id}
											type="button"
											onClick={() => onSelect(option)}
											className={cn(
												'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors',
												'hover:bg-surface-2 focus-visible:bg-surface-2',
											)}
										>
											<FileNameIcon name={option.relativePath} className="size-3.5" />
											<span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-ink">
												{option.name}
											</span>
											{directory ? (
												<span className="min-w-0 max-w-[130px] truncate font-mono text-[11px] leading-4 text-ink-tertiary">
													{directory}
												</span>
											) : null}
										</button>
									);
								})}
							</div>
						) : null}
					</div>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
