import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	appendGitIgnoreEntry,
	computeCurrentFiles,
	createPushFailure,
	DiffStore,
	discardRenamedPath,
	extractGitHubRepoSlug,
	fetchGitHubPullRequests,
	findDirtyPath,
	getBranchHistory,
	getMergeCommitCount,
	getUpstreamStatusCounts,
	listDirtyPaths,
	normalizeRepoRelativePath,
	parseStatusLine,
	predictMergeConflicts,
	readPatchForEntry,
	resolveDefaultBranchName,
	resolveRepo,
	runCommand,
	runGit,
	sanitizeRepoName,
	snapshotsEqual,
	stripTrailingSlash,
} from './diff-store';

type StoredSnapshot = Parameters<typeof snapshotsEqual>[1];
const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
	const dir = await mkdtemp(path.join(tmpdir(), 'miko-diff-store-'));
	tempDirs.push(dir);
	return dir;
}

function createSnapshot(overrides: Partial<StoredSnapshot> = {}): StoredSnapshot {
	return {
		status: 'ready',
		branchName: 'feature/login',
		defaultBranchName: 'main',
		hasOriginRemote: true,
		originRepoSlug: 'acme/repo',
		hasUpstream: true,
		aheadCount: 1,
		behindCount: 0,
		lastFetchedAt: '2026-04-24T10:00:00.000Z',
		files: [
			{
				path: 'src/app.ts',
				changeType: 'modified',
				isUntracked: false,
				additions: 2,
				deletions: 1,
				patchDigest: 'digest-1',
				mimeType: 'text/plain; charset=utf-8',
				size: 123,
			},
		],
		branchHistory: {
			entries: [
				{
					sha: 'abc123',
					summary: 'Add login form',
					description: 'Adds the first pass of the login UI.',
					authorName: 'Sarp',
					authoredAt: '2026-04-24T09:00:00.000Z',
					tags: ['v1.0.0'],
					githubUrl: 'https://github.com/acme/repo/commit/abc123',
				},
			],
		},
		...overrides,
	};
}

describe('snapshotsEqual', () => {
	test('returns true when the previous snapshot is undefined and the next snapshot is the empty unknown state', () => {
		expect(
			snapshotsEqual(undefined, {
				status: 'unknown',
				branchName: undefined,
				defaultBranchName: undefined,
				hasOriginRemote: undefined,
				originRepoSlug: undefined,
				hasUpstream: undefined,
				aheadCount: undefined,
				behindCount: undefined,
				lastFetchedAt: undefined,
				files: [],
				branchHistory: { entries: [] },
			}),
		).toBe(true);
	});

	test('returns false when the previous snapshot is undefined and the next snapshot is not the empty unknown state', () => {
		expect(snapshotsEqual(undefined, createSnapshot())).toBe(false);
	});

	test('returns false when branch metadata changes', () => {
		const base = createSnapshot();

		expect(snapshotsEqual(base, createSnapshot({ branchName: 'feature/profile' }))).toBe(false);
	});

	test('returns true for identical snapshots', () => {
		const left = createSnapshot();
		const right = createSnapshot();

		expect(snapshotsEqual(left, right)).toBe(true);
	});
});

describe('stripTrailingSlash', () => {
	test('removes trailing slashes from the end of a path', () => {
		expect(stripTrailingSlash('tmp/cache///')).toBe('tmp/cache');
	});
});

describe('normalizeRepoRelativePath', () => {
	test('normalizes separators and leading relative markers', () => {
		expect(normalizeRepoRelativePath('./src\\app.ts')).toBe('src/app.ts');
	});

	test('preserves a trailing slash for directory-like paths', () => {
		expect(normalizeRepoRelativePath('tmp/cache/')).toBe('tmp/cache/');
	});

	test('rejects paths that escape the repository', () => {
		expect(() => normalizeRepoRelativePath('../secret.txt')).toThrow(
			'Path must stay inside the repository',
		);
	});
});

