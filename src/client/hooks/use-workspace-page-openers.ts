import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { ChatAttachment } from '../../shared/types';
import { uploadFiles } from '../components/chat-composer/chat-composer-utils';
import { workspacePagePath } from '../lib/middle-tabs';
import { PASTED_TEXT_LABEL } from '../lib/prompt-parts';
import { resolveWorkspaceFileOpenTarget } from '../lib/workspace-file-open-target';
import { useUiStore, type WorkspacePage } from '../stores/ui-store';
import { useWorkspaceFileStore } from '../stores/workspace-file-store';

type FilePage = Extract<WorkspacePage, { type: 'file' }>;

/**
 * Shared openers for the middle-tab file viewer. Used by both the composer (live tokens)
 * and the transcript (submitted prompts) so a clicked mention/attachment/pasted-text
 * always opens the same way.
 */
export function useWorkspacePageOpeners(
	workspaceId: string,
	sourceSessionId?: string,
	workspaceRoot?: string,
) {
	const navigate = useNavigate();
	const pastedTextUploadByIdRef = useRef(new Map<string, Promise<ChatAttachment | null>>());

	const openFilePage = useCallback(
		(page: FilePage) => {
			useUiStore.getState().openMiddleTab(workspaceId, page);
			navigate(workspacePagePath(workspaceId, page));
		},
		[navigate, workspaceId],
	);

	const openWorkspaceFile = useCallback(
		(path: string) => {
			const target = resolveWorkspaceFileOpenTarget({ path, workspaceRoot, sourceSessionId });
			if (target.kind === 'page') openFilePage(target.page);
		},
		[openFilePage, sourceSessionId, workspaceRoot],
	);

	const openWorkspaceDiff = useCallback(
		(path: string) => {
			const page: WorkspacePage = { type: 'diff', path, source: 'workspace' };
			useUiStore.getState().openMiddleTab(workspaceId, page);
			navigate(workspacePagePath(workspaceId, page));
		},
		[navigate, workspaceId],
	);

	const openPastedText = useCallback(
		async (id: string, text: string) => {
			try {
				const existingUpload = pastedTextUploadByIdRef.current.get(id);
				const upload =
					existingUpload ??
					uploadFiles(workspaceId, [new File([text], 'pasted-text.txt', { type: 'text/plain' })])
						.then((attachments) => attachments[0] ?? null)
						.catch((error) => {
							pastedTextUploadByIdRef.current.delete(id);
							throw error;
						});
				if (!existingUpload) pastedTextUploadByIdRef.current.set(id, upload);

				const uploaded = await upload;
				if (!uploaded) return;

				const attachment: ChatAttachment = { ...uploaded, displayName: PASTED_TEXT_LABEL };
				void useWorkspaceFileStore.getState().loadAttachmentFile(workspaceId, attachment);
				openFilePage({
					type: 'file',
					source: 'generated_attachment',
					sourceId: attachment.id,
					title: PASTED_TEXT_LABEL,
					attachment,
					...(sourceSessionId ? { sourceSessionId } : {}),
				});
			} catch (error) {
				console.warn('[workspace-page-openers] failed to persist pasted text', error);
				toast.error('Could not open pasted text');
			}
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
				attachment,
				...(sourceSessionId ? { sourceSessionId } : {}),
			});
		},
		[openFilePage, sourceSessionId, workspaceId],
	);

	return { openWorkspaceFile, openWorkspaceDiff, openPastedText, openAttachment };
}
