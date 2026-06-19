import type { WorkspaceFileSearchResult } from '../../shared/types';

export interface WorkspaceFileTreeFileNode {
	type: 'file';
	id: string;
	name: string;
	path: string;
}

export interface WorkspaceFileTreeFolderNode {
	type: 'folder';
	id: string;
	name: string;
	path: string;
	children: WorkspaceFileTreeNode[];
}

export type WorkspaceFileTreeNode = WorkspaceFileTreeFileNode | WorkspaceFileTreeFolderNode;

interface MutableFolderNode {
	type: 'folder';
	id: string;
	name: string;
	path: string;
	childrenByName: Map<string, MutableTreeNode>;
}

type MutableTreeNode = MutableFolderNode | WorkspaceFileTreeFileNode;

function compareTreeNodes(left: WorkspaceFileTreeNode, right: WorkspaceFileTreeNode) {
	if (left.type !== right.type) return left.type === 'folder' ? -1 : 1;
	return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function freezeFolder(folder: MutableFolderNode): WorkspaceFileTreeFolderNode {
	return {
		type: 'folder',
		id: folder.id,
		name: folder.name,
		path: folder.path,
		children: [...folder.childrenByName.values()]
			.map((child) => (child.type === 'folder' ? freezeFolder(child) : child))
			.sort(compareTreeNodes),
	};
}

function safePathSegments(relativePath: string) {
	return relativePath
		.replace(/\\/g, '/')
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean);
}

export function buildWorkspaceFileTree(
	files: WorkspaceFileSearchResult[],
): WorkspaceFileTreeNode[] {
	const root: MutableFolderNode = {
		type: 'folder',
		id: '',
		name: '',
		path: '',
		childrenByName: new Map(),
	};

	for (const file of files) {
		const segments = safePathSegments(file.relativePath);
		if (segments.length === 0) continue;

		let folder = root;
		for (let index = 0; index < segments.length - 1; index += 1) {
			const name = segments[index];
			const path = segments.slice(0, index + 1).join('/');
			const existing = folder.childrenByName.get(name);
			if (existing?.type === 'folder') {
				folder = existing;
				continue;
			}

			const next: MutableFolderNode = {
				type: 'folder',
				id: `folder:${path}`,
				name,
				path,
				childrenByName: new Map(),
			};
			folder.childrenByName.set(name, next);
			folder = next;
		}

		const fileName = segments.at(-1);
		if (!fileName) continue;
		const path = segments.join('/');
		folder.childrenByName.set(fileName, {
			type: 'file',
			id: `file:${path}`,
			name: fileName,
			path,
		});
	}

	return freezeFolder(root).children;
}