describe('runGit', () => {
	test('runs a git command in the provided working tree and returns stdout and exit code', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init'], repoRoot);

		const result = await runGit(['rev-parse', '--show-toplevel'], repoRoot);
		const resolvedRepoRoot = await realpath(repoRoot);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout.trim()).toBe(resolvedRepoRoot);
	});
});

describe('runCommand', () => {
	test('runs a regular command and returns stdout and exit code', async () => {
		const result = await runCommand(['git', '--version']);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('git version');
	});
});

describe('createPushFailure', () => {
	test('maps non-fast-forward errors to a branch out of date message', () => {
		expect(
			createPushFailure('commit_and_push', 'remote rejected: non-fast-forward update', true),
		).toEqual({
			ok: false,
			mode: 'commit_and_push',
			phase: 'push',
			title: 'Branch is not up to date',
			message: 'Your branch is behind its remote. Pull or rebase, then try pushing again.',
			detail: 'remote rejected: non-fast-forward update',
			localCommitCreated: true,
			snapshotChanged: true,
		});
	});
});

describe('resolveRepo', () => {
	test('returns null outside a git repository', async () => {
		const dir = await createTempDir();

		await expect(resolveRepo(dir)).resolves.toBeNull();
	});

	test('returns the repo root and null baseCommit for a repo without commits', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init'], repoRoot);
		const resolvedRepoRoot = await realpath(repoRoot);

		await expect(resolveRepo(repoRoot)).resolves.toEqual({
			repoRoot: resolvedRepoRoot,
			baseCommit: null,
		});
	});

	test('returns the repo root and head commit for a repo with commits', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'README.md'), 'hello\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'init'], repoRoot);

		const resolvedRepoRoot = await realpath(repoRoot);
		const head = await runGit(['rev-parse', 'HEAD'], repoRoot);

		await expect(resolveRepo(repoRoot)).resolves.toEqual({
			repoRoot: resolvedRepoRoot,
			baseCommit: head.stdout.trim(),
		});
	});
});

describe('extractGitHubRepoSlug', () => {
	test('extracts the owner and repo from supported GitHub remote URL formats', () => {
		expect(extractGitHubRepoSlug('git@github.com:acme/repo.git')).toBe('acme/repo');
		expect(extractGitHubRepoSlug('ssh://git@github.com/acme/repo.git')).toBe('acme/repo');
		expect(extractGitHubRepoSlug('https://github.com/acme/repo.git')).toBe('acme/repo');
		expect(extractGitHubRepoSlug('https://github.com/acme/my.repo.git')).toBe('acme/my.repo');
	});

	test('returns null for unsupported remotes', () => {
		expect(extractGitHubRepoSlug('https://gitlab.com/acme/repo.git')).toBeNull();
	});
});

describe('resolveDefaultBranchName', () => {
	test('returns the remote default branch from origin/HEAD when available', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'README.md'), 'hello\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'init'], repoRoot);
		await runGit(['update-ref', 'refs/remotes/origin/main', 'HEAD'], repoRoot);
		await runGit(
			['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'],
			repoRoot,
		);

		await expect(resolveDefaultBranchName(repoRoot)).resolves.toBe('main');
	});

	test('falls back to the local main branch when origin/HEAD is unavailable', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'README.md'), 'hello\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'init'], repoRoot);

		await expect(resolveDefaultBranchName(repoRoot)).resolves.toBe('main');
	});

	test('falls back to the local master branch when main does not exist', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'master'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'README.md'), 'hello\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'init'], repoRoot);

		await expect(resolveDefaultBranchName(repoRoot)).resolves.toBe('master');
	});
});

describe('getUpstreamStatusCounts', () => {
	test('returns ahead and behind counts relative to the upstream branch', async () => {
		const repoRoot = await createTempDir();
		const remoteRoot = await createTempDir();

		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['init', '--bare'], remoteRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'README.md'), 'hello\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'init'], repoRoot);
		await runGit(['remote', 'add', 'origin', remoteRoot], repoRoot);
		await runGit(['push', '-u', 'origin', 'main'], repoRoot);

		await Bun.write(path.join(repoRoot, 'README.md'), 'hello\nmore\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'ahead'], repoRoot);

		await expect(getUpstreamStatusCounts(repoRoot)).resolves.toEqual({
			aheadCount: 1,
			behindCount: 0,
		});
	});
});

