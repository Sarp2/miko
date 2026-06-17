import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { getDataDir } from '../shared/branding';
import type { ChatAttachment } from '../shared/types';
import type { WorkspaceRecord } from './event';
import { getWorkspaceUploadDir } from './paths';
import {
	handleAgentInstructionContent,
	handleAttachmentContent,
	handleWorkspaceFileContent,
	handleWorkspaceUpload,
	handleWorkspaceUploadDelete,
	persistUploadedFiles,
	refreshStartupWorkspaceState,
	serveStatic,
} from './server';
import { persistWorkspaceUpload } from './uploads';

function createUploadRequest(args: {
	method?: string;
	url?: string;
	files?: File[];
	includeNonFileField?: boolean;
}) {
	const formData = new FormData();
	for (const file of args.files ?? []) {
		formData.append('files', file);
	}

	if (args.includeNonFileField) {
		formData.append('files', 'not-a-file');
	}

	return new Request(args.url ?? 'http://localhost/api/workspaces/workspace-1/uploads', {
		method: args.method ?? 'POST',
		body: formData,
	});
}

function createStore(workspace: { id: string; localPath: string } | null) {
	return {
		getWorkspace(workspaceId: string) {
			return workspace && workspace.id === workspaceId ? workspace : null;
		},
	} as unknown as import('./event-store').EventStore;
}

function createAttachmentContentRequest(args: { method?: string; url?: string }) {
	return new Request(
		args.url ?? 'http://localhost/api/workspaces/workspace-1/uploads/notes.md/content',
		{
			method: args.method ?? 'GET',
		},
	);
}

function createAgentInstructionContentRequest(args: { method?: string; url?: string }) {
	return new Request(
		args.url ?? 'http://localhost/api/agent-instructions/create-pr-workspace-1.md/content',
		{
			method: args.method ?? 'GET',
		},
	);
}

function createWorkspaceFileContentRequest(args: { method?: string; url?: string }) {
	return new Request(
		args.url ?? 'http://localhost/api/workspaces/workspace-1/files/notes.md/content',
		{
			method: args.method ?? 'GET',
		},
	);
}

function createUploadDeleteRequest(args: { method?: string; url?: string }) {
	return new Request(args.url ?? 'http://localhost/api/workspaces/workspace-1/uploads/notes.md', {
		method: args.method ?? 'DELETE',
	});
}

describe('persistUploadedFiles', () => {
	test('persists every file and forwards upload metadata', async () => {
		const calls: Array<{
			workspaceId: string;
			localPath: string;
			fileName: string;
			bytes: Uint8Array;
			fallbackMimeType?: string;
		}> = [];

		const files = [
			new File(['hello'], 'hello.txt', { type: 'text/plain' }),
			new File(['no mime'], 'notes.md'),
		];

		const attachments = await persistUploadedFiles({
			workspaceId: 'workspace-1',
			localPath: '/tmp/workspace-1',
			files,
			persistUpload: async (args) => {
				calls.push(args);
				return {
					id: `attachment-${calls.length}`,
					kind: 'file',
					displayName: args.fileName,
					absolutePath: `/tmp/workspace-1/${args.fileName}`,
					relativePath: `./.miko/uploads/${args.fileName}`,
					contentUrl: `/api/workspaces/${args.workspaceId}/uploads/${args.fileName}/content`,
					mimeType: args.fallbackMimeType ?? 'application/octet-stream',
					size: args.bytes.byteLength,
				} satisfies ChatAttachment;
			},
		});

		expect(attachments).toHaveLength(2);
		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatchObject({
			workspaceId: 'workspace-1',
			localPath: '/tmp/workspace-1',
			fileName: 'hello.txt',
			fallbackMimeType: 'text/plain;charset=utf-8',
		});

		expect(new TextDecoder().decode(calls[0]?.bytes)).toBe('hello');
		expect(calls[1]).toMatchObject({
			fileName: 'notes.md',
			fallbackMimeType: undefined,
		});

		expect(new TextDecoder().decode(calls[1]?.bytes)).toBe('no mime');
	});

	test('cleans up already-persisted files when a later default upload fails', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			const tooLongFileName = `${'a'.repeat(280)}.txt`;

			await expect(
				persistUploadedFiles({
					workspaceId: 'workspace-1',
					localPath,
					files: [new File(['first'], 'first.txt'), new File(['second'], tooLongFileName)],
				}),
			).rejects.toThrow();

			const firstUploadExists = await Bun.file(
				path.join(getWorkspaceUploadDir(localPath), 'first.txt'),
			).exists();
			expect(firstUploadExists).toBe(false);
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});
});

