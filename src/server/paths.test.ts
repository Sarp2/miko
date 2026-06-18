import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { getWorkspaceUploadDir, requireExistingDirectoryPath, resolveLocalPath } from './paths';

describe('resolveLocalPath', () => {
	test('throws error on empty string', () => {
		expect(() => resolveLocalPath('')).toThrow('Directory path is required');
	});

	test('expands ~ to home directory', () => {
		expect(resolveLocalPath('~')).toBe(homedir());
	});

	test('expands ~/ prefix', () => {
		expect(resolveLocalPath('~/projects')).toBe(path.join(homedir(), 'projects'));
	});

	test('resolves relative paths', () => {
		const result = resolveLocalPath('./foo');
		expect(path.isAbsolute(result)).toBe(true);
	});

	test('returns absolute paths unchanged', () => {
		expect(resolveLocalPath('/usr/local/bin')).toBe('/usr/local/bin');
	});
});

describe('getWorkspaceUploadDir', () => {
	test('appends paths correctly', () => {
		const result = getWorkspaceUploadDir('workspace-1', '/Users/test/.miko-dev/data');
		expect(result).toBe('/Users/test/.miko-dev/data/uploads/workspace-1');
	});
});

describe('requireExistingDirectoryPath', () => {
	test('returns the resolved path for an existing directory', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'miko-paths-'));

		await expect(requireExistingDirectoryPath(dir)).resolves.toBe(dir);
	});

	test('does not create missing directories', async () => {
		const missing = path.join(tmpdir(), `miko-missing-${Date.now()}`);

		await expect(requireExistingDirectoryPath(missing)).rejects.toThrow(
			`Directory not found: ${missing}`,
		);
	});

	test('rejects existing files', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'miko-paths-file-'));
		const filePath = path.join(dir, 'repo.txt');
		await writeFile(filePath, 'not a directory');

		await expect(requireExistingDirectoryPath(filePath)).rejects.toThrow(
			'Directory path must be a directory',
		);
	});
});