describe('parseStatusLine', () => {
	test('parses modified, untracked, and renamed git status lines', () => {
		expect(parseStatusLine('M  src/app.ts')).toEqual({
			path: 'src/app.ts',
			changeType: 'modified',
			isUntracked: false,
		});

		expect(parseStatusLine('?? scratch.log')).toEqual({
			path: 'scratch.log',
			changeType: 'added',
			isUntracked: true,
		});

		expect(parseStatusLine('R  before.txt -> after.txt')).toEqual({
			path: 'after.txt',
			previousPath: 'before.txt',
			changeType: 'renamed',
			isUntracked: false,
		});
	});
});

describe('listDirtyPaths', () => {
	test('returns normalized dirty path entries for modified and untracked files', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'src/app.ts'), 'base\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'init'], repoRoot);

		await Bun.write(path.join(repoRoot, 'src/app.ts'), 'changed\n');
		await Bun.write(path.join(repoRoot, 'scratch.log'), 'tmp\n');

		await expect(listDirtyPaths(repoRoot)).resolves.toEqual([
			{
				path: 'src/app.ts',
				changeType: 'modified',
				isUntracked: false,
				previousPath: undefined,
			},
			{
				path: 'scratch.log',
				changeType: 'added',
				isUntracked: true,
				previousPath: undefined,
			},
		]);
	});
});

describe('findDirtyPath', () => {
	test('returns the dirty entry for a matching path and null for a clean path', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'src/app.ts'), 'base\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'init'], repoRoot);

		await Bun.write(path.join(repoRoot, 'src/app.ts'), 'changed\n');

		await expect(findDirtyPath(repoRoot, 'src/app.ts')).resolves.toEqual({
			path: 'src/app.ts',
			changeType: 'modified',
			isUntracked: false,
			previousPath: undefined,
		});
		await expect(findDirtyPath(repoRoot, 'README.md')).resolves.toBeNull();
	});
});

describe('readPatchForEntry', () => {
	test('returns a patch for a tracked modified file', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'src/app.ts'), 'console.log("old");\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'init'], repoRoot);
		const head = await runGit(['rev-parse', 'HEAD'], repoRoot);

		await Bun.write(path.join(repoRoot, 'src/app.ts'), 'console.log("new");\n');

		const patch = await readPatchForEntry(repoRoot, head.stdout.trim(), {
			path: 'src/app.ts',
			changeType: 'modified',
			isUntracked: false,
		});

		expect(patch).toContain('diff --git a/src/app.ts b/src/app.ts');
		expect(patch).toContain('-console.log("old");');
		expect(patch).toContain('+console.log("new");');
	});

	test('returns a patch for an untracked new file by diffing against /dev/null', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);
		await Bun.write(path.join(repoRoot, 'notes.txt'), 'hello\nworld\n');

		const patch = await readPatchForEntry(repoRoot, null, {
			path: 'notes.txt',
			changeType: 'added',
			isUntracked: true,
		});

		expect(patch).toContain('--- /dev/null');
		expect(patch).toContain('notes.txt');
		expect(patch).toContain('+hello');
		expect(patch).toContain('+world');
	});
});

