import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { atomicWriteFile, quarantineFile } from './durable-file';

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
	const dir = await mkdtemp(path.join(tmpdir(), 'miko-durable-file-'));
	tempDirs.push(dir);
	return dir;
}

describe('atomicWriteFile', () => {
	test('replaces the destination and preserves its previous contents as a backup', async () => {
		const dir = await createTempDir();
		const filePath = path.join(dir, 'snapshot.json');
		const backupPath = path.join(dir, 'snapshot.previous.json');
		await atomicWriteFile(filePath, 'first');
		await atomicWriteFile(filePath, 'second', { backupPath });

		expect(await Bun.file(filePath).text()).toBe('second');
		expect(await Bun.file(backupPath).text()).toBe('first');
		expect((await readdir(dir)).some((name) => name.endsWith('.tmp'))).toBe(false);
	});
});

describe('quarantineFile', () => {
	test('moves damaged data aside without deleting it', async () => {
		const dir = await createTempDir();
		const filePath = path.join(dir, 'events.jsonl');
		await Bun.write(filePath, '{broken');

		const quarantinePath = await quarantineFile(filePath);

		expect(await Bun.file(filePath).exists()).toBe(false);
		expect(await Bun.file(quarantinePath).text()).toBe('{broken');
		expect(path.basename(quarantinePath)).toContain('events.jsonl.corrupt-');
	});
});
