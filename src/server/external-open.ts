import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { ClientCommand, EditorOpenSettings, EditorPreset } from '../shared/protocol';
import { resolveLocalPath } from './paths';
import { canOpenMacApp, hasCommand, spawnDetached } from './process-utils';

type OpenExternalCommand = Extract<ClientCommand, { type: 'system.openExternal' }>;

interface CommandSpec {
	command: string;
	args: string[];
}

const DEFAULT_EDITOR_SETTINGS: EditorOpenSettings = {
	preset: 'cursor',
	commandTemplate: 'cursor {path}',
};

export async function openExternal(command: OpenExternalCommand) {
	const resolvedPath = resolveLocalPath(command.localPath);
	const platform = process.platform;
	const info =
		command.action === 'open_editor' || command.action === 'open_finder'
			? await stat(resolvedPath).catch(() => null)
			: null;

	if (command.action === 'open_editor') {
		if (!info) {
			throw new Error(`Path not found: ${resolvedPath}`);
		}

		const editorCommand = buildEditorCommand({
			localPath: resolvedPath,
			isDirectory: info.isDirectory(),
			line: command.line,
			column: command.column,
			editor: command.editor ?? DEFAULT_EDITOR_SETTINGS,
			platform,
		});

		spawnDetached(editorCommand.command, editorCommand.args);
		return;
	}

	if (platform === 'darwin') {
		if (command.action === 'open_finder') {
			if (info?.isDirectory()) {
				spawnDetached('open', [resolvedPath]);
			} else {
				spawnDetached('open', ['-R', resolvedPath]);
			}
			return;
		}

		if (command.action === 'open_terminal') {
			spawnDetached('open', ['-a', 'Terminal', resolvedPath]);
			return;
		}
	}

	if (command.action === 'open_finder') {
		spawnDetached('xdg-open', [info?.isDirectory() ? resolvedPath : path.dirname(resolvedPath)]);
		return;
	}

	if (command.action === 'open_terminal') {
		for (const terminalCommand of ['x-terminal-emulator', 'gnome-terminal', 'konsole']) {
			if (!hasCommand(terminalCommand)) continue;
			if (terminalCommand === 'konsole') {
				spawnDetached(terminalCommand, ['--workdir', resolvedPath]);
			} else {
				spawnDetached(terminalCommand, ['--working-directory', resolvedPath]);
			}
			return;
		}
		spawnDetached('xdg-open', [resolvedPath]);
	}
}

export function buildEditorCommand(args: {
	localPath: string;
	isDirectory: boolean;
	line?: number;
	column?: number;
	editor: EditorOpenSettings;
	platform: NodeJS.Platform;
}): CommandSpec {
	const editor = normalizeEditorSettings(args.editor);
	if (editor.preset === 'custom') {
		return buildCustomEditorCommand({
			commandTemplate: editor.commandTemplate,
			localPath: args.localPath,
			line: args.line,
			column: args.column,
		});
	}
	return buildPresetEditorCommand(args, editor.preset);
}

export function buildPresetEditorCommand(
	args: {
		localPath: string;
		isDirectory: boolean;
		line?: number;
		column?: number;
		platform: NodeJS.Platform;
	},
	preset: Exclude<EditorPreset, 'custom'>,
): CommandSpec {
	const wantsGoto = !args.isDirectory && Boolean(args.line);
	const opener = resolveEditorExecutable(preset, args.platform, { preferCli: wantsGoto });

	// Never feed --goto to a launcher that cannot forward CLI flags (open -a):
	// open(1) would treat it as its own argument and fail.
	if (!wantsGoto || !opener.supportsGoto) {
		return { command: opener.command, args: [...opener.args, args.localPath] };
	}
	return {
		command: opener.command,
		args: [...opener.args, '--goto', `${args.localPath}:${args.line ?? 1}:${args.column ?? 1}`],
	};
}