describe('computeCurrentFiles', () => {
	test('returns sorted diff files with derived patch metadata', async () => {
		const repoRoot = await createTempDir();

		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await mkdir(path.join(repoRoot, 'src'), { recursive: true });
		await Bun.write(path.join(repoRoot, 'src/app.ts'), 'console.log("old");\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'init'], repoRoot);
		const head = await runGit(['rev-parse', 'HEAD'], repoRoot);

		await Bun.write(path.join(repoRoot, 'src/app.ts'), 'console.log("new");\n');
		await Bun.write(path.join(repoRoot, 'scratch.log'), 'tmp\n');

		const files = await computeCurrentFiles(repoRoot, head.stdout.trim());

		expect(files.map((file) => file.path)).toEqual(['scratch.log', 'src/app.ts']);
		expect(files[0]).toMatchObject({
			path: 'scratch.log',
			changeType: 'added',
			isUntracked: true,
			additions: 1,
			deletions: 0,
			mimeType: 'application/octet-stream',
			size: 4,
		});

		expect(files[1]).toMatchObject({
			path: 'src/app.ts',
			changeType: 'modified',
			isUntracked: false,
			additions: 1,
			deletions: 1,
			mimeType: 'text/plain; charset=utf-8',
			size: 20,
		});

		expect(files[0]?.patchDigest).toHaveLength(64);
		expect(files[1]?.patchDigest).toHaveLength(64);
	});
});

describe('getBranchHistory', () => {
	test('returns commit history entries with tags and GitHub commit URLs', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'README.md'), 'hello\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'Initial commit'], repoRoot);
		await runGit(['tag', 'v1.0.0'], repoRoot);
		await runGit(['remote', 'add', 'origin', 'git@github.com:acme/repo.git'], repoRoot);

		const history = await getBranchHistory({
			repoRoot,
			ref: 'main',
			limit: 20,
		});

		expect(history.entries).toHaveLength(1);
		expect(history.entries[0]).toMatchObject({
			summary: 'Initial commit',
			authorName: 'Miko',
			tags: ['v1.0.0'],
			githubUrl: expect.stringContaining('https://github.com/acme/repo/commit/'),
		});
	});
});

describe('getMergeCommitCount', () => {
	test('returns the number of commits that exist on the target ref but not on HEAD', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'README.md'), 'base\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'init'], repoRoot);
		await runGit(['switch', '-c', 'feature/login'], repoRoot);

		await Bun.write(path.join(repoRoot, 'README.md'), 'base\nfeature\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'feature commit'], repoRoot);
		await runGit(['switch', 'main'], repoRoot);

		await expect(getMergeCommitCount(repoRoot, 'feature/login')).resolves.toBe(1);
	});
});

describe('predictMergeConflicts', () => {
	test('returns hasConflicts true for a branch that would conflict with HEAD', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'README.md'), 'base\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'init'], repoRoot);

		await runGit(['switch', '-c', 'feature/conflict'], repoRoot);
		await Bun.write(path.join(repoRoot, 'README.md'), 'feature branch\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'feature change'], repoRoot);

		await runGit(['switch', 'main'], repoRoot);
		await Bun.write(path.join(repoRoot, 'README.md'), 'main branch\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'main change'], repoRoot);

		const result = await predictMergeConflicts(repoRoot, 'feature/conflict');

		expect(result.hasConflicts).toBe(true);
		expect(result.detail).toContain('CONFLICT');
	});
});

describe('discardRenamedPath', () => {
	test('restores the previous path and removes the renamed path', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'before.txt'), 'same\n');
		await runGit(['add', '.'], repoRoot);
		await runGit(['commit', '-m', 'init'], repoRoot);
		await runGit(['mv', 'before.txt', 'after.txt'], repoRoot);

		await discardRenamedPath(repoRoot, {
			path: 'after.txt',
			previousPath: 'before.txt',
			changeType: 'renamed',
			isUntracked: false,
		});

		expect(await Bun.file(path.join(repoRoot, 'before.txt')).exists()).toBe(true);
		expect(await Bun.file(path.join(repoRoot, 'after.txt')).exists()).toBe(false);
	});
});

describe('sanitizeRepoName', () => {
	test('trims, lowercases, replaces invalid characters, and removes outer dashes', () => {
		expect(sanitizeRepoName('  My Repo!  ')).toBe('my-repo');
		expect(sanitizeRepoName('___Hello.World___')).toBe('___hello.world___');
		expect(sanitizeRepoName('!!!')).toBe('');
	});
});

describe('appendGitIgnoreEntry', () => {
	test('appends new ignore entries once and preserves trailing newlines', () => {
		expect(appendGitIgnoreEntry(null, 'scratch.log')).toBe('scratch.log\n');
		expect(appendGitIgnoreEntry('scratch.log\n', 'tmp/cache/')).toBe('scratch.log\ntmp/cache/\n');
		expect(appendGitIgnoreEntry('scratch.log', 'scratch.log')).toBe('scratch.log\n');
	});
});

