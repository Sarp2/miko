import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ScratchpadManager } from './scratchpad-manager';

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
	const dir = await mkdtemp(path.join(tmpdir(), 'miko-scratchpad-'));
	tempDirs.push(dir);
	return dir;
}

describe('ScratchpadManager.getSnapshot', () => {
	test('returns an empty snapshot when no scratchpad file exists', async () => {
		const manager = new ScratchpadManager(await createTempDir());

		await expect(manager.getSnapshot('workspace-1')).resolves.toEqual({
			workspaceId: 'workspace-1',
			content: '',
			updatedAt: null,
		});
	});
});

describe('ScratchpadManager.updateScratchpad', () => {
	test('writes markdown and reads it back from workspace-owned storage', async () => {
		const dataDir = await createTempDir();
		const manager = new ScratchpadManager(dataDir);

		const snapshot = await manager.updateScratchpad('workspace-1', '# Notes\n\n- remember this\n');

		expect(snapshot).toMatchObject({
			workspaceId: 'workspace-1',
			content: '# Notes\n\n- remember this\n',
		});
		expect(typeof snapshot.updatedAt).toBe('number');
		await expect(manager.getSnapshot('workspace-1')).resolves.toEqual(snapshot);
		await expect(
			Bun.file(path.join(dataDir, 'scratchpads', 'workspace-1.md')).text(),
		).resolves.toBe('# Notes\n\n- remember this\n');
	});

	test('keeps scratchpads isolated by workspace id', async () => {
		const manager = new ScratchpadManager(await createTempDir());

		await manager.updateScratchpad('workspace-1', 'one');
		await manager.updateScratchpad('workspace-2', 'two');

		await expect(manager.getSnapshot('workspace-1')).resolves.toMatchObject({ content: 'one' });
		await expect(manager.getSnapshot('workspace-2')).resolves.toMatchObject({ content: 'two' });
	});

	test('rejects unsafe workspace ids before resolving file paths', async () => {
		const manager = new ScratchpadManager(await createTempDir());

		await expect(manager.getSnapshot('../workspace-1')).rejects.toThrow('Invalid workspace id');
		await expect(manager.updateScratchpad('../workspace-1', 'notes')).rejects.toThrow(
			'Invalid workspace id',
		);
	});
});
