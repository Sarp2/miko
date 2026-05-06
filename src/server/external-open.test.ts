import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	buildCustomEditorCommand,
	buildEditorCommand,
	buildPresetEditorCommand,
	normalizeEditorSettings,
	openExternal,
	resolveEditorExecutable,
	tokenizeCommandTemplate,
} from './external-open';
import * as processUtils from './process-utils';

describe('openExternal', () => {
	afterEach(() => {
		spyOn(processUtils, 'hasCommand').mockRestore();
		spyOn(processUtils, 'spawnDetached').mockRestore();
	});

	test('spawns editor with --goto when opening an existing file', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'miko-external-open-'));
		const filePath = path.join(dir, 'x.ts');

		await writeFile(filePath, '');
		spyOn(processUtils, 'hasCommand').mockReturnValue(true);
		const spawn = spyOn(processUtils, 'spawnDetached').mockImplementation(() => {});

		try {
			await openExternal({
				type: 'system.openExternal',
				action: 'open_editor',
				localPath: filePath,
				line: 12,
				column: 4,
				editor: { preset: 'cursor', commandTemplate: 'cursor {path}' },
			});
			expect(spawn).toHaveBeenCalledWith('cursor', ['--goto', `${filePath}:12:4`]);
		} finally {
			await rm(dir, { recursive: true });
		}
	});

	test('throws when open_editor target does not exist', async () => {
		spyOn(processUtils, 'spawnDetached').mockImplementation(() => {});
		await expect(
			openExternal({
				type: 'system.openExternal',
				action: 'open_editor',
				localPath: '/definitely/not/here/x.ts',
			}),
		).rejects.toThrow('Path not found');
	});
});

describe('buildEditorCommand', () => {
	afterEach(() => {
		spyOn(processUtils, 'hasCommand').mockRestore();
	});

	test('routes custom preset through buildCustomEditorCommand', () => {
		spyOn(processUtils, 'hasCommand').mockReturnValue(true);
		expect(
			buildEditorCommand({
				localPath: '/u/me/x.ts',
				isDirectory: false,
				line: 12,
				column: 4,
				editor: { preset: 'custom', commandTemplate: 'myedit --goto {path}:{line}:{column}' },
				platform: 'linux',
			}),
		).toEqual({ command: 'myedit', args: ['--goto', '/u/me/x.ts:12:4'] });
	});

	test('routes preset through buildPresetEditorCommand', () => {
		spyOn(processUtils, 'hasCommand').mockReturnValue(true);
		expect(
			buildEditorCommand({
				localPath: '/u/me/x.ts',
				isDirectory: false,
				line: 12,
				column: 4,
				editor: { preset: 'cursor', commandTemplate: 'cursor {path}' },
				platform: 'linux',
			}),
		).toEqual({ command: 'cursor', args: ['--goto', '/u/me/x.ts:12:4'] });
	});
});

describe('buildPresetEditorCommand', () => {
	afterEach(() => {
		spyOn(processUtils, 'hasCommand').mockRestore();
		spyOn(processUtils, 'canOpenMacApp').mockRestore();
	});

	test('opens path without --goto for directory', () => {
		spyOn(processUtils, 'hasCommand').mockReturnValue(true);
		expect(
			buildPresetEditorCommand(
				{ localPath: '/repo', isDirectory: true, line: 42, column: 8, platform: 'linux' },
				'cursor',
			),
		).toEqual({ command: 'cursor', args: ['/repo'] });
	});

	test('appends --goto path:line:column when line provided', () => {
		spyOn(processUtils, 'hasCommand').mockReturnValue(true);
		expect(
			buildPresetEditorCommand(
				{ localPath: '/repo/x.ts', isDirectory: false, line: 42, column: 8, platform: 'linux' },
				'cursor',
			),
		).toEqual({ command: 'cursor', args: ['--goto', '/repo/x.ts:42:8'] });
	});
});

describe('resolveEditorExecutable', () => {
	afterEach(() => {
		spyOn(processUtils, 'hasCommand').mockRestore();
		spyOn(processUtils, 'canOpenMacApp').mockRestore();
	});

	test('uses CLI shim when present on PATH', () => {
		spyOn(processUtils, 'hasCommand').mockImplementation((cmd) => cmd === 'cursor');
		expect(resolveEditorExecutable('cursor', 'linux')).toEqual({ command: 'cursor', args: [] });
	});

	test('falls back to `open -a` on darwin when CLI missing but app installed', () => {
		spyOn(processUtils, 'hasCommand').mockReturnValue(false);
		spyOn(processUtils, 'canOpenMacApp').mockImplementation((app) => app === 'Visual Studio Code');
		expect(resolveEditorExecutable('vscode', 'darwin')).toEqual({
			command: 'open',
			args: ['-a', 'Visual Studio Code'],
		});
	});

	test('returns bare preset name on linux when nothing detected', () => {
		spyOn(processUtils, 'hasCommand').mockReturnValue(false);
		spyOn(processUtils, 'canOpenMacApp').mockReturnValue(false);
		expect(resolveEditorExecutable('vscode', 'linux')).toEqual({ command: 'code', args: [] });
	});
});

describe('buildCustomEditorCommand', () => {
	afterEach(() => {
		spyOn(processUtils, 'hasCommand').mockRestore();
	});

	test('substitutes {path}, {line}, {column} and tokenizes the result', () => {
		spyOn(processUtils, 'hasCommand').mockReturnValue(true);
		expect(
			buildCustomEditorCommand({
				commandTemplate: 'myedit --goto {path}:{line}:{column}',
				localPath: '/u/me/x.ts',
				line: 12,
				column: 4,
			}),
		).toEqual({ command: 'myedit', args: ['--goto', '/u/me/x.ts:12:4'] });
	});

	test('throws when template is missing {path}', () => {
		expect(() =>
			buildCustomEditorCommand({ commandTemplate: 'myedit --goto', localPath: '/u/me/x.ts' }),
		).toThrow('{path}');
	});

	test('throws when the resolved command is not on PATH', () => {
		spyOn(processUtils, 'hasCommand').mockReturnValue(false);
		expect(() =>
			buildCustomEditorCommand({
				commandTemplate: 'nope-editor {path}',
				localPath: '/u/me/x.ts',
			}),
		).toThrow('Custom editor command not found: nope-editor');
	});
});

describe('tokenizeCommandTemplate', () => {
	test('splits on whitespace and keeps quoted segments together', () => {
		expect(tokenizeCommandTemplate('"/Applications/My Editor" /u/me/x.ts')).toEqual([
			'/Applications/My Editor',
			'/u/me/x.ts',
		]);
	});

	test('backslash escapes a space inside a token', () => {
		expect(tokenizeCommandTemplate('code\\ insiders /u/me/x.ts')).toEqual([
			'code insiders',
			'/u/me/x.ts',
		]);
	});

	test('throws on an unclosed quote', () => {
		expect(() => tokenizeCommandTemplate('"oops /u/me/x.ts')).toThrow('unclosed quote');
	});
});

describe('normalizeEditorSettings', () => {
	test('trims commandTemplate and keeps a known preset', () => {
		expect(
			normalizeEditorSettings({ preset: 'vscode', commandTemplate: '  code {path}  ' }),
		).toEqual({
			preset: 'vscode',
			commandTemplate: 'code {path}',
		});
	});

	test('falls back to defaults for unknown preset and blank template', () => {
		expect(normalizeEditorSettings({ preset: 'emacs' as never, commandTemplate: '   ' })).toEqual({
			preset: 'cursor',
			commandTemplate: 'cursor {path}',
		});
	});
});
