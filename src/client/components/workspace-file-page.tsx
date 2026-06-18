import { File as PierreFile } from '@pierre/diffs/react';
import { type ReactNode, useCallback, useEffect, useMemo } from 'react';
import type { WorkspaceFileContentsResult } from '../../shared/types';
import { Icons } from '../lib/icons';
import {
	ensureMikoDiffTheme,
	MIKO_CODE_FONT_VARS,
	MIKO_FILE_OPTIONS,
} from '../lib/miko-diff-renderer';
import { isAbsoluteFilePath, workspaceFilePath } from '../lib/workspace-file-open-target';
import { agentInstructionContentUrlFromPath } from '../lib/workspace-file-previews';
import type { WorkspacePage } from '../stores/ui-store';
import { useWorkspaceFileStore } from '../stores/workspace-file-store';
import { CopyFileButton, WorkspaceCodeToolbar } from './workspace-code-toolbar';

ensureMikoDiffTheme();

interface WorkspaceFilePageProps {
	workspaceId: string;
	page: Extract<WorkspacePage, { type: 'file' }>;
	revisionKey?: string | null;
	workspaceRoot?: string;
}

function WorkspaceCodePageShell({
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
			{path ? <WorkspaceCodeToolbar path={path} actions={actions} /> : null}
			<div className="scrollbar-miko min-h-0 flex-1 overflow-auto">{children}</div>
		</div>
	);
}

function WorkspaceCodePageState({ title, message }: { title: string; message: string }) {
	return (
		<div className="flex h-full items-center justify-center px-6 text-center">
			<div className="max-w-sm rounded-md border border-hairline bg-surface-1 px-3 py-2.5 shadow-sm">
				<div className="text-[12px] font-medium text-ink">{title}</div>
				<div className="mt-1 text-[11px] leading-relaxed text-ink-subtle">{message}</div>
			</div>
		</div>
	);
}

function WorkspaceCodePageLoading() {
	return (
		<div className="flex h-full items-center justify-center px-6">
			<div className="inline-flex items-center gap-2 text-caption text-ink-subtle">
				{Icons.activeIcon({ ariaLabel: 'Loading file', className: 'size-3.5 text-ink-subtle' })}
				<span>Loading file</span>
			</div>
		</div>
	);
}

function WorkspaceImagePreview({
	file,
}: {
	file: Extract<WorkspaceFileContentsResult, { kind: 'image' }>;
}) {
	return (
		<div className="flex h-full items-center justify-center p-6">
			<img
				src={file.contentUrl}
				alt={file.name}
				className="max-h-full max-w-full rounded-md border border-hairline bg-surface-1 object-contain shadow-sm"
			/>
		</div>
	);
}

function WorkspaceBinaryPreview({
	file,
}: {
	file: Extract<WorkspaceFileContentsResult, { kind: 'binary' }>;
}) {
	return (
		<WorkspaceCodePageState
			title="File format is binary"
			message={`${file.name} cannot be opened in the file viewer.`}
		/>
	);
}

function shouldRenderAsPlainText(file: Extract<WorkspaceFileContentsResult, { kind: 'text' }>) {
	const name = file.name.trim();
	if (!name) return true;
	if (name.startsWith('.')) return true;
	return !name.includes('.');
}

function WorkspacePlainTextPreview({
	file,
}: {
	file: Extract<WorkspaceFileContentsResult, { kind: 'text' }>;
}) {
	const lines = file.contents.split('\n');

	return (
		<pre
			className="m-0 grid min-w-max grid-cols-[auto_1fr] bg-canvas font-mono text-[12px] leading-[1.6] text-ink"
			style={MIKO_CODE_FONT_VARS}
		>
			{lines.map((line, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: file viewer lines are static for a loaded cache key.
				<code key={index} className="contents">
					<span className="select-none border-r border-hairline bg-surface-1 px-3 text-right text-ink-tertiary">
						{index + 1}
					</span>
					<span className="whitespace-pre px-3 text-ink">{line || ' '}</span>
				</code>
			))}
		</pre>
	);
}

