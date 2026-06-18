import type { SessionSummary } from '../../shared/types';
import { PASTED_TEXT_LABEL } from '../lib/prompt-parts';
import { basename } from '../lib/relative-path';
import { isAbsoluteFilePath } from '../lib/workspace-file-open-target';
import type { WorkspaceFileSource, WorkspacePage } from '../stores/ui-store';

export type WorkspaceRouteKind = 'workspace' | 'session' | 'diff' | 'file';

interface WorkspaceRoutePageInput {
	kind: WorkspaceRouteKind;
	sessionId?: string;
	searchParams?: URLSearchParams;
}

const FILE_SOURCES = new Set<WorkspaceFileSource>([
	'scratchpad',
	'workspace_file',
	'ci_log',
	'pr_comment',
	'generated_attachment',
	'pasted_text',
	'external_file',
]);

export function selectFirstSessionId(sessions: Pick<SessionSummary, 'id' | 'createdAt'>[] = []) {
	return sessions.toSorted((a, b) => a.createdAt - b.createdAt)[0]?.id ?? null;
}

export function selectSessionRouteTarget(
	sessions: Pick<SessionSummary, 'id' | 'createdAt'>[] = [],
	requestedSessionId?: string | null,
) {
	if (requestedSessionId && sessions.some((session) => session.id === requestedSessionId)) {
		return requestedSessionId;
	}

	return selectFirstSessionId(sessions);
}

function parseFileSource(value: string | null, path: string | null): WorkspaceFileSource {
	if (value && FILE_SOURCES.has(value as WorkspaceFileSource)) return value as WorkspaceFileSource;
	if (path && isAbsoluteFilePath(path)) return 'external_file';
	return path ? 'workspace_file' : 'generated_attachment';
}

function fallbackFileTitle(source: WorkspaceFileSource, path: string | null) {
	if (source === 'scratchpad') return 'Scratchpad';
	if (source === 'workspace_file' && path) return basename(path);
	if (source === 'ci_log') return 'CI Log';
	if (source === 'pr_comment') return 'PR Comment';
	if (source === 'pasted_text') return PASTED_TEXT_LABEL;
	if (source === 'external_file' && path) return basename(path);
	return 'Attachment';
}

export function deriveWorkspaceRoutePage({
	kind,
	sessionId,
	searchParams = new URLSearchParams(),
}: WorkspaceRoutePageInput): WorkspacePage | null {
	if (kind === 'session') {
		return sessionId ? { type: 'chat', sessionId } : null;
	}

	if (kind === 'workspace') return null;

	if (kind === 'diff') {
		const path = searchParams.get('path')?.trim();
		const sourceSessionId = searchParams.get('sessionId')?.trim() || undefined;
		const source = searchParams.get('source') === 'transcript' ? 'transcript' : undefined;
		const turnId = searchParams.get('turnId')?.trim() || undefined;
		return {
			type: 'diff',
			...(path ? { path } : {}),
			...(source ? { source } : {}),
			...(sourceSessionId ? { sourceSessionId } : {}),
			...(turnId ? { turnId } : {}),
		};
	}

	const path = searchParams.get('path')?.trim() || null;
	const source = parseFileSource(searchParams.get('source'), path);
	const title = searchParams.get('title')?.trim() || fallbackFileTitle(source, path);
	const sourceId = searchParams.get('sourceId')?.trim() || undefined;
	const sourceSessionId = searchParams.get('sessionId')?.trim() || undefined;

	return {
		type: 'file',
		...(path ? { path } : {}),
		title,
		source,
		...(sourceId ? { sourceId } : {}),
		...(sourceSessionId ? { sourceSessionId } : {}),
	};
}
