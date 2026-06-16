import * as React from 'react';
import type { AttachmentKind, ChatAttachment, PromptPart } from '../../../shared/types';
import { fallbackPromptParts, promptPartKey } from '../../lib/prompt-parts';
import { PromptToken } from '../prompt-token';

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
	previewUrl?: string;
}

export interface UserPromptProps {
	/** The user's message content */
	content: string;
	/** Structured prompt layout emitted by the composer. */
	parts?: PromptPart[];
	/** Optional file/image attachments */
	attachments?: UserPromptAttachment[];
	onOpenFile?: (path: string) => void;
	onOpenPastedText?: (part: Extract<PromptPart, { type: 'pasted_text' }>) => void;
	onOpenAttachment?: (attachment: ChatAttachment) => void;
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

function PromptPartsView({
	parts,
	attachments,
	onOpenFile,
	onOpenPastedText,
	onOpenAttachment,
}: {
	parts: PromptPart[];
	attachments: ChatAttachment[];
	onOpenFile?: (path: string) => void;
	onOpenPastedText?: (part: Extract<PromptPart, { type: 'pasted_text' }>) => void;
	onOpenAttachment?: (attachment: ChatAttachment) => void;
}) {
	const attachmentById = React.useMemo(
		() => new Map(attachments.map((attachment) => [attachment.id, attachment])),
		[attachments],
	);

	return (
		<div className="whitespace-pre-wrap break-words text-[14px] font-normal leading-[1.4] text-ink">
			{parts.map((part, index) => {
				if (part.type === 'text')
					// biome-ignore lint/suspicious/noArrayIndexKey: parts render in order and are never reordered.
					return <React.Fragment key={`text:${index}`}>{part.text}</React.Fragment>;
				const key = `${promptPartKey(part)}:${index}`;
				const openToken = () => {
					if (part.type === 'mention') {
						onOpenFile?.(part.path);
						return;
					}
					if (part.type === 'pasted_text') {
						onOpenPastedText?.(part);
						return;
					}

					const attachment = attachmentById.get(part.attachmentId);
					if (attachment) onOpenAttachment?.(attachment);
				};

				return (
					<PromptToken
						key={key}
						part={part}
						attachments={attachments}
						readOnly
						onOpen={openToken}
						className="mx-0.5"
					/>
				);
			})}
		</div>
	);
}

/**
 * UserPrompt displays a user message in the transcript.
 * It uses the same inline prompt tokens as the composer so mentions and files
 * keep their original position after the prompt is submitted.
 */
export function UserPrompt({
	content,
	attachments,
	parts,
	onOpenFile,
	onOpenPastedText,
	onOpenAttachment,
}: UserPromptProps) {
	const normalizedAttachments = React.useMemo(
		() => (attachments || []).map((attachment, index) => normalizeAttachment(attachment, index)),
		[attachments],
	);
	const renderedParts = React.useMemo(
		() => (parts?.length ? parts : fallbackPromptParts(content, normalizedAttachments)),
		[content, normalizedAttachments, parts],
	);

	return (
		<div className="relative min-w-0">
			<PromptPartsView
				parts={renderedParts}
				attachments={normalizedAttachments}
				onOpenFile={onOpenFile}
				onOpenPastedText={onOpenPastedText}
				onOpenAttachment={onOpenAttachment}
			/>
		</div>
	);
}
