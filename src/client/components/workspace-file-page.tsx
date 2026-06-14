import { File } from '@pierre/diffs/react';
import { type ReactNode, useCallback, useEffect } from 'react';
import { Icons } from '../lib/icons';
import {
	ensureMikoDiffTheme,
	MIKO_CODE_FONT_VARS,
	MIKO_FILE_OPTIONS,
} from '../lib/miko-diff-renderer';
import type { WorkspacePage } from '../stores/ui-store';
import { useWorkspaceFileStore } from '../stores/workspace-file-store';
import { CopyFileButton, WorkspaceCodeToolbar } from './workspace-code-toolbar';

ensureMikoDiffTheme();

interface WorkspaceFilePageProps {
	workspaceId: string;
	page: Extract<WorkspacePage, { type: 'file' }>;
	revisionKey?: string | null;
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

export function WorkspaceFilePage({ workspaceId, page, revisionKey }: WorkspaceFilePageProps) {
	const path = page.path;
	const resource = useWorkspaceFileStore((state) =>
		path ? state.getFileResource(workspaceId, path) : null,
	);
	const copyFileContents = useCallback(async () => {
		if (!path) return;
		try {
			await useWorkspaceFileStore.getState().loadFileContents(workspaceId, path);
			const latest = useWorkspaceFileStore.getState().getFileResource(workspaceId, path);
			if (latest.status !== 'ready' || !latest.data) {
				throw new Error('File content is not ready to copy.');
			}
			if (!navigator.clipboard) throw new Error('Clipboard is not available.');
			await navigator.clipboard.writeText(latest.data.contents);
		} catch (error) {
			console.warn('[workspace-file-page] failed to copy file contents', error);
			throw error;
		}
	}, [path, workspaceId]);
	const toolbarActions = path ? (
		<CopyFileButton
			disabled={resource?.status === 'loading' && !resource.data}
			onCopy={copyFileContents}
		/>
	) : null;

	useEffect(() => {
		// The revision key is a workspace-snapshot freshness signal; when it changes,
		// this effect intentionally refetches the same route path.
		void revisionKey;
		if (!path || page.source !== 'workspace_file') return;
		void useWorkspaceFileStore.getState().loadFileContents(workspaceId, path, { force: true });
	}, [page.source, path, revisionKey, workspaceId]);

	if (page.source !== 'workspace_file') {
		return (
			<WorkspaceCodePageShell path={path} actions={toolbarActions}>
				<WorkspaceCodePageState
					title="Preview unavailable"
					message="This file source is not supported by the workspace file viewer yet."
				/>
			</WorkspaceCodePageShell>
		);
	}

	if (!path) {
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
			<WorkspaceCodePageShell path={path} actions={toolbarActions}>
				<WorkspaceCodePageLoading />
			</WorkspaceCodePageShell>
		);
	}

	if (resource.status === 'error' || !resource.data) {
		return (
			<WorkspaceCodePageShell path={path} actions={toolbarActions}>
				<WorkspaceCodePageState
					title="Preview unavailable"
					message={resource.error ?? 'This file cannot be shown as text.'}
				/>
			</WorkspaceCodePageShell>
		);
	}

	return (
		<WorkspaceCodePageShell path={resource.data.path} actions={toolbarActions}>
			<div className="min-w-max">
				<File
					file={{
						name: resource.data.name,
						contents: resource.data.contents,
						cacheKey: resource.data.cacheKey,
					}}
					disableWorkerPool
					style={MIKO_CODE_FONT_VARS}
					options={MIKO_FILE_OPTIONS}
				/>
			</div>
		</WorkspaceCodePageShell>
	);
}