describe('DiffStore.initializeGit', () => {
	test('initializes git in a project directory and refreshes the project snapshot', async () => {
		const projectPath = await createTempDir();
		const store = new DiffStore(projectPath);

		const result = await store.initializeGit({
			projectId: 'project-1',
			projectPath,
		});

		expect(result).toMatchObject({
			ok: true,
			snapshotChanged: true,
		});

		expect((await stat(path.join(projectPath, '.git'))).isDirectory()).toBe(true);
		expect(store.getProjectSnapshot('project-1')).toMatchObject({
			status: 'ready',
			files: [],
			branchHistory: { entries: [] },
		});
	});
});

describe('DiffStore.readPatch', () => {
	test('returns the patch for a changed file', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'notes.txt'), 'first line\n');
		await runGit(['add', 'notes.txt'], repoRoot);
		await runGit(['commit', '-m', 'initial commit'], repoRoot);
		await Bun.write(path.join(repoRoot, 'notes.txt'), 'first line\nsecond line\n');

		const store = new DiffStore(repoRoot);
		const result = await store.readPatch({
			projectPath: repoRoot,
			path: './notes.txt',
		});

		expect(result.patch).toContain('diff --git a/notes.txt b/notes.txt');
		expect(result.patch).toContain('+second line');
	});
});

describe('DiffStore.refreshSnapshot', () => {
	test('stores a ready snapshot with the current changed files', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'notes.txt'), 'first line\n');
		await runGit(['add', 'notes.txt'], repoRoot);
		await runGit(['commit', '-m', 'initial commit'], repoRoot);
		await Bun.write(path.join(repoRoot, 'notes.txt'), 'first line\nsecond line\n');

		const store = new DiffStore(repoRoot);
		const changed = await store.refreshSnapshot('project-1', repoRoot);
		const snapshot = store.getProjectSnapshot('project-1');

		expect(changed).toBe(true);
		expect(snapshot.status).toBe('ready');
		expect(snapshot.files).toHaveLength(1);
		expect(snapshot.files[0]).toMatchObject({
			path: 'notes.txt',
			changeType: 'modified',
			isUntracked: false,
		});
	});
});

describe('DiffStore.previewMergeBranch', () => {
	test('returns mergeable when the target branch has one clean commit', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'base.txt'), 'base\n');
		await runGit(['add', 'base.txt'], repoRoot);
		await runGit(['commit', '-m', 'base commit'], repoRoot);
		await runGit(['checkout', '-b', 'feature/login'], repoRoot);

		await Bun.write(path.join(repoRoot, 'feature.txt'), 'feature\n');
		await runGit(['add', 'feature.txt'], repoRoot);
		await runGit(['commit', '-m', 'feature commit'], repoRoot);
		await runGit(['checkout', 'main'], repoRoot);

		const store = new DiffStore(repoRoot);
		const result = await store.previewMergeBranch({
			projectPath: repoRoot,
			branch: { kind: 'local', name: 'feature/login' },
		});

		expect(result).toMatchObject({
			status: 'mergeable',
			commitCount: 1,
			hasConflicts: false,
			targetBranchName: 'feature/login',
		});
	});
});

describe('DiffStore.mergeBranch', () => {
	test('merges a clean target branch into the current branch', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'base.txt'), 'base\n');
		await runGit(['add', 'base.txt'], repoRoot);
		await runGit(['commit', '-m', 'base commit'], repoRoot);
		await runGit(['checkout', '-b', 'feature/login'], repoRoot);

		await Bun.write(path.join(repoRoot, 'feature.txt'), 'feature\n');
		await runGit(['add', 'feature.txt'], repoRoot);
		await runGit(['commit', '-m', 'feature commit'], repoRoot);
		await runGit(['checkout', 'main'], repoRoot);

		const store = new DiffStore(repoRoot);
		const result = await store.mergeBranch({
			projectId: 'project-1',
			projectPath: repoRoot,
			branch: { kind: 'local', name: 'feature/login' },
		});

		expect(result).toMatchObject({
			ok: true,
			branchName: 'main',
		});
		expect(await Bun.file(path.join(repoRoot, 'feature.txt')).text()).toBe('feature\n');
	});
});

