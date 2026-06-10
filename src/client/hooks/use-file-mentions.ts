import { useCallback, useMemo, useRef, useState } from 'react';

import type { WorkspaceDiffFile } from '../../shared/types';
import {
	activeMentionRange,
	type MentionRange,
	mentionOptionsFromGitFiles,
} from '../components/chat-composer/chat-composer-utils';
import type { FileMentionOption } from '../components/chat-composer/file-mention-popover';

interface UseFileMentionsArgs {
	content: string;
	files: WorkspaceDiffFile[];
	onContentChange: (content: string) => void;
}

export function useFileMentions({ content, files, onContentChange }: UseFileMentionsArgs) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [mentionRange, setMentionRange] = useState<MentionRange | null>(null);
	const mentionOptions = useMemo(() => mentionOptionsFromGitFiles(files), [files]);
	const filteredMentionOptions = useMemo(() => {
		const query = mentionRange?.query.trim().toLowerCase() ?? '';
		if (!query) return mentionOptions.slice(0, 20);
		return mentionOptions
			.filter((option) => option.relativePath.toLowerCase().includes(query))
			.slice(0, 20);
	}, [mentionOptions, mentionRange]);

	const refreshMentionRange = useCallback((value: string) => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		setMentionRange(activeMentionRange(value, textarea.selectionStart));
	}, []);

	const updateContent = useCallback(
		(nextContent: string) => {
			onContentChange(nextContent);
			requestAnimationFrame(() => refreshMentionRange(nextContent));
		},
		[onContentChange, refreshMentionRange],
	);

	const insertMention = useCallback(
		(option: FileMentionOption) => {
			if (!mentionRange) return;
			const inserted = `@${option.relativePath} `;
			const nextContent = `${content.slice(0, mentionRange.start)}${inserted}${content.slice(mentionRange.end)}`;
			const nextCursor = mentionRange.start + inserted.length;
			onContentChange(nextContent);
			setMentionRange(null);
			requestAnimationFrame(() => {
				textareaRef.current?.focus();
				textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
			});
		},
		[content, mentionRange, onContentChange],
	);

	const closeMentions = useCallback(() => setMentionRange(null), []);

	return {
		textareaRef,
		mentionRange,
		mentionOptions: filteredMentionOptions,
		refreshMentionRange,
		updateContent,
		insertMention,
		closeMentions,
	};
}
