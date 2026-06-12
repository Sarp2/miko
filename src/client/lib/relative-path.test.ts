import { describe, expect, test } from 'bun:test';
import { toRelativePath } from './relative-path';

describe('toRelativePath', () => {
	test('strips the root prefix and leading slash', () => {
		expect(toRelativePath('/home/dev/repo/src/app.ts', '/home/dev/repo')).toBe('src/app.ts');
	});

	test('returns the original path when not under the root', () => {
		expect(toRelativePath('/other/app.ts', '/home/dev/repo')).toBe('/other/app.ts');
	});

	test('returns the original path when the root is empty or equal', () => {
		expect(toRelativePath('/home/dev/repo/a.ts', '')).toBe('/home/dev/repo/a.ts');
		expect(toRelativePath('/home/dev/repo', '/home/dev/repo')).toBe('/home/dev/repo');
	});
});
