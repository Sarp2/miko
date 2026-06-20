import * as Popover from '@radix-ui/react-popover';
import type * as React from 'react';

/**
 * Single popover hosting the composer's suggestion menus (@-mention and slash commands). One
 * Popover.Root keeps the contenteditable anchor mounted while the body switches, so the caret and
 * focus survive toggling between menus. Width tracks the composer; it sits flush above it.
 */
export function ComposerSuggestionPopover({
	open,
	anchor,
	onOpenChange,
	children,
}: {
	open: boolean;
	anchor: React.ReactElement;
	onOpenChange: (open: boolean) => void;
	children: React.ReactNode;
}) {
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
					className="w-[calc(var(--radix-popover-trigger-width)_-_16px)] overflow-hidden rounded-t-[10px] rounded-b-none border border-b-0 border-hairline bg-canvas p-0 text-ink shadow-none outline-none"
				>
					{children}
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
