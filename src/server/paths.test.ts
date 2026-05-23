import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import path from 'node:path';
import { getWorkspaceUploadDir, resolveLocalPath } from './paths';

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
		const result = getWorkspaceUploadDir('/Users/test/workspace');
		expect(result).toBe('/Users/test/workspace/.miko/uploads');
	});
});