describe('handleWorkspaceUpload', () => {
	test('returns null for non-POST requests', async () => {
		const req = createUploadRequest({ method: 'GET' });
		const response = await handleWorkspaceUpload(req, new URL(req.url), createStore(null));
		expect(response).toBeNull();
	});

	test('returns null for non-upload paths', async () => {
		const req = createUploadRequest({
			url: 'http://localhost/api/workspaces/workspace-1/files',
		});

		const response = await handleWorkspaceUpload(req, new URL(req.url), createStore(null));
		expect(response).toBeNull();
	});

	test('returns 404 when workspace is missing', async () => {
		const req = createUploadRequest({});
		const response = await handleWorkspaceUpload(req, new URL(req.url), createStore(null));

		expect(response?.status).toBe(404);
		expect(await response?.json()).toEqual({ error: 'Workspace not found' });
	});

	test('returns 400 when no file entries are present', async () => {
		const req = createUploadRequest({ includeNonFileField: true });
		const response = await handleWorkspaceUpload(
			req,
			new URL(req.url),
			createStore({ id: 'workspace-1', localPath: '/tmp/workspace-1' }),
		);

		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'No files uploaded' });
	});

	test('returns 400 when more than 50 files are uploaded', async () => {
		const files = Array.from(
			{ length: 51 },
			(_, index) => new File([`file-${index}`], `${index}.txt`),
		);

		const req = createUploadRequest({ files });
		const response = await handleWorkspaceUpload(
			req,
			new URL(req.url),
			createStore({ id: 'workspace-1', localPath: '/tmp/workspace-1' }),
		);

		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'You can upload up to 50 files at a time.' });
	});

	test('returns 413 when a file exceeds 100 MB', async () => {
		const largeBytes = new Uint8Array(100 * 1024 * 1024 + 1);
		const req = createUploadRequest({ files: [new File([largeBytes], 'big.bin')] });
		const response = await handleWorkspaceUpload(
			req,
			new URL(req.url),
			createStore({ id: 'workspace-1', localPath: '/tmp/workspace-1' }),
		);

		expect(response?.status).toBe(413);
		expect(await response?.json()).toEqual({ error: 'File "big.bin" exceeds the 100 MB limit.' });
	});

	test('returns uploaded attachments on success', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			const req = createUploadRequest({
				files: [new File(['hello upload'], 'hello.txt', { type: 'text/plain' })],
			});

			const response = await handleWorkspaceUpload(
				req,
				new URL(req.url),
				createStore({ id: 'workspace-1', localPath }),
			);

			expect(response?.status).toBe(200);
			const payload = (await response?.json()) as { attachments: ChatAttachment[] };

			expect(payload.attachments).toHaveLength(1);
			expect(payload.attachments[0]).toMatchObject({
				kind: 'file',
				displayName: 'hello.txt',
				mimeType: 'text/plain;charset=utf-8',
				size: 12,
			});

			const savedPath = payload.attachments[0]?.absolutePath;

			expect(savedPath).toBeTruthy();
			expect(await Bun.file(savedPath as string).text()).toBe('hello upload');
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});

	test('returns 500 when persistUploadedFiles fails', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			const tooLongFileName = `${'a'.repeat(280)}.txt`;
			const req = createUploadRequest({
				files: [new File(['first'], 'first.txt'), new File(['second'], tooLongFileName)],
			});
			const response = await handleWorkspaceUpload(
				req,
				new URL(req.url),
				createStore({ id: 'workspace-1', localPath }),
			);

			expect(response?.status).toBe(500);
			expect(await response?.json()).toEqual({ error: 'Upload failed' });
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});
});

