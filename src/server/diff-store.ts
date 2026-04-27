import { createHash } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
	BranchActionFailure,
	BranchActionSuccess,
	BranchMetadata,
	ChatBranchHistoryEntry,
	ChatBranchHistorySnapshot,
	ChatBranchListEntry,
	ChatBranchListResult,
	ChatCheckoutBranchResult,
	ChatCreateBranchResult,
	ChatDiffFile,
	ChatDiffSnapshot,
	ChatMergeBranchResult,
	ChatMergePreviewResult,
	ChatSyncResult,
	DiffCommitMode,
	DiffCommitResult,
	GitHubRepoAvailabilityResult,
	GithubPublishInfo,
	UpstreamStatus,
} from '../shared/types';
import { inferProjectFileContentType } from './uploads';

interface StoredChatDiffState extends BranchMetadata, UpstreamStatus {
	status: ChatDiffSnapshot['status'];
	files: ChatDiffFile[];
	branchHistory: ChatBranchHistorySnapshot;
}

interface DirtyPathEntry {
	path: string;
	previousPath?: string;
	changeType: ChatDiffFile['changeType'];
	isUntracked: boolean;
}

type SelectedBranch =
	| { kind: 'local'; name: string }
	| { kind: 'remote'; name: string; remoteRef: string }
	| {
			kind: 'pull_request';
			name: string;
			prNumber: number;
			headRefName: string;
			headRepoCloneUrl?: string;
			isCrossRepository?: boolean;
			remoteRef?: string;
	  };

interface GitHubPullRequestRecord {
	number: number;
	title: string;
	head?: {
		ref?: string;
		label?: string;
		repo?: {
			clone_url?: string;
			full_name?: string;
		};
	};
}

interface FetchGitHubPullRequestsOptions {
	ghApiImpl?: (path: string) => Promise<unknown | null>;
	fetchImpl?: typeof fetch;
}

function createEmptyState(): StoredChatDiffState {
	return {
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
	};
}

function branchMetadataEqual(left: BranchMetadata, right: BranchMetadata) {
	return (
		left.branchName === right.branchName &&
		left.defaultBranchName === right.defaultBranchName &&
		left.hasOriginRemote === right.hasOriginRemote &&
		left.originRepoSlug === right.originRepoSlug &&
		left.hasUpstream === right.hasUpstream
	);
}

function upstreamStatusEqual(left: UpstreamStatus, right: UpstreamStatus) {
	return (
		left.aheadCount === right.aheadCount &&
		left.behindCount === right.behindCount &&
		left.lastFetchedAt === right.lastFetchedAt
	);
}

function branchHistoryEqual(left: ChatBranchHistorySnapshot, right: ChatBranchHistorySnapshot) {
	if (left.entries.length !== right.entries.length) return false;

	return left.entries.every((entry, index) => {
		const other = right.entries[index];
		return (
			Boolean(other) &&
			entry.sha === other.sha &&
			entry.summary === other.summary &&
			entry.description === other.description &&
			entry.authorName === other.authorName &&
			entry.authoredAt === other.authoredAt &&
			entry.githubUrl === other.githubUrl &&
			entry.tags.length === other.tags.length &&
			entry.tags.every((tag, tagIndex) => tag === other.tags[tagIndex])
		);
	});
}

export function snapshotsEqual(left: StoredChatDiffState | undefined, right: StoredChatDiffState) {
	if (!left) {
		return right.status === 'unknown' && right.files.length === 0;
	}

	if (left.status !== right.status) return false;
	if (!branchMetadataEqual(left, right)) return false;
	if (!upstreamStatusEqual(left, right)) return false;
	if (!branchHistoryEqual(left.branchHistory, right.branchHistory)) return false;
	if (left.files.length !== right.files.length) return false;

	return left.files.every((file, index) => {
		const other = right.files[index];
		return (
			Boolean(other) &&
			file.path === other.path &&
			file.changeType === other.changeType &&
			file.isUntracked === other.isUntracked &&
			file.additions === other.additions &&
			file.deletions === other.deletions &&
			file.patchDigest === other.patchDigest &&
			file.mimeType === other.mimeType &&
			file.size === other.size
		);
	});
}

export function stripTrailingSlash(value: string) {
	return value.replace(/\/+$/u, '');
}

export function normalizeRepoRelativePath(value: string) {
	const normalizedInput = value.replace(/\\/gu, '/').trim();
	const hadTrailingSlash = normalizedInput.endsWith('/');

	const normalized = path.posix
		.normalize(normalizedInput || '.')
		.replace(/^(\.\/)+/u, '')
		.replace(/^\/+/u, '');

	if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
		throw new Error('Path must stay inside the repository');
	}

	return hadTrailingSlash && !normalized.endsWith('/') ? `${normalized}/` : normalized;
}

