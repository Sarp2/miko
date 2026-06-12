import path from 'node:path';

import type { WorkspaceFileSearchResult } from 'src/shared/types';
import { runGit } from './diff-store';

const DEFAULT_FILE_SEARCH_LIMIT = 20;
const MAX_FILE_SEARCH_LIMIT = 50;
const FILE_LIST_CACHE_TTL_MS = 15_000;
const MAX_FILE_LIST_CACHE_ENTRIES = 50;

interface FileListCacheEntry {
	expiresAt: number;
	paths: string[];
	pending?: Promise<string[]>;
}

const fileListCacheByWorkspacePath = new Map<string, FileListCacheEntry>();

function pruneWorkspaceFileListCache(now = Date.now()) {
	for (const [workspacePath, entry] of fileListCacheByWorkspacePath.entries()) {
		if (!entry.pending && entry.expiresAt <= now)
			fileListCacheByWorkspacePath.delete(workspacePath);
	}

	while (fileListCacheByWorkspacePath.size > MAX_FILE_LIST_CACHE_ENTRIES) {
		let oldestWorkspacePath: string | null = null;
		let oldestExpiresAt = Number.POSITIVE_INFINITY;

		for (const [workspacePath, entry] of fileListCacheByWorkspacePath.entries()) {
			if (entry.pending) continue;
			if (entry.expiresAt >= oldestExpiresAt) continue;
			oldestWorkspacePath = workspacePath;
			oldestExpiresAt = entry.expiresAt;
		}

		if (!oldestWorkspacePath) return;
		fileListCacheByWorkspacePath.delete(oldestWorkspacePath);
	}
}

function normalizeFilePath(filePath: string) {
	return filePath.replace(/\\/g, '/').trim();
}

function normalizeQuery(query: string) {
	return query.trim().toLowerCase();
}

function resultName(relativePath: string) {
	return path.posix.basename(relativePath);
}

function scorePath(relativePath: string, query: string) {
	if (!query) return 0;

	const normalizedPath = relativePath.toLowerCase();
	const name = resultName(normalizedPath);

	if (name === query) return 0;
	if (name.startsWith(query)) return 10;
	if (normalizedPath.startsWith(query)) return 20;

	const segmentStartIndex = normalizedPath.indexOf(`/${query}`);
	if (segmentStartIndex !== -1) return 30 + segmentStartIndex;

	const nameIndex = name.indexOf(query);
	if (nameIndex !== -1) return 40 + nameIndex;

	const pathIndex = normalizedPath.indexOf(query);
	if (pathIndex !== -1) return 60 + pathIndex;

	return null;
}

function uniqueFilePaths(stdout: string) {
	const seen = new Set<string>();
	const paths: string[] = [];

	for (const line of stdout.split(/\r?\n/u)) {
		const relativePath = normalizeFilePath(line);
		if (!relativePath || seen.has(relativePath)) continue;
		seen.add(relativePath);
		paths.push(relativePath);
	}

	return paths;
}

async function loadWorkspaceFileList(workspacePath: string) {
	const result = await runGit(['ls-files', '-co', '--exclude-standard'], workspacePath);

	if (result.exitCode !== 0) {
		const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
		throw new Error(detail || 'Unable to search workspace files');
	}

	return uniqueFilePaths(result.stdout);
}

async function getWorkspaceFileList(workspacePath: string) {
	const now = Date.now();
	pruneWorkspaceFileListCache(now);
	const cached = fileListCacheByWorkspacePath.get(workspacePath);
	if (cached && !cached.pending && cached.expiresAt > now) return cached.paths;
	if (cached?.pending) return cached.pending;

	const pending = loadWorkspaceFileList(workspacePath)
		.then((paths) => {
			fileListCacheByWorkspacePath.set(workspacePath, {
				paths,
				expiresAt: Date.now() + FILE_LIST_CACHE_TTL_MS,
			});
			pruneWorkspaceFileListCache();
			return paths;
		})
		.catch((error) => {
			fileListCacheByWorkspacePath.delete(workspacePath);
			throw error;
		});

	fileListCacheByWorkspacePath.set(workspacePath, {
		paths: cached?.paths ?? [],
		expiresAt: cached?.expiresAt ?? 0,
		pending,
	});

	return pending;
}

export function clearWorkspaceFileSearchCache(workspacePath?: string) {
	if (workspacePath) {
		fileListCacheByWorkspacePath.delete(workspacePath);
		return;
	}
	fileListCacheByWorkspacePath.clear();
}

export async function searchWorkspaceFiles(
	workspacePath: string,
	query: string,
	limit = DEFAULT_FILE_SEARCH_LIMIT,
): Promise<WorkspaceFileSearchResult[]> {
	const normalizedQuery = normalizeQuery(query);
	const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_FILE_SEARCH_LIMIT;
	const safeLimit = Math.max(1, Math.min(requestedLimit, MAX_FILE_SEARCH_LIMIT));
	const filePaths = await getWorkspaceFileList(workspacePath);

	return filePaths
		.map((relativePath) => {
			const score = scorePath(relativePath, normalizedQuery);
			return score === null ? null : { relativePath, score };
		})
		.filter((entry): entry is { relativePath: string; score: number } => entry !== null)
		.sort((left, right) => {
			if (left.score !== right.score) return left.score - right.score;
			if (left.relativePath.length !== right.relativePath.length) {
				return left.relativePath.length - right.relativePath.length;
			}
			return left.relativePath.localeCompare(right.relativePath);
		})
		.slice(0, safeLimit)
		.map(({ relativePath }) => ({
			id: relativePath,
			name: resultName(relativePath),
			relativePath,
		}));
}
