import path from 'node:path';

import type { WorkspaceFileSearchResult } from 'src/shared/types';
import { runGit } from './diff-store';

const DEFAULT_FILE_SEARCH_LIMIT = 20;
const MAX_FILE_SEARCH_LIMIT = 50;

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

export async function searchWorkspaceFiles(
	workspacePath: string,
	query: string,
	limit = DEFAULT_FILE_SEARCH_LIMIT,
): Promise<WorkspaceFileSearchResult[]> {
	const normalizedQuery = normalizeQuery(query);
	const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_FILE_SEARCH_LIMIT;
	const safeLimit = Math.max(1, Math.min(requestedLimit, MAX_FILE_SEARCH_LIMIT));
	const result = await runGit(['ls-files', '-co', '--exclude-standard'], workspacePath);

	if (result.exitCode !== 0) {
		const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
		throw new Error(detail || 'Unable to search workspace files');
	}

	return uniqueFilePaths(result.stdout)
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
