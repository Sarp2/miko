import { create } from 'zustand';
import type { WorkspaceFileSearchResult } from '../../shared/types';
import { useWorkspaceStore } from './workspace-store';

const DEFAULT_ALL_FILES_LIMIT = 2_000;

interface FileListResource {
	status: 'idle' | 'loading' | 'ready' | 'error';
	files: WorkspaceFileSearchResult[];
	error?: string;
	requestId?: number;
}

interface RightSidebarFileStoreState {
	fileListByWorkspaceId: Map<string, FileListResource>;
	getFileList: (workspaceId: string) => FileListResource;
	loadFileList: (workspaceId: string, options?: { force?: boolean }) => Promise<void>;
	resetFileList: (workspaceId: string) => void;
}

let nextRequestId = 1;

const idleResource: FileListResource = { status: 'idle', files: [] };

export const useRightSidebarFileStore = create<RightSidebarFileStoreState>((set, get) => ({
	fileListByWorkspaceId: new Map(),

	getFileList: (workspaceId) => get().fileListByWorkspaceId.get(workspaceId) ?? idleResource,

	loadFileList: async (workspaceId, options = {}) => {
		const current = get().fileListByWorkspaceId.get(workspaceId);
		if (!options.force && (current?.status === 'loading' || current?.status === 'ready')) return;

		const requestId = nextRequestId++;
		set((state) => {
			const next = new Map(state.fileListByWorkspaceId);
			next.set(workspaceId, {
				status: 'loading',
				files: current?.files ?? [],
				requestId,
			});
			return { fileListByWorkspaceId: next };
		});

		try {
			const files = await useWorkspaceStore
				.getState()
				.listFiles(workspaceId, DEFAULT_ALL_FILES_LIMIT);
			set((state) => {
				const current = state.fileListByWorkspaceId.get(workspaceId);
				if (current?.requestId !== requestId) return state;
				const next = new Map(state.fileListByWorkspaceId);
				next.set(workspaceId, { status: 'ready', files });
				return { fileListByWorkspaceId: next };
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Could not load files';
			set((state) => {
				const current = state.fileListByWorkspaceId.get(workspaceId);
				if (current?.requestId !== requestId) return state;
				const next = new Map(state.fileListByWorkspaceId);
				next.set(workspaceId, { status: 'error', files: current.files, error: message });
				return { fileListByWorkspaceId: next };
			});
		}
	},

	resetFileList: (workspaceId) => {
		set((state) => {
			if (!state.fileListByWorkspaceId.has(workspaceId)) return state;
			const next = new Map(state.fileListByWorkspaceId);
			next.delete(workspaceId);
			return { fileListByWorkspaceId: next };
		});
	},
}));
