import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ChatAttachment } from '../shared/types';
import { getProjectUploadDir } from './paths';
import {
	handleAttachmentContent,
	handleProjectFileContent,
	handleProjectUpload,
	handleProjectUploadDelete,
	persistUploadedFiles,
	serveStatic,
} from './server';
import { persistProjectUpload } from './uploads';

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

	return new Request(args.url ?? 'http://localhost/api/projects/project-1/uploads', {
		method: args.method ?? 'POST',
		body: formData,
	});
}

function createStore(project: { id: string; localPath: string } | null) {
	return {
		getProject(projectId: string) {
			return project && project.id === projectId ? project : null;
		},
	} as unknown as import('./event-store').EventStore;
}

function createAttachmentContentRequest(args: { method?: string; url?: string }) {
	return new Request(
		args.url ?? 'http://localhost/api/projects/project-1/uploads/notes.md/content',
		{
			method: args.method ?? 'GET',
		},
	);
}

function createProjectFileContentRequest(args: { method?: string; url?: string }) {
	return new Request(args.url ?? 'http://localhost/api/projects/project-1/files/notes.md/content', {
		method: args.method ?? 'GET',
	});
}

function createUploadDeleteRequest(args: { method?: string; url?: string }) {
	return new Request(args.url ?? 'http://localhost/api/projects/project-1/uploads/notes.md', {
		method: args.method ?? 'DELETE',
	});
}

describe('persistUploadedFiles', () => {
	test('persists every file and forwards upload metadata', async () => {
		const calls: Array<{
			projectId: string;
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
			projectId: 'project-1',
			localPath: '/tmp/project-1',
			files,
			persistUpload: async (args) => {
				calls.push(args);
				return {
					id: `attachment-${calls.length}`,
					kind: 'file',
					displayName: args.fileName,
					absolutePath: `/tmp/project-1/${args.fileName}`,
					relativePath: `./.miko/uploads/${args.fileName}`,
					contentUrl: `/api/projects/${args.projectId}/uploads/${args.fileName}/content`,
					mimeType: args.fallbackMimeType ?? 'application/octet-stream',
					size: args.bytes.byteLength,
				} satisfies ChatAttachment;
			},
		});

		expect(attachments).toHaveLength(2);
		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatchObject({
			projectId: 'project-1',
			localPath: '/tmp/project-1',
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
					projectId: 'project-1',
					localPath,
					files: [new File(['first'], 'first.txt'), new File(['second'], tooLongFileName)],
				}),
			).rejects.toThrow();

			const firstUploadExists = await Bun.file(
				path.join(getProjectUploadDir(localPath), 'first.txt'),
			).exists();
			expect(firstUploadExists).toBe(false);
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});
});

