import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { getDataDir } from '../shared/branding';

export function resolveLocalPath(localPath: string) {
	const trimmed = localPath.trim();
	if (!trimmed) {
		throw new Error('Directory path is required');
	}

	if (trimmed === '~') {
		return homedir();
	}

	if (trimmed.startsWith('~/')) {
		return path.join(homedir(), trimmed.slice(2));
	}

	return path.resolve(trimmed);
}

export async function requireExistingDirectoryPath(localPath: string) {
	const resolvedPath = resolveLocalPath(localPath);
	let info: Awaited<ReturnType<typeof stat>>;
	try {
		info = await stat(resolvedPath);
	} catch {
		throw new Error(`Directory not found: ${resolvedPath}`);
	}

	if (!info.isDirectory()) {
		throw new Error('Directory path must be a directory');
	}

	return resolvedPath;
}

export function getWorkspaceUploadDir(workspaceId: string, dataDir = getDataDir(homedir())) {
	return path.join(resolveLocalPath(dataDir), 'uploads', workspaceId);
}
