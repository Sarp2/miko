import type { SessionSummary } from '../../shared/types';
import type { MiddleTabDescriptor, WorkspacePage } from '../stores/ui-store';

function sessionTitle(session?: Pick<SessionSummary, 'title'>) {
	const title = session?.title.trim();
	if (!title) return 'Untitled';
	return title;
}

export function middleTabTitle(
	tab: MiddleTabDescriptor,
	sessions: Pick<SessionSummary, 'id' | 'title'>[] = [],
) {
	const { page } = tab;
	if (page.type === 'chat') {
		return sessionTitle(sessions.find((session) => session.id === page.sessionId));
	}

	return tab.fallbackTitle ?? 'Untitled';
}

export function workspacePagePath(workspaceId: string, page: WorkspacePage) {
	const base = `/workspaces/${encodeURIComponent(workspaceId)}`;

	if (page.type === 'chat') {
		return `${base}/sessions/${encodeURIComponent(page.sessionId)}`;
	}

	if (page.type === 'diff') {
		const params = new URLSearchParams();
		if (page.path) params.set('path', page.path);
		if (page.sourceSessionId) params.set('sessionId', page.sourceSessionId);
		const query = params.toString();
		return `${base}/diff${query ? `?${query}` : ''}`;
	}

	const params = new URLSearchParams();
	if (page.path) params.set('path', page.path);
	if (page.source !== 'workspace_file') params.set('source', page.source);
	if (page.sourceId) params.set('sourceId', page.sourceId);
	if (page.title) params.set('title', page.title);
	const query = params.toString();
	return `${base}/file${query ? `?${query}` : ''}`;
}