describe('handleAttachmentContent', () => {
	test('returns null for non-matching paths', async () => {
		const req = createAttachmentContentRequest({
			url: 'http://localhost/api/workspaces/workspace-1/uploads/notes.md',
		});

		const response = await handleAttachmentContent(req, new URL(req.url), createStore(null));
		expect(response).toBeNull();
	});

	test('returns 405 for non-GET methods', async () => {
		const req = createAttachmentContentRequest({ method: 'POST' });
		const response = await handleAttachmentContent(
			req,
			new URL(req.url),
			createStore({ id: 'workspace-1', localPath: '/tmp/workspace-1' }),
		);

		expect(response?.status).toBe(405);
		expect(response?.headers.get('Allow')).toBe('GET');
	});

	test('returns 404 when workspace is missing', async () => {
		const req = createAttachmentContentRequest({});
		const response = await handleAttachmentContent(req, new URL(req.url), createStore(null));

		expect(response?.status).toBe(404);
		expect(await response?.json()).toEqual({ error: 'Workspace not found' });
	});

	test('returns 400 for invalid attachment paths', async () => {
		const req = createAttachmentContentRequest({
			url: 'http://localhost/api/workspaces/workspace-1/uploads/..%2Fsecret.txt/content',
		});

		const response = await handleAttachmentContent(
			req,
			new URL(req.url),
			createStore({ id: 'workspace-1', localPath: '/tmp/workspace-1' }),
		);

		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'Invalid attachment path' });
	});

	test('returns 400 for malformed URL-encoded attachment paths', async () => {
		const req = createAttachmentContentRequest({
			url: 'http://localhost/api/workspaces/workspace-1/uploads/%E0%A4%A/content',
		});
		const response = await handleAttachmentContent(
			req,
			new URL(req.url),
			createStore({ id: 'workspace-1', localPath: '/tmp/workspace-1' }),
		);
		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'Invalid attachment path' });
	});

	test('returns 404 when attachment file is missing', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			const req = createAttachmentContentRequest({
				url: 'http://localhost/api/workspaces/workspace-1/uploads/missing.txt/content',
			});

			const response = await handleAttachmentContent(
				req,
				new URL(req.url),
				createStore({ id: 'workspace-1', localPath }),
			);

			expect(response?.status).toBe(404);
			expect(await response?.json()).toEqual({ error: 'Attachment not found' });
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});

	test('returns 404 when attachment path points to a directory', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			const uploadDir = getWorkspaceUploadDir(localPath);
			await mkdir(path.join(uploadDir, 'folder.txt'), { recursive: true });

			const req = createAttachmentContentRequest({
				url: 'http://localhost/api/workspaces/workspace-1/uploads/folder.txt/content',
			});

			const response = await handleAttachmentContent(
				req,
				new URL(req.url),
				createStore({ id: 'workspace-1', localPath }),
			);

			expect(response?.status).toBe(404);
			expect(await response?.json()).toEqual({ error: 'Attachment not found' });
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});

	test('returns attachment content with inferred content type', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			const uploadDir = getWorkspaceUploadDir(localPath);
			await mkdir(uploadDir, { recursive: true });
			const filePath = path.join(uploadDir, 'notes.md');
			await Bun.write(filePath, '# hello');

			const req = createAttachmentContentRequest({});
			const response = await handleAttachmentContent(
				req,
				new URL(req.url),
				createStore({ id: 'workspace-1', localPath }),
			);

			expect(response?.status).toBe(200);
			expect(response?.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
			expect(await response?.text()).toBe('# hello');
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});
});

