import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { WorkspaceDiffFile } from '../../shared/types';
import {
	activeMentionRange,
	type MentionRange,
	mentionOptionsFromGitFiles,
} from '../components/chat-composer/chat-composer-utils';
import type { FileMentionOption } from '../components/chat-composer/file-mention-popover';
import { useWorkspaceStore } from '../stores/workspace-store';

const FILE_SEARCH_DEBOUNCE_MS = 150;
const FILE_SEARCH_LIMIT = 20;

interface UseFileMentionsArgs {
	workspaceId: string;
	content: string;
	files: WorkspaceDiffFile[];
	onContentChange: (content: string) => void;
}

export function useFileMentions({
	workspaceId,
	content,
	files,
	onContentChange,
}: UseFileMentionsArgs) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const requestIdRef = useRef(0);
	const [mentionRange, setMentionRange] = useState<MentionRange | null>(null);
	const [searchedMentionOptions, setSearchedMentionOptions] = useState<FileMentionOption[]>([]);
	const [searchedMentionQuery, setSearchedMentionQuery] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const changedFileMentionOptions = useMemo(() => mentionOptionsFromGitFiles(files), [files]);
	const mentionOpen = mentionRange !== null;
	const mentionQuery = mentionRange?.query.trim() ?? '';
	const changedFileFilteredOptions = useMemo(() => {
		const query = mentionRange?.query.trim().toLowerCase() ?? '';
		if (!query) return changedFileMentionOptions.slice(0, FILE_SEARCH_LIMIT);
		return changedFileMentionOptions
			.filter((option) => option.relativePath.toLowerCase().includes(query))
			.slice(0, FILE_SEARCH_LIMIT);
	}, [changedFileMentionOptions, mentionRange]);

	useEffect(() => {
		if (!mentionOpen || !mentionQuery) {
			requestIdRef.current += 1;
			setSearchedMentionOptions([]);
			setSearchedMentionQuery('');
			setIsLoading(false);
			return;
		}

		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		setSearchedMentionOptions([]);
		setIsLoading(true);

		const timeoutId = window.setTimeout(() => {
			useWorkspaceStore
				.getState()
				.searchFiles(workspaceId, mentionQuery, FILE_SEARCH_LIMIT)
				.then((results) => {
					if (requestIdRef.current !== requestId) return;
					setSearchedMentionOptions(results);
					setSearchedMentionQuery(mentionQuery);
				})
				.catch(() => {
					if (requestIdRef.current !== requestId) return;
					setSearchedMentionOptions([]);
					setSearchedMentionQuery(mentionQuery);
				})
				.finally(() => {
					if (requestIdRef.current !== requestId) return;
					setIsLoading(false);
				});
		}, FILE_SEARCH_DEBOUNCE_MS);

		return () => {
			clearTimeout(timeoutId);
			if (requestIdRef.current === requestId) requestIdRef.current += 1;
		};
	}, [mentionOpen, mentionQuery, workspaceId]);

	const hasSearchResultForQuery = mentionQuery.length > 0 && searchedMentionQuery === mentionQuery;
	const mentionOptions = mentionQuery
		? hasSearchResultForQuery
			? searchedMentionOptions
			: []
		: changedFileFilteredOptions;
	const mentionSearchLoading = mentionQuery.length > 0 && (!hasSearchResultForQuery || isLoading);

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
		mentionOptions,
		isLoading: mentionSearchLoading,
		refreshMentionRange,
		updateContent,
		insertMention,
		closeMentions,
	};
}
