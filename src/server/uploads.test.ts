import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	deleteProjectUpload,
	getUploadCandidateNames,
	inferAttachmentContentType,
	persistProjectUpload,
	sanitizeFileName,
} from './uploads';

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempProjectDir() {
	const dir = await mkdtemp(path.join(tmpdir(), 'miko-uploads-'));
	tempDirs.push(dir);
	return dir;
}

describe('sanitizeFileName', () => {
	test('keeps only the basename and normalizes unsafe characters', () => {
		expect(sanitizeFileName('../../my report.pdf')).toBe('my-report.pdf');
	});

	test('trims surrounding whitespace from the basename', () => {
		expect(sanitizeFileName('  hello world!.ts  ')).toBe('hello-world-.ts');
	});

	test('falls back to upload when the name becomes empty', () => {
		expect(sanitizeFileName('***')).toBe('upload');
	});
});

describe('getUploadCandidateNames', () => {
	test('returns the sanitized name as the first candidate and preserves the extension for numbered fallbacks', () => {
		const candidates = getUploadCandidateNames('../../my report.pdf');

		expect(candidates.first).toBe('my-report.pdf');
		expect(candidates.withCounter(1)).toBe('my-report-1.pdf');
		expect(candidates.withCounter(2)).toBe('my-report-2.pdf');
	});

	test('uses upload as the base name when sanitization removes everything', () => {
		const candidates = getUploadCandidateNames('***');

		expect(candidates.first).toBe('upload');
		expect(candidates.withCounter(1)).toBe('upload-1');
	});
});

describe('persistProjectUpload', () => {
	test('writes the upload to the project upload directory and returns attachment metadata', async () => {
		const localPath = await createTempProjectDir();
		const bytes = new TextEncoder().encode('hello upload');

		const attachment = await persistProjectUpload({
			projectId: 'project-123',
			localPath,
			fileName: '../../my report.txt',
			bytes,
			fallbackMimeType: 'text/plain; charset=utf-8',
		});

		expect(attachment.kind).toBe('file');
		expect(attachment.displayName).toBe('../../my report.txt');
		expect(attachment.relativePath).toBe('./.miko/uploads/my-report.txt');
		expect(attachment.contentUrl).toBe('/api/projects/project-123/uploads/my-report.txt/content');
		expect(attachment.mimeType).toBe('text/plain; charset=utf-8');
		expect(attachment.size).toBe(bytes.byteLength);
		expect(path.basename(attachment.absolutePath)).toBe('my-report.txt');

		const storedText = await readFile(attachment.absolutePath, 'utf-8');
		expect(storedText).toBe('hello upload');
	});

	test('adds a numeric suffix when the sanitized file name already exists', async () => {
		const localPath = await createTempProjectDir();
		const first = await persistProjectUpload({
			projectId: 'project-123',
			localPath,
			fileName: 'report.txt',
			bytes: new TextEncoder().encode('first'),
			fallbackMimeType: 'text/plain; charset=utf-8',
		});

		const second = await persistProjectUpload({
			projectId: 'project-123',
			localPath,
			fileName: 'report.txt',
			bytes: new TextEncoder().encode('second'),
			fallbackMimeType: 'text/plain; charset=utf-8',
		});

		expect(path.basename(first.absolutePath)).toBe('report.txt');
		expect(path.basename(second.absolutePath)).toBe('report-1.txt');
		expect(second.relativePath).toBe('./.miko/uploads/report-1.txt');
		expect(second.contentUrl).toBe('/api/projects/project-123/uploads/report-1.txt/content');

		const storedText = await readFile(second.absolutePath, 'utf-8');
		expect(storedText).toBe('second');
	});
});

describe('inferAttachmentContentType', () => {
	test('returns a specific mapped content type for known extensions', () => {
		expect(inferAttachmentContentType('data.json')).toBe('application/json; charset=utf-8');
		expect(inferAttachmentContentType('notes.md')).toBe('text/markdown; charset=utf-8');
	});

	test('returns plain text for text-like source files', () => {
		expect(inferAttachmentContentType('component.tsx')).toBe('text/plain; charset=utf-8');
		expect(inferAttachmentContentType('script.py')).toBe('text/plain; charset=utf-8');
	});

	test('uses the provided fallback type or the binary default for unknown extensions', () => {
		expect(inferAttachmentContentType('archive.bin', 'application/custom')).toBe(
			'application/custom',
		);
		expect(inferAttachmentContentType('archive.bin')).toBe('application/octet-stream');
	});
});

describe('deleteProjectUpload', () => {
	test('deletes a stored upload by file name', async () => {
		const localPath = await createTempProjectDir();
		const attachment = await persistProjectUpload({
			projectId: 'project-123',
			localPath,
			fileName: 'report.txt',
			bytes: new TextEncoder().encode('delete me'),
			fallbackMimeType: 'text/plain; charset=utf-8',
		});

		const deleted = await deleteProjectUpload({
			localPath,
			storedName: path.basename(attachment.absolutePath),
		});

		expect(deleted).toBe(true);
		await expect(readFile(attachment.absolutePath, 'utf-8')).rejects.toThrow();
	});

	test('returns false for invalid stored names that are not plain file names', async () => {
		const localPath = await createTempProjectDir();

		await expect(deleteProjectUpload({ localPath, storedName: '' })).resolves.toBe(false);
		await expect(deleteProjectUpload({ localPath, storedName: 'nested/file.txt' })).resolves.toBe(
			false,
		);
		await expect(deleteProjectUpload({ localPath, storedName: 'nested\\file.txt' })).resolves.toBe(
			false,
		);
		await expect(deleteProjectUpload({ localPath, storedName: '.' })).resolves.toBe(false);
		await expect(deleteProjectUpload({ localPath, storedName: '..' })).resolves.toBe(false);
	});
});
