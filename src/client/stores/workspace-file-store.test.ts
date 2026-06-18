import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type {
	ChatAttachment,
	WorkspaceDiffPatchResult,
	WorkspaceFileContentsResult,
} from '../../shared/types';
import { useWorkspaceFileStore } from './workspace-file-store';
import { useWorkspaceStore } from './workspace-store';

const originalWorkspaceFileCommands = {
	readFileContents: useWorkspaceStore.getState().readFileContents,
	readExternalFileContents: useWorkspaceStore.getState().readExternalFileContents,
	readDiffPatch: useWorkspaceStore.getState().readDiffPatch,
};

function fileResult(path = 'src/index.css'): WorkspaceFileContentsResult {
	return {
		kind: 'text',
		path,
		name: 'index.css',
		contents: 'body {}',
		mimeType: 'text/plain; charset=utf-8',
		size: 7,
		encoding: 'utf-8',
		cacheKey: `${path}:digest`,
	};
}

function diffResult(path = 'src/index.css'): WorkspaceDiffPatchResult {
	return {
		path,
		patch: 'diff --git a/src/index.css b/src/index.css',
		patchDigest: 'digest',
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

beforeEach(() => {
	useWorkspaceFileStore.getState().resetForTests();
	useWorkspaceStore.setState({
		readFileContents: async () => fileResult(),
		readExternalFileContents: async (_workspaceId, _sessionId, path) => fileResult(path),
		readDiffPatch: async () => diffResult(),
	});
});

afterEach(() => {
	useWorkspaceStore.setState(originalWorkspaceFileCommands);
});

describe('useWorkspaceFileStore.loadFileContents', () => {
	test('loads and caches workspace file contents', async () => {
		await useWorkspaceFileStore.getState().loadFileContents('workspace-1', 'src/index.css');

		expect(
			useWorkspaceFileStore.getState().getFileResource('workspace-1', 'src/index.css'),
		).toMatchObject({
			status: 'ready',
			data: fileResult(),
			error: null,
		});
	});

	test('force refetches ready file contents', async () => {
		let version = 0;
		useWorkspaceStore.setState({
			readFileContents: async () => {
				version += 1;
				return { ...fileResult(), contents: `body { color: ${version}; }` };
			},
		});

		await useWorkspaceFileStore.getState().loadFileContents('workspace-1', 'src/index.css');
		await useWorkspaceFileStore
			.getState()
			.loadFileContents('workspace-1', 'src/index.css', { force: true });

		expect(
			useWorkspaceFileStore.getState().getFileResource('workspace-1', 'src/index.css').data,
		).toMatchObject({
			kind: 'text',
			contents: 'body { color: 2; }',
		});
	});

	test('bounds cached file resources', async () => {
		useWorkspaceStore.setState({
			readFileContents: async (_workspaceId, path) => fileResult(path),
		});

		for (let index = 0; index < 121; index += 1) {
			await useWorkspaceFileStore
				.getState()
				.loadFileContents('workspace-1', `src/file-${index}.ts`);
		}

		expect(useWorkspaceFileStore.getState().fileByKey.size).toBe(120);
		expect(
			useWorkspaceFileStore.getState().getFileResource('workspace-1', 'src/file-0.ts').status,
		).toBe('idle');
		expect(
			useWorkspaceFileStore.getState().getFileResource('workspace-1', 'src/file-120.ts').status,
		).toBe('ready');
	});

	test('does not resurrect file resources after reset', async () => {
		const pending = deferred<WorkspaceFileContentsResult>();
		useWorkspaceStore.setState({
			readFileContents: async () => pending.promise,
		});

		const load = useWorkspaceFileStore.getState().loadFileContents('workspace-1', 'src/index.css');
		useWorkspaceFileStore.getState().resetForTests();
		pending.resolve(fileResult());
		await load;

		expect(
			useWorkspaceFileStore.getState().getFileResource('workspace-1', 'src/index.css').status,
		).toBe('idle');
	});
});

describe('useWorkspaceFileStore.loadExternalFileContents', () => {
	test('loads external file contents through the shared file cache', async () => {
		await useWorkspaceFileStore
			.getState()
			.loadExternalFileContents('workspace-1', 'session-1', '/Users/sarp/.claude/plans/plan.md');

		expect(
			useWorkspaceFileStore
				.getState()
				.getExternalFileResource('workspace-1', 'session-1', '/Users/sarp/.claude/plans/plan.md'),
		).toMatchObject({
			status: 'ready',
			data: fileResult('/Users/sarp/.claude/plans/plan.md'),
			error: null,
		});
	});

	test('keys external file contents by session id', async () => {
		await useWorkspaceFileStore
			.getState()
			.loadExternalFileContents('workspace-1', 'session-1', '/Users/sarp/.claude/plans/plan.md');

		expect(
			useWorkspaceFileStore
				.getState()
				.getExternalFileResource('workspace-1', 'session-2', '/Users/sarp/.claude/plans/plan.md')
				.status,
		).toBe('idle');
	});
});

describe('useWorkspaceFileStore.loadAttachmentFile', () => {
	function textAttachment(): ChatAttachment {
		return {
			id: 'attachment-1',
			kind: 'file',
			displayName: 'create-pr-workspace.md',
			absolutePath: '/tmp/create-pr-workspace.md',
			relativePath: 'create-pr-workspace.md',
			mimeType: 'text/markdown',
			size: 0,
			contentUrl: '/api/agent-instructions/create-pr-workspace.md/content',
		};
	}

	test('force refetches ready attachment previews with a stable attachment id', async () => {
		let version = 0;
		const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () => {
			version += 1;
			return new Response(`instructions ${version}`, { status: 200 });
		}) as unknown as typeof fetch);

		try {
			await useWorkspaceFileStore.getState().loadAttachmentFile('workspace-1', textAttachment());
			await useWorkspaceFileStore.getState().loadAttachmentFile('workspace-1', textAttachment());
			await useWorkspaceFileStore
				.getState()
				.loadAttachmentFile('workspace-1', textAttachment(), { force: true });

			const resource = useWorkspaceFileStore
				.getState()
				.getAttachmentResource('workspace-1', 'attachment-1');

			expect(resource.data).toMatchObject({
				kind: 'text',
				contents: 'instructions 2',
			});
			expect(fetchSpy).toHaveBeenCalledTimes(2);
		} finally {
			fetchSpy.mockRestore();
		}
	});
});

