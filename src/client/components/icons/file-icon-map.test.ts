import { describe, expect, test } from 'bun:test';
import { resolveFileIconKey } from './file-icon-map';

describe('resolveFileIconKey', () => {
	test('resolves by extension', () => {
		expect(resolveFileIconKey('src/App.tsx')).toBe('react');
		expect(resolveFileIconKey('main.ts')).toBe('typescript');
		expect(resolveFileIconKey('README.md')).toBe('markdown');
	});

	test('prefers exact filename matches over extension', () => {
		expect(resolveFileIconKey('package.json')).toBe('npm');
		expect(resolveFileIconKey('CLAUDE.md')).toBe('claude');
	});

	test('matches the longest compound extension first', () => {
		expect(resolveFileIconKey('config.env.local')).toBe('fileText');
	});

	test('falls back to the generic file icon for unknown types', () => {
		expect(resolveFileIconKey('notes.xyz')).toBe('file');
		expect(resolveFileIconKey('LICENSE')).toBe('fileText');
	});
});
