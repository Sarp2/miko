import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	appendGitIgnoreEntry,
	computeCurrentFiles,
	DiffStore,
	discardRenamedPath,
	extractGitHubRepoSlug,
	findDirtyPath,
	getBranchHistory,
	getMainAheadCount,
	getUpstreamStatusCounts,
	hasPushedCommits,
	listDirtyPaths,
	normalizeRepoRelativePath,
	parseStatusLine,
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

async function createRepo(args: { branch?: string; remote?: string } = {}) {
	const repoRoot = await createTempDir();
	await runGit(['init', '-b', args.branch ?? 'main'], repoRoot);
	await runGit(['config', 'user.email', 'miko@example.com'], repoRoot);
	await runGit(['config', 'user.name', 'Miko'], repoRoot);
	if (args.remote) await runGit(['remote', 'add', 'origin', args.remote], repoRoot);
	return repoRoot;
}

async function commitFile(
	repoRoot: string,
	relativePath: string,
	contents: string,
	message: string,
) {
	await mkdir(path.dirname(path.join(repoRoot, relativePath)), { recursive: true });
	await Bun.write(path.join(repoRoot, relativePath), contents);
	await runGit(['add', relativePath], repoRoot);
	await runGit(['commit', '-m', message], repoRoot);
}

async function createRepoWithInitialCommit(args: { branch?: string; remote?: string } = {}) {
	const repoRoot = await createRepo(args);
	await commitFile(repoRoot, 'README.md', 'hello\n', 'Initial commit');
	return repoRoot;
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
		hasPushedCommits: true,
		branchPublishState: 'published',
		mainAheadCount: 0,
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
				hasPushedCommits: undefined,
				branchPublishState: 'unknown',
				mainAheadCount: undefined,
				branchHistory: { entries: [] },
			}),
		).toBe(true);
	});

	test('returns false when the previous snapshot is undefined and the next snapshot is not empty', () => {
		expect(snapshotsEqual(undefined, createSnapshot())).toBe(false);
	});

	test('returns false when branch, publish, main-ahead, or file metadata changes', () => {
		const base = createSnapshot();

		expect(snapshotsEqual(base, createSnapshot({ branchName: 'feature/profile' }))).toBe(false);
		expect(snapshotsEqual(base, createSnapshot({ hasPushedCommits: false }))).toBe(false);
		expect(snapshotsEqual(base, createSnapshot({ branchPublishState: 'local_only' }))).toBe(false);
		expect(snapshotsEqual(base, createSnapshot({ mainAheadCount: 2 }))).toBe(false);
		expect(snapshotsEqual(base, createSnapshot({ files: [] }))).toBe(false);
	});

	test('returns true for identical snapshots', () => {
		expect(snapshotsEqual(createSnapshot(), createSnapshot())).toBe(true);
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
		const repoRoot = await createRepoWithInitialCommit();
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
		const repoRoot = await createRepoWithInitialCommit({ branch: 'main' });
		await runGit(['update-ref', 'refs/remotes/origin/main', 'HEAD'], repoRoot);
		await runGit(
			['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'],
			repoRoot,
		);

		await expect(resolveDefaultBranchName(repoRoot)).resolves.toBe('main');
	});

	test('falls back to the local main branch when origin/HEAD is unavailable', async () => {
		const repoRoot = await createRepoWithInitialCommit({ branch: 'main' });

		await expect(resolveDefaultBranchName(repoRoot)).resolves.toBe('main');
	});

	test('falls back to the local master branch when main does not exist', async () => {
		const repoRoot = await createRepoWithInitialCommit({ branch: 'master' });

		await expect(resolveDefaultBranchName(repoRoot)).resolves.toBe('master');
	});
});

