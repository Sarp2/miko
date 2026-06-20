import type { WorkspaceRecord } from './event';

export function shouldPollActiveWorkspace(workspace: WorkspaceRecord) {
	return (
		workspace.visibilityState === 'active' &&
		workspace.setupState === 'ready' &&
		workspace.reviewState !== 'done' &&
		workspace.reviewState !== 'closed'
	);
}
