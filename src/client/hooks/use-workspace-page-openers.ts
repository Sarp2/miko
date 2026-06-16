import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import type { ChatAttachment } from '../../shared/types';
import type { LocalAttachment } from '../components/chat-composer/chat-composer-types';
import { workspacePagePath } from '../lib/middle-tabs';
import { PASTED_TEXT_LABEL } from '../lib/prompt-parts';
import { basename } from '../lib/relative-path';
import { useUiStore, type WorkspacePage } from '../stores/ui-store';
import { useWorkspaceFileStore } from '../stores/workspace-file-store';

type FilePage = Extract<WorkspacePage, { type: 'file' }>;

/**
 * Shared openers for the middle-tab file viewer. Used by both the composer (live tokens)
 * and the transcript (submitted prompts) so a clicked mention/attachment/pasted-text
 * always opens the same way.
 */
export function useWorkspacePageOpeners(workspaceId: string, sourceSessionId?: string) {
	const navigate = useNavigate();

	const openFilePage = useCallback(
		(page: FilePage) => {
			useUiStore.getState().openMiddleTab(workspaceId, page);
			navigate(workspacePagePath(workspaceId, page));
		},
		[navigate, workspaceId],
	);

	const openWorkspaceFile = useCallback(
		(path: string) => {
			openFilePage({
				type: 'file',
				source: 'workspace_file',
				path,
				title: basename(path),
				...(sourceSessionId ? { sourceSessionId } : {}),
			});
		},
		[openFilePage, sourceSessionId],
	);

	const openPastedText = useCallback(
		(id: string, text: string) => {
			useWorkspaceFileStore.getState().setPastedTextFile(workspaceId, id, text);
			openFilePage({
				type: 'file',
				source: 'pasted_text',
				sourceId: id,
				title: PASTED_TEXT_LABEL,
				...(sourceSessionId ? { sourceSessionId } : {}),
			});
		},
		[openFilePage, sourceSessionId, workspaceId],
	);

	const openAttachment = useCallback(
		(attachment: ChatAttachment) => {
			void useWorkspaceFileStore.getState().loadAttachmentFile(workspaceId, attachment);
			openFilePage({
				type: 'file',
				source: 'generated_attachment',
				sourceId: attachment.id,
				title: attachment.displayName,
				...(sourceSessionId ? { sourceSessionId } : {}),
			});
		},
		[openFilePage, sourceSessionId, workspaceId],
	);

	const openLocalAttachment = useCallback(
		(attachment: LocalAttachment) => {
			void useWorkspaceFileStore
				.getState()
				.loadLocalAttachmentFile(workspaceId, attachment.id, attachment.file, attachment.kind);
			openFilePage({
				type: 'file',
				source: 'generated_attachment',
				sourceId: attachment.id,
				title: attachment.file.name || 'file',
				...(sourceSessionId ? { sourceSessionId } : {}),
			});
		},
		[openFilePage, sourceSessionId, workspaceId],
	);

	return { openWorkspaceFile, openPastedText, openAttachment, openLocalAttachment };
}
