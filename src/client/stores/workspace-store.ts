import { create } from 'zustand';
import type { EditorOpenSettings } from '../../shared/protocol';
import type {
	WorkspaceDiffPatchResult,
	WorkspaceFileContentsResult,
	WorkspaceFileSearchResult,
	WorkspaceSnapshot,
} from '../../shared/types';
import { basename } from '../lib/relative-path';
import { useWsStore } from './ws-store';

export interface OpenExternalArgs {
	localPath: string;
	action: 'open_finder' | 'open_terminal' | 'open_editor';
	editor?: EditorOpenSettings;
}

function workspaceSubscriptionId(workspaceId: string) {
	return `workspace:${workspaceId}`;
}

interface WorkspaceStoreState {
	snapshotByWorkspaceId: Map<string, WorkspaceSnapshot | null>;
	connectedWorkspaceIds: Set<string>;
	getWorkspaceSnapshot: (workspaceId: string) => WorkspaceSnapshot | null;
	connectWorkspace: (workspaceId: string) => void;
	disconnectWorkspace: (workspaceId: string) => void;
	markRead: (workspaceId: string) => Promise<void>;
	refreshGit: (workspaceId: string) => Promise<unknown>;
	refreshPrStage: (workspaceId: string) => Promise<unknown>;
	readDiffPatch: (workspaceId: string, path: string) => Promise<WorkspaceDiffPatchResult>;
	readFileContents: (workspaceId: string, path: string) => Promise<WorkspaceFileContentsResult>;
	readExternalFileContents: (path: string) => Promise<WorkspaceFileContentsResult>;
	searchFiles: (
		workspaceId: string,
		query: string,
		limit?: number,
	) => Promise<WorkspaceFileSearchResult[]>;
	renameBranch: (workspaceId: string, branchName: string) => Promise<unknown>;
	commitAndPush: (workspaceId: string, sessionId: string) => Promise<unknown>;
	pullLatestMain: (workspaceId: string, sessionId: string) => Promise<unknown>;
	createPr: (workspaceId: string, sessionId: string) => Promise<unknown>;
	fixCi: (workspaceId: string, sessionId: string) => Promise<unknown>;
	resolveMergeConflicts: (workspaceId: string, sessionId: string) => Promise<unknown>;
	addressReviewComments: (
		workspaceId: string,
		sessionId: string,
		commentIds: string[],
	) => Promise<unknown>;
	mergePr: (workspaceId: string) => Promise<unknown>;
	openExternal: (args: OpenExternalArgs) => Promise<unknown>;
}

let unsubscribeFromWsStore: (() => void) | null = null;

function readWorkspaceSnapshot(workspaceId: string) {
	const subscriptionId = workspaceSubscriptionId(workspaceId);
	const snapshot = useWsStore.getState().snapshotsBySubscriptionId.get(subscriptionId);
	return snapshot?.type === 'workspace' ? snapshot.data : null;
}

function syncConnectedWorkspaceSnapshots() {
	const state = useWorkspaceStore.getState();
	let changed = false;
	const snapshotByWorkspaceId = new Map(state.snapshotByWorkspaceId);

	for (const workspaceId of state.connectedWorkspaceIds) {
		const snapshot = readWorkspaceSnapshot(workspaceId);
		if (snapshotByWorkspaceId.get(workspaceId) === snapshot) continue;
		snapshotByWorkspaceId.set(workspaceId, snapshot);
		changed = true;
	}

	if (changed) useWorkspaceStore.setState({ snapshotByWorkspaceId });
}

function ensureWorkspaceSnapshotSync() {
	if (unsubscribeFromWsStore) return;
	unsubscribeFromWsStore = useWsStore.subscribe(syncConnectedWorkspaceSnapshots);
}

function parseWorkspaceFileSearchResults(value: unknown): WorkspaceFileSearchResult[] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry) => {
		if (!entry || typeof entry !== 'object') return [];
		const candidate = entry as Partial<WorkspaceFileSearchResult>;
		if (typeof candidate.relativePath !== 'string' || !candidate.relativePath.trim()) return [];

		const relativePath = candidate.relativePath;
		return [
			{
				id: typeof candidate.id === 'string' && candidate.id ? candidate.id : relativePath,
				name:
					typeof candidate.name === 'string' && candidate.name
						? candidate.name
						: basename(relativePath),
				relativePath,
			},
		];
	});
}

function parseWorkspaceDiffPatchResult(value: unknown): WorkspaceDiffPatchResult {
	if (!value || typeof value !== 'object') throw new Error('Invalid workspace diff response');
	const candidate = value as Partial<WorkspaceDiffPatchResult>;
	if (
		typeof candidate.path !== 'string' ||
		!candidate.path ||
		typeof candidate.patch !== 'string' ||
		typeof candidate.patchDigest !== 'string' ||
		!candidate.patchDigest
	) {
		throw new Error('Invalid workspace diff response');
	}

	return {
		path: candidate.path,
		patch: candidate.patch,
		patchDigest: candidate.patchDigest,
	};
}

