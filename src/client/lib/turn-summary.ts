/** Human-readable summary of a turn's collapsed work (e.g. `5 tool calls, 2 messages`). */
export function summarizeTurn(toolCount: number, messageCount: number): string {
	const parts: string[] = [];
	if (toolCount > 0) parts.push(`${toolCount} tool call${toolCount === 1 ? '' : 's'}`);
	if (messageCount > 0) parts.push(`${messageCount} message${messageCount === 1 ? '' : 's'}`);
	return parts.join(', ') || 'Working';
}

/** Unique tool kinds in first-seen order, capped at `limit`, for the summary icons. */
export function distinctToolKinds<TKind extends string>(
	tools: ReadonlyArray<{ toolKind: TKind }>,
	limit = 5,
): TKind[] {
	const seen = new Set<TKind>();
	const kinds: TKind[] = [];
	for (const tool of tools) {
		if (seen.has(tool.toolKind)) continue;
		seen.add(tool.toolKind);
		kinds.push(tool.toolKind);
	}
	return kinds.slice(0, limit);
}
