import { ArrowsOutSimple } from '@phosphor-icons/react';
import * as React from 'react';
import { cn } from '../../lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import {
	AttachmentCard,
	type AttachmentKind,
	type ChatAttachment,
	formatAttachmentSize,
} from './attachment-card';

export interface UserPromptAttachment {
	id?: string;
	name?: string;
	displayName?: string;
	type?: string;
	mimeType?: string;
	size?: number;
	kind?: AttachmentKind;
	absolutePath?: string;
	relativePath?: string;
	contentUrl?: string;
	/** Optional text shown in attachment preview dialog for text-like files */
	previewText?: string;
	/** Optional URL shown in attachment preview dialog for image files */
	previewUrl?: string;
}

export interface UserPromptProps {
	/** The user's message content */
	content: string;
	/** Optional file/image attachments */
	attachments?: UserPromptAttachment[];
	/** Optional CSS class */
	className?: string;
}

function isTextPreviewType(type: string): boolean {
	return (
		type.startsWith('text/') ||
		type.includes('json') ||
		type.includes('javascript') ||
		type.includes('typescript') ||
		type.includes('xml') ||
		type.includes('yaml')
	);
}

function normalizeAttachment(attachment: UserPromptAttachment, index: number): ChatAttachment {
	const displayName = attachment.displayName || attachment.name || `attachment-${index + 1}`;
	const mimeType = attachment.mimeType || attachment.type || 'application/octet-stream';
	const normalizedMimeType = mimeType.toLowerCase();
	const inferredKind: AttachmentKind = attachment.kind
		? attachment.kind
		: normalizedMimeType.startsWith('image/')
			? 'image'
			: 'file';

	return {
		id: attachment.id || `${displayName}:${index}`,
		kind: inferredKind,
		displayName,
		absolutePath: attachment.absolutePath || displayName,
		relativePath: attachment.relativePath || displayName,
		contentUrl: attachment.contentUrl || attachment.previewUrl || '',
		mimeType,
		size: attachment.size ?? 0,
	};
}

/**
 * UserPrompt displays a user message in the transcript.
 * Follows Linear design system with surface-1 background and hairline borders.
 */
