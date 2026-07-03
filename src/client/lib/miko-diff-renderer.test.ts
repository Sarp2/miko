import { describe, expect, test } from 'bun:test';
import { isPlainTextDiffFileName } from './miko-diff-renderer';

describe('isPlainTextDiffFileName', () => {
	// Files resolving to Shiki "text" hang Pierre's diff renderer and must take the
	// safe-language path instead.
	test('flags extensionless and unknown-extension files', () => {
		expect(isPlainTextDiffFileName('.gitkeep')).toBe(true);
		expect(isPlainTextDiffFileName('.gitignore')).toBe(true);
		expect(isPlainTextDiffFileName('LICENSE')).toBe(true);
		expect(isPlainTextDiffFileName('src/PROBE')).toBe(true);
	});

	test('leaves files with real grammars alone', () => {
		expect(isPlainTextDiffFileName('app.ts')).toBe(false);
		expect(isPlainTextDiffFileName('main.js')).toBe(false);
		expect(isPlainTextDiffFileName('data.json')).toBe(false);
		expect(isPlainTextDiffFileName('notes.md')).toBe(false);
	});
});
