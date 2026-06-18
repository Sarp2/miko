import type { ChatAttachment, PromptPart } from '../../shared/types';
import type { WorkspacePage } from '../stores/ui-store';
import { PASTED_TEXT_LABEL } from './prompt-parts';
import { basename, toRelativePath } from './relative-path';

type FilePage = Extract<WorkspacePage, { type: 'file' }>;
type DiffPage = Extract<WorkspacePage, { type: 'diff' }>;

export type WorkspaceFileOpenTarget =
	| { kind: 'page'; page: FilePage }
	| { kind: 'attachment'; page: FilePage; attachment: ChatAttachment }
	| { kind: 'pasted_text'; page: FilePage; id: string; text: string }
	| { kind: 'unavailable'; reason: string };

export type WorkspaceDiffOpenTarget =
	| { kind: 'page'; page: DiffPage | FilePage }
	| { kind: 'unavailable'; reason: string };

export function isAbsoluteFilePath(path: string): boolean {
	return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

function normalizePath(path: string): string {
	return path.replace(/\\+/g, '/').replace(/\/+/g, '/');
}

function normalizeWorkspaceRoot(workspaceRoot?: string): string {
	if (!workspaceRoot) return '';
	const normalized = normalizePath(workspaceRoot).replace(/\/+$/, '');
	return normalized === '/' ? '/' : normalized;
}

export function isPathInsideWorkspace(path: string, workspaceRoot?: string): boolean {
	if (!isAbsoluteFilePath(path)) return true;
	const root = normalizeWorkspaceRoot(workspaceRoot);
	if (!root) return false;
	const normalizedPath = normalizePath(path);
	if (root === '/') return normalizedPath.startsWith('/');
	return normalizedPath === root || normalizedPath.startsWith(`${root}/`);
}

export function workspaceFilePath(path: string, workspaceRoot?: string): string | null {
	const trimmed = path.trim();
	if (!trimmed) return null;
	if (!isAbsoluteFilePath(trimmed)) return normalizePath(trimmed).replace(/^\.\//, '');
	if (!isPathInsideWorkspace(trimmed, workspaceRoot)) return null;
	return toRelativePath(normalizePath(trimmed), normalizeWorkspaceRoot(workspaceRoot));
}

function withSourceSession<T extends FilePage | DiffPage>(page: T, sourceSessionId?: string): T {
	return sourceSessionId ? ({ ...page, sourceSessionId } as T) : page;
}

function externalFilePage(path: string, sourceSessionId?: string): FilePage {
	return withSourceSession(
		{ type: 'file', source: 'external_file', path, title: basename(path) },
		sourceSessionId,
	);
}

export function resolveWorkspaceFileOpenTarget({
	path,
	workspaceRoot,
	sourceSessionId,
}: {
	path: string;
	workspaceRoot?: string;
	sourceSessionId?: string;
}): WorkspaceFileOpenTarget {
	const relativePath = workspaceFilePath(path, workspaceRoot);
	if (!relativePath) {
		return { kind: 'page', page: externalFilePage(path, sourceSessionId) };
	}

	return {
		kind: 'page',
		page: withSourceSession(
			{ type: 'file', source: 'workspace_file', path: relativePath, title: basename(relativePath) },
			sourceSessionId,
		),
	};
}

export function resolvePromptPartFileOpenTarget({
	part,
	attachments = [],
	workspaceRoot,
	sourceSessionId,
}: {
	part: Exclude<PromptPart, { type: 'text' }>;
	attachments?: ChatAttachment[];
	workspaceRoot?: string;
	sourceSessionId?: string;
}): WorkspaceFileOpenTarget {
	if (part.type === 'mention') {
		return resolveWorkspaceFileOpenTarget({ path: part.path, workspaceRoot, sourceSessionId });
	}

	if (part.type === 'pasted_text') {
		return {
			kind: 'pasted_text',
			id: part.id,
			text: part.text,
			page: withSourceSession(
				{ type: 'file', source: 'pasted_text', sourceId: part.id, title: PASTED_TEXT_LABEL },
				sourceSessionId,
			),
		};
	}

	const attachment = attachments.find((candidate) => candidate.id === part.attachmentId);
	if (!attachment) return { kind: 'unavailable', reason: 'Attachment is no longer available.' };

	return {
		kind: 'attachment',
		attachment,
		page: withSourceSession(
			{
				type: 'file',
				source: 'generated_attachment',
				sourceId: attachment.id,
				title: attachment.displayName,
				attachment,
			},
			sourceSessionId,
		),
	};
}

export function resolveTranscriptReadFileOpenTarget({
	path,
	workspaceRoot,
	sourceSessionId,
}: {
	path: string;
	workspaceRoot?: string;
	sourceSessionId?: string;
}): WorkspaceFileOpenTarget {
	return resolveWorkspaceFileOpenTarget({ path, workspaceRoot, sourceSessionId });
}

export function resolveChangedFileDiffOpenTarget({
	path,
	workspaceRoot,
	sourceSessionId,
	turnId,
}: {
	path: string;
	workspaceRoot?: string;
	sourceSessionId?: string;
	turnId?: string;
}): WorkspaceDiffOpenTarget {
	if (!path || path === '__overflow')
		return { kind: 'unavailable', reason: 'Diff is unavailable.' };

	const relativePath = workspaceFilePath(path, workspaceRoot);
	if (!relativePath) return { kind: 'page', page: externalFilePage(path, sourceSessionId) };

	const page: DiffPage = {
		type: 'diff',
		path: relativePath,
		...(sourceSessionId
			? { source: 'transcript' as const, sourceSessionId }
			: { source: 'workspace' as const }),
		...(turnId ? { turnId } : {}),
	};
	return { kind: 'page', page };
}