export function UserPrompt({ content, attachments, className }: UserPromptProps) {
	const [isOpen, setIsOpen] = React.useState(false);
	const [openAttachmentId, setOpenAttachmentId] = React.useState<string | null>(null);
	const [previewTextByUrl, setPreviewTextByUrl] = React.useState<Record<string, string>>({});
	const [previewErrorByUrl, setPreviewErrorByUrl] = React.useState<Record<string, string>>({});
	const maxLength = 150;
	const normalizedAttachments = React.useMemo(
		() =>
			(attachments || []).map((attachment, index) => ({
				raw: attachment,
				normalized: normalizeAttachment(attachment, index),
			})),
		[attachments],
	);

	const isTruncated = content.length > maxLength;
	const displayContent = isTruncated ? `${content.slice(0, maxLength)}...` : content;
	const selectedAttachment = React.useMemo(
		() =>
			normalizedAttachments.find(({ normalized }) => normalized.id === openAttachmentId) ?? null,
		[normalizedAttachments, openAttachmentId],
	);
	const selectedPreviewUrl = selectedAttachment?.normalized.contentUrl || '';
	const selectedIsTextPreview = selectedAttachment
		? isTextPreviewType(selectedAttachment.normalized.mimeType.toLowerCase())
		: false;
	const hasFetchedPreviewText = selectedPreviewUrl
		? Object.hasOwn(previewTextByUrl, selectedPreviewUrl)
		: false;
	const hasPreviewError = selectedPreviewUrl
		? Object.hasOwn(previewErrorByUrl, selectedPreviewUrl)
		: false;
	const selectedPreviewText =
		selectedAttachment?.raw.previewText ??
		(hasFetchedPreviewText ? previewTextByUrl[selectedPreviewUrl] : undefined);
	const selectedPreviewError = hasPreviewError ? previewErrorByUrl[selectedPreviewUrl] : undefined;

	React.useEffect(() => {
		if (!selectedAttachment || !selectedIsTextPreview || selectedAttachment.raw.previewText) return;
		if (!selectedPreviewUrl || hasFetchedPreviewText || hasPreviewError) return;

		const controller = new AbortController();
		void fetch(selectedPreviewUrl, { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error(`Preview failed with ${response.status}`);
				return await response.text();
			})
			.then((text) => {
				setPreviewTextByUrl((current) => ({ ...current, [selectedPreviewUrl]: text }));
			})
			.catch((error) => {
				if (error instanceof DOMException && error.name === 'AbortError') return;
				setPreviewErrorByUrl((current) => ({
					...current,
					[selectedPreviewUrl]: 'Preview unavailable for this attachment.',
				}));
			});

		return () => controller.abort();
	}, [
		hasFetchedPreviewText,
		hasPreviewError,
		selectedAttachment,
		selectedIsTextPreview,
		selectedPreviewUrl,
	]);

	return (
		<>
			<div className="flex">
				<div
					className={cn(
						'rounded-lg border border-hairline bg-surface-2 p-4 relative inline-block w-fit max-w-[68ch]',
						className,
					)}
				>
					{isTruncated ? (
						<button
							type="button"
							className={cn(
								'text-body text-ink whitespace-pre-wrap',
								'cursor-pointer hover:text-ink-muted transition-colors',
							)}
							onClick={() => setIsOpen(true)}
							aria-label="Click to view full message"
						>
							{displayContent}
						</button>
					) : (
						<div className="text-body text-ink whitespace-pre-wrap">{displayContent}</div>
					)}

					{isTruncated && (
						<div className="absolute top-2 right-2 pointer-events-none">
							<ArrowsOutSimple className="size-3 text-ink-subtle" weight="bold" />
						</div>
					)}

					{attachments && attachments.length > 0 && (
						<div className="mt-3 flex flex-wrap gap-2">
							{normalizedAttachments.map(({ normalized }) => {
								const attachmentKey = normalized.id;
								return (
									<AttachmentCard
										key={attachmentKey}
										attachment={normalized}
										onClick={() => setOpenAttachmentId(attachmentKey)}
									/>
								);
							})}
						</div>
					)}
				</div>
			</div>

			<Dialog open={isOpen} onOpenChange={setIsOpen}>
				<DialogContent className="max-w-2xl bg-surface-1 border-hairline">
					<DialogHeader>
						<DialogTitle className="text-body font-medium text-ink">Full message</DialogTitle>
					</DialogHeader>
					<div className="text-sm font-normal leading-relaxed text-ink whitespace-pre-wrap max-h-[60vh] overflow-y-auto">
						{content}
					</div>
				</DialogContent>
			</Dialog>

			<Dialog
				open={Boolean(selectedAttachment)}
				onOpenChange={(open) => {
					if (!open) setOpenAttachmentId(null);
				}}
			>
				<DialogContent className="max-w-2xl bg-surface-1 border-hairline">
					<DialogHeader>
						<DialogTitle className="text-body font-medium text-ink">
							{selectedAttachment?.normalized.displayName || 'Attachment Preview'}
						</DialogTitle>
					</DialogHeader>
					{selectedAttachment ? (
						<div className="space-y-3">
							<div className="flex items-center justify-between gap-3">
								<span className="truncate text-caption text-ink-subtle">
									{selectedAttachment.normalized.mimeType}
								</span>
								<span className="shrink-0 text-caption text-ink-tertiary">
									{selectedAttachment.normalized.size
										? formatAttachmentSize(selectedAttachment.normalized.size)
										: ''}
								</span>
							</div>

							{selectedAttachment.normalized.mimeType.toLowerCase().startsWith('image/') &&
							(selectedAttachment.raw.previewUrl || selectedAttachment.normalized.contentUrl) ? (
								<div className="overflow-hidden rounded-md border border-hairline bg-surface-2">
									<img
										src={
											selectedAttachment.raw.previewUrl || selectedAttachment.normalized.contentUrl
										}
										alt={selectedAttachment.normalized.displayName}
										className="max-h-[65vh] w-full object-contain"
									/>
								</div>
							) : null}

							{selectedIsTextPreview && selectedPreviewText !== undefined ? (
								<pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-hairline bg-surface-2 p-3 font-mono text-caption leading-relaxed text-ink-muted">
									{selectedPreviewText}
								</pre>
							) : null}

							{selectedIsTextPreview &&
							selectedPreviewUrl &&
							selectedPreviewText === undefined &&
							!selectedPreviewError ? (
								<div className="rounded-md border border-hairline bg-surface-2 p-3">
									<span className="text-body-sm text-ink-subtle">Loading preview...</span>
								</div>
							) : null}

							{!(
								(selectedAttachment.normalized.mimeType.toLowerCase().startsWith('image/') &&
									(selectedAttachment.raw.previewUrl ||
										selectedAttachment.normalized.contentUrl)) ||
								(selectedIsTextPreview &&
									(selectedPreviewText !== undefined ||
										(Boolean(selectedPreviewUrl) && !selectedPreviewError)))
							) ? (
								<div className="rounded-md border border-hairline bg-surface-2 p-3">
									<span className="text-body-sm text-ink-subtle">
										{selectedPreviewError || 'Preview unavailable for this file type.'}
									</span>
								</div>
							) : null}
						</div>
					) : null}
				</DialogContent>
			</Dialog>
		</>
	);
}
