import { X } from '@phosphor-icons/react';
import type { QueuedMessageSnapshot } from '../../../shared/types';
import { Button } from '../ui/button';

/**
 * Messages sent while a turn is running. They run FIFO as the active turn settles; each can be
 * removed before it starts. Rendered at the top of the composer.
 */
export function ComposerQueuedMessages({
	queued,
	onRemove,
}: {
	queued: QueuedMessageSnapshot[];
	onRemove: (messageId: string) => void;
}) {
	if (queued.length === 0) return null;

	return (
		<div className="flex flex-col gap-1 border-b border-hairline px-2 py-1.5">
			<div className="px-1 text-[11px] font-medium text-ink-subtle">
				Queued · runs after the current turn
			</div>
			{queued.map((message) => (
				<div key={message.id} className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1">
					<span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-ink-muted">
						{message.content.trim() || 'Attachment'}
					</span>
					{message.attachmentCount > 0 ? (
						<span className="shrink-0 text-[11px] text-ink-tertiary">
							+{message.attachmentCount}
						</span>
					) : null}
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="size-5 shrink-0 text-ink-subtle hover:text-ink"
						onClick={() => onRemove(message.id)}
						aria-label="Remove queued message"
					>
						<X className="size-3" />
					</Button>
				</div>
			))}
		</div>
	);
}
