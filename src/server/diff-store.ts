import { createHash } from 'node:crypto';
import { realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
	BranchActionFailure,
	BranchActionSuccess,
	BranchMetadata,
	GitHubRepoAvailabilityResult,
	GithubPublishInfo,
	UpstreamStatus,
	WorkspaceBranchHistoryEntry,
	WorkspaceBranchHistorySnapshot,
	WorkspaceDiffFile,
	WorkspaceDiffPatchResult,
	WorkspaceFileContentsResult,
	WorkspaceGitSnapshot,
} from '../shared/types';
import { inferWorkspaceFileContentType } from './uploads';

interface StoredWorkspaceGitState extends BranchMetadata, UpstreamStatus {
	status: WorkspaceGitSnapshot['status'];
	files: WorkspaceDiffFile[];
	hasPushedCommits?: boolean;
	branchPublishState?: WorkspaceGitSnapshot['branchPublishState'];
	mainAheadCount?: number;
	branchHistory: WorkspaceBranchHistorySnapshot;
}

interface DirtyPathEntry {
	path: string;
	previousPath?: string;
	changeType: WorkspaceDiffFile['changeType'];
	isUntracked: boolean;
}

const MAX_WORKSPACE_FILE_CONTENT_BYTES = 2 * 1024 * 1024;
const DEFAULT_BINARY_MIME_TYPE = 'application/octet-stream';
const TEXT_PLAIN_CONTENT_TYPE = 'text/plain; charset=utf-8';

export interface GitHubBackedRepoInspection {
	ok: boolean;
	repoRoot?: string;
	branchName?: string;
	defaultBranchName?: string;
	githubOwner?: string;
	githubRepo?: string;
	originRepoSlug?: string;
	message?: string;
}

