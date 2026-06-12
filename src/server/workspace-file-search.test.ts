import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import { runGit } from './diff-store';
import { clearWorkspaceFileSearchCache, searchWorkspaceFiles } from './workspace-file-search';

const roots: string[] = [];

async function createRepo() {
	const root = await mkdtemp(path.join(process.cwd(), '.tmp-workspace-file-search-'));
	roots.push(root);
	await runGit(['init', '-b', 'main'], root);
	return root;
}

async function writeRepoFile(repoPath: string, relativePath: string, content = '') {
	const filePath = path.join(repoPath, relativePath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await Bun.write(filePath, content);
}

afterEach(async () => {
	clearWorkspaceFileSearchCache();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('searchWorkspaceFiles', () => {
	test('searches tracked and untracked non-ignored files', async () => {
		const repoPath = await createRepo();
		await writeRepoFile(repoPath, '.gitignore', 'dist/\n');
		await writeRepoFile(repoPath, 'src/client/chat-composer.tsx');
		await writeRepoFile(repoPath, 'src/server/chat-manager.ts');
		await writeRepoFile(repoPath, 'dist/chat-bundle.js');
		await runGit(['add', '.gitignore', 'src/client/chat-composer.tsx'], repoPath);

		const results = await searchWorkspaceFiles(repoPath, 'chat', 10);
		const paths = results.map((result) => result.relativePath);

		expect(paths).toContain('src/client/chat-composer.tsx');
		expect(paths).toContain('src/server/chat-manager.ts');
		expect(paths).not.toContain('dist/chat-bundle.js');
	});

	test('prefers basename matches and respects the result limit', async () => {
		const repoPath = await createRepo();
		await writeRepoFile(repoPath, 'src/client/components/file-mention.tsx');
		await writeRepoFile(repoPath, 'src/file.ts');
		await writeRepoFile(repoPath, 'docs/mention-file.md');

		const results = await searchWorkspaceFiles(repoPath, 'file', 2);

		expect(results.map((result) => result.relativePath)).toEqual([
			'src/file.ts',
			'src/client/components/file-mention.tsx',
		]);
	});

	test('reuses the cached file list for repeated workspace searches', async () => {
		const repoPath = await createRepo();
		await writeRepoFile(repoPath, 'README.md');

		expect(await searchWorkspaceFiles(repoPath, 'readme')).toHaveLength(1);

		await writeRepoFile(repoPath, 'docs/README.md');

		expect(
			(await searchWorkspaceFiles(repoPath, 'readme')).map((result) => result.relativePath),
		).toEqual(['README.md']);

		clearWorkspaceFileSearchCache(repoPath);

		expect(
			(await searchWorkspaceFiles(repoPath, 'readme')).map((result) => result.relativePath),
		).toEqual(['README.md', 'docs/README.md']);
	});

	test('caches empty file lists', async () => {
		const repoPath = await createRepo();

		expect(await searchWorkspaceFiles(repoPath, 'readme')).toEqual([]);

		await writeRepoFile(repoPath, 'README.md');

		expect(await searchWorkspaceFiles(repoPath, 'readme')).toEqual([]);

		clearWorkspaceFileSearchCache(repoPath);

		expect(
			(await searchWorkspaceFiles(repoPath, 'readme')).map((result) => result.relativePath),
		).toEqual(['README.md']);
	});
});