describe('DiffStore.checkoutBranch', () => {
	test('switches to a local branch', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'base.txt'), 'base\n');
		await runGit(['add', 'base.txt'], repoRoot);
		await runGit(['commit', '-m', 'base commit'], repoRoot);
		await runGit(['checkout', '-b', 'feature/login'], repoRoot);
		await runGit(['checkout', 'main'], repoRoot);

		const store = new DiffStore(repoRoot);
		const result = await store.checkoutBranch({
			projectId: 'project-1',
			projectPath: repoRoot,
			branch: { kind: 'local', name: 'feature/login' },
		});

		expect(result).toMatchObject({
			ok: true,
			branchName: 'feature/login',
		});
	});
});

describe('DiffStore.createBranch', () => {
	test('creates and switches to a new branch from the current branch', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'base.txt'), 'base\n');
		await runGit(['add', 'base.txt'], repoRoot);
		await runGit(['commit', '-m', 'base commit'], repoRoot);

		const store = new DiffStore(repoRoot);
		const result = await store.createBranch({
			projectId: 'project-1',
			projectPath: repoRoot,
			name: 'feature/login',
		});

		expect(result).toMatchObject({
			ok: true,
			branchName: 'feature/login',
		});

		expect((await runGit(['branch', '--show-current'], repoRoot)).stdout.trim()).toBe(
			'feature/login',
		);
	});
});

describe('DiffStore.syncBranch', () => {
	test('fetches from a local origin remote', async () => {
		const remoteRoot = await createTempDir();
		const repoRoot = await createTempDir();

		await runGit(['init', '--bare'], remoteRoot);
		await runGit(['init', '-b', 'main'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'base.txt'), 'base\n');
		await runGit(['add', 'base.txt'], repoRoot);
		await runGit(['commit', '-m', 'base commit'], repoRoot);
		await runGit(['remote', 'add', 'origin', remoteRoot], repoRoot);

		const store = new DiffStore(repoRoot);
		const result = await store.syncBranch({
			projectId: 'project-1',
			projectPath: repoRoot,
			action: 'fetch',
		});

		expect(result).toMatchObject({
			ok: true,
			action: 'fetch',
			branchName: 'main',
		});
	});
});

describe('DiffStore.commitFiles', () => {
	test('commits only the selected changed file in commit-only mode', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'selected.txt'), 'before\n');
		await Bun.write(path.join(repoRoot, 'other.txt'), 'before\n');

		await runGit(['add', 'selected.txt', 'other.txt'], repoRoot);
		await runGit(['commit', '-m', 'base commit'], repoRoot);

		await Bun.write(path.join(repoRoot, 'selected.txt'), 'after\n');
		await Bun.write(path.join(repoRoot, 'other.txt'), 'after\n');

		const store = new DiffStore(repoRoot);
		const result = await store.commitFiles({
			projectId: 'project-1',
			projectPath: repoRoot,
			paths: ['selected.txt'],
			summary: 'Update selected file',
			mode: 'commit_only',
		});

		expect(result).toMatchObject({
			ok: true,
			mode: 'commit_only',
			pushed: false,
		});

		expect((await runGit(['show', 'HEAD:selected.txt'], repoRoot)).stdout).toBe('after\n');
		expect((await runGit(['show', 'HEAD:other.txt'], repoRoot)).stdout).toBe('before\n');
		expect((await listDirtyPaths(repoRoot)).map((entry) => entry.path)).toEqual(['other.txt']);
	});
});

describe('DiffStore.discardFile', () => {
	test('restores a modified tracked file to the last commit', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'notes.txt'), 'before\n');
		await runGit(['add', 'notes.txt'], repoRoot);
		await runGit(['commit', '-m', 'base commit'], repoRoot);
		await Bun.write(path.join(repoRoot, 'notes.txt'), 'after\n');

		const store = new DiffStore(repoRoot);
		const result = await store.discardFile({
			projectId: 'project-1',
			projectPath: repoRoot,
			path: 'notes.txt',
		});

		expect(result.snapshotChanged).toBe(true);
		expect(await Bun.file(path.join(repoRoot, 'notes.txt')).text()).toBe('before\n');
		expect(await listDirtyPaths(repoRoot)).toEqual([]);
	});
});