const EDITOR_LAUNCHERS: Record<Exclude<EditorPreset, 'custom'>, { cli: string; macApp: string }> = {
	cursor: { cli: 'cursor', macApp: 'Cursor' },
	vscode: { cli: 'code', macApp: 'Visual Studio Code' },
	warp: { cli: 'warp', macApp: 'Warp' },
	antigravity: { cli: 'antigravity', macApp: 'Antigravity' },
};

export interface EditorExecutable {
	command: string;
	args: string[];
	supportsGoto: boolean;
}

export function resolveEditorExecutable(
	preset: Exclude<EditorPreset, 'custom'>,
	platform: NodeJS.Platform,
	options: { preferCli?: boolean } = {},
): EditorExecutable {
	const { cli, macApp } = EDITOR_LAUNCHERS[preset];
	const cliExecutable: EditorExecutable = { command: cli, args: [], supportsGoto: true };

	if (platform !== 'darwin') {
		return cliExecutable;
	}

	// On macOS, `open -a` (LaunchServices) is the reliable way to launch the app.
	// A CLI on PATH can lie: e.g. Cursor's agent installs a `cursor` shim that
	// exits 1 with "No Cursor IDE installation found" instead of opening the IDE,
	// and spawnDetached cannot see that exit code. Prefer the CLI only when the
	// caller needs a --goto line/column jump, which open(1) cannot express.
	const openExecutable: EditorExecutable = {
		command: 'open',
		args: ['-a', macApp],
		supportsGoto: false,
	};
	if (options.preferCli && hasCommand(cli)) return cliExecutable;
	if (canOpenMacApp(macApp)) return openExecutable;
	if (hasCommand(cli)) return cliExecutable;
	return openExecutable;
}

export function buildCustomEditorCommand(args: {
	commandTemplate: string;
	localPath: string;
	line?: number;
	column?: number;
}): CommandSpec {
	const template = args.commandTemplate.trim();
	if (!template.includes('{path}')) {
		throw new Error('Custom editor command must include {path}');
	}

	const line = String(args.line ?? 1);
	const column = String(args.column ?? 1);
	const replaced = template
		.replaceAll('{path}', args.localPath)
		.replaceAll('{line}', line)
		.replaceAll('{column}', column);

	const tokens = tokenizeCommandTemplate(replaced);
	const [command, ...commandArgs] = tokens;
	if (!command) {
		throw new Error('Custom editor command is empty');
	}
	if (!hasCommand(command)) {
		throw new Error(`Custom editor command not found: ${command}`);
	}
	return { command, args: commandArgs };
}

export function tokenizeCommandTemplate(template: string) {
	const tokens: string[] = [];
	let current = '';
	let quote: "'" | '"' | null = null;

	for (let index = 0; index < template.length; index += 1) {
		const char = template[index];

		if (char === '\\' && index + 1 < template.length) {
			current += template[index + 1];
			index += 1;
			continue;
		}

		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}

		if (/\s/.test(char)) {
			if (current.length > 0) {
				tokens.push(current);
				current = '';
			}
			continue;
		}

		current += char;
	}

	if (quote) {
		throw new Error('Custom editor command has an unclosed quote');
	}
	if (current.length > 0) {
		tokens.push(current);
	}
	return tokens;
}

export function normalizeEditorSettings(editor: EditorOpenSettings): EditorOpenSettings {
	const preset = normalizeEditorPreset(editor.preset);
	const commandTemplate = editor.commandTemplate?.trim() || DEFAULT_EDITOR_SETTINGS.commandTemplate;
	return { preset, commandTemplate } as EditorOpenSettings;
}

function normalizeEditorPreset(preset: EditorPreset): EditorPreset {
	switch (preset) {
		case 'vscode':
		case 'custom':
		case 'warp':
		case 'antigravity':
		case 'cursor':
			return preset;
		default:
			return DEFAULT_EDITOR_SETTINGS.preset;
	}
}
