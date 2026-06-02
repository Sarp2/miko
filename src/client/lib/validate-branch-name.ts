// Frontend git branch-name validation. This is UX only; the backend remains the
// source of truth. We never auto-transform input here: on failure we report the
// reason and leave the user's text untouched so they can fix it.

export type BranchNameValidation = { ok: true; value: string } | { ok: false; message: string };

const INVALID_CHARACTER_MESSAGES: Array<[RegExp, string]> = [
	[/\s/, 'Branch names cannot contain spaces'],
	[/~/, 'Branch names cannot contain ~'],
	[/\^/, 'Branch names cannot contain ^'],
	[/:/, 'Branch names cannot contain :'],
	[/\?/, 'Branch names cannot contain ?'],
	[/\*/, 'Branch names cannot contain *'],
	[/\[/, 'Branch names cannot contain ['],
	[/\\/, 'Branch names cannot contain backslashes'],
	// biome-ignore lint/suspicious/noControlCharactersInRegex: git rejects ASCII control characters in refs.
	[/[\x00-\x1f\x7f]/, 'Branch names cannot contain control characters'],
];

const INVALID_PATTERN_MESSAGES: Array<[RegExp, string]> = [
	[/\.\./, 'Branch names cannot contain consecutive dots'],
	[/\/\//, 'Branch names cannot contain double slashes'],
	[/^\//, 'Branch names cannot start with a slash'],
	[/\/$/, 'Branch names cannot end with a slash'],
	[/\.$/, 'Branch names cannot end with a dot'],
	[/\.lock$/, 'Branch name cannot end with .lock'],
	[/@\{/, 'Branch names cannot contain @{'],
];

export function validateBranchName(input: string): BranchNameValidation {
	const value = input;

	if (value.length === 0) return { ok: false, message: 'Branch name cannot be empty' };
	if (value === 'HEAD') return { ok: false, message: 'Branch name cannot be HEAD' };

	for (const [pattern, message] of INVALID_CHARACTER_MESSAGES) {
		if (pattern.test(value)) return { ok: false, message };
	}

	for (const [pattern, message] of INVALID_PATTERN_MESSAGES) {
		if (pattern.test(value)) return { ok: false, message };
	}

	return { ok: true, value };
}
