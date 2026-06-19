import { describe, expect, test } from 'bun:test';
import type {
	WorkspaceDiffFile,
	WorkspaceGitHubSnapshot,
	WorkspaceSnapshot,
} from '../../shared/types';
import { selectWorkspaceChangeFiles } from './workspace-diff-files';

function file(path: string, patchDigest = path): WorkspaceDiffFile {
	return {
		path,
		changeType: 'modified',
		isUntracked: false,
		additions: 1,
		deletions: 0,
		patchDigest,
	};
}

function snapshot({
	githubStatus = 'none',
	githubFiles,
	pullRequestFiles = [],
	localFiles = [],
}: {
	githubStatus?: WorkspaceGitHubSnapshot['status'];
	githubFiles?: WorkspaceDiffFile[];
	pullRequestFiles?: WorkspaceDiffFile[];
	localFiles?: WorkspaceDiffFile[];
}): WorkspaceSnapshot {
	return {
		workspace: {
			id: 'workspace-1',
			directoryId: 'directory-1',
			localPath: '/repo/worktree',
			branchName: 'feature/work',
			setupState: 'ready',
			reviewState: 'in_review',
			visibilityState: 'active',
			hasUnreadAgentResult: false,
			createdAt: 1,
			updatedAt: 1,
		},
		primaryLabel: 'feature/work',
		healthState: 'healthy',
		git: {
			status: 'ready',
			files: localFiles,
			pullRequestFiles,
		},
		github: {
			status: githubStatus,
			owner: 'sarp',
			repo: 'miko',
			...(githubFiles ? { files: githubFiles } : {}),
			comments: [],
			checks: [],
		},
		sessions: [],
		hasActiveSession: false,
		hasUnreadAgentResult: false,
	};
}

describe('selectWorkspaceChangeFiles', () => {
	test('uses local dirty files when there is no pull request', () => {
		expect(
			selectWorkspaceChangeFiles(snapshot({ localFiles: [file('b.ts')] })).map((item) => item.path),
		).toEqual(['b.ts']);
	});

	test('uses PR files for PR workspaces and merges local dirty files deterministically', () => {
		expect(
			selectWorkspaceChangeFiles(
				snapshot({
					githubStatus: 'merged',
					githubFiles: [file('z.ts'), file('a.ts', 'old')],
					localFiles: [file('a.ts', 'new'), file('m.ts')],
				}),
			).map((item) => `${item.path}:${item.patchDigest}`),
		).toEqual(['a.ts:new', 'm.ts:m.ts', 'z.ts:z.ts']);
	});

	test('falls back to observed branch PR files when GitHub files are absent', () => {
		expect(
			selectWorkspaceChangeFiles(
				snapshot({ githubStatus: 'open', pullRequestFiles: [file('branch.ts')] }),
			).map((item) => item.path),
		).toEqual(['branch.ts']);
	});
});
