import { describe, expect, test } from 'bun:test';
import { basename, toRelativePath } from './relative-path';

describe('basename', () => {
	test('returns the final path segment', () => {
		expect(basename('/home/dev/repo/src/app.ts')).toBe('app.ts');
	});

	test('ignores trailing slashes and falls back to the original path', () => {
		expect(basename('/home/dev/repo/')).toBe('repo');
		expect(basename('')).toBe('');
	});
});

describe('toRelativePath', () => {
	test('strips the root prefix and leading slash', () => {
		expect(toRelativePath('/home/dev/repo/src/app.ts', '/home/dev/repo')).toBe('src/app.ts');
	});

	test('returns the original path when not under the root', () => {
		expect(toRelativePath('/other/app.ts', '/home/dev/repo')).toBe('/other/app.ts');
	});

	test('returns the original path for sibling directories with the same prefix', () => {
		expect(toRelativePath('/home/dev/repo-v2/src/app.ts', '/home/dev/repo')).toBe(
			'/home/dev/repo-v2/src/app.ts',
		);
	});

	test('returns the original path when the root is empty or equal', () => {
		expect(toRelativePath('/home/dev/repo/a.ts', '')).toBe('/home/dev/repo/a.ts');
		expect(toRelativePath('/home/dev/repo', '/home/dev/repo')).toBe('/home/dev/repo');
	});
});
