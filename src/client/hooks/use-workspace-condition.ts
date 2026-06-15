import { useMemo } from 'react';
import { deriveWorkspaceCondition, type WorkspaceCondition } from '../lib/workspace-condition';
import { useWorkspaceStore } from '../stores/workspace-store';

export function useWorkspaceCondition(workspaceId: string | undefined): WorkspaceCondition | null {
	const snapshot = useWorkspaceStore((state) =>
		workspaceId ? (state.snapshotByWorkspaceId.get(workspaceId) ?? null) : null,
	);

	return useMemo(() => (snapshot ? deriveWorkspaceCondition(snapshot) : null), [snapshot]);
}
