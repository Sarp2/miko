import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acquireDataDirLock } from './data-dir-lock';

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
	const dir = await mkdtemp(path.join(tmpdir(), 'miko-data-lock-'));
	tempDirs.push(dir);
	return dir;
}

describe('acquireDataDirLock', () => {
	test('allows only one owner until the lock is released', async () => {
		const dataDir = await createTempDir();
		const first = await acquireDataDirLock(dataDir);

		await expect(acquireDataDirLock(dataDir)).rejects.toThrow('Miko is already using');

		await first.release();
		const second = await acquireDataDirLock(dataDir);
		await second.release();
	});

	test('releases the operating-system lease without leaving lock data on disk', async () => {
		const dataDir = await createTempDir();
		const lock = await acquireDataDirLock(dataDir);
		expect(lock.path).toStartWith('tcp://127.0.0.1:');
		await lock.release();

		const next = await acquireDataDirLock(dataDir);
		await next.release();
	});
});
