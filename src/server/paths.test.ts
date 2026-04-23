import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import path from 'node:path';
import { getProjectUploadDir, resolveLocalPath } from './paths';

describe('resolveLocalPath', () => {
	test('throws error on empty string', () => {
		expect(() => resolveLocalPath('')).toThrow('Project path is required');
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

describe('getProjectUploadDir', () => {
	test('appends pahts correctly', () => {
		const result = getProjectUploadDir('/Users/test/project');
		expect(result).toBe('/Users/test/project/.miko/uploads');
	});
});
