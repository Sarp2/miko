import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatAttachment, PromptPart, WorkspaceSnapshot } from '../../shared/types';
import type { LocalAttachment } from '../components/chat-composer/chat-composer-types';
import { activeMentionRange } from '../components/chat-composer/chat-composer-utils';
import type { FileMentionOption } from '../components/chat-composer/file-mention-popover';
import { promptTokenEditorHtml } from '../components/prompt-token';
import {
	compactPromptParts,
	promptPartFromPastedText,
	promptPartKey,
	promptPartsTextLength,
	promptPartText,
	replaceRangeWithParts,
} from '../lib/prompt-parts';
import { useWorkspaceStore } from '../stores/workspace-store';

// This hook drives a contenteditable surface that mixes plain text with atomic token
// chips (mentions, attachments, pasted text). It maps between two representations:
//   - PromptPart[]: the source of truth, where each token contributes its inline-text
//     length (see promptPartText) so the document reads as one flat string.
//   - the DOM: text nodes plus token <span data-token-key> elements.
// Caret positions are tracked as integer offsets into that flat string. The DOM walkers
// below (nodeText/boundaryOffset/caretOffset/restoreCaret) convert between DOM selection
// ranges and those offsets, treating each token as a single opaque run of characters so
// the caret never lands inside a chip.

const FILE_SEARCH_DEBOUNCE_MS = 150;
const FILE_SEARCH_LIMIT = 20;

function escapeTextHtml(value: string) {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function editorHtmlFromParts(parts: PromptPart[], attachments: ChatAttachment[]) {
	return parts
		.map((part) =>
			part.type === 'text' ? escapeTextHtml(part.text) : promptTokenEditorHtml(part, attachments),
		)
		.join('');
}

function localAttachmentsAsChatAttachments(attachments: LocalAttachment[]) {
	return attachments.map(
		(attachment) =>
			({
				id: attachment.id,
				kind: attachment.kind,
				displayName: attachment.file.name,
				absolutePath: attachment.file.name,
				relativePath: attachment.file.name,
				contentUrl: '',
				mimeType: attachment.file.type || 'application/octet-stream',
				size: attachment.file.size,
			}) satisfies ChatAttachment,
	);
}

function tokenTextFromElement(
	element: HTMLElement,
	tokenPartsByKey: Map<string, PromptPart>,
	attachments: ChatAttachment[],
) {
	const tokenKey = element.dataset.tokenKey;
	const tokenPart = tokenKey ? tokenPartsByKey.get(tokenKey) : null;
	return tokenPart ? promptPartText(tokenPart, attachments) : element.innerText;
}

function nodeText(
	node: Node,
	tokenPartsByKey: Map<string, PromptPart>,
	attachments: ChatAttachment[],
): string {
	if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
	if (node instanceof HTMLBRElement) return '\n';
	if (node instanceof HTMLElement) {
		if (node.dataset.tokenKey) return tokenTextFromElement(node, tokenPartsByKey, attachments);
		return Array.from(node.childNodes)
			.map((child) => nodeText(child, tokenPartsByKey, attachments))
			.join('');
	}
	return '';
}

function promptTextFromDom(
	root: HTMLElement,
	tokenPartsByKey: Map<string, PromptPart>,
	attachments: ChatAttachment[],
) {
	return Array.from(root.childNodes)
		.map((child) => nodeText(child, tokenPartsByKey, attachments))
		.join('')
		.replace(/ /g, '');
}

function boundaryOffset(
	root: HTMLElement,
	targetNode: Node,
	targetOffset: number,
	tokenPartsByKey: Map<string, PromptPart>,
	attachments: ChatAttachment[],
) {
	if (targetNode === root) {
		return Array.from(root.childNodes)
			.slice(0, targetOffset)
			.reduce((offset, child) => offset + nodeText(child, tokenPartsByKey, attachments).length, 0);
	}

	let offset = 0;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
	let node = walker.nextNode();

	while (node) {
		if (node === targetNode) {
			if (node.nodeType === Node.TEXT_NODE) return offset + targetOffset;
			if (node instanceof HTMLElement) {
				return (
					offset +
					Array.from(node.childNodes)
						.slice(0, targetOffset)
						.reduce(
							(nextOffset, child) =>
								nextOffset + nodeText(child, tokenPartsByKey, attachments).length,
							0,
						)
				);
			}
			return offset;
		}

		if (node instanceof HTMLElement && node.dataset.tokenKey) {
			if (node.contains(targetNode)) return offset;
			offset += tokenTextFromElement(node, tokenPartsByKey, attachments).length;
			walker.currentNode = node;
			node = walker.nextSibling();
			continue;
		}

		if (node.nodeType === Node.TEXT_NODE) offset += node.textContent?.length ?? 0;
		else if (node instanceof HTMLBRElement) offset += 1;

		node = walker.nextNode();
	}

	return offset;
}

function selectionOffsets(
	root: HTMLElement,
	tokenPartsByKey: Map<string, PromptPart>,
	attachments: ChatAttachment[],
) {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		const offset = promptTextFromDom(root, tokenPartsByKey, attachments).length;
		return { start: offset, end: offset };
	}

	const range = selection.getRangeAt(0);
	if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
		const offset = promptTextFromDom(root, tokenPartsByKey, attachments).length;
		return { start: offset, end: offset };
	}

	const start = boundaryOffset(
		root,
		range.startContainer,
		range.startOffset,
		tokenPartsByKey,
		attachments,
	);
	const end = boundaryOffset(
		root,
		range.endContainer,
		range.endOffset,
		tokenPartsByKey,
		attachments,
	);
	return { start: Math.min(start, end), end: Math.max(start, end) };
}