describe('DiffStore.ignoreFile', () => {
	test('adds an untracked file to gitignore and removes it from dirty paths', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'base.txt'), 'base\n');
		await runGit(['add', 'base.txt'], repoRoot);
		await runGit(['commit', '-m', 'base commit'], repoRoot);
		await Bun.write(path.join(repoRoot, 'debug.log'), 'debug\n');

		const store = new DiffStore(repoRoot);
		const result = await store.ignoreFile({
			projectId: 'project-1',
			projectPath: repoRoot,
			path: 'debug.log',
		});

		expect(result.snapshotChanged).toBe(true);
		expect(await Bun.file(path.join(repoRoot, '.gitignore')).text()).toBe('debug.log\n');
		expect((await listDirtyPaths(repoRoot)).map((entry) => entry.path)).toEqual(['.gitignore']);
	});

	test('does not match sibling paths that share the ignore prefix', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init'], repoRoot);
		await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
		await runGit(['config', 'user.name', 'Miko'], repoRoot);

		await Bun.write(path.join(repoRoot, 'base.txt'), 'base\n');
		await runGit(['add', 'base.txt'], repoRoot);
		await runGit(['commit', '-m', 'base commit'], repoRoot);
		await mkdir(path.join(repoRoot, 'foobar'));
		await Bun.write(path.join(repoRoot, 'foobar', 'baz.txt'), 'baz\n');

		const store = new DiffStore(repoRoot);
		await expect(
			store.ignoreFile({
				projectId: 'project-1',
				projectPath: repoRoot,
				path: 'foo',
			}),
		).rejects.toThrow('File is no longer changed: foo');

		expect(await Bun.file(path.join(repoRoot, '.gitignore')).exists()).toBe(false);
		expect((await listDirtyPaths(repoRoot)).map((entry) => entry.path)).toEqual(['foobar/baz.txt']);
	});
});

describe('DiffStore.discardFile in an unborn repo', () => {
	test('fully discards a staged added file before the first commit', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init'], repoRoot);
		await Bun.write(path.join(repoRoot, 'new-file.txt'), 'new\n');
		await runGit(['add', 'new-file.txt'], repoRoot);

		const store = new DiffStore(repoRoot);
		const result = await store.discardFile({
			projectId: 'project-1',
			projectPath: repoRoot,
			path: 'new-file.txt',
		});

		expect(result.snapshotChanged).toBe(true);
		expect(await Bun.file(path.join(repoRoot, 'new-file.txt')).exists()).toBe(false);
		expect(await listDirtyPaths(repoRoot)).toEqual([]);
	});
});

describe('fetchGitHubPullRequests', () => {
	test('returns an empty gh api array without falling back to fetch', async () => {
		let fetchCalled = false;
		const fetchImpl: typeof fetch = ((...args: Parameters<typeof fetch>) => {
			fetchCalled = true;
			return fetch(...args);
		}) as typeof fetch;

		const result = await fetchGitHubPullRequests('sarp/miko', {
			ghApiImpl: async () => [],
			fetchImpl,
		});

		expect(result).toEqual([]);
		expect(fetchCalled).toBe(false);
	});
});

describe('DiffStore.refreshSnapshot lastFetchedAt', () => {
	test('resolves a relative FETCH_HEAD path from the target repo root', async () => {
		const repoRoot = await createTempDir();
		await runGit(['init'], repoRoot);
		await Bun.write(path.join(repoRoot, '.git', 'FETCH_HEAD'), 'fetch data\n');
		const expectedFetchedAt = (
			await stat(path.join(repoRoot, '.git', 'FETCH_HEAD'))
		).mtime.toISOString();

		const store = new DiffStore(repoRoot);
		await store.refreshSnapshot('project-1', repoRoot);

		expect(store.getProjectSnapshot('project-1').lastFetchedAt).toBe(expectedFetchedAt);
	});
});