describe('handleProjectUpload', () => {
	test('returns null for non-POST requests', async () => {
		const req = createUploadRequest({ method: 'GET' });
		const response = await handleProjectUpload(req, new URL(req.url), createStore(null));
		expect(response).toBeNull();
	});

	test('returns null for non-upload paths', async () => {
		const req = createUploadRequest({
			url: 'http://localhost/api/projects/project-1/files',
		});

		const response = await handleProjectUpload(req, new URL(req.url), createStore(null));
		expect(response).toBeNull();
	});

	test('returns 404 when project is missing', async () => {
		const req = createUploadRequest({});
		const response = await handleProjectUpload(req, new URL(req.url), createStore(null));

		expect(response?.status).toBe(404);
		expect(await response?.json()).toEqual({ error: 'Project not found' });
	});

	test('returns 400 when no file entries are present', async () => {
		const req = createUploadRequest({ includeNonFileField: true });
		const response = await handleProjectUpload(
			req,
			new URL(req.url),
			createStore({ id: 'project-1', localPath: '/tmp/project-1' }),
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
		const response = await handleProjectUpload(
			req,
			new URL(req.url),
			createStore({ id: 'project-1', localPath: '/tmp/project-1' }),
		);

		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'You can upload up to 50 files at a time.' });
	});

	test('returns 413 when a file exceeds 100 MB', async () => {
		const largeBytes = new Uint8Array(100 * 1024 * 1024 + 1);
		const req = createUploadRequest({ files: [new File([largeBytes], 'big.bin')] });
		const response = await handleProjectUpload(
			req,
			new URL(req.url),
			createStore({ id: 'project-1', localPath: '/tmp/project-1' }),
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

			const response = await handleProjectUpload(
				req,
				new URL(req.url),
				createStore({ id: 'project-1', localPath }),
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
			const response = await handleProjectUpload(
				req,
				new URL(req.url),
				createStore({ id: 'project-1', localPath }),
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
			url: 'http://localhost/api/projects/project-1/uploads/notes.md',
		});

		const response = await handleAttachmentContent(req, new URL(req.url), createStore(null));
		expect(response).toBeNull();
	});

	test('returns 405 for non-GET methods', async () => {
		const req = createAttachmentContentRequest({ method: 'POST' });
		const response = await handleAttachmentContent(
			req,
			new URL(req.url),
			createStore({ id: 'project-1', localPath: '/tmp/project-1' }),
		);

		expect(response?.status).toBe(405);
		expect(response?.headers.get('Allow')).toBe('GET');
	});

	test('returns 404 when project is missing', async () => {
		const req = createAttachmentContentRequest({});
		const response = await handleAttachmentContent(req, new URL(req.url), createStore(null));

		expect(response?.status).toBe(404);
		expect(await response?.json()).toEqual({ error: 'Project not found' });
	});

	test('returns 400 for invalid attachment paths', async () => {
		const req = createAttachmentContentRequest({
			url: 'http://localhost/api/projects/project-1/uploads/..%2Fsecret.txt/content',
		});

		const response = await handleAttachmentContent(
			req,
			new URL(req.url),
			createStore({ id: 'project-1', localPath: '/tmp/project-1' }),
		);

		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'Invalid attachment path' });
	});

	test('returns 404 when attachment file is missing', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			const req = createAttachmentContentRequest({
				url: 'http://localhost/api/projects/project-1/uploads/missing.txt/content',
			});

			const response = await handleAttachmentContent(
				req,
				new URL(req.url),
				createStore({ id: 'project-1', localPath }),
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
			const uploadDir = getProjectUploadDir(localPath);
			await mkdir(path.join(uploadDir, 'folder.txt'), { recursive: true });

			const req = createAttachmentContentRequest({
				url: 'http://localhost/api/projects/project-1/uploads/folder.txt/content',
			});

			const response = await handleAttachmentContent(
				req,
				new URL(req.url),
				createStore({ id: 'project-1', localPath }),
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
			const uploadDir = getProjectUploadDir(localPath);
			await mkdir(uploadDir, { recursive: true });
			const filePath = path.join(uploadDir, 'notes.md');
			await writeFile(filePath, '# hello');

			const req = createAttachmentContentRequest({});
			const response = await handleAttachmentContent(
				req,
				new URL(req.url),
				createStore({ id: 'project-1', localPath }),
			);

			expect(response?.status).toBe(200);
			expect(response?.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
			expect(await response?.text()).toBe('# hello');
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});
});

