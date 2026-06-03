import * as React from 'react';
import type { SidebarDirectoryGroup } from '../../shared/types';

export function useSidebarExpansion(
	directoryGroups: SidebarDirectoryGroup[],
	expandedDirectoryIds: string[] | undefined,
	onDirectoryExpandedChange?: (directoryId: string, expanded: boolean) => void,
) {
	const isControlled = expandedDirectoryIds !== undefined;
	const [internalExpandedIds, setInternalExpandedIds] = React.useState<string[]>(() =>
		directoryGroups.map((directory) => directory.directoryId),
	);

	// When the directory list changes, expand any newly-added directories by default.
	// Adjust state during render (tracking the previous list) rather than in an effect,
	// so it only runs when the list identity changes and never adds an extra commit.
	const [seenGroups, setSeenGroups] = React.useState(directoryGroups);
	if (!isControlled && directoryGroups !== seenGroups) {
		setSeenGroups(directoryGroups);
		setInternalExpandedIds((previous) => {
			const existing = new Set(previous);
			for (const directory of directoryGroups) existing.add(directory.directoryId);
			return [...existing];
		});
	}

	const setExpanded = React.useCallback(
		(directoryId: string, expanded: boolean) => {
			if (!isControlled) {
				setInternalExpandedIds((previous) => {
					const next = new Set(previous);
					if (expanded) next.add(directoryId);
					else next.delete(directoryId);
					return [...next];
				});
			}
			onDirectoryExpandedChange?.(directoryId, expanded);
		},
		[isControlled, onDirectoryExpandedChange],
	);

	const currentExpandedIds = isControlled ? expandedDirectoryIds : internalExpandedIds;
	return { currentExpandedIds, setExpanded };
}