function caretOffset(
	root: HTMLElement,
	tokenPartsByKey: Map<string, PromptPart>,
	attachments: ChatAttachment[],
) {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return promptTextFromDom(root, tokenPartsByKey, attachments).length;
	}

	const range = selection.getRangeAt(0);
	if (!root.contains(range.startContainer)) {
		return promptTextFromDom(root, tokenPartsByKey, attachments).length;
	}

	let offset = 0;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
	let node = walker.nextNode();

	while (node) {
		if (node === range.startContainer) {
			if (node.nodeType === Node.TEXT_NODE) return offset + range.startOffset;
			return offset;
		}

		if (node instanceof HTMLElement && node.dataset.tokenKey) {
			if (node.contains(range.startContainer)) return offset;
			offset += tokenTextFromElement(node, tokenPartsByKey, attachments).length;
			walker.currentNode = node;
			node = walker.nextSibling();
			continue;
		}

		if (node.nodeType === Node.TEXT_NODE) offset += node.textContent?.length ?? 0;
		else if (node instanceof HTMLBRElement) offset += 1;

		node = walker.nextNode();
	}

	return offset;
}

function restoreCaret(
	root: HTMLElement,
	tokenPartsByKey: Map<string, PromptPart>,
	attachments: ChatAttachment[],
	targetOffset: number,
) {
	const selection = window.getSelection();
	if (!selection) return;
	let remaining = targetOffset;

	for (const child of Array.from(root.childNodes)) {
		const length = nodeText(child, tokenPartsByKey, attachments).length;
		if (child.nodeType === Node.TEXT_NODE && remaining <= length) {
			const range = document.createRange();
			range.setStart(child, remaining);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
			return;
		}

		if (child instanceof HTMLElement && child.dataset.tokenKey && remaining <= length) {
			const range = document.createRange();
			range.setStartAfter(child);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
			return;
		}

		remaining -= length;
	}

	const range = document.createRange();
	range.selectNodeContents(root);
	range.collapse(false);
	selection.removeAllRanges();
	selection.addRange(range);
}

function parseEditorParts(
	root: HTMLElement,
	tokenPartsByKey: Map<string, PromptPart>,
	attachments: ChatAttachment[],
) {
	const parts: PromptPart[] = [];

	for (const node of Array.from(root.childNodes)) {
		if (node.nodeType === Node.TEXT_NODE) {
			parts.push({ type: 'text', text: node.textContent ?? '' });
			continue;
		}

		if (!(node instanceof HTMLElement)) continue;
		const tokenKey = node.dataset.tokenKey;
		const tokenPart = tokenKey ? tokenPartsByKey.get(tokenKey) : null;
		parts.push(tokenPart ?? { type: 'text', text: nodeText(node, tokenPartsByKey, attachments) });
	}

	return compactPromptParts(parts);
}

