import type { ChatAttachment, PromptPart } from '../../shared/types';

/** User-facing label for pasted-text tokens and tabs. */
export const PASTED_TEXT_LABEL = 'Pasted text';

type PromptTokenPart = Exclude<PromptPart, { type: 'text' }>;

function basename(path: string) {
	return path.split('/').filter(Boolean).at(-1) ?? path;
}

function attachmentName(attachments: ChatAttachment[], attachmentId: string) {
	return attachments.find((attachment) => attachment.id === attachmentId)?.displayName;
}

/** Stable identity for a non-text part, used as a React key and editor token key. */
export function promptPartKey(part: PromptPart): string {
	if (part.type === 'mention') return `mention:${part.path}`;
	if (part.type === 'attachment') return `attachment:${part.attachmentId}`;
	if (part.type === 'pasted_text') return `pasted_text:${part.id}`;
	return '';
}

/** Inline plain-text rendering of a part, used when flattening parts back to a string. */
export function promptPartText(part: PromptPart, attachments: ChatAttachment[] = []): string {
	if (part.type === 'text') return part.text;
	if (part.type === 'mention') return `@${part.path}`;
	if (part.type === 'pasted_text') return part.text;
	return attachmentName(attachments, part.attachmentId) ?? 'file';
}

/** Short label shown inside a token chip. */
export function promptPartLabel(part: PromptTokenPart, attachments: ChatAttachment[] = []): string {
	if (part.type === 'mention') return part.label || basename(part.path);
	if (part.type === 'pasted_text') return PASTED_TEXT_LABEL;
	return attachmentName(attachments, part.attachmentId) ?? 'file';
}

/** Tooltip / hover text for a token chip. */
export function promptPartTooltip(
	part: PromptTokenPart,
	attachments: ChatAttachment[] = [],
): string {
	if (part.type === 'mention') return part.path;
	if (part.type === 'pasted_text') return part.text;
	const attachment = attachments.find((item) => item.id === part.attachmentId);
	return attachment?.relativePath || attachment?.displayName || 'file';
}

export function promptPartLength(part: PromptPart, attachments: ChatAttachment[] = []): number {
	return promptPartText(part, attachments).length;
}

export function promptPartsTextLength(parts: PromptPart[], attachments: ChatAttachment[] = []) {
	return parts.reduce((length, part) => length + promptPartLength(part, attachments), 0);
}

export function compactPromptParts(parts: PromptPart[]) {
	const compacted: PromptPart[] = [];

	for (const part of parts) {
		if (part.type === 'text') {
			if (part.text.length === 0) continue;
			const previous = compacted.at(-1);
			if (previous?.type === 'text') {
				previous.text += part.text;
			} else {
				compacted.push({ ...part });
			}
			continue;
		}

		compacted.push({ ...part });
	}

	return compacted;
}

export function promptPartsPlainText(parts: PromptPart[], attachments: ChatAttachment[] = []) {
	return parts.map((part) => promptPartText(part, attachments)).join('');
}

export function fallbackPromptParts(content: string, attachments: ChatAttachment[] = []) {
	const parts: PromptPart[] = [];
	if (content.length > 0) parts.push({ type: 'text', text: content });
	if (attachments.length > 0 && content.length > 0) parts.push({ type: 'text', text: '\n' });
	for (const attachment of attachments) {
		if (parts.length > 0 && parts.at(-1)?.type !== 'text') parts.push({ type: 'text', text: ' ' });
		parts.push({ type: 'attachment', attachmentId: attachment.id });
	}
	return compactPromptParts(parts);
}

export function promptPartFromPastedText(text: string): PromptPart[] {
	if (!text) return [];
	return [{ type: 'pasted_text', id: crypto.randomUUID(), text }];
}

/**
 * Replace the inline-text range [start, end) with `inserted`, treating every part
 * as occupying `promptPartText(part).length` characters. Text parts are split at the
 * boundary; non-text tokens are atomic and dropped whole when the range overlaps them.
 */
export function replaceRangeWithParts(
	parts: PromptPart[],
	attachments: ChatAttachment[],
	start: number,
	end: number,
	inserted: PromptPart[],
) {
	const next: PromptPart[] = [];
	let offset = 0;
	let insertedWritten = false;

	for (const part of parts) {
		const length = promptPartLength(part, attachments);
		const partStart = offset;
		const partEnd = offset + length;

		if (partEnd <= start || partStart >= end) {
			if (!insertedWritten && partStart >= end) {
				next.push(...inserted);
				insertedWritten = true;
			}
			next.push(part);
			offset = partEnd;
			continue;
		}

		if (part.type === 'text') {
			const keepLeft = Math.max(0, start - partStart);
			const keepRight = Math.max(0, partEnd - end);
			if (keepLeft > 0) next.push({ type: 'text', text: part.text.slice(0, keepLeft) });
			if (!insertedWritten) {
				next.push(...inserted);
				insertedWritten = true;
			}
			if (keepRight > 0)
				next.push({ type: 'text', text: part.text.slice(part.text.length - keepRight) });
		} else if (!insertedWritten) {
			next.push(...inserted);
			insertedWritten = true;
		}

		offset = partEnd;
	}

	if (!insertedWritten) next.push(...inserted);
	return compactPromptParts(next);
}
