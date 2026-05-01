import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_KEYBINDINGS } from 'src/shared/types';
import {
	formatDisplayPath,
	KeybindingsManager,
	normalizeKeybindings,
	readKeybindingsSnapshot,
} from './keybindings';

const tempDirs: string[] = [];
const managers: KeybindingsManager[] = [];

afterEach(async () => {
	for (const manager of managers.splice(0)) {
		manager.dispose();
	}

	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
	const dir = await mkdtemp(path.join(tmpdir(), 'miko-keybindings-'));
	tempDirs.push(dir);
	return dir;
}

function createManager(filePath: string) {
	const manager = new KeybindingsManager(filePath);
	managers.push(manager);
	return manager;
}

describe('KeybindingsManager.initialize', () => {
	test('creates parent directory and default keybindings file on initialize', async () => {
		const tempDir = await createTempDir();
		const filePath = path.join(tempDir, 'settings', 'keybindings.json');
		const manager = createManager(filePath);

		await manager.initialize();

		expect(existsSync(path.dirname(filePath))).toBe(true);
		expect(existsSync(filePath)).toBe(true);

		expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(DEFAULT_KEYBINDINGS);
		expect(manager.getSnapshot()).toEqual({
			bindings: DEFAULT_KEYBINDINGS,
			warning: null,
			filePathDisplay: filePath,
		});
	});

	test('loads existing keybindings on initialize', async () => {
		const tempDir = await createTempDir();
		const filePath = path.join(tempDir, 'keybindings.json');

		await writeFile(
			filePath,
			JSON.stringify({
				...DEFAULT_KEYBINDINGS,
				toggleEmbeddedTerminal: ['Cmd+Shift+J', '  CTRL+J  '],
			}),
			'utf8',
		);

		const manager = createManager(filePath);
		await manager.initialize();

		expect(manager.getSnapshot()).toEqual({
			bindings: {
				...DEFAULT_KEYBINDINGS,
				toggleEmbeddedTerminal: ['cmd+shift+j', 'ctrl+j'],
			},
			warning: null,
			filePathDisplay: filePath,
		});

		expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({
			...DEFAULT_KEYBINDINGS,
			toggleEmbeddedTerminal: ['Cmd+Shift+J', '  CTRL+J  '],
		});
	});
});

describe('KeybindingsManager.dispose', () => {
	test('clears listeners on dispose', async () => {
		const tempDir = await createTempDir();
		const filePath = path.join(tempDir, 'keybindings.json');

		const manager = createManager(filePath);
		await manager.initialize();
		let calls = 0;

		manager.onChange(() => {
			calls += 1;
		});
		manager.dispose();

		await manager.write({ toggleEmbeddedTerminal: ['cmd+k'] });

		expect(calls).toBe(0);
	});
});

describe('KeybindingsManager.onChange', () => {
	test('notifies listener when keybindings change', async () => {
		const tempDir = await createTempDir();
		const filePath = path.join(tempDir, 'keybindings.json');

		const manager = createManager(filePath);
		await manager.initialize();
		let calls = 0;

		manager.onChange(() => {
			calls += 1;
		});

		await manager.write({ toggleEmbeddedTerminal: ['cmd+k'] });
		expect(calls).toBe(1);
	});
});

describe('KeybindingsManager.reload', () => {
	test('updates snapshot from keybindings file', async () => {
		const tempDir = await createTempDir();
		const filePath = path.join(tempDir, 'keybindings.json');

		const manager = createManager(filePath);
		await manager.initialize();

		await writeFile(
			filePath,
			JSON.stringify({
				...DEFAULT_KEYBINDINGS,
				toggleEmbeddedTerminal: ['cmd+k'],
			}),
			'utf8',
		);
		await manager.reload();

		expect(manager.getSnapshot().bindings.toggleEmbeddedTerminal).toEqual(['cmd+k']);
	});
});

describe('KeybindingsManager.write', () => {
	test('writes normalized keybindings to file and updates snapshot', async () => {
		const tempDir = await createTempDir();
		const filePath = path.join(tempDir, 'keybindings.json');

		const manager = createManager(filePath);
		await manager.initialize();

		const snapshot = await manager.write({
			toggleEmbeddedTerminal: [' Cmd+K ', 'CTRL+K'],
		});

		expect(snapshot.bindings.toggleEmbeddedTerminal).toEqual(['cmd+k', 'ctrl+k']);
		expect(manager.getSnapshot()).toEqual(snapshot);
		expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(snapshot.bindings);
	});
});

describe('readKeybindingsSnapshot', () => {
	test('returns defaults when keybindings file is missing', async () => {
		const tempDir = await createTempDir();
		const filePath = path.join(tempDir, 'keybindings.json');

		const snapshot = await readKeybindingsSnapshot(filePath);

		expect(snapshot).toEqual({
			bindings: DEFAULT_KEYBINDINGS,
			warning: null,
			filePathDisplay: filePath,
		});
	});

	test('returns defaults when keybindings file is empty', async () => {
		const tempDir = await createTempDir();
		const filePath = path.join(tempDir, 'keybindings.json');
		await writeFile(filePath, '  \n', 'utf8');

		const snapshot = await readKeybindingsSnapshot(filePath);

		expect(snapshot).toEqual({
			bindings: DEFAULT_KEYBINDINGS,
			warning: 'Keybindings file was empty. Using defaults.',
			filePathDisplay: filePath,
		});
	});

	test('returns defaults when keybindings file has invalid JSON', async () => {
		const tempDir = await createTempDir();
		const filePath = path.join(tempDir, 'keybindings.json');
		await writeFile(filePath, JSON.stringify(DEFAULT_KEYBINDINGS).replace('{', ''), 'utf8');

		const snapshot = await readKeybindingsSnapshot(filePath);

		expect(snapshot).toEqual({
			bindings: DEFAULT_KEYBINDINGS,
			warning: 'Keybindings file is invalid JSON. Using defaults.',
			filePathDisplay: filePath,
		});
	});
});

describe('normalizeKeybindings', () => {
	test('requires a keybindings object', () => {
		const snapshot = normalizeKeybindings(null, '/tmp/keybindings.json');

		expect(snapshot.bindings).toEqual(DEFAULT_KEYBINDINGS);
		expect(snapshot.warning).toBe('Keybindings file must contain a JSON object. Using defaults.');
	});

	test('requires shortcut arrays', () => {
		const snapshot = normalizeKeybindings(
			{ toggleEmbeddedTerminal: 'cmd+k' },
			'/tmp/keybindings.json',
		);

		expect(snapshot.bindings.toggleEmbeddedTerminal).toEqual(
			DEFAULT_KEYBINDINGS.toggleEmbeddedTerminal,
		);

		expect(snapshot.warning).toBe(
			'Some keybindings were reset to defaults: toggleEmbeddedTerminal must be an array of shortcut strings',
		);
	});

	test('requires at least one valid shortcut string', () => {
		const snapshot = normalizeKeybindings(
			{ toggleEmbeddedTerminal: [null, '   '] },
			'/tmp/keybindings.json',
		);

		expect(snapshot.bindings.toggleEmbeddedTerminal).toEqual(
			DEFAULT_KEYBINDINGS.toggleEmbeddedTerminal,
		);

		expect(snapshot.warning).toBe(
			'Some keybindings were reset to defaults: toggleEmbeddedTerminal did not contain any valid shortcut strings',
		);
	});
});

describe('formatDisplayPath', () => {
	test('formats home directory as tilde', () => {
		expect(formatDisplayPath(homedir())).toBe('~');
	});

	test('formats paths inside home directory with tilde prefix', () => {
		expect(formatDisplayPath(path.join(homedir(), '.miko', 'keybindings.json'))).toBe(
			'~/.miko/keybindings.json',
		);
	});

	test('keeps paths outside home directory unchanged', () => {
		expect(formatDisplayPath('/tmp/keybindings.json')).toBe('/tmp/keybindings.json');
	});
});