function WorkspaceFilePreview({ file }: { file: WorkspaceFileContentsResult }) {
	if (file.kind === 'image') return <WorkspaceImagePreview file={file} />;
	if (file.kind === 'binary') return <WorkspaceBinaryPreview file={file} />;

	if (shouldRenderAsPlainText(file)) return <WorkspacePlainTextPreview file={file} />;

	return (
		<div className="min-w-max">
			<PierreFile
				file={{
					name: file.name,
					contents: file.contents,
					cacheKey: file.cacheKey,
				}}
				disableWorkerPool
				style={MIKO_CODE_FONT_VARS}
				options={MIKO_FILE_OPTIONS}
			/>
		</div>
	);
}

export function WorkspaceFilePage({
	workspaceId,
	page,
	revisionKey,
	workspaceRoot,
}: WorkspaceFilePageProps) {
	const path = page.path;
	const agentInstructionAttachment = useMemo(
		() => (path ? agentInstructionContentUrlFromPath(path) : null),
		[path],
	);
	const agentInstructionAttachmentId = agentInstructionAttachment
		? `agent-instruction:${agentInstructionAttachment.fileName}`
		: undefined;
	const resolvedWorkspaceFilePath = path ? workspaceFilePath(path, workspaceRoot) : null;
	const isUnresolvedAbsoluteWorkspaceFile =
		page.source === 'workspace_file' &&
		Boolean(path && isAbsoluteFilePath(path)) &&
		!resolvedWorkspaceFilePath;
	const isExternalFile = page.source === 'external_file' || isUnresolvedAbsoluteWorkspaceFile;
	const isWorkspaceFile =
		page.source === 'workspace_file' &&
		!isUnresolvedAbsoluteWorkspaceFile &&
		!agentInstructionAttachment;
	const isPastedText = page.source === 'pasted_text';
	const pageAttachment = page.source === 'generated_attachment' ? page.attachment : undefined;
	const isGeneratedAttachment =
		page.source === 'generated_attachment' || Boolean(agentInstructionAttachment);
	const pastedTextSourceId = isPastedText ? page.sourceId : undefined;
	const attachmentSourceId =
		agentInstructionAttachmentId ?? (isGeneratedAttachment ? page.sourceId : undefined);
	const getActiveResource = useCallback(
		(state: ReturnType<typeof useWorkspaceFileStore.getState>) => {
			if (isWorkspaceFile && resolvedWorkspaceFilePath)
				return state.getFileResource(workspaceId, resolvedWorkspaceFilePath);
			if (isExternalFile && page.sourceSessionId && path)
				return state.getExternalFileResource(workspaceId, page.sourceSessionId, path);
			if (pastedTextSourceId) return state.getPastedTextResource(workspaceId, pastedTextSourceId);
			if (attachmentSourceId) return state.getAttachmentResource(workspaceId, attachmentSourceId);
			return null;
		},
		[
			attachmentSourceId,
			isExternalFile,
			isWorkspaceFile,
			page.sourceSessionId,
			pastedTextSourceId,
			path,
			resolvedWorkspaceFilePath,
			workspaceId,
		],
	);
	const resource = useWorkspaceFileStore(getActiveResource);
	const copyFileContents = useCallback(async () => {
		try {
			if (isWorkspaceFile && resolvedWorkspaceFilePath) {
				await useWorkspaceFileStore
					.getState()
					.loadFileContents(workspaceId, resolvedWorkspaceFilePath);
			}

			const latest = getActiveResource(useWorkspaceFileStore.getState());
			if (latest?.status !== 'ready' || !latest.data || latest.data.kind !== 'text') {
				throw new Error('File content is not ready to copy.');
			}
			if (!navigator.clipboard) throw new Error('Clipboard is not available.');
			await navigator.clipboard.writeText(latest.data.contents);
		} catch (error) {
			console.warn('[workspace-file-page] failed to copy file contents', error);
			throw error;
		}
	}, [getActiveResource, isWorkspaceFile, resolvedWorkspaceFilePath, workspaceId]);
	const canCopyTextFile = resource?.status === 'ready' && resource.data?.kind === 'text';
	const toolbarActions = canCopyTextFile ? (
		<CopyFileButton disabled={false} onCopy={copyFileContents} />
	) : null;

	useEffect(() => {
		// The revision key is a workspace-snapshot freshness signal; when it changes,
		// this effect intentionally refetches the same route path.
		void revisionKey;
		if (!resolvedWorkspaceFilePath || !isWorkspaceFile) return;
		void useWorkspaceFileStore
			.getState()
			.loadFileContents(workspaceId, resolvedWorkspaceFilePath, { force: true });
	}, [isWorkspaceFile, resolvedWorkspaceFilePath, revisionKey, workspaceId]);

	useEffect(() => {
		if (!path || !isExternalFile || !page.sourceSessionId) return;
		void useWorkspaceFileStore
			.getState()
			.loadExternalFileContents(workspaceId, page.sourceSessionId, path, { force: true });
	}, [isExternalFile, page.sourceSessionId, path, workspaceId]);

	useEffect(() => {
		if (!pageAttachment) return;
		void useWorkspaceFileStore
			.getState()
			.loadAttachmentFile(workspaceId, pageAttachment, { force: true });
	}, [pageAttachment, workspaceId]);

	useEffect(() => {
		// The revision key should also refresh generated instruction attachments that
		// reuse the same synthetic id and server path.
		void revisionKey;
		if (!agentInstructionAttachment || !agentInstructionAttachmentId) return;
		void useWorkspaceFileStore.getState().loadAttachmentFile(
			workspaceId,
			{
				id: agentInstructionAttachmentId,
				kind: 'file',
				displayName: agentInstructionAttachment.fileName,
				absolutePath: path ?? agentInstructionAttachment.fileName,
				relativePath: agentInstructionAttachment.fileName,
				contentUrl: agentInstructionAttachment.contentUrl,
				mimeType: agentInstructionAttachment.fileName.endsWith('.md')
					? 'text/markdown'
					: 'text/plain',
				size: 0,
			},
			{ force: true },
		);
	}, [agentInstructionAttachment, agentInstructionAttachmentId, path, revisionKey, workspaceId]);

	if (isExternalFile && !page.sourceSessionId) {
		return (
			<WorkspaceCodePageShell path={path ?? page.title}>
				<WorkspaceCodePageState
					title="Preview unavailable"
					message="This external file is not available from the current session."
				/>
			</WorkspaceCodePageShell>
		);
	}

	if (!isWorkspaceFile && !isExternalFile && !isPastedText && !isGeneratedAttachment) {
		return (
			<WorkspaceCodePageShell path={path ?? page.title} actions={toolbarActions}>
				<WorkspaceCodePageState
					title="Preview unavailable"
					message="This file source is not supported by the workspace file viewer yet."
				/>
			</WorkspaceCodePageShell>
		);
	}

	if ((isWorkspaceFile || isExternalFile) && !path) {
		return (
			<WorkspaceCodePageShell>
				<WorkspaceCodePageState title="Select a file" message="Choose a file to preview." />
			</WorkspaceCodePageShell>
		);
	}

	if (
		!resource ||
		resource.status === 'idle' ||
		(resource.status === 'loading' && !resource.data)
	) {
		return (
			<WorkspaceCodePageShell path={path ?? page.title} actions={toolbarActions}>
				<WorkspaceCodePageLoading />
			</WorkspaceCodePageShell>
		);
	}

	if (resource.status === 'error' || !resource.data) {
		return (
			<WorkspaceCodePageShell path={path ?? page.title} actions={toolbarActions}>
				<WorkspaceCodePageState
					title="Preview unavailable"
					message={resource.error ?? 'This file cannot be shown as text.'}
				/>
			</WorkspaceCodePageShell>
		);
	}

	return (
		<WorkspaceCodePageShell path={resource.data.path || page.title} actions={toolbarActions}>
			<WorkspaceFilePreview file={resource.data} />
		</WorkspaceCodePageShell>
	);
}
