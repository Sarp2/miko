import { describe, expect, test } from 'bun:test';
import type { HydratedTranscriptMessage } from '../../shared/types';
import { turnChangedFiles } from './turn-changed-files';

type ToolMessage = Extract<HydratedTranscriptMessage, { kind: 'tool' }>;

function tool(toolKind: ToolMessage['toolKind'], input: unknown): ToolMessage {
	return {
		id: `${toolKind}-${Math.random()}`,
		timestamp: '1970-01-01T00:00:01.000Z',
		kind: 'tool',
		toolKind,
		toolName: toolKind,
		toolId: `call-${Math.random()}`,
		input,
		hasResult: true,
	} as ToolMessage;
}

describe('turnChangedFiles', () => {
	test('derives line deltas and fragments from an edit', () => {
		const [file] = turnChangedFiles([
			tool('edit_file', { filePath: 'src/a.ts', oldString: 'a\nb', newString: 'a\nb\nc' }),
		]);

		expect(file).toMatchObject({
			path: 'src/a.ts',
			name: 'a.ts',
			additions: 3,
			deletions: 2,
			before: 'a\nb',
			after: 'a\nb\nc',
		});
	});

	test('treats a write as additions only with no before', () => {
		const [file] = turnChangedFiles([
			tool('write_file', { filePath: 'src/b.ts', content: 'x\ny' }),
		]);
		expect(file).toMatchObject({ additions: 2, deletions: 0, before: '', after: 'x\ny' });
	});

	test('derives deletions from a delete', () => {
		const [file] = turnChangedFiles([
			tool('delete_file', { filePath: 'src/gone.ts', oldString: 'a\nb\nc' }),
		]);
		expect(file).toMatchObject({
			name: 'gone.ts',
			additions: 0,
			deletions: 3,
			before: 'a\nb\nc',
			after: '',
		});
	});

	test('skips errored file tools', () => {
		const failed = tool('edit_file', { filePath: 'src/a.ts', oldString: 'x', newString: 'y' });
		failed.isError = true;
		expect(turnChangedFiles([failed])).toEqual([]);
	});

	test('aggregates multiple edits to the same file and ignores other tools', () => {
		const files = turnChangedFiles([
			tool('edit_file', { filePath: 'src/a.ts', oldString: 'a', newString: 'a\nb' }),
			tool('edit_file', { filePath: 'src/a.ts', oldString: 'c', newString: 'd' }),
			tool('bash', { command: 'ls' }),
		]);

		expect(files).toHaveLength(1);
		expect(files[0]).toMatchObject({ additions: 3, deletions: 2 });
	});
});
