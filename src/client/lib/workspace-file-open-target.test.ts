import { describe, expect, test } from 'bun:test';
import type { ChatAttachment, PromptPart } from '../../shared/types';
import {
	isPathInsideWorkspace,
	resolveChangedFileDiffOpenTarget,
	resolvePromptPartFileOpenTarget,
	resolveTranscriptReadFileOpenTarget,
	resolveWorkspaceFileOpenTarget,
	workspaceFilePath,
} from './workspace-file-open-target';

const workspaceRoot = '/Users/sarp/conductor/workspaces/miko/hong-kong';

function attachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
	return {
		id: 'att1',
		kind: 'file',
		displayName: 'notes.md',
		absolutePath: '/Users/sarp/Desktop/notes.md',
		relativePath: 'notes.md',
		contentUrl: '/api/attachments/att1/content',
		mimeType: 'text/markdown',
		size: 42,
		...overrides,
	};
}

describe('workspace file path classification', () => {
	test('treats repo-relative paths and absolute paths under the workspace as workspace files', () => {
		expect(workspaceFilePath('src/app.ts', workspaceRoot)).toBe('src/app.ts');
		expect(workspaceFilePath(`${workspaceRoot}/src/app.ts`, workspaceRoot)).toBe('src/app.ts');
		expect(isPathInsideWorkspace(`${workspaceRoot}/src/app.ts`, workspaceRoot)).toBe(true);
	});

	test('does not classify absolute paths outside the workspace as workspace files', () => {
		const path = '/Users/sarp/.claude/plans/can-you-add-a-jolly-goose.md';
		expect(workspaceFilePath(path, workspaceRoot)).toBeNull();
		expect(isPathInsideWorkspace(path, workspaceRoot)).toBe(false);
	});

	test('requires a workspace root before trusting absolute paths', () => {
		expect(workspaceFilePath('/Users/sarp/project/src/app.ts')).toBeNull();
		expect(isPathInsideWorkspace('/Users/sarp/project/src/app.ts')).toBe(false);
	});
});

describe('resolveWorkspaceFileOpenTarget', () => {
	test('opens workspace files with a repo-relative path and source session', () => {
		expect(
			resolveWorkspaceFileOpenTarget({
				path: `${workspaceRoot}/README.md`,
				workspaceRoot,
				sourceSessionId: 'session1',
			}),
		).toEqual({
			kind: 'page',
			page: {
				type: 'file',
				source: 'workspace_file',
				path: 'README.md',
				title: 'README.md',
				sourceSessionId: 'session1',
			},
		});
	});

	test('returns an explicit external target for absolute files outside the workspace', () => {
		expect(
			resolveWorkspaceFileOpenTarget({
				path: '/Users/sarp/.claude/plans/plan.md',
				workspaceRoot,
				sourceSessionId: 'session1',
			}),
		).toEqual({
			kind: 'page',
			page: {
				type: 'file',
				source: 'external_file',
				path: '/Users/sarp/.claude/plans/plan.md',
				title: 'plan.md',
				sourceSessionId: 'session1',
			},
		});
	});
});

describe('resolvePromptPartFileOpenTarget', () => {
	test('opens mention parts through the workspace-file classifier', () => {
		const part: Extract<PromptPart, { type: 'mention' }> = { type: 'mention', path: 'src/app.ts' };
		expect(resolvePromptPartFileOpenTarget({ part, workspaceRoot })).toMatchObject({
			kind: 'page',
			page: { source: 'workspace_file', path: 'src/app.ts' },
		});
	});

	test('opens attachment parts as generated attachments', () => {
		const part: Extract<PromptPart, { type: 'attachment' }> = {
			type: 'attachment',
			attachmentId: 'att1',
		};
		expect(resolvePromptPartFileOpenTarget({ part, attachments: [attachment()] })).toEqual({
			kind: 'attachment',
			attachment: attachment(),
			page: {
				type: 'file',
				source: 'generated_attachment',
				sourceId: 'att1',
				title: 'notes.md',
				attachment: attachment(),
			},
		});
	});

	test('describes pasted text parts as legacy pasted text files', () => {
		const part: Extract<PromptPart, { type: 'pasted_text' }> = {
			type: 'pasted_text',
			id: 'paste1',
			text: 'hello',
		};
		expect(resolvePromptPartFileOpenTarget({ part, sourceSessionId: 'session1' })).toEqual({
			kind: 'pasted_text',
			id: 'paste1',
			text: 'hello',
			page: {
				type: 'file',
				source: 'pasted_text',
				sourceId: 'paste1',
				title: 'Pasted text',
				sourceSessionId: 'session1',
			},
		});
	});

	test('keeps missing attachment tokens unavailable instead of guessing from a path', () => {
		const part: Extract<PromptPart, { type: 'attachment' }> = {
			type: 'attachment',
			attachmentId: 'missing',
		};
		expect(resolvePromptPartFileOpenTarget({ part })).toEqual({
			kind: 'unavailable',
			reason: 'Attachment is no longer available.',
		});
	});
});

describe('transcript open targets', () => {
	test('opens transcript changed files as transcript diffs when session context exists', () => {
		expect(
			resolveChangedFileDiffOpenTarget({
				path: `${workspaceRoot}/README.md`,
				workspaceRoot,
				sourceSessionId: 'session1',
				turnId: 'turn1',
			}),
		).toEqual({
			kind: 'page',
			page: {
				type: 'diff',
				path: 'README.md',
				source: 'transcript',
				sourceSessionId: 'session1',
				turnId: 'turn1',
			},
		});
	});

	test('does not send external read_file paths to workspace.readFile', () => {
		expect(
			resolveTranscriptReadFileOpenTarget({
				path: '/Users/sarp/.claude/plans/plan.md',
				workspaceRoot,
			}),
		).toEqual({
			kind: 'page',
			page: {
				type: 'file',
				source: 'external_file',
				path: '/Users/sarp/.claude/plans/plan.md',
				title: 'plan.md',
			},
		});
	});
});
