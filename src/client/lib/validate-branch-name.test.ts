import { describe, expect, test } from 'bun:test';
import { validateBranchName } from './validate-branch-name';

describe('validateBranchName', () => {
	test('accepts a normal branch name', () => {
		const result = validateBranchName('feature/header-spec');
		expect(result).toEqual({ ok: true, value: 'feature/header-spec' });
	});

	test('rejects invalid names with a specific message', () => {
		const cases: Array<[string, string]> = [
			['', 'empty'],
			['HEAD', 'HEAD'],
			['has space', 'spaces'],
			['bad~name', '~'],
			['bad:name', ':'],
			['bad\\name', 'backslash'],
			['dot..dot', 'consecutive dots'],
			['a//b', 'double slash'],
			['/leading', 'start with a slash'],
			['trailing/', 'end with a slash'],
			['trailing.', 'end with a dot'],
			['branch.lock', '.lock'],
		];

		for (const [name, hint] of cases) {
			const result = validateBranchName(name);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.message.toLowerCase()).toContain(hint.toLowerCase());
		}
	});
});
