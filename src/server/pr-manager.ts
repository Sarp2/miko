import { createHash } from 'node:crypto';
import type {
	PullRequestCheckSnapshot,
	PullRequestCommentSnapshot,
	WorkspaceDiffFile,
	WorkspaceGitHubSnapshot,
} from 'src/shared/types';
import { runCommand } from './diff-store';
import type { WorkspaceRecord } from './event';
import type { EventStore } from './event-store';
import {
	GitHubRateLimitError,
	GitHubRestClient,
	type GitHubRestResult,
} from './github-rest-client';
import { inferWorkspaceFileContentType } from './uploads';

type GhResult = Awaited<ReturnType<typeof runCommand>>;

interface GitHubApiClient {
	requestJson<T>(cacheKey: string, path: string): Promise<GitHubRestResult<T>>;
	requestJsonPages?<TPage, TItem>(
		cacheKey: string,
		path: string,
		getItems: (page: TPage) => TItem[],
	): Promise<GitHubRestResult<TItem[]>>;
}

interface PrManagerDeps {
	runGh?: (args: string[]) => Promise<GhResult>;
	github?: GitHubApiClient;
}

interface GitHubPullRequestSearchItem {
	number?: number;
	title?: string;
	url?: string;
	state?: string;
	merged_at?: string | null;
	isDraft?: boolean;
	draft?: boolean;
	headRefName?: string;
	head?: { ref?: string };
	baseRefName?: string;
	base?: { ref?: string };
	createdAt?: string;
	created_at?: string;
}

interface GitHubCommentAuthor {
	login?: string;
	isBot?: boolean;
}

interface GitHubPullRequestComment {
	id?: string;
	author?: GitHubCommentAuthor;
	authorAssociation?: string;
	body?: string;
	url?: string;
	path?: string;
	line?: number;
	createdAt?: string;
	updatedAt?: string;
}

interface GitHubPullRequestCheck {
	name?: string;
	workflowName?: string;
	status?: string;
	conclusion?: string;
	detailsUrl?: string;
	startedAt?: string;
	completedAt?: string;
}

interface GitHubPullRequestView {
	number?: number;
	title?: string;
	body?: string;
	html_url?: string;
	url?: string;
	state?: string;
	merged_at?: string | null;
	mergeable_state?: string;
	mergeStateStatus?: string;
	isDraft?: boolean;
	draft?: boolean;
	headRefName?: string;
	head?: { ref?: string; sha?: string };
	baseRefName?: string;
	base?: { ref?: string };
	createdAt?: string;
	created_at?: string;
	additions?: number;
	deletions?: number;
	comments?: GitHubPullRequestComment[];
	reviews?: Array<{
		id?: string;
		author?: GitHubCommentAuthor;
		authorAssociation?: string;
		body?: string;
		url?: string;
		state?: string;
		submittedAt?: string;
	}>;
	reviewLineComments?: GitHubPullRequestComment[];
	statusCheckRollup?: GitHubPullRequestCheck[];
	files?: GitHubPullRequestFile[];
}

interface GitHubPullRequestFile {
	path?: string;
	filename?: string;
	status?: string;
	additions?: number;
	deletions?: number;
	patch?: string;
	patchDigest?: string;
	previous_filename?: string;
	previousFilename?: string;
}

interface GitHubRestIssueComment {
	id?: number;
	user?: { login?: string; type?: string };
	author_association?: string;
	body?: string;
	html_url?: string;
	path?: string;
	line?: number;
	created_at?: string;
	updated_at?: string;
}

interface GitHubRestReview {
	id?: number;
	user?: { login?: string; type?: string };
	author_association?: string;
	body?: string;
	html_url?: string;
	state?: string;
	submitted_at?: string;
}

interface GitHubRestCheckRun {
	name?: string;
	status?: string;
	conclusion?: string;
	html_url?: string;
	started_at?: string;
	completed_at?: string;
	check_suite?: { app?: { name?: string } };
}

interface GitHubRestCheckRunsResponse {
	check_runs?: GitHubRestCheckRun[];
}

interface GitHubRestCombinedStatus {
	statuses?: Array<{
		context?: string;
		state?: string;
		target_url?: string;
		created_at?: string;
		updated_at?: string;
	}>;
}

type GitHubRestPullRequestFile = GitHubPullRequestFile;

