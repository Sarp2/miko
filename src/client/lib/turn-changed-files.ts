import type { HydratedTranscriptMessage } from '../../shared/types';
import { basename } from '../routes/workspace-route-state';

type ToolMessage = Extract<HydratedTranscriptMessage, { kind: 'tool' }>;

export interface TurnChangedFile {
	path: string;
	name: string;
	additions: number;
	deletions: number;
	/** Concatenated pre-edit fragment(s) for the hover diff. */
	before: string;
	/** Concatenated post-edit fragment(s) for the hover diff. */
	after: string;
}

interface FileAccumulator {
	path: string;
	name: string;
	additions: number;
	deletions: number;
	beforeParts: string[];
	afterParts: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function lineCount(value: string): number {
	return value.length > 0 ? value.split('\n').length : 0;
}

/**
 * Files written or edited during a turn, with approximate line deltas and the
 * edit fragments needed to render a fragment-level diff on hover. Counts and
 * content are derived from the tool inputs, not a real git diff.
 */
export function turnChangedFiles(tools: ToolMessage[]): TurnChangedFile[] {
	const byPath = new Map<string, FileAccumulator>();

	for (const tool of tools) {
		if (tool.toolKind !== 'edit_file' && tool.toolKind !== 'write_file') continue;
		// A failed edit/write left the file unchanged, so skip it.
		if (tool.isError) continue;
		const input = asRecord(tool.input);
		const path = typeof input.filePath === 'string' ? input.filePath : '';
		if (!path) continue;

		const before =
			tool.toolKind === 'edit_file' && typeof input.oldString === 'string' ? input.oldString : '';
		const after =
			tool.toolKind === 'edit_file'
				? typeof input.newString === 'string'
					? input.newString
					: ''
				: typeof input.content === 'string'
					? input.content
					: '';

		const accumulator = byPath.get(path) ?? {
			path,
			name: basename(path),
			additions: 0,
			deletions: 0,
			beforeParts: [],
			afterParts: [],
		};
		accumulator.additions += lineCount(after);
		accumulator.deletions += lineCount(before);
		if (before) accumulator.beforeParts.push(before);
		accumulator.afterParts.push(after);
		byPath.set(path, accumulator);
	}

	return [...byPath.values()].map((file) => ({
		path: file.path,
		name: file.name,
		additions: file.additions,
		deletions: file.deletions,
		before: file.beforeParts.join('\n'),
		after: file.afterParts.join('\n'),
	}));
}