describe('getUpstreamStatusCounts', () => {
	test('returns ahead and behind counts relative to the upstream branch', async () => {
		const remoteRoot = await createTempDir();
		const repoRoot = await createRepoWithInitialCommit({ branch: 'main' });

		await runGit(['init', '--bare'], remoteRoot);
		await runGit(['remote', 'add', 'origin', remoteRoot], repoRoot);
		await runGit(['push', '-u', 'origin', 'main'], repoRoot);
		await commitFile(repoRoot, 'README.md', 'hello\nmore\n', 'ahead');

		await expect(getUpstreamStatusCounts(repoRoot)).resolves.toEqual({
			aheadCount: 1,
			behindCount: 0,
		});
	});
});

describe('hasPushedCommits', () => {
	test('returns true when the remote workspace branch has commits past remote main', async () => {
		const repoRoot = await createRepoWithInitialCommit({ branch: 'main' });
		await runGit(['checkout', '-b', 'atlas'], repoRoot);
		await commitFile(repoRoot, 'feature.txt', 'feature\n', 'feature');
		await runGit(['update-ref', 'refs/remotes/origin/main', 'main'], repoRoot);
		await runGit(['update-ref', 'refs/remotes/origin/atlas', 'atlas'], repoRoot);

		await expect(
			hasPushedCommits({ repoRoot, branchName: 'atlas', defaultBranchName: 'main' }),
		).resolves.toBe(true);
	});

	test('returns false when the remote workspace branch does not exist', async () => {
		const repoRoot = await createRepoWithInitialCommit({ branch: 'main' });
		await runGit(['update-ref', 'refs/remotes/origin/main', 'main'], repoRoot);

		await expect(
			hasPushedCommits({ repoRoot, branchName: 'atlas', defaultBranchName: 'main' }),
		).resolves.toBe(false);
	});
});

