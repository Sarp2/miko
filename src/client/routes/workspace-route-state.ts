import type { SessionSummary } from '../../shared/types';
import type { WorkspaceFileSource, WorkspacePage } from '../stores/ui-store';

export type WorkspaceRouteKind = 'workspace' | 'session' | 'diff' | 'file';

interface WorkspaceRoutePageInput {
	kind: WorkspaceRouteKind;
	sessionId?: string;
	searchParams?: URLSearchParams;
	sessions?: Pick<SessionSummary, 'id' | 'createdAt'>[];
}

const FILE_SOURCES = new Set<WorkspaceFileSource>([
	'scratchpad',
	'workspace_file',
	'ci_log',
	'pr_comment',
	'generated_attachment',
]);

export function basename(path: string) {
	return path.split('/').filter(Boolean).at(-1) ?? path;
}

export function selectFirstSessionId(sessions: Pick<SessionSummary, 'id' | 'createdAt'>[] = []) {
	return sessions.toSorted((a, b) => a.createdAt - b.createdAt)[0]?.id ?? null;
}

function parseFileSource(value: string | null, path: string | null): WorkspaceFileSource {
	if (value && FILE_SOURCES.has(value as WorkspaceFileSource)) return value as WorkspaceFileSource;
	return path ? 'workspace_file' : 'generated_attachment';
}

function fallbackFileTitle(source: WorkspaceFileSource, path: string | null) {
	if (source === 'scratchpad') return 'Scratchpad';
	if (source === 'workspace_file' && path) return basename(path);
	if (source === 'ci_log') return 'CI Log';
	if (source === 'pr_comment') return 'PR Comment';
	return 'Attachment';
}

export function deriveWorkspaceRoutePage({
	kind,
	sessionId,
	searchParams = new URLSearchParams(),
	sessions = [],
}: WorkspaceRoutePageInput): WorkspacePage | null {
	if (kind === 'session') {
		return sessionId ? { type: 'chat', sessionId } : null;
	}

	if (kind === 'workspace') {
		const firstSessionId = selectFirstSessionId(sessions);
		return firstSessionId ? { type: 'chat', sessionId: firstSessionId } : null;
	}

	if (kind === 'diff') {
		const path = searchParams.get('path')?.trim();
		return path ? { type: 'diff', path } : { type: 'diff' };
	}

	const path = searchParams.get('path')?.trim() || null;
	const source = parseFileSource(searchParams.get('source'), path);
	const title = searchParams.get('title')?.trim() || fallbackFileTitle(source, path);
	const sourceId = searchParams.get('sourceId')?.trim() || undefined;

	return {
		type: 'file',
		...(path ? { path } : {}),
		title,
		source,
		...(sourceId ? { sourceId } : {}),
	};
}
