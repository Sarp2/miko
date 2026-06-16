import { create } from 'zustand';
import type {
	ChatAttachment,
	WorkspaceDiffPatchResult,
	WorkspaceFileContentsResult,
} from '../../shared/types';
import { PASTED_TEXT_LABEL } from '../lib/prompt-parts';
import { attachmentPreviewResult, localFilePreviewResult } from '../lib/workspace-file-previews';
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
	pastedTextFileByKey: Map<string, WorkspaceFileResource>;
	attachmentFileByKey: Map<string, WorkspaceFileResource>;
	getFileResource: (workspaceId: string, path: string) => WorkspaceFileResource;
	getDiffResource: (workspaceId: string, path: string) => WorkspaceDiffResource;
	getPastedTextResource: (workspaceId: string, sourceId: string) => WorkspaceFileResource;
	setPastedTextFile: (workspaceId: string, sourceId: string, text: string) => void;
	getAttachmentResource: (workspaceId: string, attachmentId: string) => WorkspaceFileResource;
	loadAttachmentFile: (workspaceId: string, attachment: ChatAttachment) => Promise<void>;
	loadLocalAttachmentFile: (
		workspaceId: string,
		attachmentId: string,
		file: File,
		kind: ChatAttachment['kind'],
	) => Promise<void>;
	loadFileContents: (
		workspaceId: string,
		path: string,
		options?: { force?: boolean },
	) => Promise<void>;
	loadDiffPatch: (
		workspaceId: string,
		path: string,
		options?: { expectedPatchDigest?: string; force?: boolean },
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

const MAX_CACHED_FILE_RESOURCES = 120;
const MAX_CACHED_DIFF_RESOURCES = 120;
const MAX_CACHED_ATTACHMENT_RESOURCES = 60;
const MAX_CACHED_PASTED_TEXT_RESOURCES = 60;

let nextRequestId = 1;

function missingResource(error: string): WorkspaceFileResource {
	return { status: 'error', data: null, error, requestId: null };
}

function pruneResourceMap<TKey, TValue extends { status: WorkspaceResourceStatus }>(
	resources: Map<TKey, TValue>,
	maxSize: number,
) {
	if (resources.size <= maxSize) return resources;

	const pruned = new Map(resources);
	for (const [key, resource] of pruned) {
		if (pruned.size <= maxSize) break;
		if (resource.status === 'loading') continue;
		pruned.delete(key);
	}

	return pruned;
}

function resourceKey(workspaceId: string, path: string) {
	return JSON.stringify([workspaceId, path]);
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : 'Request failed';
}

export const useWorkspaceFileStore = create<WorkspaceFileStoreState>((set, get) => {
	function writeAttachmentResource(
		key: string,
		resource: WorkspaceFileResource,
		guardRequestId?: number,
	) {
		set((state) => {
			if (
				guardRequestId !== undefined &&
				state.attachmentFileByKey.get(key)?.requestId !== guardRequestId
			)
				return state;
			const attachmentFileByKey = new Map(state.attachmentFileByKey);
			attachmentFileByKey.set(key, resource);
			return {
				attachmentFileByKey: pruneResourceMap(attachmentFileByKey, MAX_CACHED_ATTACHMENT_RESOURCES),
			};
		});
	}

	// Shared machinery for both local (File) and remote (uploaded) attachments: show a
	// loading state, resolve the preview, then store the result or error. The requestId
	// guard discards results from superseded or reset requests, and the cache is bounded.
	async function loadAttachmentInto(
		key: string,
		resolve: () => Promise<WorkspaceFileContentsResult>,
	) {
		const current = get().attachmentFileByKey.get(key);
		if (current?.status === 'loading' || current?.status === 'ready') return;

		const requestId = nextRequestId;
		nextRequestId += 1;
		writeAttachmentResource(key, {
			status: 'loading',
			data: current?.data ?? null,
			error: null,
			requestId,
		});

		try {
			const data = await resolve();
			writeAttachmentResource(
				key,
				{ status: 'ready', data, error: null, requestId: null },
				requestId,
			);
		} catch (error) {
			writeAttachmentResource(
				key,
				{
					status: 'error',
					data: current?.data ?? null,
					error: errorMessage(error),
					requestId: null,
				},
				requestId,
			);
		}
	}

	return {
		fileByKey: new Map(),
		diffByKey: new Map(),
		pastedTextFileByKey: new Map(),
		attachmentFileByKey: new Map(),

		getFileResource: (workspaceId, path) => {
			return get().fileByKey.get(resourceKey(workspaceId, path)) ?? IDLE_FILE_RESOURCE;
		},

		getDiffResource: (workspaceId, path) => {
			return get().diffByKey.get(resourceKey(workspaceId, path)) ?? IDLE_DIFF_RESOURCE;
		},

		getPastedTextResource: (workspaceId, sourceId) => {
			return (
				get().pastedTextFileByKey.get(resourceKey(workspaceId, sourceId)) ??
				missingResource('This pasted text is no longer available in memory.')
			);
		},

		setPastedTextFile: (workspaceId, sourceId, text) => {
			const data: WorkspaceFileContentsResult = {
				kind: 'text',
				path: PASTED_TEXT_LABEL,
				name: PASTED_TEXT_LABEL,
				contents: text,
				mimeType: 'text/plain',
				size: new TextEncoder().encode(text).length,
				encoding: 'utf-8',
				cacheKey: `${sourceId}:${text.length}`,
			};

			set((state) => {
				const pastedTextFileByKey = new Map(state.pastedTextFileByKey);
				pastedTextFileByKey.set(resourceKey(workspaceId, sourceId), {
					status: 'ready',
					data,
					error: null,
					requestId: null,
				});
				return {
					pastedTextFileByKey: pruneResourceMap(
						pastedTextFileByKey,
						MAX_CACHED_PASTED_TEXT_RESOURCES,
					),
				};
			});
		},

		getAttachmentResource: (workspaceId, attachmentId) => {
			return (
				get().attachmentFileByKey.get(resourceKey(workspaceId, attachmentId)) ??
				missingResource('This attachment is no longer available in memory.')
			);
		},

		loadLocalAttachmentFile: async (workspaceId, attachmentId, file, kind) => {
			await loadAttachmentInto(resourceKey(workspaceId, attachmentId), () =>
				localFilePreviewResult({ attachmentId, file, kind }),
			);
		},

		loadAttachmentFile: async (workspaceId, attachment) => {
			await loadAttachmentInto(resourceKey(workspaceId, attachment.id), () =>
				attachmentPreviewResult(attachment),
			);
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
				return { fileByKey: pruneResourceMap(fileByKey, MAX_CACHED_FILE_RESOURCES) };
			});

			try {
				const data = await useWorkspaceStore.getState().readFileContents(workspaceId, path);
				set((state) => {
					if (state.fileByKey.get(key)?.requestId !== requestId) return state;
					const fileByKey = new Map(state.fileByKey);
					fileByKey.set(key, { status: 'ready', data, error: null, requestId: null });
					return { fileByKey: pruneResourceMap(fileByKey, MAX_CACHED_FILE_RESOURCES) };
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
					return { fileByKey: pruneResourceMap(fileByKey, MAX_CACHED_FILE_RESOURCES) };
				});
			}
		},

		loadDiffPatch: async (workspaceId, path, options = {}) => {
			const key = resourceKey(workspaceId, path);
			const current = get().diffByKey.get(key);
			const expectedPatchDigest = options.expectedPatchDigest ?? null;
			if (
				!options.force &&
				current?.status === 'loading' &&
				current.expectedPatchDigest === expectedPatchDigest
			)
				return;
			if (
				!options.force &&
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
				return { diffByKey: pruneResourceMap(diffByKey, MAX_CACHED_DIFF_RESOURCES) };
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
					return { diffByKey: pruneResourceMap(diffByKey, MAX_CACHED_DIFF_RESOURCES) };
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
					return { diffByKey: pruneResourceMap(diffByKey, MAX_CACHED_DIFF_RESOURCES) };
				});
			}
		},

		resetForTests: () => {
			nextRequestId = 1;
			set({
				fileByKey: new Map(),
				diffByKey: new Map(),
				pastedTextFileByKey: new Map(),
				attachmentFileByKey: new Map(),
			});
		},
	};
});
