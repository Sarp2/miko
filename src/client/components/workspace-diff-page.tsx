import { PatchDiff } from '@pierre/diffs/react';
import { type ReactNode, useEffect } from 'react';
import { Icons } from '../lib/icons';
import {
	ensureMikoDiffTheme,
	MIKO_CODE_FONT_VARS,
	MIKO_DIFF_OPTIONS,
} from '../lib/miko-diff-renderer';
import { useWorkspaceFileStore } from '../stores/workspace-file-store';
import { WorkspaceCodePathHeader } from './workspace-code-path-header';

ensureMikoDiffTheme();

interface WorkspaceDiffPageProps {
	workspaceId: string;
	path?: string;
	expectedPatchDigest?: string;
}

function WorkspaceDiffPageShell({ path, children }: { path?: string; children: ReactNode }) {
	return (
		<div className="flex h-full min-h-0 flex-col bg-canvas text-ink">
			{path ? (
				<WorkspaceCodePathHeader path={path} />
			) : (
				<div className="border-b border-hairline px-3 py-2 text-caption text-ink-tertiary">
					Changes
				</div>
			)}
			<div className="scrollbar-miko min-h-0 flex-1 overflow-auto">{children}</div>
		</div>
	);
}

function WorkspaceDiffPageState({ title, message }: { title: string; message: string }) {
	return (
		<div className="flex h-full items-center justify-center px-6 text-center">
			<div className="max-w-sm rounded-lg border border-hairline bg-surface-1 px-4 py-3 shadow-sm">
				<div className="text-body-sm font-medium text-ink">{title}</div>
				<div className="mt-1 text-caption leading-relaxed text-ink-subtle">{message}</div>
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
}: WorkspaceDiffPageProps) {
	const resource = useWorkspaceFileStore((state) =>
		path ? state.getDiffResource(workspaceId, path) : null,
	);

	useEffect(() => {
		if (!path) return;
		void useWorkspaceFileStore.getState().loadDiffPatch(workspaceId, path, { expectedPatchDigest });
	}, [expectedPatchDigest, path, workspaceId]);

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

	if (!resource || resource.status === 'idle' || resource.status === 'loading') {
		return (
			<WorkspaceDiffPageShell path={path}>
				<WorkspaceDiffPageLoading />
			</WorkspaceDiffPageShell>
		);
	}

	if (resource.status === 'error' || !resource.data) {
		return (
			<WorkspaceDiffPageShell path={path}>
				<WorkspaceDiffPageState
					title="Diff unavailable"
					message={resource.error ?? 'This file is no longer changed.'}
				/>
			</WorkspaceDiffPageShell>
		);
	}

	return (
		<WorkspaceDiffPageShell path={resource.data.path}>
			<div className="min-w-max">
				<PatchDiff
					patch={resource.data.patch}
					disableWorkerPool
					style={MIKO_CODE_FONT_VARS}
					options={MIKO_DIFF_OPTIONS}
				/>
			</div>
		</WorkspaceDiffPageShell>
	);
}
