import { describe, expect, test } from 'bun:test';
import { displayBashCommand } from './bash-line';

describe('displayBashCommand', () => {
	test('strips shell invocation wrappers', () => {
		expect(displayBashCommand("/bin/zsh -lc 'git diff --stat'")).toBe('git diff --stat');
		expect(displayBashCommand('/usr/bin/bash -c "npm run build"')).toBe('npm run build');
		expect(displayBashCommand("sh -l -c 'ls'")).toBe('ls');
	});

	test('returns plain commands unchanged', () => {
		expect(displayBashCommand('git push origin main')).toBe('git push origin main');
		expect(displayBashCommand("echo 'hello world'")).toBe("echo 'hello world'");
	});
});
