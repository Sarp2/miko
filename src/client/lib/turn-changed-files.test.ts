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

	test('derives write additions from raw provider payloads', () => {
		const write = tool('write_file', { filePath: 'src/new.ts' });
		write.rawInput = { file_path: 'src/new.ts', content: 'one\ntwo\n' };

		const [file] = turnChangedFiles([write]);

		expect(file).toMatchObject({
			path: 'src/new.ts',
			additions: 2,
			deletions: 0,
			before: '',
			after: 'one\ntwo\n',
		});
	});

	test('derives edit additions from raw snake-case fields', () => {
		const edit = tool('edit_file', { filePath: 'src/new.ts' });
		edit.rawInput = { file_path: 'src/new.ts', old_string: '', new_string: 'created\n' };

		const [file] = turnChangedFiles([edit]);

		expect(file).toMatchObject({ additions: 1, deletions: 0, after: 'created\n' });
	});

	test('derives write additions from codex file-change diff payloads', () => {
		const write = tool('write_file', {
			filePath: '/tmp/project/readme2.md',
			content: '',
		});
		write.rawInput = {
			type: 'fileChange',
			changes: [
				{
					path: '/tmp/project/readme2.md',
					kind: { type: 'add' },
					diff: 'hello\nworld\n',
				},
			],
		};

		const [file] = turnChangedFiles([write]);

		expect(file).toMatchObject({
			name: 'readme2.md',
			additions: 2,
			deletions: 0,
			after: 'hello\nworld\n',
		});
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
