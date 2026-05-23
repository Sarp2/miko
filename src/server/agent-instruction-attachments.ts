import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { getDataDir } from 'src/shared/branding';
import type {
	ChatAttachment,
	PullRequestCommentSnapshot,
	WorkspaceGitSnapshot,
} from 'src/shared/types';
import type { DirectoryRecord, WorkspaceRecord } from './event';

const CREATE_PR_INSTRUCTIONS_FILE_NAME = 'create-pr-instructions.md';
const FAILING_CI_LOGS_FILE_NAME = 'failing-ci-logs.txt';
const SELECTED_REVIEW_COMMENTS_FILE_NAME = 'selected-review-comments.txt';
const INSTRUCTION_FILE_PATTERN =
	/^(?:create-pr|failing-ci|selected-review-comments)-(.+)\.(?:md|txt)$/u;

function getAgentInstructionsDir() {
	return path.join(getDataDir(homedir()), 'agent-instructions');
}

function isWorkspaceInstructionAttachment(fileName: string) {
	return INSTRUCTION_FILE_PATTERN.exec(fileName);
}

export function buildCreatePrInstructionsMarkdown(args: {
	workspaceId: string;
	directoryPath: string;
	workspacePath: string;
	branchName: string;
	githubOwner: string;
	githubRepo: string;
	hasUncommittedChanges: boolean;
	hasPushedCommits?: boolean;
	branchPublishState?: string;
}) {
	const uncommittedLine = args.hasUncommittedChanges
		? 'There are uncommitted changes in this workspace.'
		: 'There are no uncommitted changes currently detected in this workspace.';

	const pushedLine = args.hasPushedCommits
		? 'The current branch appears to have pushed commits on origin.'
		: 'The current branch does not appear to have pushed commits on origin yet.';

	const upstreamLine =
		args.branchPublishState === 'published'
			? 'The current branch appears to be published on origin.'
			: 'There is no published remote branch detected yet.';

	return `The user requested a pull request for this workspace.

Workspace ID: ${args.workspaceId}
Directory: ${args.directoryPath}
Worktree: ${args.workspacePath}
Current branch: ${args.branchName}
Target branch: origin/main
GitHub repository: ${args.githubOwner}/${args.githubRepo}

${uncommittedLine}
${pushedLine}
${upstreamLine}

Follow these steps to create a PR:

- If you have any skills related to creating PRs, invoke them now. Instructions there should take precedence over these instructions.
- Run \`git status\` and \`git diff\` to review uncommitted changes.
- If there are uncommitted changes, commit them. Follow any instructions the user gave you about writing commit messages.
- Push the current branch to origin.
- Run \`git diff origin/main...HEAD\` to review the full PR diff.
- If this repository has previous pull requests, inspect recent PR titles/descriptions and follow the team's existing PR conventions.
- Use \`gh pr create --base main\` to create a PR onto the target branch.
- Keep the title under 80 characters.
- Keep the description under five sentences, unless the user instructed otherwise.
- Describe all meaningful changes in the workspace diff, not only the last message.
- Do not merge the PR.
- Do not rename the branch after creating the PR.

If any of these steps fail, ask the user for help.
`;
}

export async function writeCreatePrInstructionsAttachment(args: {
	workspace: WorkspaceRecord;
	directory: DirectoryRecord;
	git: WorkspaceGitSnapshot;
}): Promise<ChatAttachment> {
	const { workspace, directory, git } = args;
	const instructionsDir = getAgentInstructionsDir();
	await mkdir(instructionsDir, { recursive: true });

	const absolutePath = path.join(instructionsDir, `create-pr-${workspace.id}.md`);
	const markdown = buildCreatePrInstructionsMarkdown({
		workspaceId: workspace.id,
		directoryPath: directory.localPath,
		workspacePath: workspace.localPath,
		branchName: workspace.branchName,
		githubOwner: directory.githubOwner,
		githubRepo: directory.githubRepo,
		hasUncommittedChanges: git.files.length > 0,
		hasPushedCommits: git.hasPushedCommits,
		branchPublishState: git.branchPublishState,
	});

	await Bun.write(absolutePath, markdown);
	const info = await stat(absolutePath);

	return {
		id: `create-pr-${workspace.id}`,
		kind: 'file',
		displayName: CREATE_PR_INSTRUCTIONS_FILE_NAME,
		absolutePath,
		relativePath: CREATE_PR_INSTRUCTIONS_FILE_NAME,
		contentUrl: `file://${absolutePath}`,
		mimeType: 'text/markdown',
		size: info.size,
	};
}