async function fileExists(filePath: string) {
	try {
		await stat(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function runGit(args: string[], cwd: string) {
	const process = Bun.spawn(['git', '-C', cwd, ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);

	return {
		stdout,
		stderr,
		exitCode,
	};
}

export async function runCommand(args: string[]) {
	const process = Bun.spawn(args, {
		stdout: 'pipe',
		stderr: 'pipe',
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);

	return {
		stdout,
		stderr,
		exitCode,
	};
}

function formatGitFailure(result: Awaited<ReturnType<typeof runGit>>) {
	return [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
}

function summarizeGitFailure(detail: string, fallback: string) {
	return (
		detail
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.find((line) => line.length > 0) ?? fallback
	);
}

function createBranchActionFailure(
	title: string,
	detail: string,
	fallbackMessage: string,
	snapshotChanged = false,
): BranchActionFailure {
	return {
		ok: false,
		title,
		message: summarizeGitFailure(detail, fallbackMessage),
		detail,
		snapshotChanged,
	};
}

function createMergeActionFailure(args: {
	title: string;
	detail: string;
	fallback: string;
	snapshotChanged: boolean;
}): BranchActionFailure {
	return {
		ok: false,
		title: args.title,
		message: summarizeGitFailure(args.detail, args.fallback),
		detail: args.detail,
		snapshotChanged: args.snapshotChanged,
	};
}

function createCommitFailure(mode: DiffCommitMode, detail: string): DiffCommitResult {
	return {
		ok: false,
		mode,
		phase: 'commit',
		title: 'Commit failed',
		message: summarizeGitFailure(detail, 'Git could not create the commit.'),
		detail,
	};
}

export function createPushFailure(
	mode: DiffCommitMode,
	detail: string,
	snapshotChanged: boolean,
): DiffCommitResult {
	const normalized = detail.toLowerCase();
	let title = 'Push failed';
	let message = summarizeGitFailure(detail, 'Git could not push the commit.');

	if (normalized.includes('non-fast-forward') || normalized.includes('fetch first')) {
		title = 'Branch is not up to date';
		message = 'Your branch is behind its remote. Pull or rebase, then try pushing again.';
	} else if (normalized.includes('does not appear to be a git repository')) {
		title = 'No origin remote configured';
		message = 'This repository does not have an origin remote configured.';
	} else if (normalized.includes('has no upstream branch') || normalized.includes('set-upstream')) {
		title = 'No upstream branch configured';
		message = 'This branch does not have an upstream remote branch configured yet.';
	} else if (
		normalized.includes('permission denied') ||
		normalized.includes('authentication failed') ||
		normalized.includes('could not read from remote repository')
	) {
		title = 'Remote authentication failed';
		message = 'Git could not authenticate with the remote repository.';
	}

	return {
		ok: false,
		mode,
		phase: 'push',
		title,
		message,
		detail,
		localCommitCreated: true,
		snapshotChanged,
	};
}

function createSyncPushFailure(detail: string, snapshotChanged: boolean): ChatSyncResult {
	const normalized = detail.toLowerCase();
	let title = 'Push failed';
	let message = summarizeGitFailure(detail, 'Git could not push this branch.');

	if (normalized.includes('non-fast-forward') || normalized.includes('fetch first')) {
		title = 'Branch is not up to date';
		message = 'Your branch is behind its remote. Pull or rebase, then try pushing again.';
	} else if (normalized.includes('has no upstream branch') || normalized.includes('set-upstream')) {
		title = 'No upstream branch configured';
		message = 'This branch does not have an upstream remote branch configured yet.';
	} else if (
		normalized.includes('permission denied') ||
		normalized.includes('authentication failed') ||
		normalized.includes('could not read from remote repository')
	) {
		title = 'Remote authentication failed';
		message = 'Git could not authenticate with the remote repository.';
	}

	return {
		ok: false,
		action: 'push',
		title,
		message,
		detail,
		snapshotChanged,
	};
}

export async function resolveRepo(
	projectPath: string,
): Promise<{ repoRoot: string; baseCommit: string | null } | null> {
	const topLevel = await runGit(['rev-parse', '--show-toplevel'], projectPath);
	if (topLevel.exitCode !== 0) {
		return null;
	}

	const repoRoot = topLevel.stdout.trim();
	const head = await runGit(['rev-parse', 'HEAD'], repoRoot);

	return {
		repoRoot,
		baseCommit: head.exitCode === 0 ? head.stdout.trim() : null,
	};
}

async function getBranchName(repoRoot: string) {
	const branch = await runGit(['branch', '--show-current'], repoRoot);
	const trimmed = branch.stdout.trim();
	if (trimmed) return trimmed;

	const symbolic = await runGit(['symbolic-ref', '--short', 'HEAD'], repoRoot);
	return symbolic.exitCode === 0 ? symbolic.stdout.trim() : undefined;
}

async function getOriginRemoteUrl(repoRoot: string) {
	const remote = await runGit(['remote', 'get-url', 'origin'], repoRoot);
	return remote.exitCode === 0 ? remote.stdout.trim() : null;
}

export function extractGitHubRepoSlug(remoteUrl: string | null | undefined) {
	if (!remoteUrl) return null;

	const patterns = [
		/^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/u,
		/^ssh:\/\/git@github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/u,
		/^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/u,
	];

	for (const pattern of patterns) {
		const match = remoteUrl.match(pattern);
		if (match?.[1]) {
			return match[1];
		}
	}

	return null;
}

export async function resolveDefaultBranchName(repoRoot: string) {
	const originHead = await runGit(
		['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
		repoRoot,
	);

	if (originHead.exitCode === 0) {
		return originHead.stdout.trim().replace(/^origin\//u, '');
	}

	const branches = await getLocalBranchNames(repoRoot);
	if (branches.includes('main')) return 'main';
	if (branches.includes('master')) return 'master';
	return branches[0];
}

async function hasUpstreamBranch(repoRoot: string) {
	const upstream = await runGit(
		['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
		repoRoot,
	);
	return upstream.exitCode === 0;
}

export async function getUpstreamStatusCounts(repoRoot: string) {
	const result = await runGit(
		['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
		repoRoot,
	);

	if (result.exitCode !== 0) {
		return { aheadCount: undefined, behindCount: undefined };
	}

	const [aheadText = '', behindText = ''] = result.stdout.trim().split(/\s+/u);
	const aheadCount = Number.parseInt(aheadText, 10);
	const behindCount = Number.parseInt(behindText, 10);

	return {
		aheadCount: Number.isFinite(aheadCount) ? aheadCount : undefined,
		behindCount: Number.isFinite(behindCount) ? behindCount : undefined,
	};
}

async function getLastFetchedAt(repoRoot: string) {
	const gitPath = await runGit(['rev-parse', '--git-path', 'FETCH_HEAD'], repoRoot);
	if (gitPath.exitCode !== 0) return undefined;

	try {
		const fetchHeadPath = gitPath.stdout.trim();
		const info = await stat(
			path.isAbsolute(fetchHeadPath) ? fetchHeadPath : path.join(repoRoot, fetchHeadPath),
		);
		return info.mtime.toISOString();
	} catch {
		return undefined;
	}
}

export function parseStatusLine(line: string): DirtyPathEntry | null {
	if (!line.trim()) return null;

	const status = line.slice(0, 2);
	const rawPath = line.slice(3);
	const renameIndex = rawPath.indexOf(' -> ');
	const isUntracked = status === '??';

	if (renameIndex >= 0) {
		const previousPath = rawPath.slice(0, renameIndex).trim();
		const nextPath = rawPath.slice(renameIndex + 4).trim();
		return {
			path: nextPath,
			previousPath,
			changeType: 'renamed',
			isUntracked: false,
		};
	}

	let changeType: ChatDiffFile['changeType'] = 'modified';
	if (isUntracked || status.includes('A')) {
		changeType = 'added';
	} else if (status.includes('D')) {
		changeType = 'deleted';
	} else if (status.includes('R')) {
		changeType = 'renamed';
	}

	return {
		path: rawPath.trim(),
		changeType,
		isUntracked,
	};
}

export async function listDirtyPaths(repoRoot: string) {
	// TODO: switch to `git status --porcelain=v1 -z` and parse NUL-delimited records
	// so quoted paths, newlines, and rename entries are handled without ambiguity.
	const status = await runGit(['status', '--porcelain=v1', '--untracked-files=all'], repoRoot);
	if (status.exitCode !== 0) {
		throw new Error(formatGitFailure(status) || 'Failed to list git changes');
	}

	return status.stdout
		.split(/\r?\n/u)
		.map((line) => parseStatusLine(line))
		.filter((entry): entry is DirtyPathEntry => Boolean(entry))
		.map((entry) => ({
			...entry,
			path: normalizeRepoRelativePath(entry.path),
			previousPath: entry.previousPath ? normalizeRepoRelativePath(entry.previousPath) : undefined,
		}));
}

export async function findDirtyPath(repoRoot: string, relativePath: string) {
	const normalizedPath = stripTrailingSlash(relativePath);
	const dirtyPaths = await listDirtyPaths(repoRoot);
	return dirtyPaths.find((entry) => stripTrailingSlash(entry.path) === normalizedPath) ?? null;
}

export async function readPatchForEntry(
	repoRoot: string,
	baseCommit: string | null,
	entry: DirtyPathEntry,
): Promise<string> {
	const targetPath = stripTrailingSlash(entry.path);
	const absolutePath = path.join(repoRoot, targetPath);

	if (entry.isUntracked || (!baseCommit && entry.changeType === 'added')) {
		const result = await runGit(
			['diff', '--no-index', '--no-color', '--', '/dev/null', absolutePath],
			repoRoot,
		);
		return result.stdout;
	}

	const diffArgs = ['diff', '--no-ext-diff', '--no-color', '--find-renames'];
	if (baseCommit) {
		diffArgs.push(baseCommit);
	}

	diffArgs.push('--', targetPath);
	if (entry.previousPath && entry.previousPath !== entry.path) {
		diffArgs.push(stripTrailingSlash(entry.previousPath));
	}

	const result = await runGit(diffArgs, repoRoot);
	return result.stdout;
}

function countPatchChanges(patch: string) {
	let additions = 0;
	let deletions = 0;

	for (const line of patch.split('\n')) {
		if (line.startsWith('+++') || line.startsWith('---')) continue;
		if (line.startsWith('+')) additions += 1;
		if (line.startsWith('-')) deletions += 1;
	}

	return { additions, deletions };
}

export async function computeCurrentFiles(repoRoot: string, baseCommit: string | null) {
	const dirtyPaths = await listDirtyPaths(repoRoot);
	const files = await Promise.all(
		dirtyPaths.map(async (entry) => {
			const patch = await readPatchForEntry(repoRoot, baseCommit, entry);
			const { additions, deletions } = countPatchChanges(patch);

			const absolutePath = path.join(repoRoot, stripTrailingSlash(entry.path));
			const exists = await fileExists(absolutePath);
			const size = exists ? (await stat(absolutePath)).size : undefined;

			return {
				path: entry.path,
				changeType: entry.changeType,
				isUntracked: entry.isUntracked,
				additions,
				deletions,
				patchDigest: createHash('sha256').update(patch).digest('hex'),
				mimeType: exists ? inferProjectFileContentType(entry.path) : undefined,
				size,
			} satisfies ChatDiffFile;
		}),
	);

	return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function getBranchHistory(args: {
	repoRoot: string;
	ref: string;
	limit: number;
}): Promise<ChatBranchHistorySnapshot> {
	const remoteUrl = await getOriginRemoteUrl(args.repoRoot);
	const repoSlug = extractGitHubRepoSlug(remoteUrl);
	const result = await runGit(
		[
			'log',
			args.ref,
			`--max-count=${args.limit}`,
			'--date=iso-strict',
			'--format=%H%x1f%s%x1f%b%x1f%an%x1f%aI%x1e',
		],
		args.repoRoot,
	);

	if (result.exitCode !== 0) {
		return { entries: [] };
	}

	const entries = await Promise.all(
		result.stdout
			.split('\x1e')
			.map((chunk) => chunk.trim())
			.filter(Boolean)
			.map(async (chunk) => {
				const [sha = '', summary = '', description = '', authorName = '', authoredAt = ''] =
					chunk.split('\x1f');

				const tagsResult = await runGit(['tag', '--points-at', sha], args.repoRoot);
				const tags =
					tagsResult.exitCode === 0
						? tagsResult.stdout
								.split(/\r?\n/u)
								.map((tag) => tag.trim())
								.filter(Boolean)
						: [];

				return {
					sha,
					summary,
					description: description.trim(),
					authorName: authorName || undefined,
					authoredAt,
					tags,
					githubUrl: repoSlug ? `https://github.com/${repoSlug}/commit/${sha}` : undefined,
				} satisfies ChatBranchHistoryEntry;
			}),
	);
	return { entries };
}

async function getLocalBranchNames(repoRoot: string) {
	const result = await runGit(
		['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
		repoRoot,
	);

	if (result.exitCode !== 0) return [];

	return result.stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

async function getRemoteBranchNames(repoRoot: string) {
	const result = await runGit(
		['for-each-ref', '--format=%(refname:short)', 'refs/remotes'],
		repoRoot,
	);

	if (result.exitCode !== 0) return [];

	return result.stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => line && !line.endsWith('/HEAD'));
}

async function getBranchUpdatedAtMap(repoRoot: string, refPrefix: string) {
	const result = await runGit(
		['for-each-ref', '--format=%(refname:short)%x1f%(committerdate:iso-strict)', refPrefix],
		repoRoot,
	);

	const map = new Map<string, string>();
	if (result.exitCode !== 0) return map;

	for (const line of result.stdout.split(/\r?\n/u)) {
		const [name = '', updatedAt = ''] = line.split('\x1f');
		if (name.trim() && updatedAt.trim()) {
			map.set(name.trim(), updatedAt.trim());
		}
	}
	return map;
}

async function getRecentBranchNames(repoRoot: string) {
	const updatedAtMap = await getBranchUpdatedAtMap(repoRoot, 'refs/heads');
	return [...updatedAtMap.entries()]
		.sort((left, right) => right[1].localeCompare(left[1]))
		.map(([name]) => name)
		.slice(0, 5);
}

export async function getMergeCommitCount(repoRoot: string, ref: string) {
	const result = await runGit(['rev-list', '--count', `HEAD..${ref}`], repoRoot);
	if (result.exitCode !== 0) {
		throw new Error(formatGitFailure(result) || 'Could not compare branch history');
	}

	const count = Number.parseInt(result.stdout.trim(), 10);
	return Number.isFinite(count) ? count : 0;
}

export async function predictMergeConflicts(repoRoot: string, ref: string) {
	const mergeTree = await runGit(['merge-tree', 'HEAD', ref], repoRoot);
	const hasConflicts =
		mergeTree.stdout.includes('<<<<<<<') || mergeTree.stdout.includes('CONFLICT (');

	if (mergeTree.exitCode !== 0 && !hasConflicts) {
		return {
			hasConflicts: false,
			detail: undefined,
		};
	}

	return {
		hasConflicts,
		detail: hasConflicts ? mergeTree.stdout.trim() : undefined,
	};
}

async function resolveSelectedBranchRef(_repoRoot: string, branch: SelectedBranch) {
	if (branch.kind === 'local') {
		return {
			ref: branch.name,
			branchName: branch.name,
			displayName: branch.name,
		};
	}

	if (branch.kind === 'remote') {
		return {
			ref: branch.remoteRef,
			branchName: branch.name,
			displayName: branch.remoteRef,
		};
	}

	return {
		ref: branch.remoteRef ?? `origin/${branch.headRefName}`,
		branchName: branch.name,
		displayName: `PR #${branch.prNumber}`,
	};
}

export async function discardRenamedPath(repoRoot: string, entry: DirtyPathEntry) {
	const currentPath = stripTrailingSlash(entry.path);
	const previousPath = stripTrailingSlash(entry.previousPath ?? '');
	const restoreResult = await runGit(
		['restore', '--staged', '--worktree', '--source=HEAD', '--', previousPath],
		repoRoot,
	);

	if (restoreResult.exitCode !== 0) {
		throw new Error(formatGitFailure(restoreResult) || 'Failed to restore renamed file');
	}

	await rm(path.join(repoRoot, currentPath), { recursive: true, force: true });
}

async function discardAddedPath(repoRoot: string, hasCommit: boolean, relativePath: string) {
	const result = hasCommit
		? await runGit(['reset', 'HEAD', '--', relativePath], repoRoot)
		: await runGit(['rm', '--cached', '--ignore-unmatch', '--', relativePath], repoRoot);

	if (result.exitCode !== 0) {
		throw new Error(formatGitFailure(result) || 'Failed to unstage added file');
	}
}

export function sanitizeRepoName(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
}

interface GhAuthInfo {
	ghInstalled: boolean;
	authenticated: boolean;
	activeAccountLogin?: string;
}

async function getGhAuthInfo(): Promise<GhAuthInfo> {
	if (!Bun.which('gh')) {
		return { ghInstalled: false, authenticated: false };
	}

	const result = await runCommand(['gh', 'api', 'user']);
	if (result.exitCode !== 0) {
		return { ghInstalled: true, authenticated: false };
	}

	try {
		const parsed = JSON.parse(result.stdout) as { login?: string };
		return {
			ghInstalled: true,
			authenticated: true,
			activeAccountLogin: parsed.login,
		};
	} catch {
		return { ghInstalled: true, authenticated: true };
	}
}

async function getGitHubOwners() {
	const userResult = await runCommand(['gh', 'api', 'user']);
	const orgsResult = await runCommand(['gh', 'api', 'user/orgs']);
	const owners: string[] = [];

	try {
		const user = JSON.parse(userResult.stdout) as { login?: string };
		if (user.login) owners.push(user.login);
	} catch {}

	try {
		const orgs = JSON.parse(orgsResult.stdout) as Array<{ login?: string }>;
		for (const org of orgs) {
			if (org.login) owners.push(org.login);
		}
	} catch {}

	return [...new Set(owners)];
}

async function ghApi(pathname: string): Promise<unknown | null> {
	if (!Bun.which('gh')) return null;

	const result = await runCommand(['gh', 'api', pathname]);
	if (result.exitCode !== 0) {
		return null;
	}

	try {
		return JSON.parse(result.stdout);
	} catch {
		return null;
	}
}

function normalizePullRequestsResponse(value: unknown): GitHubPullRequestRecord[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry) => entry && typeof entry === 'object') as GitHubPullRequestRecord[];
}

export async function fetchGitHubPullRequests(
	repoSlug: string,
	options: FetchGitHubPullRequestsOptions = {},
) {
	const ghPath = `repos/${repoSlug}/pulls?state=open&per_page=50`;
	const ghResponse = await (options.ghApiImpl ?? ghApi)(ghPath);

	if (Array.isArray(ghResponse)) {
		return normalizePullRequestsResponse(ghResponse);
	}

	const fetchImpl = options.fetchImpl ?? fetch;
	const response = await fetchImpl(`https://api.github.com/${ghPath}`, {
		headers: {
			Accept: 'application/vnd.github+json',
		},
	});

	if (!response.ok) {
		throw new Error(`GitHub pull request fetch failed with ${response.status}`);
	}
	return normalizePullRequestsResponse(await response.json());
}

export function appendGitIgnoreEntry(currentContents: string | null, entry: string) {
	const normalizedEntry = normalizeRepoRelativePath(entry);
	const current = currentContents ?? '';
	const currentLines = current
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);

	if (currentLines.includes(normalizedEntry)) {
		return current.endsWith('\n') ? current : `${current}\n`;
	}

	const prefix = current.length === 0 || current.endsWith('\n') ? current : `${current}\n`;
	return `${prefix}${normalizedEntry}\n`;
}

export class DiffStore {
	private readonly states = new Map<string, StoredChatDiffState>();

	// biome-ignore lint/complexity/noUselessConstructor: <>
	constructor(_: string) {}

	async initialize() {}

	async initializeGit(args: {
		projectId: string;
		projectPath: string;
	}): Promise<BranchActionSuccess | BranchActionFailure> {
		const existingRepo = await resolveRepo(args.projectPath);

		if (existingRepo) {
			const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath);
			return {
				ok: true,
				branchName: await getBranchName(existingRepo.repoRoot),
				snapshotChanged,
			};
		}

		const initResult = await runGit(['init'], args.projectPath);
		if (initResult.exitCode !== 0) {
			return createBranchActionFailure(
				'Initialize git failed',
				formatGitFailure(initResult),
				'Git could not initialize this folder.',
			);
		}

		const repo = await resolveRepo(args.projectPath);
		const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath);

		return {
			ok: true,
			branchName: repo ? await getBranchName(repo.repoRoot) : undefined,
			snapshotChanged,
		};
	}

	async getGitHubPublishInfo(args: { projectPath: string }): Promise<GithubPublishInfo> {
		const authInfo = await getGhAuthInfo();
		const suggestedRepoName = sanitizeRepoName(path.basename(args.projectPath)) || 'my-repo';

		if (!authInfo.ghInstalled || !authInfo.authenticated) {
			return {
				ghInstalled: authInfo.ghInstalled,
				authenticated: authInfo.authenticated,
				activeAccountLogin: authInfo.activeAccountLogin,
				owners: authInfo.activeAccountLogin ? [authInfo.activeAccountLogin] : [],
				suggestedRepoName,
			};
		}

		return {
			ghInstalled: true,
			authenticated: true,
			activeAccountLogin: authInfo.activeAccountLogin,
			owners: await getGitHubOwners(),
			suggestedRepoName,
		};
	}

	async checkGitHubRepoAvailability(args: {
		owner: string;
		name: string;
	}): Promise<GitHubRepoAvailabilityResult> {
		const authInfo = await getGhAuthInfo();
		if (!authInfo.ghInstalled) {
			return { available: false, message: 'GitHub CLI is not installed.' };
		}

		if (!authInfo.authenticated) {
			return { available: false, message: 'GitHub CLI is not authenticated.' };
		}

		const owner = args.owner.trim();
		const name = sanitizeRepoName(args.name);

		if (!owner || !name) {
			return { available: false, message: 'Enter an owner and repository name.' };
		}

		const result = await runCommand(['gh', 'api', `repos/${owner}/${name}`]);
		if (result.exitCode === 0) {
			return { available: false, message: `${owner}/${name} already exists.` };
		}

		const detail = `${result.stderr}\n${result.stdout}`.toLowerCase();
		if (detail.includes('404')) {
			return { available: true, message: `${owner}/${name} is available.` };
		}

		return {
			available: false,
			message: 'Could not verify repository availability.',
		};
	}

	async publishToGitHub(args: {
		projectId: string;
		projectPath: string;
		owner: string;
		name: string;
		visibility: 'public' | 'private';
		description?: string;
	}): Promise<BranchActionSuccess | BranchActionFailure> {
		const repo = await resolveRepo(args.projectPath);
		if (!repo) {
			return {
				ok: false,
				title: 'Publish failed',
				message: 'Initialize git before publishing to GitHub.',
				snapshotChanged: false,
			};
		}

		const authInfo = await getGhAuthInfo();
		if (!authInfo.ghInstalled) {
			return {
				ok: false,
				title: 'GitHub CLI not installed',
				message: 'Install GitHub CLI (`gh`) to publish from Miko.',
				snapshotChanged: false,
			};
		}

		if (!authInfo.authenticated) {
			return {
				ok: false,
				title: 'GitHub CLI not signed in',
				message: 'Run `gh auth login` and try again.',
				snapshotChanged: false,
			};
		}

		const owner = args.owner.trim();
		const repoName = sanitizeRepoName(args.name);
		if (!owner || !repoName) {
			return {
				ok: false,
				title: 'Publish failed',
				message: 'Owner and repository name are required.',
				snapshotChanged: false,
			};
		}

		const availability = await this.checkGitHubRepoAvailability({ owner, name: repoName });
		if (!availability.available) {
			return {
				ok: false,
				title: 'Publish failed',
				message: availability.message,
				snapshotChanged: false,
			};
		}

		const createArgs = [
			'gh',
			'repo',
			'create',
			`${owner}/${repoName}`,
			args.visibility === 'private' ? '--private' : '--public',
			'--source',
			args.projectPath,
			'--remote',
			'origin',
		];

		if (repo.baseCommit) {
			createArgs.push('--push');
		}

		if (args.description?.trim()) {
			createArgs.push('--description', args.description.trim());
		}

		const createResult = await runCommand(createArgs);
		if (createResult.exitCode !== 0) {
			const detail = [createResult.stderr.trim(), createResult.stdout.trim()]
				.filter(Boolean)
				.join('\n');

			return {
				ok: false,
				title: 'Publish failed',
				message: summarizeGitFailure(detail, 'GitHub CLI could not publish this repository.'),
				detail,
				snapshotChanged: false,
			};
		}

		const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath);
		return {
			ok: true,
			branchName: await getBranchName(repo.repoRoot),
			snapshotChanged,
		};
	}

	async readPatch(args: { projectPath: string; path: string }) {
		const relativePath = normalizeRepoRelativePath(args.path);
		const repo = await resolveRepo(args.projectPath);
		if (!repo) {
			throw new Error('Project is not in a git repository');
		}

		const entry = await findDirtyPath(repo.repoRoot, relativePath);
		if (!entry) {
			throw new Error(`File is no longer changed: ${relativePath}`);
		}

		return { patch: await readPatchForEntry(repo.repoRoot, repo.baseCommit, entry) };
	}

	getProjectSnapshot(projectId: string): ChatDiffSnapshot {
		const state = this.states.get(projectId) ?? createEmptyState();
		return {
			status: state.status,
			branchName: state.branchName,
			defaultBranchName: state.defaultBranchName,
			hasOriginRemote: state.hasOriginRemote,
			originRepoSlug: state.originRepoSlug,
			hasUpstream: state.hasUpstream,
			aheadCount: state.aheadCount,
			behindCount: state.behindCount,
			lastFetchedAt: state.lastFetchedAt,
			files: [...state.files],
			branchHistory: {
				entries: state.branchHistory.entries.map((entry) => ({
					...entry,
					tags: [...entry.tags],
				})),
			},
		};
	}

	async refreshSnapshot(projectId: string, projectPath: string) {
		const repo = await resolveRepo(projectPath);
		if (!repo) {
			const nextState = {
				status: 'no_repo',
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
			} satisfies StoredChatDiffState;

			const changed = !snapshotsEqual(this.states.get(projectId), nextState);
			this.states.set(projectId, nextState);

			return changed;
		}

		const [files, branchName, defaultBranchName, originRemoteUrl, hasUpstream, lastFetchedAt] =
			await Promise.all([
				computeCurrentFiles(repo.repoRoot, repo.baseCommit),
				getBranchName(repo.repoRoot),
				resolveDefaultBranchName(repo.repoRoot),
				getOriginRemoteUrl(repo.repoRoot),
				hasUpstreamBranch(repo.repoRoot),
				getLastFetchedAt(repo.repoRoot),
			]);

		const originRepoSlug = extractGitHubRepoSlug(originRemoteUrl) ?? undefined;

		const { aheadCount, behindCount } = hasUpstream
			? await getUpstreamStatusCounts(repo.repoRoot)
			: { aheadCount: undefined, behindCount: undefined };

		const branchHistory = repo.baseCommit
			? await getBranchHistory({
					repoRoot: repo.repoRoot,
					ref: branchName ?? 'HEAD',
					limit: 20,
				})
			: { entries: [] };

		const nextState = {
			status: 'ready',
			branchName,
			defaultBranchName,
			hasOriginRemote: originRemoteUrl !== null,
			originRepoSlug,
			hasUpstream,
			aheadCount,
			behindCount,
			lastFetchedAt,
			files,
			branchHistory,
		} satisfies StoredChatDiffState;

		const changed = !snapshotsEqual(this.states.get(projectId), nextState);
		this.states.set(projectId, nextState);

		return changed;
	}

	async listBranches(args: { projectPath: string }): Promise<ChatBranchListResult> {
		const repo = await resolveRepo(args.projectPath);
		if (!repo) {
			throw new Error('Project is not in a git repository');
		}

		const [
			currentBranchName,
			defaultBranchName,
			localBranchNames,
			remoteBranchNames,
			recentBranchNames,
			localUpdatedAtMap,
			remoteUpdatedAtMap,
		] = await Promise.all([
			getBranchName(repo.repoRoot),
			resolveDefaultBranchName(repo.repoRoot),
			getLocalBranchNames(repo.repoRoot),
			getRemoteBranchNames(repo.repoRoot),
			getRecentBranchNames(repo.repoRoot),
			getBranchUpdatedAtMap(repo.repoRoot, 'refs/heads'),
			getBranchUpdatedAtMap(repo.repoRoot, 'refs/remotes'),
		]);

		const local: ChatBranchListEntry[] = localBranchNames.map((name) => ({
			id: `local:${name}`,
			kind: 'local',
			name,
			displayName: name,
			updatedAt: localUpdatedAtMap.get(name),
			prTitle: '',
		}));

		const remote: ChatBranchListEntry[] = remoteBranchNames.map((remoteRef) => ({
			id: `remote:${remoteRef}`,
			kind: 'remote',
			name: remoteRef.replace(/^[^/]+\//u, ''),
			displayName: remoteRef,
			updatedAt: remoteUpdatedAtMap.get(remoteRef),
			prTitle: '',
		}));

		const localByName = new Map(local.map((entry) => [entry.name, entry]));
		const remoteByName = new Map(remote.map((entry) => [entry.name, entry]));
		const recent: ChatBranchListEntry[] = recentBranchNames
			.map((name) => localByName.get(name) ?? remoteByName.get(name))
			.filter((entry): entry is ChatBranchListEntry => Boolean(entry))
			.map((entry) => ({ ...entry, id: `recent:${entry.id}` }));

		const remoteUrl = await getOriginRemoteUrl(repo.repoRoot);
		const repoSlug = extractGitHubRepoSlug(remoteUrl);

		let pullRequests: ChatBranchListEntry[] = [];
		let pullRequestsStatus: ChatBranchListResult['pullRequestsStatus'] = 'unavailable';
		let pullRequestsError: string | undefined;

		if (repoSlug) {
			try {
				pullRequests = (await fetchGitHubPullRequests(repoSlug)).flatMap<ChatBranchListEntry>(
					(pr) => {
						const headRefName = pr.head?.ref?.trim();
						if (!headRefName) return [];

						return {
							id: `pr:${pr.number}`,
							kind: 'pull_request',
							name: headRefName,
							displayName: `PR #${pr.number}`,
							description: pr.title,
							prNumber: pr.number,
							prTitle: pr.title,
							headRefName,
							headLabel: pr.head?.label?.trim(),
							headRepoCloneUrl: pr.head?.repo?.clone_url?.trim(),
							isCrossRepository: Boolean(
								pr.head?.repo?.full_name &&
									pr.head.repo.full_name.toLowerCase() !== repoSlug.toLowerCase(),
							),
						} satisfies ChatBranchListEntry;
					},
				);
				pullRequestsStatus = 'available';
			} catch (error) {
				pullRequestsStatus = 'error';
				pullRequestsError = error instanceof Error ? error.message : String(error);
			}
		}

		return {
			currentBranchName,
			defaultBranchName,
			recent,
			local,
			remote,
			pullRequests,
			pullRequestsStatus,
			pullRequestsError,
		};
	}

	async previewMergeBranch(args: {
		projectPath: string;
		branch: SelectedBranch;
	}): Promise<ChatMergePreviewResult> {
		const repo = await resolveRepo(args.projectPath);
		if (!repo) {
			throw new Error('Project is not in a git repository');
		}

		const currentBranchName = await getBranchName(repo.repoRoot);
		const resolvedBranch = await resolveSelectedBranchRef(repo.repoRoot, args.branch);

		if (currentBranchName && resolvedBranch.branchName === currentBranchName) {
			return {
				currentBranchName,
				targetBranchName: resolvedBranch.branchName,
				targetDisplayName: resolvedBranch.displayName,
				status: 'up_to_date',
				commitCount: 0,
				hasConflicts: false,
				message: `${currentBranchName} is already up to date with ${resolvedBranch.displayName}.`,
			};
		}

		try {
			const commitCount = await getMergeCommitCount(repo.repoRoot, resolvedBranch.ref);
			if (commitCount === 0) {
				return {
					currentBranchName,
					targetBranchName: resolvedBranch.branchName,
					targetDisplayName: resolvedBranch.displayName,
					status: 'up_to_date',
					commitCount,
					hasConflicts: false,
					message: `${currentBranchName ?? 'Current branch'} is already up to date with ${resolvedBranch.displayName}.`,
				};
			}

			const conflictPrediction = await predictMergeConflicts(repo.repoRoot, resolvedBranch.ref);
			if (conflictPrediction.hasConflicts) {
				return {
					currentBranchName,
					targetBranchName: resolvedBranch.branchName,
					targetDisplayName: resolvedBranch.displayName,
					status: 'conflicts',
					commitCount,
					hasConflicts: true,
					message: `${commitCount} ${commitCount === 1 ? 'commit' : 'commits'} from ${resolvedBranch.displayName} would merge into ${currentBranchName ?? 'the current branch'}, but conflicts are expected.`,
					detail: conflictPrediction.detail,
				};
			}

			return {
				currentBranchName,
				targetBranchName: resolvedBranch.branchName,
				targetDisplayName: resolvedBranch.displayName,
				status: 'mergeable',
				commitCount,
				hasConflicts: false,
				message: `${commitCount} ${commitCount === 1 ? 'commit' : 'commits'} from ${resolvedBranch.displayName} will merge into ${currentBranchName ?? 'the current branch'}.`,
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return {
				currentBranchName,
				targetBranchName: resolvedBranch.branchName,
				targetDisplayName: resolvedBranch.displayName,
				status: 'error',
				commitCount: 0,
				hasConflicts: false,
				message: 'Could not preview this merge.',
				detail,
			};
		}
	}

	async mergeBranch(args: {
		projectId: string;
		projectPath: string;
		branch: SelectedBranch;
	}): Promise<ChatMergeBranchResult> {
		const repo = await resolveRepo(args.projectPath);
		if (!repo) {
			throw new Error('Project is not in a git repository');
		}

		const currentDirtyPaths = await listDirtyPaths(repo.repoRoot);
		if (currentDirtyPaths.length > 0) {
			return {
				ok: false,
				title: 'Merge blocked',
				message: 'Commit, discard, or stash your local changes before merging.',
				snapshotChanged: false,
			};
		}

		const resolvedBranch = await resolveSelectedBranchRef(repo.repoRoot, args.branch);
		const commitCount = await getMergeCommitCount(repo.repoRoot, resolvedBranch.ref);
		if (commitCount === 0) {
			return {
				ok: false,
				title: 'Already up to date',
				message: `${resolvedBranch.displayName} is already merged into ${(await getBranchName(repo.repoRoot)) ?? 'the current branch'}.`,
				snapshotChanged: false,
			};
		}

		const mergeResult = await runGit(['merge', '--no-edit', resolvedBranch.ref], repo.repoRoot);
		const detail = formatGitFailure(mergeResult);

		if (mergeResult.exitCode !== 0) {
			const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath);
			const normalized = detail.toLowerCase();

			return createMergeActionFailure({
				title: normalized.includes('conflict') ? 'Merge conflicts need resolution' : 'Merge failed',
				detail,
				fallback: normalized.includes('conflict')
					? 'Git reported merge conflicts while merging this branch.'
					: 'Git could not merge this branch.',
				snapshotChanged,
			});
		}

		const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath);
		return {
			ok: true,
			branchName: await getBranchName(repo.repoRoot),
			snapshotChanged,
		};
	}

	async checkoutBranch(args: {
		projectId: string;
		projectPath: string;
		branch: SelectedBranch;
		bringChanges?: boolean;
	}): Promise<ChatCheckoutBranchResult> {
		const repo = await resolveRepo(args.projectPath);
		if (!repo) {
			throw new Error('Project is not in a git repository');
		}

		const currentDirtyPaths = await listDirtyPaths(repo.repoRoot);
		if (currentDirtyPaths.length > 0 && !args.bringChanges) {
			return {
				ok: false,
				cancelled: true,
				title: 'Branch switch cancelled',
				message: 'Your current changes were kept on the current branch.',
				snapshotChanged: false,
			};
		}

		let switchResult: Awaited<ReturnType<typeof runGit>>;
		if (args.branch.kind === 'local') {
			switchResult = await runGit(['switch', args.branch.name], repo.repoRoot);
		} else if (args.branch.kind === 'remote') {
			const localBranchNames = await getLocalBranchNames(repo.repoRoot);
			switchResult = localBranchNames.includes(args.branch.name)
				? await runGit(['switch', args.branch.name], repo.repoRoot)
				: await runGit(['switch', '--track', '--no-guess', args.branch.remoteRef], repo.repoRoot);
		} else {
			const localBranchNames = await getLocalBranchNames(repo.repoRoot);
			let localBranchName = args.branch.name;

			if (localBranchNames.includes(localBranchName) && args.branch.isCrossRepository) {
				localBranchName = `${args.branch.name}-pr-${args.branch.prNumber}`;
			}

			if (localBranchNames.includes(localBranchName)) {
				switchResult = await runGit(['switch', localBranchName], repo.repoRoot);
			} else if (args.branch.isCrossRepository && args.branch.headRepoCloneUrl) {
				const fetchResult = await runGit(
					[
						'fetch',
						'--no-tags',
						args.branch.headRepoCloneUrl,
						`refs/heads/${args.branch.headRefName}:refs/heads/${localBranchName}`,
					],
					repo.repoRoot,
				);
				if (fetchResult.exitCode !== 0) {
					return createBranchActionFailure(
						'Checkout failed',
						formatGitFailure(fetchResult),
						'Git could not fetch the pull request branch.',
					);
				}
				switchResult = await runGit(['switch', localBranchName], repo.repoRoot);
			} else {
				const remoteRef = args.branch.remoteRef ?? `origin/${args.branch.headRefName}`;
				switchResult = await runGit(['switch', '--track', '--no-guess', remoteRef], repo.repoRoot);
			}
		}

		if (switchResult.exitCode !== 0) {
			return createBranchActionFailure(
				'Checkout failed',
				formatGitFailure(switchResult),
				'Git could not switch branches.',
			);
		}

		const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath);
		return {
			ok: true,
			branchName: await getBranchName(repo.repoRoot),
			snapshotChanged,
		};
	}

	async createBranch(args: {
		projectId: string;
		projectPath: string;
		name: string;
		baseBranchName?: string;
	}): Promise<ChatCreateBranchResult> {
		const repo = await resolveRepo(args.projectPath);
		if (!repo) {
			throw new Error('Project is not in a git repository');
		}

		const branchName = args.name.trim();
		if (!branchName) {
			throw new Error('Branch name is required');
		}

		const refValidation = await runGit(['check-ref-format', '--branch', branchName], repo.repoRoot);
		if (refValidation.exitCode !== 0) {
			return createBranchActionFailure(
				'Create branch failed',
				formatGitFailure(refValidation),
				'Branch name is not valid.',
			);
		}

		const localBranchNames = await getLocalBranchNames(repo.repoRoot);
		if (localBranchNames.includes(branchName)) {
			return {
				ok: false,
				title: 'Create branch failed',
				message: `A local branch named "${branchName}" already exists.`,
				snapshotChanged: false,
			};
		}

		const baseBranchName =
			args.baseBranchName?.trim() ||
			(await resolveDefaultBranchName(repo.repoRoot)) ||
			(await getBranchName(repo.repoRoot));

		if (!baseBranchName) {
			throw new Error('Could not determine a base branch');
		}

		const switchResult = await runGit(['switch', '-c', branchName, baseBranchName], repo.repoRoot);
		if (switchResult.exitCode !== 0) {
			return createBranchActionFailure(
				'Create branch failed',
				formatGitFailure(switchResult),
				'Git could not create the branch.',
			);
		}

		const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath);
		return {
			ok: true,
			branchName,
			snapshotChanged,
		};
	}

	async syncBranch(args: {
		projectId: string;
		projectPath: string;
		action: 'fetch' | 'pull' | 'push' | 'publish';
	}): Promise<ChatSyncResult> {
		const repo = await resolveRepo(args.projectPath);
		if (!repo) {
			throw new Error('Project is not in a git repository');
		}

		const [hasUpstream, originRemoteUrl] = await Promise.all([
			hasUpstreamBranch(repo.repoRoot),
			getOriginRemoteUrl(repo.repoRoot),
		]);
		const hasOriginRemote = originRemoteUrl !== null;

		if (args.action === 'publish') {
			if (!hasOriginRemote) {
				return {
					ok: false,
					action: args.action,
					title: 'Publish branch failed',
					message: 'This repository does not have an origin remote configured.',
					snapshotChanged: false,
				};
			}

			const publishResult = await runGit(['push', '-u', 'origin', 'HEAD'], repo.repoRoot);
			if (publishResult.exitCode !== 0) {
				const detail = formatGitFailure(publishResult);
				return {
					ok: false,
					action: args.action,
					title: 'Publish branch failed',
					message: summarizeGitFailure(detail, 'Git could not publish this branch.'),
					detail,
					snapshotChanged: false,
				};
			}

			const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath);
			const { aheadCount, behindCount } = await getUpstreamStatusCounts(repo.repoRoot);

			return {
				ok: true,
				action: args.action,
				branchName: await getBranchName(repo.repoRoot),
				aheadCount,
				behindCount,
				snapshotChanged,
			};
		}

		if (args.action === 'push') {
			if (!hasUpstream) {
				return {
					ok: false,
					action: args.action,
					title: 'Push failed',
					message: 'This branch does not have an upstream remote branch configured yet.',
					snapshotChanged: false,
				};
			}

			const pushResult = await runGit(['push'], repo.repoRoot);
			if (pushResult.exitCode !== 0) {
				return createSyncPushFailure(formatGitFailure(pushResult), false);
			}

			const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath);
			const { aheadCount, behindCount } = await getUpstreamStatusCounts(repo.repoRoot);
			return {
				ok: true,
				action: args.action,
				branchName: await getBranchName(repo.repoRoot),
				aheadCount,
				behindCount,
				snapshotChanged,
			};
		}

		if (args.action === 'pull' && !hasUpstream) {
			return {
				ok: false,
				action: args.action,
				title: 'Pull failed',
				message: 'This branch does not have an upstream remote branch configured yet.',
				snapshotChanged: false,
			};
		}

		const syncResult =
			args.action === 'pull'
				? await runGit(['pull', '--ff-only'], repo.repoRoot)
				: await runGit(['fetch', '--all', '--prune'], repo.repoRoot);

		if (syncResult.exitCode !== 0) {
			const detail = formatGitFailure(syncResult);
			return {
				ok: false,
				action: args.action,
				title: args.action === 'pull' ? 'Pull failed' : 'Fetch failed',
				message: summarizeGitFailure(
					detail,
					args.action === 'pull'
						? 'Git could not pull the latest changes.'
						: 'Git could not fetch the latest changes.',
				),
				detail,
				snapshotChanged: false,
			};
		}

		const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath);
		const nextHasUpstream = await hasUpstreamBranch(repo.repoRoot);

		const { aheadCount, behindCount } = nextHasUpstream
			? await getUpstreamStatusCounts(repo.repoRoot)
			: { aheadCount: undefined, behindCount: undefined };

		return {
			ok: true,
			action: args.action,
			branchName: await getBranchName(repo.repoRoot),
			aheadCount,
			behindCount,
			snapshotChanged,
		};
	}

	async generateCommitMessage(_args: { projectPath: string; paths: string[] }) {
		// TODO: implement commit message generation after generateCommitMessageDetailed is added to miko.
		throw new Error('TODO: generate commit message support is not implemented yet.');
	}

	async commitFiles(args: {
		projectId: string;
		projectPath: string;
		paths: string[];
		summary: string;
		description?: string;
		mode: DiffCommitMode;
	}) {
		const summary = args.summary.trim();
		const description = args.description?.trim();

		if (!summary) {
			throw new Error('Commit summary is required');
		}

		const normalizedPaths = [...new Set(args.paths.map(normalizeRepoRelativePath))];
		if (normalizedPaths.length === 0) {
			throw new Error('Select at least one file to commit');
		}

		const repo = await resolveRepo(args.projectPath);
		if (!repo) {
			throw new Error('Project is not in a git repository');
		}

		const [hasUpstream, originRemoteUrl] = await Promise.all([
			hasUpstreamBranch(repo.repoRoot),
			getOriginRemoteUrl(repo.repoRoot),
		]);

		const hasOriginRemote = originRemoteUrl !== null;

		const currentDirtyPaths = new Set(
			(await listDirtyPaths(repo.repoRoot)).map((entry) => entry.path),
		);

		const missingPaths = normalizedPaths.filter(
			(relativePath) => !currentDirtyPaths.has(relativePath),
		);

		if (missingPaths.length > 0) {
			throw new Error(`File is no longer changed: ${missingPaths[0]}`);
		}

		const addResult = await runGit(['add', '--', ...normalizedPaths], repo.repoRoot);
		if (addResult.exitCode !== 0) {
			throw new Error(addResult.stderr.trim() || 'Failed to stage selected files');
		}

		const commitArgs = ['commit', '--only', '-m', summary];
		if (description) {
			commitArgs.push('-m', description);
		}

		commitArgs.push('--', ...normalizedPaths);

		const commitResult = await runGit(commitArgs, repo.repoRoot);
		if (commitResult.exitCode !== 0) {
			return createCommitFailure(args.mode, formatGitFailure(commitResult));
		}

		const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath);
		const branchName = await getBranchName(repo.repoRoot);

		if (args.mode === 'commit_only') {
			return {
				ok: true,
				mode: args.mode,
				branchName,
				pushed: false,
				snapshotChanged,
			} satisfies DiffCommitResult;
		}

		if (!hasUpstream && !hasOriginRemote) {
			return {
				ok: true,
				mode: args.mode,
				branchName,
				pushed: false,
				snapshotChanged,
			} satisfies DiffCommitResult;
		}

		const pushResult = hasUpstream
			? await runGit(['push'], repo.repoRoot)
			: await runGit(['push', '-u', 'origin', 'HEAD'], repo.repoRoot);

		if (pushResult.exitCode !== 0) {
			return createPushFailure(args.mode, formatGitFailure(pushResult), snapshotChanged);
		}

		const postPushSnapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath);

		return {
			ok: true,
			mode: args.mode,
			branchName,
			pushed: true,
			snapshotChanged: snapshotChanged || postPushSnapshotChanged,
		} satisfies DiffCommitResult;
	}

	async discardFile(args: { projectId: string; projectPath: string; path: string }) {
		const relativePath = normalizeRepoRelativePath(args.path);
		const repo = await resolveRepo(args.projectPath);
		if (!repo) {
			throw new Error('Project is not in a git repository');
		}

		const entry = await findDirtyPath(repo.repoRoot, relativePath);
		if (!entry) {
			throw new Error(`File is no longer changed: ${relativePath}`);
		}

		if (entry.isUntracked) {
			await rm(path.join(repo.repoRoot, stripTrailingSlash(entry.path)), {
				recursive: true,
				force: true,
			});
		} else if (entry.changeType === 'added') {
			await discardAddedPath(
				repo.repoRoot,
				repo.baseCommit !== null,
				stripTrailingSlash(entry.path),
			);

			await rm(path.join(repo.repoRoot, stripTrailingSlash(entry.path)), {
				recursive: true,
				force: true,
			});
		} else if (entry.changeType === 'renamed') {
			if (!repo.baseCommit) {
				throw new Error('Cannot discard a rename before the repository has an initial commit');
			}
			await discardRenamedPath(repo.repoRoot, entry);
		} else {
			if (!repo.baseCommit) {
				throw new Error(
					'Cannot discard tracked changes before the repository has an initial commit',
				);
			}

			const restoreResult = await runGit(
				[
					'restore',
					'--staged',
					'--worktree',
					'--source=HEAD',
					'--',
					stripTrailingSlash(entry.path),
				],
				repo.repoRoot,
			);

			if (restoreResult.exitCode !== 0) {
				throw new Error(formatGitFailure(restoreResult) || 'Failed to discard file changes');
			}
		}

		return {
			snapshotChanged: await this.refreshSnapshot(args.projectId, args.projectPath),
		};
	}

	async ignoreFile(args: { projectId: string; projectPath: string; path: string }) {
		const ignoreEntry = normalizeRepoRelativePath(args.path);
		const repo = await resolveRepo(args.projectPath);
		if (!repo) {
			throw new Error('Project is not in a git repository');
		}

		const dirtyPaths = await listDirtyPaths(repo.repoRoot);
		const exactEntry = dirtyPaths.find((candidate) => candidate.path === ignoreEntry);
		if (exactEntry && !exactEntry.isUntracked) {
			throw new Error('Only untracked files can be ignored from the diff viewer');
		}

		const entry = dirtyPaths.find(
			(candidate) =>
				candidate.isUntracked &&
				(candidate.path === ignoreEntry || candidate.path.startsWith(ignoreEntry)),
		);

		if (!entry) {
			throw new Error(`File is no longer changed: ${ignoreEntry}`);
		}

		const gitignorePath = path.join(repo.repoRoot, '.gitignore');
		const currentContents = await readFile(gitignorePath, 'utf8').catch(() => null);

		const nextContents = appendGitIgnoreEntry(currentContents, ignoreEntry);
		if (nextContents !== currentContents) {
			await writeFile(gitignorePath, nextContents, 'utf8');
		}

		return {
			snapshotChanged: await this.refreshSnapshot(args.projectId, args.projectPath),
		};
	}
}
