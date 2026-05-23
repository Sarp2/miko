import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceGitHubSnapshot, WorkspaceHealthState } from 'src/shared/types';
import { type DiffStore, extractGitHubRepoSlug, runGit } from './diff-store';
import type { SessionRecord, WorkspaceRecord } from './event';
import type { EventStore } from './event-store';
import type { PrManager } from './pr-manager';

const WORKSPACE_CODE_NAMES = [
	'atlas',
	'orion',
	'vega',
	'argo',
	'sirius',
	'lyra',
	'nova',
	'apollo',
	'helios',
	'selene',
	'phoenix',
	'pegasus',
	'perseus',
	'oberon',
	'europa',
	'callisto',
	'triton',
	'janus',
	'hyperion',
	'prometheus',
	'daedalus',
	'icarus',
	'hermes',
	'athena',
	'artemis',
	'aurora',
];

const PR_REFRESH_COOLDOWN_MS = 60 * 1000;
const MAX_WORKSPACE_NAME_SUFFIX = 100;

export type WorkspaceTurnIntent =
	| 'commit_and_push'
	| 'pull_latest_main'
	| 'create_pr'
	| 'fix_ci'
	| 'address_review_comments';

export interface WorkspaceCreateResult {
	workspace: WorkspaceRecord;
	session: SessionRecord | null;
}

interface WorkspaceManagerDeps {
	diffStore?: Pick<DiffStore, 'refreshWorkspaceGitSnapshot'>;
	prManager?: Pick<PrManager, 'getWorkspaceGitHubSnapshot' | 'refreshWorkspacePrState'>;
}

async function pathExists(localPath: string) {
	try {
		await stat(localPath);
		return true;
	} catch {
		return false;
	}
}

async function resolvePhysicalPath(localPath: string) {
	return realpath(localPath).catch(() => path.resolve(localPath));
}

function sanitizeBranchName(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._/-]+/gu, '-')
		.replace(/\/+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.replace(/\.lock$/u, '');
}

