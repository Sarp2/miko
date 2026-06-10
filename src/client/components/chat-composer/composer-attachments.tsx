import { File } from '@phosphor-icons/react';

import type { LocalAttachment } from './chat-composer-types';

export function AttachmentPill({
	attachment,
	onRemove,
}: {
	attachment: LocalAttachment;
	onRemove: () => void;
}) {
	return (
		<div className="group flex min-w-0 items-center gap-2 rounded-md border border-hairline bg-surface-1 px-2 py-1 text-caption text-ink-muted">
			<File className="size-3 shrink-0 text-ink-subtle" />
			<span className="max-w-40 truncate">{attachment.file.name}</span>
			<button
				type="button"
				onClick={onRemove}
				className="rounded px-1 text-ink-tertiary opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
				aria-label={`Remove ${attachment.file.name}`}
			>
				×
			</button>
		</div>
	);
}