describe('handleAgentInstructionContent', () => {
	test('returns null for non-matching paths', async () => {
		const req = createAgentInstructionContentRequest({
			url: 'http://localhost/api/agent-instructions/create-pr-workspace-1.md',
		});
		const response = await handleAgentInstructionContent(req, new URL(req.url));
		expect(response).toBeNull();
	});

	test('returns 405 for non-GET methods', async () => {
		const req = createAgentInstructionContentRequest({ method: 'POST' });
		const response = await handleAgentInstructionContent(req, new URL(req.url));

		expect(response?.status).toBe(405);
		expect(response?.headers.get('Allow')).toBe('GET');
	});

	test('returns 400 for invalid instruction names', async () => {
		const req = createAgentInstructionContentRequest({
			url: 'http://localhost/api/agent-instructions/..%2Fsecret.txt/content',
		});
		const response = await handleAgentInstructionContent(req, new URL(req.url));

		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'Invalid agent instruction path' });
	});

	test('returns instruction content with inferred content type', async () => {
		const originalRuntimeProfile = process.env.MIKO_RUNTIME_PROFILE;
		process.env.MIKO_RUNTIME_PROFILE = 'dev';
		const instructionsDir = path.join(getDataDir(homedir()), 'agent-instructions');
		const filePath = path.join(instructionsDir, 'create-pr-workspace-1.md');
		try {
			await mkdir(path.dirname(filePath), { recursive: true });
			await Bun.write(filePath, '# instruction');
			const req = createAgentInstructionContentRequest({});
			const response = await handleAgentInstructionContent(req, new URL(req.url));

			expect(response?.status).toBe(200);
			expect(response?.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
			expect(response?.headers.get('X-Content-Type-Options')).toBe('nosniff');
			expect(await response?.text()).toBe('# instruction');
		} finally {
			process.env.MIKO_RUNTIME_PROFILE = originalRuntimeProfile;
			await rm(filePath, { force: true });
		}
	});

	test('rejects oversized instruction previews', async () => {
		const originalRuntimeProfile = process.env.MIKO_RUNTIME_PROFILE;
		process.env.MIKO_RUNTIME_PROFILE = 'dev';
		const instructionsDir = path.join(getDataDir(homedir()), 'agent-instructions');
		const filePath = path.join(instructionsDir, 'failing-ci-workspace-1.txt');
		try {
			await mkdir(path.dirname(filePath), { recursive: true });
			await Bun.write(filePath, 'x'.repeat(2 * 1024 * 1024 + 1));
			const req = createAgentInstructionContentRequest({
				url: 'http://localhost/api/agent-instructions/failing-ci-workspace-1.txt/content',
			});
			const response = await handleAgentInstructionContent(req, new URL(req.url));

			expect(response?.status).toBe(413);
			expect(await response?.json()).toEqual({
				error: 'Agent instruction is too large to preview',
			});
		} finally {
			process.env.MIKO_RUNTIME_PROFILE = originalRuntimeProfile;
			await rm(filePath, { force: true });
		}
	});
});

describe('handleWorkspaceFileContent', () => {
	test('returns null for non-matching paths', async () => {
		const req = createWorkspaceFileContentRequest({
			url: 'http://localhost/api/workspaces/workspace-1/files/notes.md',
		});
		const response = await handleWorkspaceFileContent(req, new URL(req.url), createStore(null));
		expect(response).toBeNull();
	});

	test('returns 405 for non-GET methods', async () => {
		const req = createWorkspaceFileContentRequest({ method: 'POST' });
		const response = await handleWorkspaceFileContent(
			req,
			new URL(req.url),
			createStore({ id: 'workspace-1', localPath: '/tmp/workspace-1' }),
		);
		expect(response?.status).toBe(405);
		expect(response?.headers.get('Allow')).toBe('GET');
	});

	test('returns 404 when workspace is missing', async () => {
		const req = createWorkspaceFileContentRequest({});
		const response = await handleWorkspaceFileContent(req, new URL(req.url), createStore(null));
		expect(response?.status).toBe(404);
		expect(await response?.json()).toEqual({ error: 'Workspace not found' });
	});

	test('returns 400 for invalid workspace file paths', async () => {
		const req = createWorkspaceFileContentRequest({
			url: 'http://localhost/api/workspaces/workspace-1/files/..%2Fsecret.txt/content',
		});
		const response = await handleWorkspaceFileContent(
			req,
			new URL(req.url),
			createStore({ id: 'workspace-1', localPath: '/tmp/workspace-1' }),
		);
		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'Invalid workspace file path' });
	});

	test('returns 400 for malformed URL-encoded workspace file paths', async () => {
		const req = createWorkspaceFileContentRequest({
			url: 'http://localhost/api/workspaces/workspace-1/files/%E0%A4%A/content',
		});
		const response = await handleWorkspaceFileContent(
			req,
			new URL(req.url),
			createStore({ id: 'workspace-1', localPath: '/tmp/workspace-1' }),
		);
		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'Invalid workspace file path' });
	});

	test('returns 400 for absolute workspace file paths', async () => {
		const req = createWorkspaceFileContentRequest({
			url: 'http://localhost/api/workspaces/workspace-1/files/%2Fetc%2Fpasswd/content',
		});
		const response = await handleWorkspaceFileContent(
			req,
			new URL(req.url),
			createStore({ id: 'workspace-1', localPath: '/tmp/workspace-1' }),
		);
		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'Invalid workspace file path' });
	});

	test('returns 404 when workspace file is missing', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			const req = createWorkspaceFileContentRequest({
				url: 'http://localhost/api/workspaces/workspace-1/files/missing.txt/content',
			});
			const response = await handleWorkspaceFileContent(
				req,
				new URL(req.url),
				createStore({ id: 'workspace-1', localPath }),
			);
			expect(response?.status).toBe(404);
			expect(await response?.json()).toEqual({ error: 'File not found' });
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});

	test('returns 404 when workspace file path points to a directory', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			await mkdir(path.join(localPath, 'folder.txt'), { recursive: true });

			const req = createWorkspaceFileContentRequest({
				url: 'http://localhost/api/workspaces/workspace-1/files/folder.txt/content',
			});
			const response = await handleWorkspaceFileContent(
				req,
				new URL(req.url),
				createStore({ id: 'workspace-1', localPath }),
			);
			expect(response?.status).toBe(404);
			expect(await response?.json()).toEqual({ error: 'File not found' });
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});

	test('returns workspace file content with inferred content type', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			const filePath = path.join(localPath, 'notes.md');
			await Bun.write(filePath, '# workspace file');

			const req = createWorkspaceFileContentRequest({});
			const response = await handleWorkspaceFileContent(
				req,
				new URL(req.url),
				createStore({ id: 'workspace-1', localPath }),
			);
			expect(response?.status).toBe(200);
			expect(response?.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
			expect(response?.headers.get('X-Content-Type-Options')).toBe('nosniff');
			expect(await response?.text()).toBe('# workspace file');
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});
});

