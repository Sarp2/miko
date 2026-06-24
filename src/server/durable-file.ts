import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

async function syncDirectory(directoryPath: string) {
	const handle = await open(directoryPath, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function writeSyncedFile(filePath: string, contents: string) {
	const handle = await open(filePath, 'w', 0o600);
	try {
		await handle.writeFile(contents, 'utf8');
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function replaceFileAtomically(filePath: string, contents: string) {
	const temporaryPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
	);
	try {
		await writeSyncedFile(temporaryPath, contents);
		await rename(temporaryPath, filePath);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

export async function atomicWriteFile(
	filePath: string,
	contents: string,
	options: { backupPath?: string } = {},
) {
	const directoryPath = path.dirname(filePath);
	await mkdir(directoryPath, { recursive: true, mode: 0o700 });

	if (options.backupPath) {
		try {
			const currentContents = await readFile(filePath, 'utf8');
			await replaceFileAtomically(options.backupPath, currentContents);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}

	await replaceFileAtomically(filePath, contents);
	await syncDirectory(directoryPath);
}

export async function quarantineFile(filePath: string) {
	const timestamp = new Date().toISOString().replaceAll(':', '-');
	const quarantinePath = `${filePath}.corrupt-${timestamp}-${randomUUID().slice(0, 8)}`;
	await rename(filePath, quarantinePath);
	await syncDirectory(path.dirname(filePath));
	return quarantinePath;
}

export async function readTextIfExists(filePath: string) {
	try {
		return await readFile(filePath, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}