function parseWorkspaceFileContentsResult(value: unknown): WorkspaceFileContentsResult {
	if (!value || typeof value !== 'object') throw new Error('Invalid workspace file response');
	const candidate = value as Partial<WorkspaceFileContentsResult>;

	const baseValid =
		typeof candidate.path === 'string' &&
		Boolean(candidate.path) &&
		typeof candidate.name === 'string' &&
		Boolean(candidate.name) &&
		typeof candidate.mimeType === 'string' &&
		Boolean(candidate.mimeType) &&
		typeof candidate.size === 'number' &&
		Number.isFinite(candidate.size) &&
		Number.isSafeInteger(candidate.size) &&
		candidate.size >= 0 &&
		typeof candidate.cacheKey === 'string' &&
		Boolean(candidate.cacheKey);

	if (!baseValid) {
		throw new Error('Invalid workspace file response');
	}

	const path = candidate.path as string;
	const name = candidate.name as string;
	const mimeType = candidate.mimeType as string;
	const size = candidate.size as number;
	const cacheKey = candidate.cacheKey as string;

	if (
		candidate.kind === 'text' &&
		typeof candidate.contents === 'string' &&
		candidate.encoding === 'utf-8'
	) {
		return {
			kind: 'text',
			path,
			name,
			contents: candidate.contents,
			mimeType,
			size,
			encoding: 'utf-8',
			cacheKey,
		};
	}

	if (
		candidate.kind === 'image' &&
		typeof candidate.contentUrl === 'string' &&
		candidate.contentUrl.trim()
	) {
		return {
			kind: 'image',
			path,
			name,
			contentUrl: candidate.contentUrl,
			mimeType,
			size,
			cacheKey,
		};
	}

	if (candidate.kind === 'binary') {
		return {
			kind: 'binary',
			path,
			name,
			mimeType,
			size,
			cacheKey,
		};
	}

	throw new Error('Invalid workspace file response');
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
	snapshotByWorkspaceId: new Map(),
	connectedWorkspaceIds: new Set(),

	getWorkspaceSnapshot: (workspaceId) => {
		return get().snapshotByWorkspaceId.get(workspaceId) ?? null;
	},

	connectWorkspace: (workspaceId) => {
		ensureWorkspaceSnapshotSync();
		set((state) => {
			if (state.connectedWorkspaceIds.has(workspaceId)) return state;
			const connectedWorkspaceIds = new Set(state.connectedWorkspaceIds);
			connectedWorkspaceIds.add(workspaceId);
			return { connectedWorkspaceIds };
		});

		useWsStore
			.getState()
			.subscribeTopic(workspaceSubscriptionId(workspaceId), { type: 'workspace', workspaceId });
		syncConnectedWorkspaceSnapshots();
	},

	disconnectWorkspace: (workspaceId) => {
		useWsStore.getState().unsubscribeTopic(workspaceSubscriptionId(workspaceId));
		set((state) => {
			const connectedWorkspaceIds = new Set(state.connectedWorkspaceIds);
			const snapshotByWorkspaceId = new Map(state.snapshotByWorkspaceId);
			connectedWorkspaceIds.delete(workspaceId);
			snapshotByWorkspaceId.delete(workspaceId);
			return { connectedWorkspaceIds, snapshotByWorkspaceId };
		});
	},

	markRead: async (workspaceId) => {
		await useWsStore.getState().command({ type: 'workspace.markRead', workspaceId });
	},

	refreshGit: (workspaceId) => {
		return useWsStore.getState().command({ type: 'workspace.refreshGit', workspaceId });
	},

	refreshPrStage: (workspaceId) => {
		return useWsStore.getState().command({ type: 'workspace.refreshPrStage', workspaceId });
	},

	readDiffPatch: async (workspaceId, path) => {
		const result = await useWsStore.getState().command<unknown>({
			type: 'workspace.readDiffPatch',
			workspaceId,
			path,
		});
		return parseWorkspaceDiffPatchResult(result);
	},

	readFileContents: async (workspaceId, path) => {
		const result = await useWsStore.getState().command<unknown>({
			type: 'workspace.readFile',
			workspaceId,
			path,
		});
		return parseWorkspaceFileContentsResult(result);
	},

	readExternalFileContents: async (path) => {
		const result = await useWsStore.getState().command<unknown>({
			type: 'file.readExternal',
			path,
		});
		return parseWorkspaceFileContentsResult(result);
	},

	searchFiles: async (workspaceId, query, limit) => {
		const result = await useWsStore.getState().command<unknown>({
			type: 'workspace.searchFiles',
			workspaceId,
			query,
			limit,
		});
		return parseWorkspaceFileSearchResults(result);
	},

	renameBranch: (workspaceId, branchName) => {
		return useWsStore
			.getState()
			.command({ type: 'workspace.renameBranch', workspaceId, branchName });
	},

	commitAndPush: (workspaceId, sessionId) => {
		return useWsStore
			.getState()
			.command({ type: 'workspace.commitAndPush', workspaceId, sessionId });
	},

	pullLatestMain: (workspaceId, sessionId) => {
		return useWsStore
			.getState()
			.command({ type: 'workspace.pullLatestMain', workspaceId, sessionId });
	},

	createPr: (workspaceId, sessionId) => {
		return useWsStore.getState().command({ type: 'workspace.createPr', workspaceId, sessionId });
	},

	fixCi: (workspaceId, sessionId) => {
		return useWsStore.getState().command({ type: 'workspace.fixCi', workspaceId, sessionId });
	},

	resolveMergeConflicts: (workspaceId, sessionId) => {
		return useWsStore
			.getState()
			.command({ type: 'workspace.resolveMergeConflicts', workspaceId, sessionId });
	},

	addressReviewComments: (workspaceId, sessionId, commentIds) => {
		return useWsStore
			.getState()
			.command({ type: 'workspace.addressReviewComments', workspaceId, sessionId, commentIds });
	},

	mergePr: (workspaceId) => {
		return useWsStore.getState().command({ type: 'workspace.mergePr', workspaceId });
	},

	openExternal: ({ localPath, action, editor }) => {
		return useWsStore
			.getState()
			.command({ type: 'system.openExternal', localPath, action, editor });
	},
}));
