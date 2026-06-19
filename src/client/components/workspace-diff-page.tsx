import type { DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs';
import { FileDiff, PatchDiff } from '@pierre/diffs/react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SessionSnapshot } from '../../shared/types';
import type { DiffSelectionRoot } from '../lib/diff-selection';
import { selectedRangeFromNativeSelection } from '../lib/diff-selection';
import { Icons } from '../lib/icons';
import {
	ensureMikoDiffTheme,
	MIKO_CODE_FONT_VARS,
	MIKO_DIFF_OPTIONS,
} from '../lib/miko-diff-renderer';
import { findTranscriptChangedFile, transcriptFileDiff } from '../lib/transcript-diff';
import { useChatWindowStore } from '../stores/chat-window-store';
import { useSessionStore } from '../stores/session-store';
import { useUiStore } from '../stores/ui-store';
import { useWorkspaceFileStore } from '../stores/workspace-file-store';
import {
	CopyFileButton,
	DiffFileSegmentedControl,
	DiffRefreshButton,
	DiffViewModeToggle,
	ViewedDiffButton,
	WorkspaceCodeToolbar,
} from './workspace-code-toolbar';
import {
	buildInlineCommentSendDefaults,
	type DiffCommentDraft,
	type DiffCommentMetadata,
	DiffInlineCommentComposer,
	formatDiffCommentMessage,
	sessionIsBusy,
} from './workspace-diff-comment';

ensureMikoDiffTheme();

interface WorkspaceDiffPageProps {
	workspaceId: string;
	path?: string;
	expectedPatchDigest?: string;
	source?: 'workspace' | 'transcript';
	sourceSessionId?: string;
	turnId?: string;
	workspaceRoot?: string;
	composerSessionId?: string | null;
	composerSessionSnapshot?: SessionSnapshot | null;
}

function WorkspaceDiffPageShell({
	actions,
	children,
	path,
}: {
	actions?: ReactNode;
	children: ReactNode;
	path?: string;
}) {
	return (
		<div className="flex h-full min-h-0 flex-col bg-canvas text-ink">
			{path ? (
				<WorkspaceCodeToolbar path={path} actions={actions} />
			) : (
				<div className="border-b border-hairline px-3 py-2 text-caption text-ink-tertiary">
					Changes
				</div>
			)}
			<div className="scrollbar-miko min-h-0 flex-1 overflow-auto bg-canvas">{children}</div>
		</div>
	);
}

function WorkspaceDiffPageState({ title, message }: { title: string; message: string }) {
	return (
		<div className="flex h-full items-center justify-center px-6 text-center">
			<div className="max-w-sm rounded-lg border border-hairline-strong bg-surface-2 px-4 py-3 shadow-sm">
				<div className="text-[12px] font-medium text-ink">{title}</div>
				<div className="mt-1 text-[11px] leading-relaxed text-ink-subtle">{message}</div>
			</div>
		</div>
	);
}

function WorkspaceDiffPageLoading() {
	return (
		<div className="flex h-full items-center justify-center px-6">
			<div className="inline-flex items-center gap-2 text-caption text-ink-subtle">
				{Icons.activeIcon({ ariaLabel: 'Loading diff', className: 'size-3.5 text-ink-subtle' })}
				<span>Loading diff</span>
			</div>
		</div>
	);
}

export function WorkspaceDiffPage({
	workspaceId,
	path,
	expectedPatchDigest,
	source = 'workspace',
	sourceSessionId,
	turnId,
	workspaceRoot = '',
	composerSessionId,
	composerSessionSnapshot,
}: WorkspaceDiffPageProps) {
	const isTranscriptDiff = source === 'transcript';
	const resource = useWorkspaceFileStore((state) =>
		!isTranscriptDiff && path ? state.getDiffResource(workspaceId, path) : null,
	);
	const sourceWindowMessages = useChatWindowStore((state) =>
		isTranscriptDiff && sourceSessionId
			? (state.windowBySessionId.get(sourceSessionId)?.messages ?? null)
			: null,
	);
	const diffViewMode = useUiStore((state) => state.getDiffViewMode(workspaceId));
	const currentPatchDigest = resource?.data?.patchDigest ?? expectedPatchDigest ?? null;
	const viewed = useUiStore((state) =>
		path ? state.isDiffPathViewed(workspaceId, path, currentPatchDigest) : false,
	);
	const setDiffViewMode = useUiStore((state) => state.setDiffViewMode);
	const setDiffPathViewed = useUiStore((state) => state.setDiffPathViewed);
	const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null);
	const selectedLinesRef = useRef<SelectedLineRange | null>(null);
	const selectionRootRef = useRef<DiffSelectionRoot | null>(null);
	const [commentDraft, setCommentDraft] = useState<DiffCommentDraft | null>(null);
	const rememberSelectionRange = useCallback((range: SelectedLineRange | null) => {
		selectedLinesRef.current = range;
		setSelectedLines(range);
	}, []);
	const clearCommentDraft = useCallback(() => {
		setCommentDraft(null);
		rememberSelectionRange(null);
	}, [rememberSelectionRange]);
	const [submittingComment, setSubmittingComment] = useState(false);
	const commentDisabled =
		!composerSessionId || !composerSessionSnapshot || sessionIsBusy(composerSessionSnapshot);
	const commentRange = commentDraft?.range ?? null;
	const commentAnnotations = useMemo<DiffLineAnnotation<DiffCommentMetadata>[]>(() => {
		if (!commentRange) return [];
		return [
			{
				side: commentRange.endSide ?? commentRange.side ?? 'additions',
				lineNumber: commentRange.end,
				metadata: { type: 'comment-draft', range: commentRange },
			},
		];
	}, [commentRange]);
	const transcriptChangedFile = useMemo(() => {
		if (!isTranscriptDiff || !path || !turnId || !sourceWindowMessages) return null;
		return findTranscriptChangedFile({
			messages: sourceWindowMessages,
			path,
			turnId,
			workspaceRoot,
		});
	}, [isTranscriptDiff, path, sourceWindowMessages, turnId, workspaceRoot]);
	const transcriptDiff = useMemo(
		() => (transcriptChangedFile ? transcriptFileDiff(transcriptChangedFile) : null),
		[transcriptChangedFile],
	);
	const copyFileContents = useCallback(async () => {
		if (!path) return;
		try {
			await useWorkspaceFileStore.getState().loadFileContents(workspaceId, path);
			const latest = useWorkspaceFileStore.getState().getFileResource(workspaceId, path);
			if (latest.status !== 'ready' || !latest.data || latest.data.kind !== 'text') {
				throw new Error('File content is not ready to copy.');
			}
			if (!navigator.clipboard) throw new Error('Clipboard is not available.');
			await navigator.clipboard.writeText(latest.data.contents);
		} catch (error) {
			console.warn('[workspace-diff-page] failed to copy file contents', error);
			throw error;
		}
	}, [path, workspaceId]);
	const submitComment = useCallback(async () => {
		if (!path || !composerSessionId || !composerSessionSnapshot || !commentDraft) return;
		const sendDefaults = buildInlineCommentSendDefaults(composerSessionSnapshot);
		if (!sendDefaults) {
			toast.error('Could not send comment: no model is available.');
			return;
		}

		setSubmittingComment(true);
		try {
			await useSessionStore.getState().sendSessionMessage({
				sessionId: composerSessionId,
				workspaceId,
				provider: sendDefaults.provider,
				content: formatDiffCommentMessage(path, commentDraft.range, commentDraft.content),
				attachments: [],
				model: sendDefaults.model,
				modelOptions: sendDefaults.modelOptions,
				planMode: sendDefaults.planMode,
			});
			clearCommentDraft();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Could not send comment';
			toast.error(message);
		} finally {
			setSubmittingComment(false);
		}
	}, [
		clearCommentDraft,
		commentDraft,
		composerSessionId,
		composerSessionSnapshot,
		path,
		workspaceId,
	]);
	const toolbarActions = path ? (
		<>
			{!isTranscriptDiff ? (
				<>
					<ViewedDiffButton
						disabled={!currentPatchDigest}
						viewed={viewed}
						onToggle={() => {
							if (!currentPatchDigest) return;
							setDiffPathViewed(workspaceId, path, currentPatchDigest, !viewed);
						}}
					/>
					<DiffRefreshButton
						onClick={() =>
							void useWorkspaceFileStore
								.getState()
								.loadDiffPatch(workspaceId, path, { expectedPatchDigest, force: true })
						}
					/>
				</>
			) : null}
			<DiffViewModeToggle
				mode={diffViewMode}
				onChange={(mode) => setDiffViewMode(workspaceId, mode)}
			/>
			{!isTranscriptDiff ? <CopyFileButton onCopy={copyFileContents} /> : null}
			<DiffFileSegmentedControl
				filePath={path}
				mode="diff"
				sourceSessionId={sourceSessionId}
				workspaceId={workspaceId}
			/>
		</>
	) : null;

	useEffect(() => {
		if (!path || isTranscriptDiff) return;
		void useWorkspaceFileStore.getState().loadDiffPatch(workspaceId, path, { expectedPatchDigest });
	}, [expectedPatchDigest, isTranscriptDiff, path, workspaceId]);

	const renderCommentAnnotation = useCallback(
		(annotation: DiffLineAnnotation<DiffCommentMetadata>) => {
			if (annotation.metadata.type !== 'comment-draft') return null;
			return (
				<DiffInlineCommentComposer
					content={commentDraft?.content ?? ''}
					disabled={commentDisabled}
					submitting={submittingComment}
					onChange={(content) => {
						setCommentDraft((current) =>
							current ? { ...current, content } : { range: annotation.metadata.range, content },
						);
					}}
					onCancel={clearCommentDraft}
					onSubmit={() => void submitComment()}
				/>
			);
		},
		[clearCommentDraft, commentDisabled, commentDraft?.content, submitComment, submittingComment],
	);

	const handlePostRender = useCallback((node: HTMLElement) => {
		selectionRootRef.current = node.shadowRoot ?? node;
	}, []);

	const openCommentDraft = useCallback(
		(range: SelectedLineRange) => {
			const root = selectionRootRef.current;
			const nativeRange = root ? selectedRangeFromNativeSelection(root) : null;
			const commentRange = nativeRange ?? selectedLinesRef.current ?? range;
			rememberSelectionRange(commentRange);
			setCommentDraft({ range: commentRange, content: '' });
		},
		[rememberSelectionRange],
	);

	const diffOptions = useMemo(
		() => ({
			...MIKO_DIFF_OPTIONS,
			diffStyle: diffViewMode,
			enableGutterUtility: true,
			lineHoverHighlight: 'number' as const,
			onPostRender: handlePostRender,
			onGutterUtilityClick: openCommentDraft,
		}),
		[diffViewMode, handlePostRender, openCommentDraft],
	);

	useEffect(() => {
		const updateNativeSelection = () => {
			const root = selectionRootRef.current;
			if (!root) return;
			const range = selectedRangeFromNativeSelection(root);
			if (!range) return;
			// Keep native text selection passive while the user drags. Re-rendering Pierre
			// during selection can disturb the browser selection and collapse the range.
			selectedLinesRef.current = range;
		};

		document.addEventListener('selectionchange', updateNativeSelection);
		document.addEventListener('mouseup', updateNativeSelection);
		return () => {
			document.removeEventListener('selectionchange', updateNativeSelection);
			document.removeEventListener('mouseup', updateNativeSelection);
		};
	}, []);

	if (!path) {
		return (
			<WorkspaceDiffPageShell>
				<WorkspaceDiffPageState
					title="Select a changed file"
					message="Choose a file from Changes to inspect its diff."
				/>
			</WorkspaceDiffPageShell>
		);
	}

	if (isTranscriptDiff) {
		if (!sourceWindowMessages) {
			return (
				<WorkspaceDiffPageShell path={path} actions={toolbarActions}>
					<WorkspaceDiffPageLoading />
				</WorkspaceDiffPageShell>
			);
		}

		if (!transcriptChangedFile || !transcriptDiff) {
			return (
				<WorkspaceDiffPageShell path={path} actions={toolbarActions}>
					<WorkspaceDiffPageState
						title="Diff unavailable"
						message="This transcript diff is no longer available in the loaded chat window."
					/>
				</WorkspaceDiffPageShell>
			);
		}

		return (
			<WorkspaceDiffPageShell path={path} actions={toolbarActions}>
				<div className="min-w-max">
					<FileDiff
						fileDiff={transcriptDiff}
						disableWorkerPool
						style={MIKO_CODE_FONT_VARS}
						options={{ ...MIKO_DIFF_OPTIONS, diffStyle: diffViewMode }}
					/>
				</div>
			</WorkspaceDiffPageShell>
		);
	}

	if (
		!resource ||
		resource.status === 'idle' ||
		(resource.status === 'loading' && !resource.data)
	) {
		return (
			<WorkspaceDiffPageShell path={path} actions={toolbarActions}>
				<WorkspaceDiffPageLoading />
			</WorkspaceDiffPageShell>
		);
	}

	if (resource.status === 'error' || !resource.data) {
		return (
			<WorkspaceDiffPageShell path={path} actions={toolbarActions}>
				<WorkspaceDiffPageState
					title="Diff unavailable"
					message={resource.error ?? 'This file is no longer changed.'}
				/>
			</WorkspaceDiffPageShell>
		);
	}

	return (
		<WorkspaceDiffPageShell path={resource.data.path} actions={toolbarActions}>
			<div className="min-w-max">
				<PatchDiff
					patch={resource.data.patch}
					disableWorkerPool
					style={MIKO_CODE_FONT_VARS}
					lineAnnotations={commentAnnotations}
					selectedLines={selectedLines}
					renderAnnotation={renderCommentAnnotation}
					options={diffOptions}
				/>
			</div>
		</WorkspaceDiffPageShell>
	);
}