export async function writeFailingCiLogsAttachment(args: {
	workspace: WorkspaceRecord;
	logs: Array<{
		runId: number;
		title?: string;
		workflowName?: string;
		url?: string;
		log: string;
	}>;
}): Promise<ChatAttachment> {
	const instructionsDir = getAgentInstructionsDir();
	await mkdir(instructionsDir, { recursive: true });

	const absolutePath = path.join(instructionsDir, `failing-ci-${args.workspace.id}.txt`);
	const body = args.logs
		.map((entry) =>
			[
				`Run ID: ${entry.runId}`,
				entry.workflowName ? `Workflow: ${entry.workflowName}` : null,
				entry.title ? `Title: ${entry.title}` : null,
				entry.url ? `URL: ${entry.url}` : null,
				'',
				entry.log || 'No failing log output was returned.',
			]
				.filter((line): line is string => line !== null)
				.join('\n'),
		)
		.join('\n\n---\n\n');

	await Bun.write(absolutePath, body || 'No failing CI logs were found.');
	const info = await stat(absolutePath);

	return {
		id: `failing-ci-${args.workspace.id}`,
		kind: 'file',
		displayName: FAILING_CI_LOGS_FILE_NAME,
		absolutePath,
		relativePath: FAILING_CI_LOGS_FILE_NAME,
		contentUrl: `file://${absolutePath}`,
		mimeType: 'text/plain',
		size: info.size,
	};
}

export async function writeSelectedReviewCommentsAttachment(args: {
	workspace: WorkspaceRecord;
	comments: PullRequestCommentSnapshot[];
	prNumber?: number;
	prTitle?: string;
}): Promise<ChatAttachment> {
	const instructionsDir = getAgentInstructionsDir();
	await mkdir(instructionsDir, { recursive: true });

	const absolutePath = path.join(
		instructionsDir,
		`selected-review-comments-${args.workspace.id}.txt`,
	);
	const header = [
		'The user selected these PR review comments to address.',
		args.prNumber ? `PR: #${args.prNumber}${args.prTitle ? ` ${args.prTitle}` : ''}` : null,
		`Workspace ID: ${args.workspace.id}`,
		`Branch: ${args.workspace.branchName}`,
	]
		.filter((line): line is string => line !== null)
		.join('\n');

	const body = args.comments
		.map((comment, index) =>
			[
				`Comment ${index + 1}`,
				`ID: ${comment.id}`,
				comment.author ? `Author: ${comment.author}` : null,
				`Source: ${comment.source}`,
				comment.path ? `File: ${comment.path}${comment.line ? `:${comment.line}` : ''}` : null,
				comment.url ? `URL: ${comment.url}` : null,
				comment.createdAt ? `Created: ${comment.createdAt}` : null,
				comment.updatedAt ? `Updated: ${comment.updatedAt}` : null,
				comment.isBot ? 'Bot: yes' : 'Bot: no',
				'',
				comment.body,
			]
				.filter((line): line is string => line !== null)
				.join('\n'),
		)
		.join('\n\n---\n\n');

	await Bun.write(absolutePath, `${header}\n\n${body}`);
	const info = await stat(absolutePath);

	return {
		id: `selected-review-comments-${args.workspace.id}`,
		kind: 'file',
		displayName: SELECTED_REVIEW_COMMENTS_FILE_NAME,
		absolutePath,
		relativePath: SELECTED_REVIEW_COMMENTS_FILE_NAME,
		contentUrl: `file://${absolutePath}`,
		mimeType: 'text/plain',
		size: info.size,
	};
}

export async function cleanupStaleInstructionAttachments(workspaces: WorkspaceRecord[]) {
	const keepWorkspaceIds = new Set(
		workspaces
			.filter(
				(workspace) =>
					!workspace.removedAt &&
					workspace.visibilityState === 'active' &&
					workspace.reviewState !== 'done' &&
					workspace.reviewState !== 'closed',
			)
			.map((workspace) => workspace.id),
	);
	const instructionsDir = getAgentInstructionsDir();
	const entries = await readdir(instructionsDir, { withFileTypes: true }).catch(() => []);
	let deletedCount = 0;

	await Promise.all(
		entries.map(async (entry) => {
			if (!entry.isFile()) return;
			const match = isWorkspaceInstructionAttachment(entry.name);
			if (!match) return;
			const workspaceId = match[1];
			if (keepWorkspaceIds.has(workspaceId)) return;

			await rm(path.join(instructionsDir, entry.name), { force: true });
			deletedCount += 1;
		}),
	);

	return { deletedCount };
}