describe('useWorkspaceFileStore.loadDiffPatch', () => {
	test('loads and caches workspace diff patches', async () => {
		await useWorkspaceFileStore.getState().loadDiffPatch('workspace-1', 'src/index.css');

		expect(
			useWorkspaceFileStore.getState().getDiffResource('workspace-1', 'src/index.css'),
		).toMatchObject({
			status: 'ready',
			data: diffResult(),
			error: null,
		});
	});

	test('force refetches ready diffs with the same expected digest', async () => {
		let version = 0;
		useWorkspaceStore.setState({
			readDiffPatch: async () => {
				version += 1;
				return { ...diffResult(), patch: `diff ${version}`, patchDigest: 'digest' };
			},
		});

		await useWorkspaceFileStore
			.getState()
			.loadDiffPatch('workspace-1', 'src/index.css', { expectedPatchDigest: 'digest' });
		await useWorkspaceFileStore.getState().loadDiffPatch('workspace-1', 'src/index.css', {
			expectedPatchDigest: 'digest',
			force: true,
		});

		const resource = useWorkspaceFileStore
			.getState()
			.getDiffResource('workspace-1', 'src/index.css');
		expect(resource.data?.patch).toBe('diff 2');
		expect(version).toBe(2);
	});

	test('refetches ready diffs when the expected digest changes', async () => {
		let version = 0;
		useWorkspaceStore.setState({
			readDiffPatch: async () => {
				version += 1;
				return { ...diffResult(), patch: `diff ${version}`, patchDigest: `digest-${version}` };
			},
		});

		await useWorkspaceFileStore
			.getState()
			.loadDiffPatch('workspace-1', 'src/index.css', { expectedPatchDigest: 'digest-1' });
		await useWorkspaceFileStore
			.getState()
			.loadDiffPatch('workspace-1', 'src/index.css', { expectedPatchDigest: 'digest-1' });
		await useWorkspaceFileStore
			.getState()
			.loadDiffPatch('workspace-1', 'src/index.css', { expectedPatchDigest: 'digest-2' });

		const resource = useWorkspaceFileStore
			.getState()
			.getDiffResource('workspace-1', 'src/index.css');
		expect(resource.data?.patch).toBe('diff 2');
		expect(version).toBe(2);
	});

	test('refetches ready diffs when the expected digest becomes unavailable', async () => {
		let calls = 0;
		useWorkspaceStore.setState({
			readDiffPatch: async () => {
				calls += 1;
				if (calls === 1) return { ...diffResult(), patchDigest: 'digest-1' };
				throw new Error('File is no longer changed');
			},
		});

		await useWorkspaceFileStore
			.getState()
			.loadDiffPatch('workspace-1', 'src/index.css', { expectedPatchDigest: 'digest-1' });
		await useWorkspaceFileStore.getState().loadDiffPatch('workspace-1', 'src/index.css');

		expect(
			useWorkspaceFileStore.getState().getDiffResource('workspace-1', 'src/index.css'),
		).toMatchObject({
			status: 'error',
			error: 'File is no longer changed',
			expectedPatchDigest: null,
		});
		expect(calls).toBe(2);
	});

	test('lets changed diff expectations supersede in-flight requests', async () => {
		const first = deferred<WorkspaceDiffPatchResult>();
		const second = deferred<WorkspaceDiffPatchResult>();
		let calls = 0;
		useWorkspaceStore.setState({
			readDiffPatch: async () => {
				calls += 1;
				return calls === 1 ? first.promise : second.promise;
			},
		});

		const firstLoad = useWorkspaceFileStore
			.getState()
			.loadDiffPatch('workspace-1', 'src/index.css', { expectedPatchDigest: 'digest-1' });
		const secondLoad = useWorkspaceFileStore
			.getState()
			.loadDiffPatch('workspace-1', 'src/index.css', { expectedPatchDigest: 'digest-2' });

		second.resolve({ ...diffResult(), patch: 'diff 2', patchDigest: 'digest-2' });
		await secondLoad;
		first.resolve({ ...diffResult(), patch: 'diff 1', patchDigest: 'digest-1' });
		await firstLoad;

		const resource = useWorkspaceFileStore
			.getState()
			.getDiffResource('workspace-1', 'src/index.css');
		expect(resource.data?.patch).toBe('diff 2');
		expect(resource.expectedPatchDigest).toBe('digest-2');
	});

	test('bounds cached diff resources', async () => {
		useWorkspaceStore.setState({
			readDiffPatch: async (_workspaceId, path) => diffResult(path),
		});

		for (let index = 0; index < 121; index += 1) {
			await useWorkspaceFileStore.getState().loadDiffPatch('workspace-1', `src/file-${index}.ts`, {
				expectedPatchDigest: 'digest',
			});
		}

		expect(useWorkspaceFileStore.getState().diffByKey.size).toBe(120);
		expect(
			useWorkspaceFileStore.getState().getDiffResource('workspace-1', 'src/file-0.ts').status,
		).toBe('idle');
		expect(
			useWorkspaceFileStore.getState().getDiffResource('workspace-1', 'src/file-120.ts').status,
		).toBe('ready');
	});

	test('stores diff load errors', async () => {
		useWorkspaceStore.setState({
			readDiffPatch: async () => {
				throw new Error('File is no longer changed');
			},
		});

		await useWorkspaceFileStore.getState().loadDiffPatch('workspace-1', 'src/index.css');

		expect(
			useWorkspaceFileStore.getState().getDiffResource('workspace-1', 'src/index.css'),
		).toMatchObject({
			status: 'error',
			error: 'File is no longer changed',
		});
	});
});
