import { FolderIcon, FolderOpenIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceSetupState } from '../../shared/types';
import { buildWorkspaceFileTree, type WorkspaceFileTreeNode } from '../lib/workspace-file-tree';
import { useRightSidebarFileStore } from '../stores/right-sidebar-file-store';
import { FileNameIcon } from './icons/file-name-icon';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

interface RightSidebarAllFilesProps {
	onOpenFile: (path: string) => void;
	revisionKey?: string;
	setupState: WorkspaceSetupState;
	workspaceId: string;
}

function FileTreeRow({ depth, children }: { depth: number; children: ReactNode }) {
	return (
		<div
			className="relative min-w-0"
			style={{ paddingLeft: depth > 0 ? `${Math.min(depth, 8) * 12}px` : undefined }}
		>
			{depth > 0 ? (
				<span
					aria-hidden="true"
					className="absolute top-1 bottom-1 w-px bg-hairline/70"
					style={{ left: `${Math.min(depth, 8) * 12 - 6}px` }}
				/>
			) : null}
			{children}
		</div>
	);
}

function FolderNode({
	node,
	depth,
	onOpenFile,
}: {
	node: Extract<WorkspaceFileTreeNode, { type: 'folder' }>;
	depth: number;
	onOpenFile: (path: string) => void;
}) {
	const [open, setOpen] = useState(depth < 1);

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<FileTreeRow depth={depth}>
				<CollapsibleTrigger className="group flex h-[25px] w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-left font-mono text-[11px] font-normal leading-4 text-ink-muted outline-none transition-colors hover:bg-surface-2/70 hover:text-ink focus-visible:ring-1 focus-visible:ring-primary">
					{open ? (
						<FolderOpenIcon className="size-3.5 shrink-0 text-ink-tertiary transition-colors group-hover:text-ink-subtle" />
					) : (
						<FolderIcon className="size-3.5 shrink-0 text-ink-tertiary transition-colors group-hover:text-ink-subtle" />
					)}
					<span className="min-w-0 truncate">{node.name}</span>
				</CollapsibleTrigger>
			</FileTreeRow>
			<CollapsibleContent>
				{node.children.map((child) => (
					<FileTreeNode key={child.id} node={child} depth={depth + 1} onOpenFile={onOpenFile} />
				))}
			</CollapsibleContent>
		</Collapsible>
	);
}

function FileNode({
	node,
	depth,
	onOpenFile,
}: {
	node: Extract<WorkspaceFileTreeNode, { type: 'file' }>;
	depth: number;
	onOpenFile: (path: string) => void;
}) {
	return (
		<FileTreeRow depth={depth}>
			<button
				type="button"
				className="group flex h-[25px] w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-left font-mono text-[11px] font-normal leading-4 text-ink outline-none transition-colors hover:bg-surface-2/70 hover:text-ink focus-visible:ring-1 focus-visible:ring-primary"
				title={node.path}
				onClick={() => onOpenFile(node.path)}
			>
				<FileNameIcon name={node.name} className="size-3.5 shrink-0 opacity-90" />
				<span className="min-w-0 truncate">{node.name}</span>
			</button>
		</FileTreeRow>
	);
}

function FileTreeNode({
	node,
	depth,
	onOpenFile,
}: {
	node: WorkspaceFileTreeNode;
	depth: number;
	onOpenFile: (path: string) => void;
}) {
	if (node.type === 'folder')
		return <FolderNode node={node} depth={depth} onOpenFile={onOpenFile} />;
	return <FileNode node={node} depth={depth} onOpenFile={onOpenFile} />;
}

function AllFilesEmptyState() {
	return (
		<div className="flex h-full items-center justify-center px-8 text-center text-[12px] leading-4 text-ink-tertiary">
			No files found in this workspace.
		</div>
	);
}

export function RightSidebarAllFiles({
	onOpenFile,
	revisionKey,
	setupState,
	workspaceId,
}: RightSidebarAllFilesProps) {
	const resource = useRightSidebarFileStore((state) => state.getFileList(workspaceId));
	const loadFileList = useRightSidebarFileStore((state) => state.loadFileList);
	const nodes = useMemo(() => buildWorkspaceFileTree(resource.files), [resource.files]);

	useEffect(() => {
		if (setupState !== 'ready') return;
		void loadFileList(workspaceId, { force: Boolean(revisionKey) });
	}, [loadFileList, revisionKey, setupState, workspaceId]);

	if (setupState === 'creating') {
		return (
			<div className="flex h-full items-center justify-center text-[12px] text-ink-tertiary">
				Preparing workspace...
			</div>
		);
	}

	if (setupState === 'failed') {
		return (
			<div className="flex h-full items-center justify-center px-8 text-center text-[12px] leading-4 text-ink-tertiary">
				Workspace setup failed. Files are unavailable.
			</div>
		);
	}

	if (resource.status === 'loading' && resource.files.length === 0) {
		return (
			<div className="flex h-full items-center justify-center text-[12px] text-ink-tertiary">
				Loading files...
			</div>
		);
	}

	if (resource.status === 'error' && resource.files.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
				<div className="text-[12px] leading-4 text-ink-tertiary">{resource.error}</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-[26px] rounded-md px-2 text-[12px] text-ink-muted hover:bg-surface-2 hover:text-ink"
					onClick={() => {
						void loadFileList(workspaceId, { force: true });
					}}
				>
					Try again
				</Button>
			</div>
		);
	}

	if (nodes.length === 0) return <AllFilesEmptyState />;

	return (
		<div className="min-w-0 space-y-0.5 px-2.5 py-2">
			{nodes.map((node) => (
				<FileTreeNode key={node.id} node={node} depth={0} onOpenFile={onOpenFile} />
			))}
		</div>
	);
}