describe('handleWorkspaceUploadDelete', () => {
	test('returns null for non-DELETE requests', async () => {
		const req = createUploadDeleteRequest({ method: 'GET' });
		const response = await handleWorkspaceUploadDelete(req, new URL(req.url), createStore(null));
		expect(response).toBeNull();
	});

	test('returns null for non-matching paths', async () => {
		const req = createUploadDeleteRequest({
			url: 'http://localhost/api/workspaces/workspace-1/uploads/notes.md/content',
		});

		const response = await handleWorkspaceUploadDelete(req, new URL(req.url), createStore(null));
		expect(response).toBeNull();
	});

	test('returns 404 when workspace is missing', async () => {
		const req = createUploadDeleteRequest({});
		const response = await handleWorkspaceUploadDelete(req, new URL(req.url), createStore(null));

		expect(response?.status).toBe(404);
		expect(await response?.json()).toEqual({ error: 'Workspace not found' });
	});

	test('returns 400 for invalid attachment paths', async () => {
		const req = createUploadDeleteRequest({
			url: 'http://localhost/api/workspaces/workspace-1/uploads/..%2Fsecret.txt',
		});

		const response = await handleWorkspaceUploadDelete(
			req,
			new URL(req.url),
			createStore({ id: 'workspace-1', localPath: '/tmp/workspace-1' }),
		);

		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'Invalid attachment path' });
	});

	test('returns 400 for malformed URL-encoded attachment paths', async () => {
		const req = createUploadDeleteRequest({
			url: 'http://localhost/api/workspaces/workspace-1/uploads/%E0%A4%A',
		});
		const response = await handleWorkspaceUploadDelete(
			req,
			new URL(req.url),
			createStore({ id: 'workspace-1', localPath: '/tmp/workspace-1' }),
		);
		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'Invalid attachment path' });
	});

	test('deletes attachment and returns ok true', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			const attachment = await persistWorkspaceUpload({
				workspaceId: 'workspace-1',
				localPath,
				fileName: 'notes.md',
				bytes: new TextEncoder().encode('delete me'),
				fallbackMimeType: 'text/markdown; charset=utf-8',
			});

			const storedName = path.basename(attachment.absolutePath);
			const req = createUploadDeleteRequest({
				url: `http://localhost/api/workspaces/workspace-1/uploads/${encodeURIComponent(storedName)}`,
			});

			const response = await handleWorkspaceUploadDelete(
				req,
				new URL(req.url),
				createStore({ id: 'workspace-1', localPath }),
			);

			expect(response?.status).toBe(200);
			expect(await response?.json()).toEqual({ ok: true });
			expect(await Bun.file(attachment.absolutePath).exists()).toBe(false);
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});
});

function makeWorkspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
	return {
		id: 'workspace-1',
		directoryId: 'directory-1',
		localPath: '/tmp/workspace-1',
		branchName: 'main',
		setupState: 'ready',
		reviewState: 'in_review',
		visibilityState: 'active',
		hasUnreadAgentResult: false,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

describe('refreshStartupWorkspaceState', () => {
	test('skips workspaces that fail the startup filters', async () => {
		const gitCalls: string[] = [];
		const prCalls: string[] = [];

		await refreshStartupWorkspaceState({
			listWorkspaces: () => [
				makeWorkspace({ id: 'active', visibilityState: 'active' }),
				makeWorkspace({ id: 'archived', visibilityState: 'archived' }),
				makeWorkspace({ id: 'not-ready', setupState: 'creating' }),
				makeWorkspace({ id: 'done', reviewState: 'done' }),
			],
			refreshWorkspaceGitSnapshot: async (workspaceId) => {
				gitCalls.push(workspaceId);
				return false;
			},
			refreshWorkspacePrStage: async (workspaceId) => {
				prCalls.push(workspaceId);
				return { refreshed: false };
			},
			broadcastSnapshots: async () => {},
			logger: { warn() {} },
		});

		// git refresh requires setupState ready; PR refresh does not.
		expect(gitCalls).toEqual(['active']);
		expect(prCalls).toEqual(['active', 'not-ready']);
	});

	test('broadcasts only after a workspace changes or refreshes', async () => {
		let broadcasts = 0;

		await refreshStartupWorkspaceState({
			listWorkspaces: () => [makeWorkspace({ id: 'changed' }), makeWorkspace({ id: 'unchanged' })],
			refreshWorkspaceGitSnapshot: async (workspaceId) => workspaceId === 'changed',
			refreshWorkspacePrStage: async (workspaceId) => ({ refreshed: workspaceId === 'changed' }),
			broadcastSnapshots: async () => {
				broadcasts++;
			},
			logger: { warn() {} },
		});

		// One broadcast for the changed git snapshot, one for the refreshed PR stage.
		expect(broadcasts).toBe(2);
	});

	test('isolates a failing workspace and keeps refreshing the rest', async () => {
		const gitCalls: string[] = [];
		const prCalls: string[] = [];
		const warnings: unknown[][] = [];

		await refreshStartupWorkspaceState({
			listWorkspaces: () => [makeWorkspace({ id: 'bad' }), makeWorkspace({ id: 'good' })],
			refreshWorkspaceGitSnapshot: async (workspaceId) => {
				gitCalls.push(workspaceId);
				if (workspaceId === 'bad') throw new Error('git boom');
				return false;
			},
			refreshWorkspacePrStage: async (workspaceId) => {
				prCalls.push(workspaceId);
				if (workspaceId === 'bad') throw new Error('pr boom');
				return { refreshed: false };
			},
			broadcastSnapshots: async () => {},
			logger: {
				warn: (...args: unknown[]) => {
					warnings.push(args);
				},
			},
		});

		expect(gitCalls).toEqual(['bad', 'good']);
		expect(prCalls).toEqual(['bad', 'good']);
		expect(warnings).toHaveLength(2);
	});
});

describe('serveStatic', () => {
	test('serves an existing file from dist', async () => {
		const distDir = await mkdtemp(path.join(tmpdir(), 'miko-static-'));
		try {
			await Bun.write(path.join(distDir, 'app.js'), 'console.log("ok")');
			const response = await serveStatic(distDir, '/app.js');

			expect(response.status).toBe(200);
			expect(await response.text()).toBe('console.log("ok")');
		} finally {
			await rm(distDir, { recursive: true, force: true });
		}
	});

	test('returns 503 when neither requested file nor index.html exists', async () => {
		const distDir = await mkdtemp(path.join(tmpdir(), 'miko-static-'));
		try {
			const response = await serveStatic(distDir, '/missing.js');

			expect(response.status).toBe(503);
			expect(await response.text()).toContain('client bundle not found');
		} finally {
			await rm(distDir, { recursive: true, force: true });
		}
	});
});
