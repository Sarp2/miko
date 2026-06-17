import { afterEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { getDataDir } from 'src/shared/branding';
import type { WorkspaceGitSnapshot } from 'src/shared/types';
import {
	buildCreatePrInstructionsMarkdown,
	cleanupStaleInstructionAttachments,
	writeCreatePrInstructionsAttachment,
	writeFailingCiLogsAttachment,
	writeSelectedReviewCommentsAttachment,
} from './agent-instruction-attachments';
import type { DirectoryRecord, WorkspaceRecord } from './event';

const originalRuntimeProfile = process.env.MIKO_RUNTIME_PROFILE;
const writtenFiles: string[] = [];

afterEach(async () => {
	if (originalRuntimeProfile === undefined) {
		delete process.env.MIKO_RUNTIME_PROFILE;
	} else {
		process.env.MIKO_RUNTIME_PROFILE = originalRuntimeProfile;
	}

	await Promise.all(writtenFiles.splice(0).map((file) => rm(file, { force: true })));
});

function useDevDataRoot() {
	process.env.MIKO_RUNTIME_PROFILE = 'dev';
}

function instructionPath(fileName: string) {
	return path.join(getDataDir(homedir()), 'agent-instructions', fileName);
}

function directory(overrides: Partial<DirectoryRecord> = {}): DirectoryRecord {
	return {
		id: 'directory-1',
		localPath: '/repo/miko',
		title: 'Miko',
		githubOwner: 'sarp',
		githubRepo: 'miko',
		defaultBranchName: 'main',
		createdAt: 100,
		updatedAt: 100,
		...overrides,
	};
}

function workspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
	return {
		id: 'workspace-test-attachment',
		directoryId: 'directory-1',
		localPath: '/repo/miko/atlas',
		branchName: 'atlas',
		setupState: 'ready',
		reviewState: 'in_progress',
		visibilityState: 'active',
		hasUnreadAgentResult: false,
		createdAt: 100,
		updatedAt: 100,
		...overrides,
	};
}

function gitSnapshot(overrides: Partial<WorkspaceGitSnapshot> = {}): WorkspaceGitSnapshot {
	return {
		status: 'ready',
		branchName: 'atlas',
		defaultBranchName: 'main',
		hasOriginRemote: true,
		originRepoSlug: 'sarp/miko',
		hasUpstream: false,
		files: [],
		hasPushedCommits: false,
		branchPublishState: 'local_only',
		branchHistory: { entries: [] },
		...overrides,
	};
}

describe('buildCreatePrInstructionsMarkdown', () => {
	test('renders workspace/git context and the expected PR creation rules', () => {
		const markdown = buildCreatePrInstructionsMarkdown({
			workspaceId: 'workspace-1',
			directoryPath: '/repo/miko',
			workspacePath: '/repo/miko/atlas',
			branchName: 'atlas',
			githubOwner: 'sarp',
			githubRepo: 'miko',
			hasUncommittedChanges: true,
			hasPushedCommits: true,
			branchPublishState: 'published',
		});

		expect(markdown).toContain('Workspace ID: workspace-1');
		expect(markdown).toContain('Worktree: /repo/miko/atlas');
		expect(markdown).toContain('Current branch: atlas');
		expect(markdown).toContain('GitHub repository: sarp/miko');
		expect(markdown).toContain('There are uncommitted changes in this workspace.');
		expect(markdown).toContain('The current branch appears to have pushed commits on origin.');
		expect(markdown).toContain("follow the team's existing PR conventions");
		expect(markdown).toContain('Do not merge the PR.');
		expect(markdown).toContain('Do not rename the branch after creating the PR.');
	});
});

describe('writeCreatePrInstructionsAttachment', () => {
	test('writes a stable markdown attachment for a workspace PR instruction turn', async () => {
		useDevDataRoot();
		const filePath = instructionPath('create-pr-workspace-test-attachment.md');
		writtenFiles.push(filePath);

		const attachment = await writeCreatePrInstructionsAttachment({
			workspace: workspace(),
			directory: directory(),
			git: gitSnapshot({
				files: [{ path: 'src/app.ts' } as WorkspaceGitSnapshot['files'][number]],
			}),
		});

		expect(attachment).toMatchObject({
			id: 'create-pr-workspace-test-attachment',
			kind: 'file',
			displayName: 'create-pr-instructions.md',
			relativePath: 'create-pr-instructions.md',
			mimeType: 'text/markdown',
			absolutePath: filePath,
			contentUrl: '/api/agent-instructions/create-pr-workspace-test-attachment.md/content',
		});
		expect(attachment.size).toBeGreaterThan(0);
		expect(await Bun.file(filePath).text()).toContain('The user requested a pull request');
	});
});

