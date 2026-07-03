import type { HydratedTranscriptMessage } from '../../shared/types';
import { basename } from './relative-path';

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
	if (!value) return 0;
	const normalized = value.endsWith('\n') ? value.slice(0, -1) : value;
	return normalized ? normalized.split('\n').length : 0;
}

function firstRawChange(rawInput: Record<string, unknown>): Record<string, unknown> {
	const changes = rawInput.changes;
	if (!Array.isArray(changes)) return {};
	return asRecord(changes[0]);
}

function rawChangeType(change: Record<string, unknown>): string {
	const kind = change.kind;
	if (typeof kind === 'string') return kind;
	const kindRecord = asRecord(kind);
	return typeof kindRecord.type === 'string' ? kindRecord.type : '';
}

function looksLikeUnifiedDiff(diff: string): boolean {
	return diff
		.split(/\r?\n/)
		.some((line) => /^@@\s/.test(line) || /^---\s/.test(line) || /^\+\+\+\s/.test(line));
}

function parseUnifiedDiffFragments(diff: string): { before: string; after: string } {
	const before: string[] = [];
	const after: string[] = [];

	for (const line of diff.split(/\r?\n/)) {
		if (!line) continue;
		if (/^@@\s/.test(line) || /^---\s/.test(line) || /^\+\+\+\s/.test(line)) continue;
		if (line === '\\ No newline at end of file') continue;

		const prefix = line[0];
		const content = line.slice(1);
		if (prefix === ' ') {
			before.push(content);
			after.push(content);
			continue;
		}
		if (prefix === '-') {
			before.push(content);
			continue;
		}
		if (prefix === '+') after.push(content);
	}

	return { before: before.join('\n'), after: after.join('\n') };
}

function rawChangeFragments(rawInput: Record<string, unknown>): { before: string; after: string } {
	const change = firstRawChange(rawInput);
	const diff = typeof change.diff === 'string' ? change.diff : '';
	if (!diff) return { before: '', after: '' };

	const kind = rawChangeType(change);
	if (!looksLikeUnifiedDiff(diff)) {
		if (kind === 'add') return { before: '', after: diff };
		if (kind === 'delete') return { before: diff, after: '' };
	}

	return parseUnifiedDiffFragments(diff);
}

function stringField(records: Record<string, unknown>[], names: string[]): string {
	for (const record of records) {
		for (const name of names) {
			const value = record[name];
			if (typeof value === 'string' && value.length > 0) return value;
		}
	}
	return '';
}

/**
 * Files written or edited during a turn, with approximate line deltas and the
 * edit fragments needed to render a fragment-level diff on hover. Counts and
 * content are derived from the tool inputs, not a real git diff.
 */
export function turnChangedFiles(tools: ToolMessage[]): TurnChangedFile[] {
	const byPath = new Map<string, FileAccumulator>();

	for (const tool of tools) {
		if (
			tool.toolKind !== 'edit_file' &&
			tool.toolKind !== 'write_file' &&
			tool.toolKind !== 'delete_file'
		)
			continue;
		// A failed edit/write/delete left the file unchanged, so skip it.
		if (tool.isError) continue;
		const input = asRecord(tool.input);
		const rawInput = asRecord(tool.rawInput);
		const inputSources = [input, rawInput];
		const path = stringField(inputSources, ['filePath', 'file_path', 'path']);
		if (!path) continue;

		const rawFragments = rawChangeFragments(rawInput);
		const oldString =
			stringField(inputSources, ['oldString', 'old_string', 'before']) || rawFragments.before;
		const content =
			stringField(inputSources, [
				'content',
				'newString',
				'new_string',
				'fileContent',
				'file_content',
				'text',
			]) || rawFragments.after;
		// before = removed content, after = resulting content.
		let before = '';
		let after = '';
		if (tool.toolKind === 'edit_file') {
			before = oldString;
			after =
				stringField(inputSources, ['newString', 'new_string', 'content']) || rawFragments.after;
		} else if (tool.toolKind === 'write_file') {
			after = content;
		} else {
			before = oldString;
		}

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