function createEmptyState(): StoredWorkspaceGitState {
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
		hasPushedCommits: undefined,
		branchPublishState: 'unknown',
		mainAheadCount: undefined,
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

function branchHistoryEqual(
	left: WorkspaceBranchHistorySnapshot,
	right: WorkspaceBranchHistorySnapshot,
) {
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

export function snapshotsEqual(
	left: StoredWorkspaceGitState | undefined,
	right: StoredWorkspaceGitState,
) {
	if (!left) {
		return right.status === 'unknown' && right.files.length === 0;
	}

	if (left.status !== right.status) return false;
	if (!branchMetadataEqual(left, right)) return false;
	if (!upstreamStatusEqual(left, right)) return false;
	if (left.hasPushedCommits !== right.hasPushedCommits) return false;
	if (left.branchPublishState !== right.branchPublishState) return false;
	if (left.mainAheadCount !== right.mainAheadCount) return false;
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

	return { stdout, stderr, exitCode };
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

	return { stdout, stderr, exitCode };
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

const SAFE_INITIAL_GITIGNORE_ENTRIES = [
	'.env',
	'.env.*',
	'!.env.example',
	'*.pem',
	'*.key',
	'*.p12',
	'*.pfx',
	'node_modules/',
	'.DS_Store',
	'.miko/',
	'.miko-dev/',
] as const;

async function ensureSafeInitialGitignore(repoRoot: string) {
	const gitignorePath = path.join(repoRoot, '.gitignore');
	const currentContents = await Bun.file(gitignorePath)
		.text()
		.catch(() => null);
	let nextContents = currentContents;

	for (const entry of SAFE_INITIAL_GITIGNORE_ENTRIES) {
		nextContents = appendGitIgnoreEntry(nextContents, entry);
	}

	if (nextContents !== null && nextContents !== currentContents) {
		await Bun.write(gitignorePath, nextContents);
	}
}

async function ensureInitialCommit(repoRoot: string): Promise<BranchActionFailure | null> {
	const repo = await resolveRepo(repoRoot);
	if (repo?.baseCommit) return null;

	await ensureSafeInitialGitignore(repoRoot);

	const addResult = await runGit(['add', '-A'], repoRoot);
	if (addResult.exitCode !== 0) {
		return createBranchActionFailure(
			'Initial commit failed',
			formatGitFailure(addResult),
			'Git could not stage files for the initial commit.',
		);
	}

	const commitResult = await runGit(
		[
			'-c',
			'user.name=Miko',
			'-c',
			'user.email=miko@example.com',
			'commit',
			'--allow-empty',
			'-m',
			'Initial commit',
		],
		repoRoot,
	);
	if (commitResult.exitCode !== 0) {
		return createBranchActionFailure(
			'Initial commit failed',
			formatGitFailure(commitResult),
			'Git could not create the initial commit.',
		);
	}

	return null;
}

export async function resolveRepo(
	workspacePath: string,
): Promise<{ repoRoot: string; baseCommit: string | null } | null> {
	const topLevel = await runGit(['rev-parse', '--show-toplevel'], workspacePath);
	if (topLevel.exitCode !== 0) return null;

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
		/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/u,
		/^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/u,
		/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/u,
	];

	for (const pattern of patterns) {
		const match = remoteUrl.match(pattern);
		if (match?.[1]) return match[1];
	}

	return null;
}

function splitRepoSlug(repoSlug: string | null | undefined) {
	const [owner, repo] = repoSlug?.split('/') ?? [];
	return owner && repo ? { owner, repo } : null;
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

async function refExists(repoRoot: string, ref: string) {
	const result = await runGit(['rev-parse', '--verify', '--quiet', ref], repoRoot);
	return result.exitCode === 0;
}

export async function hasPushedCommits(args: {
	repoRoot: string;
	branchName?: string;
	defaultBranchName?: string;
}) {
	if (!args.branchName) return false;

	const remoteBranchRef = `refs/remotes/origin/${args.branchName}`;
	if (!(await refExists(args.repoRoot, remoteBranchRef))) return false;

	const baseBranch = args.defaultBranchName || 'main';
	const remoteBaseRef = `refs/remotes/origin/${baseBranch}`;
	if (!(await refExists(args.repoRoot, remoteBaseRef))) return false;

	const result = await runGit(
		['rev-list', '--count', `${remoteBaseRef}..${remoteBranchRef}`],
		args.repoRoot,
	);

	if (result.exitCode !== 0) return false;

	const count = Number.parseInt(result.stdout.trim(), 10);
	return Number.isFinite(count) && count > 0;
}

async function getBranchPublishState(args: {
	repoRoot: string;
	branchName?: string;
	hasUpstream: boolean;
}): Promise<WorkspaceGitSnapshot['branchPublishState']> {
	if (!args.branchName) return 'unknown';
	if (args.hasUpstream) return 'published';

	const remoteBranchRef = `refs/remotes/origin/${args.branchName}`;
	return (await refExists(args.repoRoot, remoteBranchRef)) ? 'published' : 'local_only';
}

export async function getMainAheadCount(args: { repoRoot: string; defaultBranchName?: string }) {
	const baseBranch = args.defaultBranchName || 'main';
	const remoteBaseRef = `refs/remotes/origin/${baseBranch}`;
	if (!(await refExists(args.repoRoot, remoteBaseRef))) return undefined;

	const result = await runGit(['rev-list', '--count', `HEAD..${remoteBaseRef}`], args.repoRoot);
	if (result.exitCode !== 0) return undefined;

	const count = Number.parseInt(result.stdout.trim(), 10);
	return Number.isFinite(count) ? count : undefined;
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

	let changeType: WorkspaceDiffFile['changeType'] = 'modified';
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
	// before this powers broad external use. The current line parser is acceptable for
	// normal code paths, but quoted paths/newlines can produce incorrect diff rows.
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

function hashPatch(patch: string) {
	return createHash('sha256').update(patch).digest('hex');
}

function normalizeNoIndexPatchHeaders(patch: string, relativePath: string) {
	const normalizedPath = stripTrailingSlash(relativePath);
	const absolutePathPattern = /[^\s]+/u;
	return patch
		.replace(
			new RegExp(
				`^diff --git a/${absolutePathPattern.source} b/${absolutePathPattern.source}$`,
				'mu',
			),
			`diff --git a/${normalizedPath} b/${normalizedPath}`,
		)
		.replace(/^(\+\+\+) b\/.*$/mu, `+++ b/${normalizedPath}`);
}

function hashFileContents(relativePath: string, contents: string) {
	return createHash('sha256').update(`${relativePath}\0${contents}`).digest('hex');
}

function hashFileMetadata(relativePath: string, size: number, mtimeMs: number) {
	return createHash('sha256').update(`${relativePath}\0${size}\0${mtimeMs}`).digest('hex');
}

function isPreviewableTextMimeType(mimeType: string) {
	const normalized = mimeType.toLowerCase();
	return (
		normalized.startsWith('text/') ||
		normalized === 'application/json' ||
		normalized.startsWith('application/json;')
	);
}

function isDefaultBinaryMimeType(mimeType: string) {
	return mimeType.toLowerCase() === DEFAULT_BINARY_MIME_TYPE;
}

function isPreviewableImageMimeType(mimeType: string) {
	const normalized = mimeType.toLowerCase();
	return normalized.startsWith('image/') && normalized !== 'image/svg+xml';
}

function hasSuspiciousControlCharacters(value: string) {
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		const isAllowedControlCharacter = codePoint === 9 || codePoint === 10 || codePoint === 13;
		if (codePoint < 32 && !isAllowedControlCharacter) return true;
	}
	return false;
}

class RepositoryPathEscapeError extends Error {
	constructor() {
		super('Path must stay inside the repository');
		this.name = 'RepositoryPathEscapeError';
	}
}

async function resolveWorkspaceFilePath(repoRoot: string, relativePath: string) {
	const absolutePath = path.join(repoRoot, relativePath);
	const [repoRootRealPath, targetRealPath] = await Promise.all([
		realpath(repoRoot),
		realpath(absolutePath),
	]);

	if (
		targetRealPath !== repoRootRealPath &&
		!targetRealPath.startsWith(`${repoRootRealPath}${path.sep}`)
	) {
		throw new RepositoryPathEscapeError();
	}

	return targetRealPath;
}

async function previewFileAtPath(args: {
	filePath: string;
	displayPath: string;
	contentUrl?: (metadataDigest: string) => string;
}): Promise<WorkspaceFileContentsResult> {
	const info = await stat(args.filePath);
	if (!info.isFile()) throw new Error(`Path is not a file: ${args.displayPath}`);
	if (info.size > MAX_WORKSPACE_FILE_CONTENT_BYTES) {
		throw new Error(`File is too large to preview: ${args.displayPath}`);
	}

	let mimeType = inferWorkspaceFileContentType(args.filePath);
	const metadataDigest = hashFileMetadata(args.displayPath, info.size, info.mtimeMs);

	if (args.contentUrl && isPreviewableImageMimeType(mimeType)) {
		return {
			kind: 'image',
			path: args.displayPath,
			name: path.basename(args.displayPath),
			contentUrl: args.contentUrl(metadataDigest),
			mimeType,
			size: info.size,
			cacheKey: `${args.displayPath}:${metadataDigest}`,
		};
	}

	let contents: string | null = null;
	if (isPreviewableTextMimeType(mimeType) || isDefaultBinaryMimeType(mimeType)) {
		contents = await readPreviewableTextFile(args.filePath, args.displayPath).catch(() => null);
	}

	if (contents === null) {
		return {
			kind: 'binary',
			path: args.displayPath,
			name: path.basename(args.displayPath),
			mimeType,
			size: info.size,
			cacheKey: `${args.displayPath}:${metadataDigest}`,
		};
	}

	if (isDefaultBinaryMimeType(mimeType)) {
		mimeType = TEXT_PLAIN_CONTENT_TYPE;
	}
	const contentDigest = hashFileContents(args.displayPath, contents);

	return {
		kind: 'text',
		path: args.displayPath,
		name: path.basename(args.displayPath),
		contents,
		mimeType,
		size: info.size,
		encoding: 'utf-8',
		cacheKey: `${args.displayPath}:${contentDigest}`,
	};
}

async function readPreviewableTextFile(filePath: string, relativePath: string) {
	const file = Bun.file(filePath);
	const buffer = await file.arrayBuffer();
	if (new Uint8Array(buffer).includes(0)) {
		throw new Error(`File is not previewable as text: ${relativePath}`);
	}

	let contents: string;
	try {
		contents = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
	} catch {
		throw new Error(`File is not previewable as text: ${relativePath}`);
	}

	if (hasSuspiciousControlCharacters(contents)) {
		throw new Error(`File is not previewable as text: ${relativePath}`);
	}

	return contents;
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
		return normalizeNoIndexPatchHeaders(result.stdout, targetPath);
	}

	const diffArgs = ['diff', '--no-ext-diff', '--no-color', '--find-renames'];
	if (baseCommit) diffArgs.push(baseCommit);

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
				patchDigest: hashPatch(patch),
				mimeType: exists ? inferWorkspaceFileContentType(entry.path) : undefined,
				size,
			} satisfies WorkspaceDiffFile;
		}),
	);

	return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function getBranchHistory(args: {
	repoRoot: string;
	ref: string;
	limit: number;
}): Promise<WorkspaceBranchHistorySnapshot> {
	const remoteUrl = await getOriginRemoteUrl(args.repoRoot);
	const repoSlug = extractGitHubRepoSlug(remoteUrl);
	const result = await runGit(
		[
			'log',
			args.ref,
			`--max-count=${args.limit}`,
			'--date=iso-strict',
			'--decorate=full',
			'--format=%H%x00%s%x00%b%x00%an%x00%aI%x00%D%x00',
		],
		args.repoRoot,
	);

	if (result.exitCode !== 0) return { entries: [] };

	const fields = result.stdout.split('\0');
	const entries: WorkspaceBranchHistoryEntry[] = [];
	for (let index = 0; index + 5 < fields.length; index += 6) {
		const [
			rawSha = '',
			summary = '',
			description = '',
			authorName = '',
			authoredAt = '',
			refs = '',
		] = fields.slice(index, index + 6);
		const sha = rawSha.trim();
		if (!sha.trim()) continue;

		const tags = refs
			.split(',')
			.map((ref) => ref.trim())
			.flatMap((ref) => {
				if (!ref.startsWith('tag: ')) return [];
				return [ref.slice('tag: '.length).replace(/^refs\/tags\//u, '')];
			})
			.filter(Boolean);

		entries.push({
			sha,
			summary,
			description: description.trim(),
			authorName: authorName || undefined,
			authoredAt,
			tags,
			githubUrl: repoSlug ? `https://github.com/${repoSlug}/commit/${sha}` : undefined,
		});
	}
	return { entries };
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
	if (!Bun.which('gh')) return { ghInstalled: false, authenticated: false };

	const result = await runCommand(['gh', 'api', 'user']);
	if (result.exitCode !== 0) return { ghInstalled: true, authenticated: false };

	try {
		const parsed = JSON.parse(result.stdout) as { login?: string };
		return { ghInstalled: true, authenticated: true, activeAccountLogin: parsed.login };
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

export function appendGitIgnoreEntry(currentContents: string | null, entry: string) {
	const normalizedEntry = normalizeRepoRelativePath(entry);
	const normalizedEntryWithoutSlash = stripTrailingSlash(normalizedEntry);
	const current = currentContents ?? '';
	const currentLines = current
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);

	if (
		currentLines.some((line) => {
			if (line === normalizedEntry) return true;
			if (line.startsWith('#') || line.startsWith('!')) return false;
			if (stripTrailingSlash(line) === normalizedEntryWithoutSlash) return true;
			if (line.startsWith('*.') && normalizedEntry.endsWith(line.slice(1))) return true;
			return false;
		})
	) {
		return current.endsWith('\n') ? current : `${current}\n`;
	}

	const prefix = current.length === 0 || current.endsWith('\n') ? current : `${current}\n`;
	return `${prefix}${normalizedEntry}\n`;
}

export class DiffStore {
	private readonly states = new Map<string, StoredWorkspaceGitState>();

	// biome-ignore lint/complexity/noUselessConstructor: constructor kept for server wiring compatibility.
	constructor(_: string) {}

	async initialize() {}

	async initializeGit(args: {
		localPath: string;
	}): Promise<BranchActionSuccess | BranchActionFailure> {
		const { localPath } = args;
		const existingRepo = await resolveRepo(localPath);

		if (existingRepo) {
			const initialCommitFailure = await ensureInitialCommit(existingRepo.repoRoot);
			if (initialCommitFailure) return initialCommitFailure;

			return {
				ok: true,
				branchName: await getBranchName(existingRepo.repoRoot),
				snapshotChanged: false,
			};
		}

		let initResult = await runGit(['init', '-b', 'main'], localPath);
		if (initResult.exitCode !== 0) {
			initResult = await runGit(['init'], localPath);
		}
		if (initResult.exitCode !== 0) {
			return createBranchActionFailure(
				'Initialize git failed',
				formatGitFailure(initResult),
				'Git could not initialize this folder.',
			);
		}

		const repo = await resolveRepo(localPath);
		if (repo) {
			const initialCommitFailure = await ensureInitialCommit(repo.repoRoot);
			if (initialCommitFailure) return initialCommitFailure;
		}

		return {
			ok: true,
			branchName: repo ? await getBranchName(repo.repoRoot) : undefined,
			snapshotChanged: false,
		};
	}

	async getGitHubPublishInfo(args: { localPath: string }): Promise<GithubPublishInfo> {
		const { localPath } = args;
		const authInfo = await getGhAuthInfo();
		const suggestedRepoName = sanitizeRepoName(path.basename(localPath)) || 'my-repo';

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
		if (!authInfo.ghInstalled) return { available: false, message: 'GitHub CLI is not installed.' };
		if (!authInfo.authenticated)
			return { available: false, message: 'GitHub CLI is not authenticated.' };

		const owner = args.owner.trim();
		const name = sanitizeRepoName(args.name);
		if (!owner || !name)
			return { available: false, message: 'Enter an owner and repository name.' };

		const result = await runCommand(['gh', 'api', `repos/${owner}/${name}`]);
		if (result.exitCode === 0)
			return { available: false, message: `${owner}/${name} already exists.` };

		const detail = `${result.stderr}\n${result.stdout}`.toLowerCase();
		if (detail.includes('404'))
			return { available: true, message: `${owner}/${name} is available.` };

		return { available: false, message: 'Could not verify repository availability.' };
	}

	async publishToGitHub(args: {
		localPath: string;
		owner: string;
		name: string;
		visibility: 'public' | 'private';
		description?: string;
	}): Promise<BranchActionSuccess | BranchActionFailure> {
		const { localPath } = args;
		const repo = await resolveRepo(localPath);
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
				message: 'Install GitHub CLI (`gh`) to publish this repository.',
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
			localPath,
			'--remote',
			'origin',
		];

		const initialCommitFailure = await ensureInitialCommit(repo.repoRoot);
		if (initialCommitFailure) return initialCommitFailure;

		const branchName = await getBranchName(repo.repoRoot);
		if (branchName !== 'main' && branchName !== 'master') {
			return {
				ok: false,
				title: 'Publish failed',
				message: 'Switch to the main branch before publishing this repository.',
				detail: `Current branch is ${branchName ?? 'unknown'}.`,
				snapshotChanged: false,
			};
		}

		createArgs.push('--push');
		if (args.description?.trim()) createArgs.push('--description', args.description.trim());

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

		return { ok: true, branchName: await getBranchName(repo.repoRoot), snapshotChanged: false };
	}

	getWorkspaceGitSnapshot(workspaceId: string): WorkspaceGitSnapshot {
		const state = this.states.get(workspaceId) ?? createEmptyState();
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
			hasPushedCommits: state.hasPushedCommits,
			branchPublishState: state.branchPublishState,
			mainAheadCount: state.mainAheadCount,
			branchHistory: {
				entries: state.branchHistory.entries.map((entry) => ({
					...entry,
					tags: [...entry.tags],
				})),
			},
		};
	}

	async inspectGitHubBackedRepo(localPath: string): Promise<GitHubBackedRepoInspection> {
		const repo = await resolveRepo(localPath);
		if (!repo) {
			return { ok: false, message: 'Directory must be a git repository.' };
		}

		const originRemoteUrl = await getOriginRemoteUrl(repo.repoRoot);
		const originRepoSlug = extractGitHubRepoSlug(originRemoteUrl);
		const split = splitRepoSlug(originRepoSlug);

		if (!split) {
			return {
				ok: false,
				repoRoot: repo.repoRoot,
				message: 'Directory must have a GitHub origin remote.',
			};
		}

		return {
			ok: true,
			repoRoot: repo.repoRoot,
			branchName: await getBranchName(repo.repoRoot),
			defaultBranchName: await resolveDefaultBranchName(repo.repoRoot),
			githubOwner: split.owner,
			githubRepo: split.repo,
			originRepoSlug: `${split.owner}/${split.repo}`,
		};
	}

	async readPatch(args: {
		workspacePath: string;
		path: string;
	}): Promise<WorkspaceDiffPatchResult> {
		const relativePath = normalizeRepoRelativePath(args.path);
		const repo = await resolveRepo(args.workspacePath);
		if (!repo) throw new Error('Workspace is not in a git repository');

		const entry = await findDirtyPath(repo.repoRoot, relativePath);
		if (!entry) throw new Error(`File is no longer changed: ${relativePath}`);
		const patch = await readPatchForEntry(repo.repoRoot, repo.baseCommit, entry);

		return { path: entry.path, patch, patchDigest: hashPatch(patch) };
	}

	async readFileContents(args: {
		workspaceId: string;
		workspacePath: string;
		path: string;
	}): Promise<WorkspaceFileContentsResult> {
		const relativePath = stripTrailingSlash(normalizeRepoRelativePath(args.path));
		const repo = await resolveRepo(args.workspacePath);
		if (!repo) throw new Error('Workspace is not in a git repository');

		const filePath = await resolveWorkspaceFilePath(repo.repoRoot, relativePath).catch((error) => {
			if (error instanceof RepositoryPathEscapeError) throw error;
			throw new Error(`File does not exist: ${relativePath}`);
		});

		return previewFileAtPath({
			filePath,
			displayPath: relativePath,
			contentUrl: (metadataDigest) =>
				`/api/workspaces/${encodeURIComponent(args.workspaceId)}/files/${encodeURIComponent(relativePath)}/content?v=${encodeURIComponent(metadataDigest)}`,
		});
	}

	async readExternalFileContents(args: { path: string }): Promise<WorkspaceFileContentsResult> {
		const requestedPath = args.path.trim();
		if (!path.isAbsolute(requestedPath)) throw new Error('External file path must be absolute.');

		let filePath: string;
		try {
			filePath = await realpath(requestedPath);
		} catch {
			throw new Error(`File does not exist: ${requestedPath}`);
		}

		return previewFileAtPath({
			filePath,
			displayPath: filePath,
			contentUrl: (metadataDigest) =>
				`/api/external-files/content?path=${encodeURIComponent(filePath)}&v=${encodeURIComponent(metadataDigest)}`,
		});
	}

	async refreshWorkspaceGitSnapshot(workspaceId: string, workspacePath: string) {
		const repo = await resolveRepo(workspacePath);
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
				hasPushedCommits: undefined,
				branchPublishState: 'unknown',
				mainAheadCount: undefined,
				branchHistory: { entries: [] },
			} satisfies StoredWorkspaceGitState;

			const changed = !snapshotsEqual(this.states.get(workspaceId), nextState);
			this.states.set(workspaceId, nextState);
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
		const pushedCommits = await hasPushedCommits({
			repoRoot: repo.repoRoot,
			branchName,
			defaultBranchName,
		});
		const branchPublishState = await getBranchPublishState({
			repoRoot: repo.repoRoot,
			branchName,
			hasUpstream,
		});

		const mainAheadCount = await getMainAheadCount({ repoRoot: repo.repoRoot, defaultBranchName });
		const branchHistory = repo.baseCommit
			? await getBranchHistory({ repoRoot: repo.repoRoot, ref: branchName ?? 'HEAD', limit: 20 })
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
			hasPushedCommits: pushedCommits,
			branchPublishState,
			mainAheadCount,
			branchHistory,
		} satisfies StoredWorkspaceGitState;

		const changed = !snapshotsEqual(this.states.get(workspaceId), nextState);
		this.states.set(workspaceId, nextState);
		return changed;
	}

	async fetchWorkspaceGit(args: {
		workspaceId: string;
		workspacePath: string;
	}): Promise<BranchActionSuccess | BranchActionFailure> {
		const repo = await resolveRepo(args.workspacePath);
		if (!repo) {
			throw new Error('Workspace is not in a git repository');
		}

		const fetchResult = await runGit(['fetch', '--all', '--prune'], repo.repoRoot);
		if (fetchResult.exitCode !== 0) {
			return createBranchActionFailure(
				'Fetch failed',
				formatGitFailure(fetchResult),
				'Git could not fetch the latest remote changes.',
			);
		}

		const snapshotChanged = await this.refreshWorkspaceGitSnapshot(
			args.workspaceId,
			args.workspacePath,
		);

		return {
			ok: true,
			branchName: await getBranchName(repo.repoRoot),
			snapshotChanged,
		};
	}

	async discardFile(args: { workspaceId: string; workspacePath: string; path: string }) {
		const relativePath = normalizeRepoRelativePath(args.path);
		const repo = await resolveRepo(args.workspacePath);
		if (!repo) throw new Error('Workspace is not in a git repository');

		const entry = await findDirtyPath(repo.repoRoot, relativePath);
		if (!entry) throw new Error(`File is no longer changed: ${relativePath}`);

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
			snapshotChanged: await this.refreshWorkspaceGitSnapshot(args.workspaceId, args.workspacePath),
		};
	}

	async ignoreFile(args: { workspaceId: string; workspacePath: string; path: string }) {
		const ignoreEntry = normalizeRepoRelativePath(args.path);
		const repo = await resolveRepo(args.workspacePath);
		if (!repo) throw new Error('Workspace is not in a git repository');

		const dirtyPaths = await listDirtyPaths(repo.repoRoot);
		const exactEntry = dirtyPaths.find((candidate) => candidate.path === ignoreEntry);
		if (exactEntry && !exactEntry.isUntracked) {
			throw new Error('Only untracked files can be ignored from the diff viewer');
		}

		const ignoreDescendantPrefix = ignoreEntry.endsWith('/') ? ignoreEntry : `${ignoreEntry}/`;
		const entry = dirtyPaths.find(
			(candidate) =>
				candidate.isUntracked &&
				(candidate.path === ignoreEntry || candidate.path.startsWith(ignoreDescendantPrefix)),
		);

		if (!entry) throw new Error(`File is no longer changed: ${ignoreEntry}`);

		const gitignorePath = path.join(repo.repoRoot, '.gitignore');
		const currentContents = await Bun.file(gitignorePath)
			.text()
			.catch(() => null);
		const nextContents = appendGitIgnoreEntry(currentContents, ignoreEntry);
		if (nextContents !== currentContents) {
			await Bun.write(gitignorePath, nextContents);
		}

		return {
			snapshotChanged: await this.refreshWorkspaceGitSnapshot(args.workspaceId, args.workspacePath),
		};
	}
}