function formatGitFailure(result: Awaited<ReturnType<typeof runGit>>) {
	return [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
}

function assertGitSuccess(result: Awaited<ReturnType<typeof runGit>>, message: string) {
	if (result.exitCode === 0) return;
	const detail = formatGitFailure(result);
	throw new Error(detail ? `${message}: ${detail}` : message);
}

async function getExistingLocalBranches(repoPath: string) {
	const result = await runGit(
		['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
		repoPath,
	);

	assertGitSuccess(result, 'Git could not list local branches');

	return new Set(
		result.stdout
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.filter(Boolean),
	);
}

async function getExistingWorktreePaths(repoPath: string) {
	const result = await runGit(['worktree', 'list', '--porcelain'], repoPath);
	assertGitSuccess(result, 'Git could not list worktrees');

	return new Set(
		result.stdout
			.split(/\r?\n/u)
			.filter((line) => line.startsWith('worktree '))
			.map((line) => path.resolve(line.slice('worktree '.length).trim())),
	);
}

async function isValidBranchName(repoPath: string, branchName: string) {
	const result = await runGit(['check-ref-format', '--branch', branchName], repoPath);
	return result.exitCode === 0;
}

async function branchHasUpstream(repoPath: string) {
	const result = await runGit(
		['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
		repoPath,
	);
	return result.exitCode === 0;
}

async function remoteBranchExists(repoPath: string, branchName: string) {
	const result = await runGit(
		['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branchName}`],
		repoPath,
	);
	return result.exitCode === 0;
}

async function getOriginRemoteUrl(repoPath: string) {
	const result = await runGit(['remote', 'get-url', 'origin'], repoPath);
	return result.exitCode === 0 ? result.stdout.trim() : null;
}

export class WorkspaceManager {
	private readonly diffStore: WorkspaceManagerDeps['diffStore'];
	private readonly prManager: WorkspaceManagerDeps['prManager'];
	private readonly pendingTurnIntentBySessionId = new Map<string, WorkspaceTurnIntent>();
	private readonly lastPrRefreshAtByWorkspaceId = new Map<string, number>();

	constructor(
		private readonly eventStore: EventStore,
		deps: WorkspaceManagerDeps = {},
	) {
		this.diffStore = deps.diffStore;
		this.prManager = deps.prManager;
	}

	private getWorktreePath(directoryPath: string, branchName: string) {
		return path.join(directoryPath, branchName);
	}

	private async generateWorkspaceIdentity(directoryId: string, directoryPath: string) {
		const metadataBranches = new Set(
			this.eventStore
				.listWorkspacesByDirectory(directoryId)
				.map((workspace) => workspace.branchName),
		);

		const metadataPaths = new Set(
			this.eventStore.listWorkspaces().map((workspace) => path.resolve(workspace.localPath)),
		);

		const localBranches = await getExistingLocalBranches(directoryPath);
		const worktreePaths = await getExistingWorktreePaths(directoryPath);

		for (const codeName of WORKSPACE_CODE_NAMES) {
			for (let suffix = 1; suffix <= MAX_WORKSPACE_NAME_SUFFIX; suffix++) {
				const branchName = suffix === 1 ? codeName : `${codeName}-${suffix}`;
				const localPath = this.getWorktreePath(directoryPath, branchName);
				const resolvedPath = path.resolve(localPath);

				if (metadataBranches.has(branchName) || localBranches.has(branchName)) continue;
				if (metadataPaths.has(resolvedPath) || worktreePaths.has(resolvedPath)) continue;

				if (await pathExists(resolvedPath)) continue;
				if (!(await isValidBranchName(directoryPath, branchName))) continue;

				return { branchName, localPath: resolvedPath };
			}
		}

		throw new Error('Could not generate a unique workspace branch and worktree path');
	}

	private async excludeWorktreePathFromSource(directoryPath: string, branchName: string) {
		const gitPath = await runGit(['rev-parse', '--git-path', 'info/exclude'], directoryPath);
		if (gitPath.exitCode !== 0) return false;

		const excludePath = path.isAbsolute(gitPath.stdout.trim())
			? gitPath.stdout.trim()
			: path.join(directoryPath, gitPath.stdout.trim());

		const entry = `/${branchName}/`;
		const current = await readFile(excludePath, 'utf-8').catch(() => '');

		const lines = current.split(/\r?\n/u).map((line) => line.trim());
		if (lines.includes(entry)) return false;

		const prefix = current.length === 0 || current.endsWith('\n') ? current : `${current}\n`;
		await writeFile(excludePath, `${prefix}${entry}\n`, 'utf-8');
		return true;
	}

	private async removeWorktreePathFromSourceExclude(directoryPath: string, branchName: string) {
		const gitPath = await runGit(['rev-parse', '--git-path', 'info/exclude'], directoryPath);
		if (gitPath.exitCode !== 0) return;

		const excludePath = path.isAbsolute(gitPath.stdout.trim())
			? gitPath.stdout.trim()
			: path.join(directoryPath, gitPath.stdout.trim());

		const entry = `/${branchName}/`;
		const current = await readFile(excludePath, 'utf-8').catch(() => '');
		if (!current) return;

		const next = current
			.split(/\r?\n/u)
			.filter((line) => line.trim() !== entry)
			.join('\n');
		await writeFile(excludePath, next ? `${next}\n` : '', 'utf-8');
	}

	private async resolveBaseRef(directoryPath: string) {
		await runGit(['fetch', 'origin', 'main', '--prune'], directoryPath);

		const originMain = await runGit(
			['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'],
			directoryPath,
		);

		if (originMain.exitCode === 0) return 'origin/main';

		const localMain = await runGit(
			['rev-parse', '--verify', '--quiet', 'refs/heads/main'],
			directoryPath,
		);

		if (localMain.exitCode === 0) return 'main';

		throw new Error('Directory must have a main branch before creating a workspace');
	}

	async refreshWorkspacePrStage(
		workspaceId: string,
		options?: { force?: boolean },
	): Promise<{ refreshed: boolean; snapshot: WorkspaceGitHubSnapshot | null }> {
		if (!this.prManager) return { refreshed: false, snapshot: null };

		const now = Date.now();
		const lastRefreshedAt = this.lastPrRefreshAtByWorkspaceId.get(workspaceId) ?? 0;
		if (!options?.force && now - lastRefreshedAt < PR_REFRESH_COOLDOWN_MS) {
			return {
				refreshed: false,
				snapshot: this.prManager.getWorkspaceGitHubSnapshot(workspaceId),
			};
		}

		const snapshot = await this.prManager.refreshWorkspacePrState(workspaceId);
		this.lastPrRefreshAtByWorkspaceId.set(workspaceId, Date.now());
		return { refreshed: true, snapshot };
	}

	markWorkspaceInstructionTurnStarted(args: {
		sessionId: string;
		workspaceId: string;
		intent: WorkspaceTurnIntent;
	}) {
		const session = this.eventStore.requireSession(args.sessionId);
		if (session.workspaceId !== args.workspaceId) {
			throw new Error('Session does not belong to workspace');
		}

		if (
			args.intent !== 'commit_and_push' &&
			args.intent !== 'pull_latest_main' &&
			args.intent !== 'create_pr' &&
			args.intent !== 'fix_ci' &&
			args.intent !== 'address_review_comments'
		) {
			throw new Error('Unknown workspace instruction turn intent');
		}

		this.pendingTurnIntentBySessionId.set(args.sessionId, args.intent);
	}

	clearWorkspaceInstructionTurn(sessionId: string) {
		this.pendingTurnIntentBySessionId.delete(sessionId);
	}

	async handleWorkspaceTurnSettled(args: { sessionId: string }): Promise<{ changed: boolean }> {
		const intent = this.pendingTurnIntentBySessionId.get(args.sessionId);
		this.pendingTurnIntentBySessionId.delete(args.sessionId);

		const session = this.eventStore.getSession(args.sessionId);
		if (!session) return { changed: false };

		const workspace = this.eventStore.getWorkspace(session.workspaceId);
		if (!workspace) return { changed: false };

		let changed = false;

		if (this.diffStore) {
			try {
				changed =
					(await this.diffStore.refreshWorkspaceGitSnapshot(workspace.id, workspace.localPath)) ||
					changed;
			} catch (error) {
				console.error('[workspace-manager] failed to refresh workspace git snapshot', {
					workspaceId: workspace.id,
					error,
				});
			}
		}

		const shouldRefreshPrStage =
			intent === 'create_pr' ||
			intent === 'fix_ci' ||
			intent === 'address_review_comments' ||
			workspace.reviewState === 'in_review';
		if (shouldRefreshPrStage) {
			try {
				const prResult = await this.refreshWorkspacePrStage(workspace.id, {
					force:
						intent === 'create_pr' || intent === 'fix_ci' || intent === 'address_review_comments',
				});
				changed = prResult.refreshed || changed;
			} catch (error) {
				console.error('[workspace-manager] failed to refresh workspace PR stage', {
					workspaceId: workspace.id,
					error,
				});
			}
		}

		return { changed };
	}

	async getWorkspaceHealthState(workspaceId: string): Promise<WorkspaceHealthState> {
		const workspace = this.eventStore.requireWorkspace(workspaceId);
		const directory = this.eventStore.requireDirectory(workspace.directoryId);

		if (!(await pathExists(directory.localPath))) return 'source_missing';
		if (!(await pathExists(workspace.localPath))) return 'workspace_missing';

		const worktreeTopLevel = await runGit(['rev-parse', '--show-toplevel'], workspace.localPath);
		if (worktreeTopLevel.exitCode !== 0) return 'git_invalid';
		const [actualTopLevel, expectedTopLevel] = await Promise.all([
			resolvePhysicalPath(worktreeTopLevel.stdout.trim()),
			resolvePhysicalPath(workspace.localPath),
		]);
		if (actualTopLevel !== expectedTopLevel) return 'worktree_mismatch';

		const currentBranch = await runGit(['branch', '--show-current'], workspace.localPath);
		const branchName = currentBranch.stdout.trim();
		if (!branchName) return 'detached_head';
		if (branchName !== workspace.branchName) return 'branch_missing';

		const originSlug = extractGitHubRepoSlug(await getOriginRemoteUrl(workspace.localPath));
		const expectedSlug = `${directory.githubOwner}/${directory.githubRepo}`;
		if (originSlug !== expectedSlug) return 'repo_mismatch';

		return 'healthy';
	}

	async createWorkspace(directoryId: string): Promise<WorkspaceCreateResult> {
		const directory = this.eventStore.requireDirectory(directoryId);
		const identity = await this.generateWorkspaceIdentity(directory.id, directory.localPath);
		const workspace = await this.eventStore.createWorkspace({
			directoryId,
			localPath: identity.localPath,
			branchName: identity.branchName,
		});

		let excludeEntryWritten = false;

		try {
			await mkdir(path.dirname(identity.localPath), { recursive: true });
			excludeEntryWritten = await this.excludeWorktreePathFromSource(
				directory.localPath,
				identity.branchName,
			);
			const baseRef = await this.resolveBaseRef(directory.localPath);
			const result = await runGit(
				['worktree', 'add', '-b', identity.branchName, '--no-track', identity.localPath, baseRef],
				directory.localPath,
			);

			if (result.exitCode !== 0) {
				throw new Error(formatGitFailure(result) || 'Git could not create the workspace worktree');
			}

			await this.eventStore.markWorkspaceSetupCompleted(workspace.id);
			const session = await this.eventStore.createSession(workspace.id);
			await this.diffStore
				?.refreshWorkspaceGitSnapshot(workspace.id, identity.localPath)
				.catch((error) => {
					console.error('[workspace-manager] failed to refresh new workspace git snapshot', {
						workspaceId: workspace.id,
						error,
					});
				});
			return { workspace: this.eventStore.requireWorkspace(workspace.id), session };
		} catch (error) {
			if (excludeEntryWritten) {
				await this.removeWorktreePathFromSourceExclude(
					directory.localPath,
					identity.branchName,
				).catch(() => {});
			}
			const message = error instanceof Error ? error.message : String(error);
			await this.eventStore.markWorkspaceSetupFailed(workspace.id, message);
			return { workspace: this.eventStore.requireWorkspace(workspace.id), session: null };
		}
	}

	async renameWorkspaceBranch(workspaceId: string, nextBranchName: string) {
		const workspace = this.eventStore.requireWorkspace(workspaceId);
		if (workspace.reviewState !== 'in_progress' || workspace.pullRequest !== undefined) {
			throw new Error('Cannot rename a workspace branch after PR creation');
		}

		const branchName = sanitizeBranchName(nextBranchName);
		if (!branchName) throw new Error('Branch name is required');
		if (workspace.branchName === branchName) return workspace;

		const directory = this.eventStore.requireDirectory(workspace.directoryId);
		const currentBranch = await runGit(['branch', '--show-current'], workspace.localPath);
		if (currentBranch.stdout.trim() !== workspace.branchName) {
			throw new Error('Workspace worktree is not on the expected branch');
		}

		if (
			(await branchHasUpstream(workspace.localPath)) ||
			(await remoteBranchExists(directory.localPath, workspace.branchName))
		) {
			throw new Error('Cannot rename a workspace branch after it has been pushed');
		}

		if (!(await isValidBranchName(directory.localPath, branchName))) {
			throw new Error('Branch name is not valid');
		}

		if (
			this.eventStore
				.listWorkspacesByDirectory(directory.id)
				.some((candidate) => candidate.id !== workspace.id && candidate.branchName === branchName)
		) {
			throw new Error('Workspace branch is already in use for this directory');
		}

		const localBranches = await getExistingLocalBranches(directory.localPath);
		if (localBranches.has(branchName)) {
			throw new Error('A local branch with this name already exists');
		}

		const result = await runGit(['branch', '-m', branchName], workspace.localPath);
		if (result.exitCode !== 0) {
			throw new Error(formatGitFailure(result) || 'Git could not rename the workspace branch');
		}

		try {
			await this.eventStore.setWorkspaceBranch(workspace.id, branchName);
		} catch (error) {
			const rollback = await runGit(['branch', '-m', workspace.branchName], workspace.localPath);
			if (rollback.exitCode !== 0) {
				console.error('[workspace-manager] failed to rollback workspace branch rename', {
					workspaceId: workspace.id,
					fromBranchName: branchName,
					toBranchName: workspace.branchName,
					error: formatGitFailure(rollback),
				});
			}
			throw error;
		}

		await this.diffStore?.refreshWorkspaceGitSnapshot(workspace.id, workspace.localPath);
		return this.eventStore.requireWorkspace(workspace.id);
	}
}