function parseJson<T>(value: string): T | null {
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

function normalizePrStatus(
	state: string | undefined,
	mergedAt?: string | null,
): WorkspaceGitHubSnapshot['status'] {
	if (mergedAt) return 'merged';
	const normalized = state?.toUpperCase();
	if (normalized === 'OPEN') return 'open';
	if (normalized === 'MERGED') return 'merged';
	if (normalized === 'CLOSED') return 'closed';
	return 'unknown';
}

function parseGitHubTimestamp(value: string | undefined) {
	if (!value) return undefined;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : undefined;
}

function normalizeCheckStatus(check: GitHubPullRequestCheck): PullRequestCheckSnapshot['status'] {
	const conclusion = check.conclusion?.toUpperCase();
	const status = check.status?.toUpperCase();

	if (conclusion === 'FAILURE' || conclusion === 'CANCELLED' || conclusion === 'TIMED_OUT')
		return 'failing';
	if (status && status !== 'COMPLETED') return 'pending';
	if (conclusion === 'SUCCESS' || conclusion === 'SKIPPED') return 'passing';
	return 'unknown';
}

function deriveCiStatus(checks: PullRequestCheckSnapshot[]): WorkspaceGitHubSnapshot['ciStatus'] {
	if (checks.length === 0) return 'unknown';
	if (checks.some((check) => check.status === 'failing')) return 'failing';
	if (checks.some((check) => check.status === 'pending')) return 'pending';
	if (checks.every((check) => check.status === 'passing')) return 'passing';
	return 'unknown';
}

function hasMergeConflicts(mergeStateStatus: string | undefined) {
	return mergeStateStatus?.toUpperCase() === 'DIRTY';
}

function sourceIsDraft(source: GitHubPullRequestView | GitHubPullRequestSearchItem) {
	return source.isDraft ?? ('draft' in source ? source.draft : undefined);
}

function dedupeChecks(checks: GitHubPullRequestCheck[]) {
	const seen = new Set<string>();
	return checks.filter((check) => {
		const key = `${check.name ?? ''}:${check.detailsUrl ?? ''}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function mergeStateStatusFromRest(value: string | undefined) {
	return value?.toUpperCase();
}

function sourceUrl(source: GitHubPullRequestView | GitHubPullRequestSearchItem) {
	return 'html_url' in source && source.html_url ? source.html_url : source.url;
}

function sourceHeadRef(source: GitHubPullRequestView | GitHubPullRequestSearchItem) {
	return source.headRefName ?? source.head?.ref;
}

function sourceBaseRef(source: GitHubPullRequestView | GitHubPullRequestSearchItem) {
	return source.baseRefName ?? source.base?.ref;
}

function sourceCreatedAt(source: GitHubPullRequestView | GitHubPullRequestSearchItem) {
	return source.createdAt ?? source.created_at;
}

function mapChecks(pr: GitHubPullRequestView): PullRequestCheckSnapshot[] {
	const checks = pr.statusCheckRollup ?? [];
	return checks.flatMap((check) => {
		if (!check.name) return [];
		const status = normalizeCheckStatus(check);
		return {
			name: check.name,
			workflowName: check.workflowName,
			status,
			conclusion: check.conclusion,
			detailsUrl: check.detailsUrl,
			startedAt: check.startedAt,
			completedAt: check.completedAt,
			canFetchLogs: status === 'failing',
		} satisfies PullRequestCheckSnapshot;
	});
}

function isBotAuthor(author: GitHubCommentAuthor | undefined) {
	return Boolean(author?.isBot || author?.login?.endsWith('[bot]'));
}

function mapIssueComments(pr: GitHubPullRequestView): PullRequestCommentSnapshot[] {
	return (pr.comments ?? []).flatMap((comment, index) => {
		if (!comment.body) return [];
		return {
			id: comment.id ?? `issue-${index}`,
			author: comment.author?.login,
			authorAssociation: comment.authorAssociation,
			body: comment.body,
			url: comment.url,
			path: comment.path,
			line: comment.line,
			isBot: isBotAuthor(comment.author),
			source: 'issue',
			createdAt: comment.createdAt,
			updatedAt: comment.updatedAt,
		} satisfies PullRequestCommentSnapshot;
	});
}

function mapReviewComments(pr: GitHubPullRequestView): PullRequestCommentSnapshot[] {
	return (pr.reviews ?? []).flatMap((review, index) => {
		if (!review.body) return [];
		return {
			id: review.id ?? `review-${index}`,
			author: review.author?.login,
			authorAssociation: review.authorAssociation,
			body: review.body,
			url: review.url,
			isBot: isBotAuthor(review.author),
			source: 'review',
			createdAt: review.submittedAt,
			updatedAt: review.submittedAt,
		} satisfies PullRequestCommentSnapshot;
	});
}

function mapReviewLineComments(pr: GitHubPullRequestView): PullRequestCommentSnapshot[] {
	return (pr.reviewLineComments ?? []).flatMap((comment, index) => {
		if (!comment.body) return [];
		return {
			id: comment.id ?? `thread-${index}`,
			author: comment.author?.login,
			authorAssociation: comment.authorAssociation,
			body: comment.body,
			url: comment.url,
			path: comment.path,
			line: comment.line,
			isBot: isBotAuthor(comment.author),
			source: 'thread',
			createdAt: comment.createdAt,
			updatedAt: comment.updatedAt,
		} satisfies PullRequestCommentSnapshot;
	});
}

function mapComments(pr: GitHubPullRequestView): PullRequestCommentSnapshot[] {
	return [...mapIssueComments(pr), ...mapReviewComments(pr), ...mapReviewLineComments(pr)];
}

function normalizePrFileStatus(status: string | undefined): WorkspaceDiffFile['changeType'] {
	const normalized = status?.toLowerCase();
	if (normalized === 'added') return 'added';
	if (normalized === 'removed' || normalized === 'deleted') return 'deleted';
	if (normalized === 'renamed') return 'renamed';
	return 'modified';
}

function hashPrFile(file: GitHubPullRequestFile, filePath: string) {
	if (file.patchDigest) return file.patchDigest;
	return createHash('sha256')
		.update(
			[
				filePath,
				file.previous_filename ?? file.previousFilename ?? '',
				file.status ?? '',
				String(file.additions ?? 0),
				String(file.deletions ?? 0),
				file.patch ?? '',
			].join('\0'),
		)
		.digest('hex');
}

function mapPrFiles(files: GitHubPullRequestFile[] | undefined): WorkspaceDiffFile[] {
	return (files ?? [])
		.flatMap((file) => {
			const filePath = file.path ?? file.filename;
			if (!filePath) return [];
			return {
				path: filePath,
				changeType: normalizePrFileStatus(file.status),
				isUntracked: false,
				additions: file.additions ?? 0,
				deletions: file.deletions ?? 0,
				patchDigest: hashPrFile(file, filePath),
				patch: file.patch,
				mimeType:
					normalizePrFileStatus(file.status) === 'deleted'
						? undefined
						: inferWorkspaceFileContentType(filePath),
			} satisfies WorkspaceDiffFile;
		})
		.sort((left, right) => left.path.localeCompare(right.path));
}

function mapRestIssueComments(comments: GitHubRestIssueComment[]): PullRequestCommentSnapshot[] {
	return comments.flatMap((comment, index) => {
		if (!comment.body) return [];
		const author = comment.user?.login;
		return {
			id: comment.id !== undefined ? `issue-${comment.id}` : `issue-${index}`,
			author,
			authorAssociation: comment.author_association,
			body: comment.body,
			url: comment.html_url,
			path: comment.path,
			line: comment.line,
			isBot: Boolean(comment.user?.type === 'Bot' || author?.endsWith('[bot]')),
			source: 'issue',
			createdAt: comment.created_at,
			updatedAt: comment.updated_at,
		} satisfies PullRequestCommentSnapshot;
	});
}

function mapRestReviews(reviews: GitHubRestReview[]): PullRequestCommentSnapshot[] {
	return reviews.flatMap((review, index) => {
		if (!review.body) return [];
		const author = review.user?.login;
		return {
			id: review.id !== undefined ? `review-${review.id}` : `review-${index}`,
			author,
			authorAssociation: review.author_association,
			body: review.body,
			url: review.html_url,
			isBot: Boolean(review.user?.type === 'Bot' || author?.endsWith('[bot]')),
			source: 'review',
			createdAt: review.submitted_at,
			updatedAt: review.submitted_at,
		} satisfies PullRequestCommentSnapshot;
	});
}

function mapRestReviewLineComments(comments: GitHubRestIssueComment[]): GitHubPullRequestComment[] {
	return comments.flatMap((comment, index) => {
		if (!comment.body) return [];
		return {
			id: comment.id !== undefined ? `thread-${comment.id}` : `thread-${index}`,
			author: {
				login: comment.user?.login,
				isBot: Boolean(comment.user?.type === 'Bot' || comment.user?.login?.endsWith('[bot]')),
			},
			authorAssociation: comment.author_association,
			body: comment.body,
			url: comment.html_url,
			path: comment.path,
			line: comment.line,
			createdAt: comment.created_at,
			updatedAt: comment.updated_at,
		} satisfies GitHubPullRequestComment;
	});
}

function createNoneSnapshot(owner: string, repo: string): WorkspaceGitHubSnapshot {
	return {
		status: 'none',
		owner,
		repo,
		comments: [],
		checks: [],
		lastRefreshedAt: Date.now(),
	};
}

function createKnownPrSnapshot(
	workspace: WorkspaceRecord,
	owner: string,
	repo: string,
): WorkspaceGitHubSnapshot | null {
	const pullRequest = workspace.pullRequest;
	if (!pullRequest) return null;

	return {
		status: pullRequest.status,
		owner,
		repo,
		prNumber: pullRequest.number,
		createdAt: pullRequest.createdAt,
		title: pullRequest.title,
		url: pullRequest.url,
		headRefName: pullRequest.headRefName,
		baseRefName: pullRequest.baseRefName,
		ciStatus: pullRequest.ciStatus ?? 'unknown',
		isDraft: pullRequest.isDraft,
		mergeStateStatus: pullRequest.mergeStateStatus,
		hasMergeConflicts: pullRequest.hasMergeConflicts,
		files: pullRequest.files ?? [],
		comments: [],
		checks: [],
		lastRefreshedAt: Date.now(),
	};
}

export class PrManager {
	private readonly snapshots = new Map<string, WorkspaceGitHubSnapshot>();
	private readonly runGhCommand: (args: string[]) => Promise<GhResult>;
	private readonly github: GitHubApiClient | null;
	private readonly useGhForPrRefresh: boolean;

	constructor(
		private readonly eventStore: EventStore,
		deps: PrManagerDeps = {},
	) {
		this.runGhCommand = deps.runGh ?? ((args) => runCommand(['gh', ...args]));
		this.github = deps.github ?? (deps.runGh ? null : new GitHubRestClient());
		this.useGhForPrRefresh = Boolean(deps.runGh && !deps.github);
	}

	getWorkspaceGitHubSnapshot(workspaceId: string) {
		return this.snapshots.get(workspaceId) ?? null;
	}

	private async runGh(args: string[]) {
		return this.runGhCommand(args);
	}

	private async requestGitHub<T>(cacheKey: string, path: string): Promise<GitHubRestResult<T>> {
		if (!this.github) throw new Error('GitHub REST client is not configured');
		return this.github.requestJson<T>(cacheKey, path);
	}

	private async requestGitHubPages<TPage, TItem>(
		cacheKey: string,
		path: string,
		getItems: (page: TPage) => TItem[],
	): Promise<GitHubRestResult<TItem[]>> {
		if (!this.github) throw new Error('GitHub REST client is not configured');
		if (this.github.requestJsonPages) {
			return this.github.requestJsonPages<TPage, TItem>(cacheKey, path, getItems);
		}

		const result = await this.github.requestJson<TPage>(cacheKey, path);
		return result.status === 'ok' ? { status: 'ok', data: getItems(result.data) } : result;
	}

	private async findPrForBranch(owner: string, repo: string, branchName: string) {
		if (!this.useGhForPrRefresh) return this.findPrForBranchWithRest(owner, repo, branchName);

		const result = await this.runGh([
			'pr',
			'list',
			'--repo',
			`${owner}/${repo}`,
			'--head',
			branchName,
			'--state',
			'all',
			'--limit',
			'20',
			'--json',
			'number,title,url,state,headRefName,baseRefName,isDraft,createdAt',
		]);

		if (result.exitCode !== 0) {
			throw new Error(
				[result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n') ||
					'GitHub PR lookup failed',
			);
		}

		const prs = parseJson<GitHubPullRequestSearchItem[]>(result.stdout) ?? [];
		return (
			prs.find((pr) => pr.state?.toUpperCase() === 'OPEN') ??
			prs.find((pr) => pr.state?.toUpperCase() === 'MERGED') ??
			prs.find((pr) => pr.state?.toUpperCase() === 'CLOSED') ??
			null
		);
	}

	private async findPrForBranchWithRest(owner: string, repo: string, branchName: string) {
		const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?head=${encodeURIComponent(`${owner}:${branchName}`)}&state=all&per_page=20`;
		const result = await this.requestGitHub<GitHubPullRequestSearchItem[]>(
			`pulls:${owner}/${repo}:${branchName}`,
			path,
		);
		if (result.status === 'not_modified') {
			return this.getWorkspaceSnapshotPrSearchItem(owner, repo, branchName);
		}

		const prs = result.data ?? [];
		return (
			prs.find((pr) => normalizePrStatus(pr.state, pr.merged_at) === 'open') ??
			prs.find((pr) => normalizePrStatus(pr.state, pr.merged_at) === 'merged') ??
			prs.find((pr) => normalizePrStatus(pr.state, pr.merged_at) === 'closed') ??
			null
		);
	}

	private getWorkspaceSnapshotPrSearchItem(
		owner: string,
		repo: string,
		branchName: string,
	): GitHubPullRequestSearchItem | null {
		for (const snapshot of this.snapshots.values()) {
			if (snapshot.owner !== owner || snapshot.repo !== repo) continue;
			if (snapshot.headRefName !== branchName) continue;
			if (!snapshot.prNumber) continue;
			return {
				number: snapshot.prNumber,
				title: snapshot.title,
				url: snapshot.url,
				state:
					snapshot.status === 'merged'
						? 'MERGED'
						: snapshot.status === 'open'
							? 'OPEN'
							: snapshot.status === 'closed'
								? 'CLOSED'
								: undefined,
				headRefName: snapshot.headRefName,
				baseRefName: snapshot.baseRefName,
				createdAt: snapshot.createdAt ? new Date(snapshot.createdAt).toISOString() : undefined,
			};
		}
		return null;
	}

	private async viewPr(owner: string, repo: string, prNumber: number) {
		if (!this.useGhForPrRefresh) return this.viewPrWithRest(owner, repo, prNumber);

		const result = await this.runGh([
			'pr',
			'view',
			String(prNumber),
			'--repo',
			`${owner}/${repo}`,
			'--json',
			'number,title,body,url,state,mergeStateStatus,isDraft,headRefName,baseRefName,createdAt,additions,deletions,files,comments,reviews,statusCheckRollup',
		]);

		if (result.exitCode !== 0) {
			throw new Error(
				[result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n') ||
					'GitHub PR view failed',
			);
		}
		return parseJson<GitHubPullRequestView>(result.stdout);
	}

	private async viewPrWithRest(owner: string, repo: string, prNumber: number) {
		const detailPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}`;
		const detail = await this.requestGitHub<GitHubPullRequestView>(
			`pull:${owner}/${repo}:${prNumber}`,
			detailPath,
		);
		const pr =
			detail.status === 'not_modified'
				? this.snapshotToPullRequestView(this.findSnapshot(owner, repo, prNumber))
				: detail.data;
		if (!pr) throw new Error('GitHub PR view returned not modified without a cached snapshot');
		const [issueComments, reviewComments, lineComments, checks, files] = await Promise.all([
			this.fetchIssueComments(owner, repo, prNumber),
			this.fetchReviews(owner, repo, prNumber),
			this.fetchReviewLineComments(owner, repo, prNumber),
			this.fetchChecks(owner, repo, prNumber, pr.head?.sha ?? pr.headRefName),
			this.fetchPrFiles(owner, repo, prNumber),
		]);

		return {
			...pr,
			url: pr.html_url ?? pr.url,
			mergeStateStatus: pr.mergeStateStatus ?? mergeStateStatusFromRest(pr.mergeable_state),
			headRefName: sourceHeadRef(pr),
			baseRefName: sourceBaseRef(pr),
			createdAt: sourceCreatedAt(pr),
			comments: issueComments,
			reviews: reviewComments,
			reviewLineComments: lineComments,
			statusCheckRollup: checks,
			files,
		} satisfies GitHubPullRequestView;
	}

	private findSnapshot(owner: string, repo: string, prNumber: number) {
		for (const snapshot of this.snapshots.values()) {
			if (snapshot.owner === owner && snapshot.repo === repo && snapshot.prNumber === prNumber) {
				return snapshot;
			}
		}
		return null;
	}

	private snapshotToPullRequestView(
		snapshot: WorkspaceGitHubSnapshot | null,
	): GitHubPullRequestView | null {
		if (!snapshot?.prNumber) return null;
		return {
			number: snapshot.prNumber,
			title: snapshot.title,
			body: snapshot.body,
			url: snapshot.url,
			state:
				snapshot.status === 'merged'
					? 'MERGED'
					: snapshot.status === 'open'
						? 'OPEN'
						: snapshot.status === 'closed'
							? 'CLOSED'
							: undefined,
			mergeStateStatus: snapshot.mergeStateStatus,
			isDraft: snapshot.isDraft,
			headRefName: snapshot.headRefName,
			baseRefName: snapshot.baseRefName,
			createdAt: snapshot.createdAt ? new Date(snapshot.createdAt).toISOString() : undefined,
			additions: snapshot.additions,
			deletions: snapshot.deletions,
			files: snapshot.files?.map((file) => ({
				filename: file.path,
				status: file.changeType,
				additions: file.additions,
				deletions: file.deletions,
				patchDigest: file.patchDigest,
				patch: file.patch,
			})),
			comments: snapshot.comments
				.filter((comment) => comment.source === 'issue')
				.map((comment) => ({
					id: comment.id,
					author: { login: comment.author, isBot: comment.isBot },
					authorAssociation: comment.authorAssociation,
					body: comment.body,
					url: comment.url,
					path: comment.path,
					line: comment.line,
					createdAt: comment.createdAt,
					updatedAt: comment.updatedAt,
				})),
			reviews: snapshot.comments
				.filter((comment) => comment.source === 'review')
				.map((comment) => ({
					id: comment.id,
					author: { login: comment.author, isBot: comment.isBot },
					authorAssociation: comment.authorAssociation,
					body: comment.body,
					url: comment.url,
					submittedAt: comment.createdAt,
				})),
			reviewLineComments: snapshot.comments
				.filter((comment) => comment.source === 'thread')
				.map((comment) => ({
					id: comment.id,
					author: { login: comment.author, isBot: comment.isBot },
					authorAssociation: comment.authorAssociation,
					body: comment.body,
					url: comment.url,
					path: comment.path,
					line: comment.line,
					createdAt: comment.createdAt,
					updatedAt: comment.updatedAt,
				})),
			statusCheckRollup: snapshot.checks.map((check) => ({
				name: check.name,
				workflowName: check.workflowName,
				status: check.status === 'pending' ? 'IN_PROGRESS' : 'COMPLETED',
				conclusion: check.conclusion,
				detailsUrl: check.detailsUrl,
				startedAt: check.startedAt,
				completedAt: check.completedAt,
			})),
		};
	}

	private async fetchIssueComments(owner: string, repo: string, prNumber: number) {
		const result = await this.requestGitHubPages<GitHubRestIssueComment[], GitHubRestIssueComment>(
			`pull-comments:${owner}/${repo}:${prNumber}:issue`,
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${prNumber}/comments?per_page=100`,
			(page) => page,
		);
		if (result.status === 'not_modified') {
			return (
				this.snapshotToPullRequestView(this.findSnapshot(owner, repo, prNumber))?.comments ?? []
			);
		}
		return mapRestIssueComments(result.data).map((comment) => ({
			id: comment.id,
			author: { login: comment.author, isBot: comment.isBot },
			authorAssociation: comment.authorAssociation,
			body: comment.body,
			url: comment.url,
			path: comment.path,
			line: comment.line,
			createdAt: comment.createdAt,
			updatedAt: comment.updatedAt,
		}));
	}

	private async fetchReviews(owner: string, repo: string, prNumber: number) {
		const result = await this.requestGitHubPages<GitHubRestReview[], GitHubRestReview>(
			`pull-comments:${owner}/${repo}:${prNumber}:reviews`,
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/reviews?per_page=100`,
			(page) => page,
		);
		if (result.status === 'not_modified') {
			return (
				this.snapshotToPullRequestView(this.findSnapshot(owner, repo, prNumber))?.reviews ?? []
			);
		}
		return mapRestReviews(result.data).map((comment) => ({
			id: comment.id,
			author: { login: comment.author, isBot: comment.isBot },
			authorAssociation: comment.authorAssociation,
			body: comment.body,
			url: comment.url,
			submittedAt: comment.createdAt,
		}));
	}

	private async fetchReviewLineComments(owner: string, repo: string, prNumber: number) {
		const result = await this.requestGitHubPages<GitHubRestIssueComment[], GitHubRestIssueComment>(
			`pull-comments:${owner}/${repo}:${prNumber}:line`,
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/comments?per_page=100`,
			(page) => page,
		);
		if (result.status === 'not_modified') {
			return (
				this.snapshotToPullRequestView(this.findSnapshot(owner, repo, prNumber))
					?.reviewLineComments ?? []
			);
		}
		return mapRestReviewLineComments(result.data);
	}

	private async fetchPrFiles(owner: string, repo: string, prNumber: number) {
		const result = await this.requestGitHubPages<
			GitHubRestPullRequestFile[],
			GitHubRestPullRequestFile
		>(
			`pull-files:${owner}/${repo}:${prNumber}`,
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/files?per_page=100`,
			(page) => page,
		);
		if (result.status === 'not_modified') {
			return this.snapshotToPullRequestView(this.findSnapshot(owner, repo, prNumber))?.files ?? [];
		}
		return result.data;
	}

	private async fetchChecks(
		owner: string,
		repo: string,
		prNumber: number,
		ref: string | undefined,
	) {
		if (!ref) return this.findSnapshot(owner, repo, prNumber)?.checks ?? [];
		const [checkRuns, statuses] = await Promise.all([
			this.fetchCheckRuns(owner, repo, prNumber, ref),
			this.fetchCommitStatuses(owner, repo, prNumber, ref),
		]);
		return dedupeChecks([...checkRuns, ...statuses]);
	}

	private async fetchCheckRuns(owner: string, repo: string, prNumber: number, ref: string) {
		const result = await this.requestGitHubPages<GitHubRestCheckRunsResponse, GitHubRestCheckRun>(
			`check-runs:${owner}/${repo}:${ref}`,
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`,
			(page) => page.check_runs ?? [],
		);
		if (result.status === 'not_modified')
			return this.snapshotChecksAsGhChecks(owner, repo, prNumber);
		return result.data.flatMap((check) => {
			if (!check.name) return [];
			return {
				name: check.name,
				workflowName: check.check_suite?.app?.name,
				status: check.status,
				conclusion: check.conclusion,
				detailsUrl: check.html_url,
				startedAt: check.started_at,
				completedAt: check.completed_at,
			} satisfies GitHubPullRequestCheck;
		});
	}

	private async fetchCommitStatuses(owner: string, repo: string, prNumber: number, ref: string) {
		const result = await this.requestGitHubPages<
			GitHubRestCombinedStatus,
			NonNullable<GitHubRestCombinedStatus['statuses']>[number]
		>(
			`commit-status:${owner}/${repo}:${ref}`,
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}/status?per_page=100`,
			(page) => page.statuses ?? [],
		);
		if (result.status === 'not_modified')
			return this.snapshotChecksAsGhChecks(owner, repo, prNumber);
		return result.data.flatMap((status) => {
			if (!status.context) return [];
			return {
				name: status.context,
				status: status.state === 'pending' ? 'IN_PROGRESS' : 'COMPLETED',
				conclusion: status.state === 'success' ? 'success' : status.state,
				detailsUrl: status.target_url,
				startedAt: status.created_at,
				completedAt: status.updated_at,
			} satisfies GitHubPullRequestCheck;
		});
	}

	private snapshotChecksAsGhChecks(owner: string, repo: string, prNumber: number) {
		return (this.findSnapshot(owner, repo, prNumber)?.checks ?? []).map((check) => ({
			name: check.name,
			workflowName: check.workflowName,
			status: check.status === 'pending' ? 'IN_PROGRESS' : 'COMPLETED',
			conclusion: check.conclusion,
			detailsUrl: check.detailsUrl,
			startedAt: check.startedAt,
			completedAt: check.completedAt,
		}));
	}

	private async updateReviewState(
		workspace: WorkspaceRecord,
		status: WorkspaceGitHubSnapshot['status'],
	) {
		if (status === 'open') {
			await this.eventStore.setWorkspaceReviewState(workspace.id, 'in_review');
		} else if (status === 'merged') {
			await this.eventStore.setWorkspaceReviewState(workspace.id, 'done');
		} else if (status === 'closed') {
			await this.eventStore.setWorkspaceReviewState(workspace.id, 'closed');
		}
	}

	private async setSnapshotFromPr(
		workspace: WorkspaceRecord,
		owner: string,
		repo: string,
		pr: GitHubPullRequestView | GitHubPullRequestSearchItem,
	) {
		if (typeof pr.number !== 'number') {
			const snapshot = createNoneSnapshot(owner, repo);
			this.snapshots.set(workspace.id, snapshot);
			return snapshot;
		}

		const detailed =
			'statusCheckRollup' in pr || 'comments' in pr || 'reviews' in pr || 'body' in pr
				? (pr as GitHubPullRequestView)
				: await this.viewPr(owner, repo, pr.number);
		const source = detailed ?? pr;
		const status = normalizePrStatus(source.state, source.merged_at);
		const checks = detailed ? mapChecks(detailed) : [];
		const createdAt = parseGitHubTimestamp(sourceCreatedAt(source));

		const snapshot: WorkspaceGitHubSnapshot = {
			status,
			owner,
			repo,
			prNumber: pr.number,
			title: source.title,
			body: detailed?.body,
			url: sourceUrl(source),
			headRefName: sourceHeadRef(source),
			baseRefName: sourceBaseRef(source),
			ciStatus: deriveCiStatus(checks),
			isDraft: sourceIsDraft(source),
			mergeStateStatus: detailed?.mergeStateStatus,
			hasMergeConflicts: hasMergeConflicts(detailed?.mergeStateStatus),
			unresolvedCommentCount: undefined,
			additions: detailed?.additions,
			deletions: detailed?.deletions,
			files: detailed ? mapPrFiles(detailed.files) : [],
			comments: detailed ? mapComments(detailed) : [],
			checks,
			createdAt,
			lastRefreshedAt: Date.now(),
		};

		this.snapshots.set(workspace.id, snapshot);
		if (status === 'open' || status === 'merged' || status === 'closed') {
			await this.eventStore.observeWorkspacePullRequest(workspace.id, {
				number: pr.number,
				status,
				title: source.title,
				url: sourceUrl(source),
				headRefName: sourceHeadRef(source),
				baseRefName: sourceBaseRef(source),
				ciStatus: snapshot.ciStatus,
				isDraft: snapshot.isDraft,
				mergeStateStatus: snapshot.mergeStateStatus,
				hasMergeConflicts: snapshot.hasMergeConflicts,
				files: snapshot.files,
				createdAt,
				lastObservedAt: snapshot.lastRefreshedAt ?? Date.now(),
			});
		}
		await this.updateReviewState(workspace, status);
		return snapshot;
	}

	async refreshWorkspacePrState(workspaceId: string) {
		let workspace: WorkspaceRecord;
		try {
			workspace = this.eventStore.requireWorkspace(workspaceId);
		} catch (error) {
			this.snapshots.delete(workspaceId);
			throw error;
		}

		const directory = this.eventStore.requireDirectory(workspace.directoryId);
		const owner = directory.githubOwner;
		const repo = directory.githubRepo;

		if (
			workspace.visibilityState === 'archived' ||
			workspace.reviewState === 'done' ||
			workspace.reviewState === 'closed'
		) {
			this.snapshots.delete(workspace.id);
			return createKnownPrSnapshot(workspace, owner, repo) ?? createNoneSnapshot(owner, repo);
		}

		if (workspace.pullRequest?.number !== undefined) {
			let pr: GitHubPullRequestView | null;
			try {
				pr = await this.viewPr(owner, repo, workspace.pullRequest.number);
				if (!pr) throw new Error('GitHub PR view returned invalid JSON');
			} catch (error) {
				if (error instanceof GitHubRateLimitError) throw error;
				const knownSnapshot = createKnownPrSnapshot(workspace, owner, repo);
				if (knownSnapshot) {
					this.snapshots.set(workspace.id, knownSnapshot);
					return knownSnapshot;
				}
				throw new Error('GitHub PR view failed');
			}
			return this.setSnapshotFromPr(workspace, owner, repo, pr);
		}

		const pr = await this.findPrForBranch(owner, repo, workspace.branchName);
		if (pr) return this.setSnapshotFromPr(workspace, owner, repo, pr);

		const snapshot = createNoneSnapshot(owner, repo);
		this.snapshots.set(workspace.id, snapshot);
		return snapshot;
	}

	async refreshActiveWorkspaces() {
		const results = new Map<string, WorkspaceGitHubSnapshot>();
		for (const workspace of this.eventStore.listWorkspaces()) {
			if (workspace.visibilityState !== 'active') continue;
			if (workspace.reviewState === 'done' || workspace.reviewState === 'closed') continue;
			results.set(workspace.id, await this.refreshWorkspacePrState(workspace.id));
		}
		return results;
	}

	async refreshOpenPullRequests() {
		const results = new Map<string, WorkspaceGitHubSnapshot>();
		for (const workspace of this.eventStore.listWorkspaces()) {
			if (workspace.visibilityState !== 'active') continue;
			if (workspace.reviewState !== 'in_review') continue;
			results.set(workspace.id, await this.refreshWorkspacePrState(workspace.id));
		}
		return results;
	}

	async fetchFailingCheckLogs(workspaceId: string) {
		const workspace = this.eventStore.requireWorkspace(workspaceId);
		const directory = this.eventStore.requireDirectory(workspace.directoryId);
		const prNumber = workspace.pullRequest?.number;
		if (prNumber === undefined) throw new Error('Workspace does not have a pull request');

		const result = await this.runGh([
			'run',
			'list',
			'--repo',
			`${directory.githubOwner}/${directory.githubRepo}`,
			'--branch',
			workspace.branchName,
			'--limit',
			'10',
			'--json',
			'databaseId,conclusion,status,displayTitle,workflowName,url',
		]);

		if (result.exitCode !== 0) {
			throw new Error([result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n'));
		}

		const runs =
			parseJson<
				Array<{
					databaseId?: number;
					conclusion?: string;
					status?: string;
					displayTitle?: string;
					workflowName?: string;
					url?: string;
				}>
			>(result.stdout) ?? [];

		const failingRuns = runs.filter((run) => {
			const conclusion = run.conclusion?.toLowerCase();
			return (
				(conclusion === 'failure' || conclusion === 'cancelled' || conclusion === 'timed_out') &&
				run.databaseId
			);
		});

		const logs: Array<{
			runId: number;
			title?: string;
			workflowName?: string;
			url?: string;
			log: string;
		}> = [];

		for (const run of failingRuns) {
			const logResult = await this.runGh([
				'run',
				'view',
				String(run.databaseId),
				'--repo',
				`${directory.githubOwner}/${directory.githubRepo}`,
				'--log-failed',
			]);

			logs.push({
				runId: run.databaseId as number,
				title: run.displayTitle,
				workflowName: run.workflowName,
				url: run.url,
				log: [logResult.stdout.trim(), logResult.stderr.trim()].filter(Boolean).join('\n'),
			});
		}

		return logs;
	}

	async mergeWorkspacePullRequest(workspaceId: string) {
		const workspace = this.eventStore.requireWorkspace(workspaceId);
		const directory = this.eventStore.requireDirectory(workspace.directoryId);
		const prNumber = workspace.pullRequest?.number;
		if (prNumber === undefined) throw new Error('Workspace does not have a pull request');

		// v1 uses GitHub merge commits only; expose strategy later if repo policy requires it.
		const result = await this.runGh([
			'pr',
			'merge',
			String(prNumber),
			'--repo',
			`${directory.githubOwner}/${directory.githubRepo}`,
			'--merge',
		]);

		if (result.exitCode !== 0) {
			throw new Error([result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n'));
		}

		return this.refreshWorkspacePrState(workspaceId);
	}

	async markWorkspacePullRequestReady(workspaceId: string) {
		const workspace = this.eventStore.requireWorkspace(workspaceId);
		const directory = this.eventStore.requireDirectory(workspace.directoryId);
		const prNumber = workspace.pullRequest?.number;
		if (prNumber === undefined) throw new Error('Workspace does not have a pull request');
		if (workspace.pullRequest?.isDraft !== true) {
			throw new Error('Workspace pull request is not a draft');
		}

		const result = await this.runGh([
			'pr',
			'ready',
			String(prNumber),
			'--repo',
			`${directory.githubOwner}/${directory.githubRepo}`,
		]);

		if (result.exitCode !== 0) {
			throw new Error([result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n'));
		}

		return this.refreshWorkspacePrState(workspaceId);
	}
}