describe('handleProjectFileContent', () => {
	test('returns null for non-matching paths', async () => {
		const req = createProjectFileContentRequest({
			url: 'http://localhost/api/projects/project-1/files/notes.md',
		});
		const response = await handleProjectFileContent(req, new URL(req.url), createStore(null));
		expect(response).toBeNull();
	});

	test('returns 405 for non-GET methods', async () => {
		const req = createProjectFileContentRequest({ method: 'POST' });
		const response = await handleProjectFileContent(
			req,
			new URL(req.url),
			createStore({ id: 'project-1', localPath: '/tmp/project-1' }),
		);
		expect(response?.status).toBe(405);
		expect(response?.headers.get('Allow')).toBe('GET');
	});

	test('returns 404 when project is missing', async () => {
		const req = createProjectFileContentRequest({});
		const response = await handleProjectFileContent(req, new URL(req.url), createStore(null));
		expect(response?.status).toBe(404);
		expect(await response?.json()).toEqual({ error: 'Project not found' });
	});

	test('returns 400 for invalid project file paths', async () => {
		const req = createProjectFileContentRequest({
			url: 'http://localhost/api/projects/project-1/files/..%2Fsecret.txt/content',
		});
		const response = await handleProjectFileContent(
			req,
			new URL(req.url),
			createStore({ id: 'project-1', localPath: '/tmp/project-1' }),
		);
		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'Invalid project file path' });
	});

	test('returns 400 for absolute project file paths', async () => {
		const req = createProjectFileContentRequest({
			url: 'http://localhost/api/projects/project-1/files/%2Fetc%2Fpasswd/content',
		});
		const response = await handleProjectFileContent(
			req,
			new URL(req.url),
			createStore({ id: 'project-1', localPath: '/tmp/project-1' }),
		);
		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'Invalid project file path' });
	});

	test('returns 404 when project file is missing', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			const req = createProjectFileContentRequest({
				url: 'http://localhost/api/projects/project-1/files/missing.txt/content',
			});
			const response = await handleProjectFileContent(
				req,
				new URL(req.url),
				createStore({ id: 'project-1', localPath }),
			);
			expect(response?.status).toBe(404);
			expect(await response?.json()).toEqual({ error: 'File not found' });
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});

	test('returns 404 when project file path points to a directory', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			await mkdir(path.join(localPath, 'folder.txt'), { recursive: true });

			const req = createProjectFileContentRequest({
				url: 'http://localhost/api/projects/project-1/files/folder.txt/content',
			});
			const response = await handleProjectFileContent(
				req,
				new URL(req.url),
				createStore({ id: 'project-1', localPath }),
			);
			expect(response?.status).toBe(404);
			expect(await response?.json()).toEqual({ error: 'File not found' });
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});

	test('returns project file content with inferred content type', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			const filePath = path.join(localPath, 'notes.md');
			await writeFile(filePath, '# project file');

			const req = createProjectFileContentRequest({});
			const response = await handleProjectFileContent(
				req,
				new URL(req.url),
				createStore({ id: 'project-1', localPath }),
			);
			expect(response?.status).toBe(200);
			expect(response?.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
			expect(await response?.text()).toBe('# project file');
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});
});

describe('handleProjectUploadDelete', () => {
	test('returns null for non-DELETE requests', async () => {
		const req = createUploadDeleteRequest({ method: 'GET' });
		const response = await handleProjectUploadDelete(req, new URL(req.url), createStore(null));
		expect(response).toBeNull();
	});

	test('returns null for non-matching paths', async () => {
		const req = createUploadDeleteRequest({
			url: 'http://localhost/api/projects/project-1/uploads/notes.md/content',
		});

		const response = await handleProjectUploadDelete(req, new URL(req.url), createStore(null));
		expect(response).toBeNull();
	});

	test('returns 404 when project is missing', async () => {
		const req = createUploadDeleteRequest({});
		const response = await handleProjectUploadDelete(req, new URL(req.url), createStore(null));

		expect(response?.status).toBe(404);
		expect(await response?.json()).toEqual({ error: 'Project not found' });
	});

	test('returns 400 for invalid attachment paths', async () => {
		const req = createUploadDeleteRequest({
			url: 'http://localhost/api/projects/project-1/uploads/..%2Fsecret.txt',
		});

		const response = await handleProjectUploadDelete(
			req,
			new URL(req.url),
			createStore({ id: 'project-1', localPath: '/tmp/project-1' }),
		);

		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({ error: 'Invalid attachment path' });
	});

	test('deletes attachment and returns ok true', async () => {
		const localPath = await mkdtemp(path.join(tmpdir(), 'miko-server-'));
		try {
			const attachment = await persistProjectUpload({
				projectId: 'project-1',
				localPath,
				fileName: 'notes.md',
				bytes: new TextEncoder().encode('delete me'),
				fallbackMimeType: 'text/markdown; charset=utf-8',
			});

			const storedName = path.basename(attachment.absolutePath);
			const req = createUploadDeleteRequest({
				url: `http://localhost/api/projects/project-1/uploads/${encodeURIComponent(storedName)}`,
			});

			const response = await handleProjectUploadDelete(
				req,
				new URL(req.url),
				createStore({ id: 'project-1', localPath }),
			);

			expect(response?.status).toBe(200);
			expect(await response?.json()).toEqual({ ok: true });
			expect(await Bun.file(attachment.absolutePath).exists()).toBe(false);
		} finally {
			await rm(localPath, { recursive: true, force: true });
		}
	});
});

describe('serveStatic', () => {
	test('serves an existing file from dist', async () => {
		const distDir = await mkdtemp(path.join(tmpdir(), 'miko-static-'));
		try {
			await writeFile(path.join(distDir, 'app.js'), 'console.log("ok")');
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