export function useInlinePromptEditor({
	attachments,
	parts,
	setParts,
	workspaceId,
	workspaceSnapshot,
}: {
	attachments: LocalAttachment[];
	parts: PromptPart[];
	setParts: (parts: PromptPart[]) => void;
	workspaceId: string;
	workspaceSnapshot: WorkspaceSnapshot;
}) {
	const editorRef = useRef<HTMLDivElement>(null);
	const pendingCaretOffsetRef = useRef<number | null>(null);
	const skipNextDomSyncRef = useRef(false);
	const searchRequestIdRef = useRef(0);
	const attachmentTokens = useMemo(
		() => localAttachmentsAsChatAttachments(attachments),
		[attachments],
	);
	const tokenPartsByKey = useMemo(
		() =>
			new Map(
				parts
					.filter((part): part is Exclude<PromptPart, { type: 'text' }> => part.type !== 'text')
					.map((part) => [promptPartKey(part), part]),
			),
		[parts],
	);
	const [mentionRange, setMentionRange] = useState<ReturnType<typeof activeMentionRange>>(null);
	const [mentionOptions, setMentionOptions] = useState<FileMentionOption[]>([]);
	const [searchedQuery, setSearchedQuery] = useState('');
	const [isMentionLoading, setIsMentionLoading] = useState(false);
	const mentionQuery = mentionRange?.query.trim() ?? '';
	const editorHtml = useMemo(
		() => editorHtmlFromParts(parts, attachmentTokens),
		[attachmentTokens, parts],
	);

	const refreshMentionRange = useCallback(() => {
		const editor = editorRef.current;
		if (!editor) return;
		setMentionRange(
			activeMentionRange(
				promptTextFromDom(editor, tokenPartsByKey, attachmentTokens),
				caretOffset(editor, tokenPartsByKey, attachmentTokens),
			),
		);
	}, [attachmentTokens, tokenPartsByKey]);

	useLayoutEffect(() => {
		const editor = editorRef.current;
		if (!editor) return;

		if (skipNextDomSyncRef.current) {
			skipNextDomSyncRef.current = false;
			if (pendingCaretOffsetRef.current === null) return;
		}

		if (editor.innerHTML !== editorHtml) editor.innerHTML = editorHtml;

		if (pendingCaretOffsetRef.current !== null) {
			restoreCaret(editor, tokenPartsByKey, attachmentTokens, pendingCaretOffsetRef.current);
			pendingCaretOffsetRef.current = null;
		}
	}, [attachmentTokens, editorHtml, tokenPartsByKey]);

	useLayoutEffect(() => {
		if (!mentionRange || !mentionQuery) {
			searchRequestIdRef.current += 1;
			setMentionOptions(
				(workspaceSnapshot.git?.files ?? []).slice(0, FILE_SEARCH_LIMIT).map((file) => ({
					id: file.path,
					name: file.path.split('/').filter(Boolean).at(-1) ?? file.path,
					relativePath: file.path,
				})),
			);
			setSearchedQuery('');
			setIsMentionLoading(false);
			return;
		}

		const requestId = searchRequestIdRef.current + 1;
		searchRequestIdRef.current = requestId;
		setIsMentionLoading(true);
		setMentionOptions([]);
		const timeoutId = window.setTimeout(() => {
			useWorkspaceStore
				.getState()
				.searchFiles(workspaceId, mentionQuery, FILE_SEARCH_LIMIT)
				.then((results) => {
					if (searchRequestIdRef.current !== requestId) return;
					setMentionOptions(results);
					setSearchedQuery(mentionQuery);
				})
				.catch(() => {
					if (searchRequestIdRef.current !== requestId) return;
					setMentionOptions([]);
					setSearchedQuery(mentionQuery);
				})
				.finally(() => {
					if (searchRequestIdRef.current !== requestId) return;
					setIsMentionLoading(false);
				});
		}, FILE_SEARCH_DEBOUNCE_MS);

		return () => {
			clearTimeout(timeoutId);
			if (searchRequestIdRef.current === requestId) searchRequestIdRef.current += 1;
		};
	}, [mentionQuery, mentionRange, workspaceId, workspaceSnapshot.git?.files]);

	const syncPartsFromDom = useCallback(() => {
		const editor = editorRef.current;
		if (!editor) return;
		skipNextDomSyncRef.current = true;
		setParts(parseEditorParts(editor, tokenPartsByKey, attachmentTokens));
		requestAnimationFrame(refreshMentionRange);
	}, [attachmentTokens, refreshMentionRange, setParts, tokenPartsByKey]);

	const insertPastedText = useCallback(
		(text: string) => {
			const editor = editorRef.current;
			if (!editor) return;
			const { start, end } = selectionOffsets(editor, tokenPartsByKey, attachmentTokens);
			const inserted = promptPartFromPastedText(text);
			setParts(replaceRangeWithParts(parts, attachmentTokens, start, end, inserted));
			pendingCaretOffsetRef.current = start + promptPartsTextLength(inserted, attachmentTokens);
			setMentionRange(null);
			requestAnimationFrame(() => editorRef.current?.focus());
		},
		[attachmentTokens, parts, setParts, tokenPartsByKey],
	);

	const insertMention = useCallback(
		(option: FileMentionOption) => {
			if (!mentionRange) return;
			setParts(
				replaceRangeWithParts(parts, attachmentTokens, mentionRange.start, mentionRange.end, [
					{ type: 'mention', path: option.relativePath, label: option.name },
					{ type: 'text', text: ' ' },
				]),
			);
			pendingCaretOffsetRef.current = mentionRange.start + `@${option.relativePath} `.length;
			setMentionRange(null);
			requestAnimationFrame(() => editorRef.current?.focus());
		},
		[attachmentTokens, mentionRange, parts, setParts],
	);

	return {
		editorRef,
		insertMention,
		insertPastedText,
		isMentionLoading: isMentionLoading || (Boolean(mentionQuery) && searchedQuery !== mentionQuery),
		mentionOptions: mentionQuery && searchedQuery !== mentionQuery ? [] : mentionOptions,
		mentionRange,
		refreshMentionRange,
		setMentionRange,
		syncPartsFromDom,
	};
}
