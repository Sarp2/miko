import type {
	PullRequestCheckSnapshot,
	PullRequestCommentSnapshot,
	WorkspaceGitHubSnapshot,
} from 'src/shared/types';
import { runCommand } from './diff-store';
import type { WorkspaceRecord } from './event';
import type { EventStore } from './event-store';

type GhResult = Awaited<ReturnType<typeof runCommand>>;

interface PrManagerDeps {
	runGh?: (args: string[]) => Promise<GhResult>;
}

interface GitHubPullRequestSearchItem {
	number?: number;
	title?: string;
	url?: string;
	state?: string;
	isDraft?: boolean;
	headRefName?: string;
	baseRefName?: string;
	createdAt?: string;
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
	url?: string;
	state?: string;
	mergeStateStatus?: string;
	isDraft?: boolean;
	headRefName?: string;
	baseRefName?: string;
	createdAt?: string;
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
	statusCheckRollup?: GitHubPullRequestCheck[];
}

function parseJson<T>(value: string): T | null {
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

function normalizePrStatus(state: string | undefined): WorkspaceGitHubSnapshot['status'] {
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

function mapComments(pr: GitHubPullRequestView): PullRequestCommentSnapshot[] {
	return [...mapIssueComments(pr), ...mapReviewComments(pr)];
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
		comments: [],
		checks: [],
		lastRefreshedAt: Date.now(),
	};
}

export class PrManager {
	private readonly snapshots = new Map<string, WorkspaceGitHubSnapshot>();
	private readonly runGhCommand: (args: string[]) => Promise<GhResult>;

	constructor(
		private readonly eventStore: EventStore,
		deps: PrManagerDeps = {},
	) {
		this.runGhCommand = deps.runGh ?? ((args) => runCommand(['gh', ...args]));
	}

	getWorkspaceGitHubSnapshot(workspaceId: string) {
		return this.snapshots.get(workspaceId) ?? null;
	}

	private async runGh(args: string[]) {
		return this.runGhCommand(args);
	}

	private async findPrForBranch(owner: string, repo: string, branchName: string) {
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

	private async viewPr(owner: string, repo: string, prNumber: number) {
		const result = await this.runGh([
			'pr',
			'view',
			String(prNumber),
			'--repo',
			`${owner}/${repo}`,
			'--json',
			'number,title,body,url,state,mergeStateStatus,isDraft,headRefName,baseRefName,createdAt,additions,deletions,comments,reviews,statusCheckRollup',
		]);

		if (result.exitCode !== 0) {
			throw new Error(
				[result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n') ||
					'GitHub PR view failed',
			);
		}
		return parseJson<GitHubPullRequestView>(result.stdout);
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
		const status = normalizePrStatus(source.state);
		const checks = detailed ? mapChecks(detailed) : [];
		const createdAt = parseGitHubTimestamp(source.createdAt);

		const snapshot: WorkspaceGitHubSnapshot = {
			status,
			owner,
			repo,
			prNumber: pr.number,
			title: source.title,
			body: detailed?.body,
			url: source.url,
			headRefName: source.headRefName,
			baseRefName: source.baseRefName,
			ciStatus: deriveCiStatus(checks),
			unresolvedCommentCount: undefined,
			additions: detailed?.additions,
			deletions: detailed?.deletions,
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
				url: source.url,
				headRefName: source.headRefName,
				baseRefName: source.baseRefName,
				ciStatus: snapshot.ciStatus,
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
			} catch {
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
}