describe('getMainAheadCount', () => {
	test('counts commits on remote main that are not in the current workspace branch', async () => {
		const repoRoot = await createRepoWithInitialCommit({ branch: 'main' });
		await runGit(['update-ref', 'refs/remotes/origin/main', 'main'], repoRoot);
		await runGit(['checkout', '-b', 'atlas'], repoRoot);
		await runGit(['checkout', 'main'], repoRoot);
		await commitFile(repoRoot, 'main.txt', 'main\n', 'main update');
		await runGit(['update-ref', 'refs/remotes/origin/main', 'main'], repoRoot);
		await runGit(['checkout', 'atlas'], repoRoot);

		await expect(getMainAheadCount({ repoRoot, defaultBranchName: 'main' })).resolves.toBe(1);
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
		const repoRoot = await createRepoWithInitialCommit();
		await Bun.write(path.join(repoRoot, 'README.md'), 'changed\n');
		await Bun.write(path.join(repoRoot, 'scratch.log'), 'tmp\n');

		await expect(listDirtyPaths(repoRoot)).resolves.toEqual([
			{
				path: 'README.md',
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
		const repoRoot = await createRepoWithInitialCommit();
		await Bun.write(path.join(repoRoot, 'README.md'), 'changed\n');

		await expect(findDirtyPath(repoRoot, 'README.md')).resolves.toEqual({
			path: 'README.md',
			changeType: 'modified',
			isUntracked: false,
			previousPath: undefined,
		});
		await expect(findDirtyPath(repoRoot, 'missing.md')).resolves.toBeNull();
	});
});

describe('readPatchForEntry', () => {
	test('returns a patch for a tracked modified file', async () => {
		const repoRoot = await createRepoWithInitialCommit();
		const head = await runGit(['rev-parse', 'HEAD'], repoRoot);
		await Bun.write(path.join(repoRoot, 'README.md'), 'hello\nnew\n');

		const patch = await readPatchForEntry(repoRoot, head.stdout.trim(), {
			path: 'README.md',
			changeType: 'modified',
			isUntracked: false,
		});

		expect(patch).toContain('diff --git a/README.md b/README.md');
		expect(patch).toContain('+new');
	});

	test('returns a patch for an untracked new file by diffing against /dev/null', async () => {
		const repoRoot = await createRepo();
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
		const repoRoot = await createRepoWithInitialCommit();
		const head = await runGit(['rev-parse', 'HEAD'], repoRoot);

		await Bun.write(path.join(repoRoot, 'README.md'), 'changed\n');
		await Bun.write(path.join(repoRoot, 'scratch.log'), 'tmp\n');

		const files = await computeCurrentFiles(repoRoot, head.stdout.trim());

		expect(files.map((file) => file.path)).toEqual(['README.md', 'scratch.log']);
		expect(files[0]).toMatchObject({
			path: 'README.md',
			changeType: 'modified',
			isUntracked: false,
			additions: 1,
			deletions: 1,
			mimeType: 'text/markdown; charset=utf-8',
		});
		expect(files[1]).toMatchObject({
			path: 'scratch.log',
			changeType: 'added',
			isUntracked: true,
			additions: 1,
			deletions: 0,
			mimeType: 'application/octet-stream',
			size: 4,
		});
		expect(files[0]?.patchDigest).toHaveLength(64);
		expect(files[1]?.patchDigest).toHaveLength(64);
	});
});

describe('getBranchHistory', () => {
	test('returns commit history entries with tags and GitHub commit URLs', async () => {
		const repoRoot = await createRepoWithInitialCommit({
			branch: 'main',
			remote: 'git@github.com:acme/repo.git',
		});
		await runGit(['tag', 'v1.0.0'], repoRoot);

		const history = await getBranchHistory({ repoRoot, ref: 'main', limit: 20 });

		expect(history.entries).toHaveLength(1);
		expect(history.entries[0]).toMatchObject({
			summary: 'Initial commit',
			authorName: 'Miko',
			tags: ['v1.0.0'],
			githubUrl: expect.stringContaining('https://github.com/acme/repo/commit/'),
		});
	});
});

describe('discardRenamedPath', () => {
	test('restores the previous path and removes the renamed path', async () => {
		const repoRoot = await createRepo();
		await commitFile(repoRoot, 'before.txt', 'same\n', 'init');
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

	test('does not append entries already covered by common existing patterns', () => {
		expect(appendGitIgnoreEntry('*.log\n', 'scratch.log')).toBe('*.log\n');
		expect(appendGitIgnoreEntry('scratch.log/\n', 'scratch.log')).toBe('scratch.log/\n');
		expect(appendGitIgnoreEntry('!.env.example\n', '!.env.example')).toBe('!.env.example\n');
	});
});

describe('DiffStore.initializeGit', () => {
	test('initializes git with an initial commit in a directory', async () => {
		const localPath = await createTempDir();
		await Bun.write(path.join(localPath, 'README.md'), 'hello\n');
		await Bun.write(path.join(localPath, '.env'), 'SECRET=1\n');
		const store = new DiffStore(localPath);

		const result = await store.initializeGit({ localPath });
		const head = await runGit(['rev-parse', 'HEAD'], localPath);
		const committedFiles = await runGit(['ls-tree', '-r', '--name-only', 'HEAD'], localPath);

		expect(result).toMatchObject({ ok: true, branchName: 'main', snapshotChanged: false });
		expect((await stat(path.join(localPath, '.git'))).isDirectory()).toBe(true);
		expect(head.exitCode).toBe(0);
		expect(committedFiles.stdout.split(/\r?\n/u).filter(Boolean).sort()).toEqual([
			'.gitignore',
			'README.md',
		]);
		expect(await Bun.file(path.join(localPath, '.gitignore')).text()).toContain('.env\n');
	});

	test('creates an initial commit for an existing unborn repo', async () => {
		const localPath = await createTempDir();
		await runGit(['init', '-b', 'main'], localPath);
		const store = new DiffStore(localPath);

		const result = await store.initializeGit({ localPath });
		const head = await runGit(['rev-parse', 'HEAD'], localPath);

		expect(result).toMatchObject({ ok: true, branchName: 'main' });
		expect(head.exitCode).toBe(0);
	});
});

describe('DiffStore.getWorkspaceGitSnapshot', () => {
	test('returns the empty unknown state before a workspace has been refreshed', () => {
		const store = new DiffStore('/tmp/miko');

		expect(store.getWorkspaceGitSnapshot('workspace-1')).toMatchObject({
			status: 'unknown',
			files: [],
			branchHistory: { entries: [] },
		});
	});
});

describe('DiffStore.inspectGitHubBackedRepo', () => {
	test('returns GitHub owner and repo metadata for a GitHub-backed directory', async () => {
		const repoRoot = await createRepoWithInitialCommit({
			branch: 'main',
			remote: 'git@github.com:sarp/miko.git',
		});
		const store = new DiffStore(repoRoot);

		await expect(store.inspectGitHubBackedRepo(repoRoot)).resolves.toMatchObject({
			ok: true,
			branchName: 'main',
			defaultBranchName: 'main',
			githubOwner: 'sarp',
			githubRepo: 'miko',
			originRepoSlug: 'sarp/miko',
		});
	});

	test('rejects directories without a GitHub origin remote', async () => {
		const repoRoot = await createRepoWithInitialCommit();
		const store = new DiffStore(repoRoot);

		await expect(store.inspectGitHubBackedRepo(repoRoot)).resolves.toMatchObject({
			ok: false,
			message: 'Directory must have a GitHub origin remote.',
		});
	});
});

describe('DiffStore.readPatch', () => {
	test('returns the patch for a changed file in a workspace', async () => {
		const repoRoot = await createRepoWithInitialCommit();
		await Bun.write(path.join(repoRoot, 'README.md'), 'hello\nsecond line\n');
		const store = new DiffStore(repoRoot);

		const result = await store.readPatch({ workspacePath: repoRoot, path: './README.md' });

		expect(result.path).toBe('README.md');
		expect(result.patch).toContain('diff --git a/README.md b/README.md');
		expect(result.patch).toContain('+second line');
		expect(result.patchDigest).toMatch(/^[a-f0-9]{64}$/u);
	});
});

describe('DiffStore.readFileContents', () => {
	test('returns text file contents for a safe repository path', async () => {
		const repoRoot = await createRepoWithInitialCommit();
		await mkdir(path.join(repoRoot, 'src'), { recursive: true });
		await Bun.write(path.join(repoRoot, 'src', 'index.css'), 'body { color: red; }\n');
		const store = new DiffStore(repoRoot);

		const result = await store.readFileContents({
			workspacePath: repoRoot,
			path: './src/index.css',
		});

		expect(result).toMatchObject({
			path: 'src/index.css',
			name: 'index.css',
			contents: 'body { color: red; }\n',
			encoding: 'utf-8',
		});
		expect(result.mimeType).toContain('text/');
		expect(result.cacheKey).toMatch(/^src\/index\.css:[a-f0-9]{64}$/u);
	});

	test('rejects paths outside the repository', async () => {
		const repoRoot = await createRepoWithInitialCommit();
		const store = new DiffStore(repoRoot);

		await expect(
			store.readFileContents({ workspacePath: repoRoot, path: '../outside.txt' }),
		).rejects.toThrow('Path must stay inside the repository');
	});

	test('rejects symlinks that escape the repository', async () => {
		const repoRoot = await createRepoWithInitialCommit();
		const outsidePath = path.join(await createTempDir(), 'outside.txt');
		await Bun.write(outsidePath, 'secret\n');
		await symlink(outsidePath, path.join(repoRoot, 'escape.txt'));
		const store = new DiffStore(repoRoot);

		await expect(
			store.readFileContents({ workspacePath: repoRoot, path: 'escape.txt' }),
		).rejects.toThrow('Path must stay inside the repository');
	});

	test('rejects non-text files', async () => {
		const repoRoot = await createRepoWithInitialCommit();
		await Bun.write(path.join(repoRoot, 'asset.bin'), new Uint8Array([0, 1, 2]));
		const store = new DiffStore(repoRoot);

		await expect(
			store.readFileContents({ workspacePath: repoRoot, path: 'asset.bin' }),
		).rejects.toThrow('File is not previewable as text: asset.bin');
	});
});

describe('DiffStore.refreshWorkspaceGitSnapshot', () => {
	test('stores a ready workspace snapshot with diff, branch, publish, and main-ahead metadata', async () => {
		const repoRoot = await createRepoWithInitialCommit({
			branch: 'main',
			remote: 'git@github.com:sarp/miko.git',
		});
		await runGit(['update-ref', 'refs/remotes/origin/main', 'main'], repoRoot);
		await runGit(['checkout', '-b', 'atlas'], repoRoot);
		await commitFile(repoRoot, 'feature.txt', 'feature\n', 'feature');
		await runGit(['update-ref', 'refs/remotes/origin/atlas', 'atlas'], repoRoot);
		await runGit(['checkout', 'main'], repoRoot);
		await commitFile(repoRoot, 'main.txt', 'main\n', 'main update');
		await runGit(['update-ref', 'refs/remotes/origin/main', 'main'], repoRoot);
		await runGit(['checkout', 'atlas'], repoRoot);
		await Bun.write(path.join(repoRoot, 'feature.txt'), 'feature\nchanged\n');
		const store = new DiffStore(repoRoot);

		const changed = await store.refreshWorkspaceGitSnapshot('workspace-1', repoRoot);
		const snapshot = store.getWorkspaceGitSnapshot('workspace-1');

		expect(changed).toBe(true);
		expect(snapshot).toMatchObject({
			status: 'ready',
			branchName: 'atlas',
			defaultBranchName: 'main',
			hasOriginRemote: true,
			originRepoSlug: 'sarp/miko',
			hasUpstream: false,
			hasPushedCommits: true,
			branchPublishState: 'published',
			mainAheadCount: 1,
		});
		expect(snapshot.files).toHaveLength(1);
		expect(snapshot.files[0]).toMatchObject({ path: 'feature.txt', changeType: 'modified' });
		expect(snapshot.branchHistory?.entries[0]?.summary).toBe('feature');
	});

	test('stores no_repo when the workspace path is not a git repository', async () => {
		const workspacePath = await createTempDir();
		const store = new DiffStore(workspacePath);

		const changed = await store.refreshWorkspaceGitSnapshot('workspace-1', workspacePath);

		expect(changed).toBe(true);
		expect(store.getWorkspaceGitSnapshot('workspace-1')).toMatchObject({
			status: 'no_repo',
			files: [],
			branchPublishState: 'unknown',
		});
	});

	test('resolves a relative FETCH_HEAD path from the target repo root', async () => {
		const repoRoot = await createRepo();
		await Bun.write(path.join(repoRoot, '.git', 'FETCH_HEAD'), 'fetch data\n');
		const expectedFetchedAt = (
			await stat(path.join(repoRoot, '.git', 'FETCH_HEAD'))
		).mtime.toISOString();
		const store = new DiffStore(repoRoot);

		await store.refreshWorkspaceGitSnapshot('workspace-1', repoRoot);

		expect(store.getWorkspaceGitSnapshot('workspace-1').lastFetchedAt).toBe(expectedFetchedAt);
	});

	test('resolves an absolute FETCH_HEAD path from a linked worktree git dir', async () => {
		const repoRoot = await createRepoWithInitialCommit({ branch: 'main' });
		const worktreePath = path.join(await createTempDir(), 'atlas');
		await runGit(['worktree', 'add', '-b', 'atlas', worktreePath, 'main'], repoRoot);

		const fetchHeadPath = (
			await runGit(['rev-parse', '--git-path', 'FETCH_HEAD'], worktreePath)
		).stdout.trim();
		expect(path.isAbsolute(fetchHeadPath)).toBe(true);
		await Bun.write(fetchHeadPath, 'fetch data\n');
		const expectedFetchedAt = (await stat(fetchHeadPath)).mtime.toISOString();
		const store = new DiffStore(worktreePath);

		await store.refreshWorkspaceGitSnapshot('workspace-1', worktreePath);

		expect(store.getWorkspaceGitSnapshot('workspace-1').lastFetchedAt).toBe(expectedFetchedAt);
	});
});

describe('DiffStore.fetchWorkspaceGit', () => {
	test('fetches all remotes and refreshes the workspace snapshot', async () => {
		const remoteRoot = await createTempDir();
		const repoRoot = await createRepoWithInitialCommit({ branch: 'main' });
		await runGit(['init', '--bare'], remoteRoot);
		await runGit(['remote', 'add', 'origin', remoteRoot], repoRoot);
		await runGit(['push', '-u', 'origin', 'main'], repoRoot);
		const store = new DiffStore(repoRoot);

		const result = await store.fetchWorkspaceGit({
			workspaceId: 'workspace-1',
			workspacePath: repoRoot,
		});

		expect(result).toMatchObject({ ok: true, branchName: 'main' });
		expect(store.getWorkspaceGitSnapshot('workspace-1')).toMatchObject({
			status: 'ready',
			branchName: 'main',
			hasOriginRemote: true,
		});
	});
});

describe('DiffStore.discardFile', () => {
	test('restores a modified tracked file to the last commit', async () => {
		const repoRoot = await createRepoWithInitialCommit();
		await Bun.write(path.join(repoRoot, 'README.md'), 'after\n');
		const store = new DiffStore(repoRoot);

		const result = await store.discardFile({
			workspaceId: 'workspace-1',
			workspacePath: repoRoot,
			path: 'README.md',
		});

		expect(result.snapshotChanged).toBe(true);
		expect(await Bun.file(path.join(repoRoot, 'README.md')).text()).toBe('hello\n');
		expect(await listDirtyPaths(repoRoot)).toEqual([]);
	});

	test('fully discards a staged added file before the first commit', async () => {
		const repoRoot = await createRepo();
		await Bun.write(path.join(repoRoot, 'new-file.txt'), 'new\n');
		await runGit(['add', 'new-file.txt'], repoRoot);
		const store = new DiffStore(repoRoot);

		const result = await store.discardFile({
			workspaceId: 'workspace-1',
			workspacePath: repoRoot,
			path: 'new-file.txt',
		});

		expect(result.snapshotChanged).toBe(true);
		expect(await Bun.file(path.join(repoRoot, 'new-file.txt')).exists()).toBe(false);
		expect(await listDirtyPaths(repoRoot)).toEqual([]);
	});
});

describe('DiffStore.ignoreFile', () => {
	test('adds an untracked file to gitignore and removes it from dirty paths', async () => {
		const repoRoot = await createRepoWithInitialCommit();
		await Bun.write(path.join(repoRoot, 'debug.log'), 'debug\n');
		const store = new DiffStore(repoRoot);

		const result = await store.ignoreFile({
			workspaceId: 'workspace-1',
			workspacePath: repoRoot,
			path: 'debug.log',
		});

		expect(result.snapshotChanged).toBe(true);
		expect(await Bun.file(path.join(repoRoot, '.gitignore')).text()).toBe('debug.log\n');
		expect((await listDirtyPaths(repoRoot)).map((entry) => entry.path)).toEqual(['.gitignore']);
	});

	test('does not match sibling paths that share the ignore prefix', async () => {
		const repoRoot = await createRepoWithInitialCommit();
		await mkdir(path.join(repoRoot, 'foobar'));
		await Bun.write(path.join(repoRoot, 'foobar', 'baz.txt'), 'baz\n');
		const store = new DiffStore(repoRoot);

		await expect(
			store.ignoreFile({
				workspaceId: 'workspace-1',
				workspacePath: repoRoot,
				path: 'foo',
			}),
		).rejects.toThrow('File is no longer changed: foo');

		expect(await Bun.file(path.join(repoRoot, '.gitignore')).exists()).toBe(false);
		expect((await listDirtyPaths(repoRoot)).map((entry) => entry.path)).toEqual(['foobar/baz.txt']);
	});
});
