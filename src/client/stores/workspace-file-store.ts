import { create } from 'zustand';
import type { WorkspaceDiffPatchResult, WorkspaceFileContentsResult } from '../../shared/types';
import { useWorkspaceStore } from './workspace-store';

type WorkspaceResourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface WorkspaceFileResource {
	status: WorkspaceResourceStatus;
	data: WorkspaceFileContentsResult | null;
	error: string | null;
	requestId: number | null;
}

export interface WorkspaceDiffResource {
	status: WorkspaceResourceStatus;
	data: WorkspaceDiffPatchResult | null;
	error: string | null;
	requestId: number | null;
	expectedPatchDigest: string | null;
}

interface WorkspaceFileStoreState {
	fileByKey: Map<string, WorkspaceFileResource>;
	diffByKey: Map<string, WorkspaceDiffResource>;
	getFileResource: (workspaceId: string, path: string) => WorkspaceFileResource;
	getDiffResource: (workspaceId: string, path: string) => WorkspaceDiffResource;
	loadFileContents: (
		workspaceId: string,
		path: string,
		options?: { force?: boolean },
	) => Promise<void>;
	loadDiffPatch: (
		workspaceId: string,
		path: string,
		options?: { expectedPatchDigest?: string },
	) => Promise<void>;
	resetForTests: () => void;
}

const IDLE_FILE_RESOURCE: WorkspaceFileResource = {
	status: 'idle',
	data: null,
	error: null,
	requestId: null,
};

const IDLE_DIFF_RESOURCE: WorkspaceDiffResource = {
	status: 'idle',
	data: null,
	error: null,
	requestId: null,
	expectedPatchDigest: null,
};

let nextRequestId = 1;

function resourceKey(workspaceId: string, path: string) {
	return JSON.stringify([workspaceId, path]);
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : 'Request failed';
}

export const useWorkspaceFileStore = create<WorkspaceFileStoreState>((set, get) => ({
	fileByKey: new Map(),
	diffByKey: new Map(),

	getFileResource: (workspaceId, path) => {
		return get().fileByKey.get(resourceKey(workspaceId, path)) ?? IDLE_FILE_RESOURCE;
	},

	getDiffResource: (workspaceId, path) => {
		return get().diffByKey.get(resourceKey(workspaceId, path)) ?? IDLE_DIFF_RESOURCE;
	},

	loadFileContents: async (workspaceId, path, options = {}) => {
		const key = resourceKey(workspaceId, path);
		const current = get().fileByKey.get(key);
		if (current?.status === 'loading') return;
		if (!options.force && current?.status === 'ready') return;

		const requestId = nextRequestId;
		nextRequestId += 1;

		set((state) => {
			const fileByKey = new Map(state.fileByKey);
			fileByKey.set(key, {
				status: 'loading',
				data: current?.data ?? null,
				error: null,
				requestId,
			});
			return { fileByKey };
		});

		try {
			const data = await useWorkspaceStore.getState().readFileContents(workspaceId, path);
			set((state) => {
				if (state.fileByKey.get(key)?.requestId !== requestId) return state;
				const fileByKey = new Map(state.fileByKey);
				fileByKey.set(key, { status: 'ready', data, error: null, requestId: null });
				return { fileByKey };
			});
		} catch (error) {
			set((state) => {
				if (state.fileByKey.get(key)?.requestId !== requestId) return state;
				const fileByKey = new Map(state.fileByKey);
				fileByKey.set(key, {
					status: 'error',
					data: current?.data ?? null,
					error: errorMessage(error),
					requestId: null,
				});
				return { fileByKey };
			});
		}
	},

	loadDiffPatch: async (workspaceId, path, options = {}) => {
		const key = resourceKey(workspaceId, path);
		const current = get().diffByKey.get(key);
		const expectedPatchDigest = options.expectedPatchDigest ?? null;
		if (current?.status === 'loading' && current.expectedPatchDigest === expectedPatchDigest)
			return;
		if (
			current?.status === 'ready' &&
			current.expectedPatchDigest === expectedPatchDigest &&
			current.data?.patchDigest === expectedPatchDigest
		) {
			return;
		}

		const requestId = nextRequestId;
		nextRequestId += 1;

		set((state) => {
			const diffByKey = new Map(state.diffByKey);
			diffByKey.set(key, {
				status: 'loading',
				data: current?.data ?? null,
				error: null,
				requestId,
				expectedPatchDigest,
			});
			return { diffByKey };
		});

		try {
			const data = await useWorkspaceStore.getState().readDiffPatch(workspaceId, path);
			set((state) => {
				if (state.diffByKey.get(key)?.requestId !== requestId) return state;
				const diffByKey = new Map(state.diffByKey);
				diffByKey.set(key, {
					status: 'ready',
					data,
					error: null,
					requestId: null,
					expectedPatchDigest,
				});
				return { diffByKey };
			});
		} catch (error) {
			set((state) => {
				if (state.diffByKey.get(key)?.requestId !== requestId) return state;
				const diffByKey = new Map(state.diffByKey);
				diffByKey.set(key, {
					status: 'error',
					data: current?.data ?? null,
					error: errorMessage(error),
					requestId: null,
					expectedPatchDigest,
				});
				return { diffByKey };
			});
		}
	},

	resetForTests: () => {
		nextRequestId = 1;
		set({ fileByKey: new Map(), diffByKey: new Map() });
	},
}));