describe('writeFailingCiLogsAttachment', () => {
	test('writes failed CI logs with run metadata and fallback output', async () => {
		useDevDataRoot();
		const filePath = instructionPath('failing-ci-workspace-test-attachment.txt');
		writtenFiles.push(filePath);

		const attachment = await writeFailingCiLogsAttachment({
			workspace: workspace(),
			logs: [
				{
					runId: 101,
					workflowName: 'CI',
					title: 'Tests failed',
					url: 'https://github.com/sarp/miko/actions/runs/101',
					log: 'expected true to be false',
				},
				{ runId: 102, log: '' },
			],
		});

		expect(attachment).toMatchObject({
			id: 'failing-ci-workspace-test-attachment',
			displayName: 'failing-ci-logs.txt',
			mimeType: 'text/plain',
			absolutePath: filePath,
		});
		const body = await Bun.file(filePath).text();
		expect(body).toContain('Run ID: 101');
		expect(body).toContain('Workflow: CI');
		expect(body).toContain('expected true to be false');
		expect(body).toContain('---');
		expect(body).toContain('No failing log output was returned.');
	});
});

describe('writeSelectedReviewCommentsAttachment', () => {
	test('writes only the comments selected by the user with PR and file context', async () => {
		useDevDataRoot();
		const filePath = instructionPath('selected-review-comments-workspace-test-attachment.txt');
		writtenFiles.push(filePath);

		const attachment = await writeSelectedReviewCommentsAttachment({
			workspace: workspace(),
			prNumber: 12,
			prTitle: 'Add workspace model',
			comments: [
				{
					id: 'comment-1',
					author: 'coderabbitai[bot]',
					body: 'Please handle the null case.',
					url: 'https://github.com/sarp/miko/pull/12#discussion_r1',
					path: 'src/server/pr-manager.ts',
					line: 42,
					isBot: true,
					source: 'review',
					createdAt: '2026-01-01T00:00:00Z',
					updatedAt: '2026-01-01T01:00:00Z',
				},
			],
		});

		expect(attachment).toMatchObject({
			id: 'selected-review-comments-workspace-test-attachment',
			displayName: 'selected-review-comments.txt',
			mimeType: 'text/plain',
			absolutePath: filePath,
		});
		const body = await Bun.file(filePath).text();
		expect(body).toContain('The user selected these PR review comments to address.');
		expect(body).toContain('PR: #12 Add workspace model');
		expect(body).toContain('Branch: atlas');
		expect(body).toContain('File: src/server/pr-manager.ts:42');
		expect(body).toContain('Bot: yes');
		expect(body).toContain('Please handle the null case.');
	});
});

describe('cleanupStaleInstructionAttachments', () => {
	test('deletes attachments for inactive, terminal, removed, or unknown workspaces only', async () => {
		useDevDataRoot();
		const activeWorkspace = workspace({ id: 'active-workspace' });
		const archivedWorkspace = workspace({
			id: 'archived-workspace',
			visibilityState: 'archived',
		});
		const doneWorkspace = workspace({ id: 'done-workspace', reviewState: 'done' });
		const removedWorkspace = workspace({ id: 'removed-workspace', removedAt: 200 });
		const files = [
			'create-pr-active-workspace.md',
			'failing-ci-archived-workspace.txt',
			'selected-review-comments-done-workspace.txt',
			'create-pr-removed-workspace.md',
			'failing-ci-unknown-workspace.txt',
			'notes.txt',
		];
		for (const file of files) {
			const filePath = instructionPath(file);
			writtenFiles.push(filePath);
			await Bun.write(filePath, file);
		}

		const result = await cleanupStaleInstructionAttachments([
			activeWorkspace,
			archivedWorkspace,
			doneWorkspace,
			removedWorkspace,
		]);

		expect(result).toEqual({ deletedCount: 4 });
		await expect(Bun.file(instructionPath('create-pr-active-workspace.md')).text()).resolves.toBe(
			'create-pr-active-workspace.md',
		);
		await expect(Bun.file(instructionPath('notes.txt')).text()).resolves.toBe('notes.txt');
		await expect(
			Bun.file(instructionPath('failing-ci-archived-workspace.txt')).text(),
		).rejects.toThrow();
		await expect(
			Bun.file(instructionPath('selected-review-comments-done-workspace.txt')).text(),
		).rejects.toThrow();
		await expect(
			Bun.file(instructionPath('create-pr-removed-workspace.md')).text(),
		).rejects.toThrow();
		await expect(
			Bun.file(instructionPath('failing-ci-unknown-workspace.txt')).text(),
		).rejects.toThrow();
	});
});
