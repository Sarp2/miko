import { describe, expect, test } from 'bun:test';
import type { HydratedTranscriptMessage } from '../../../shared/types';
import { toolParts } from './tool-line';

type ToolMessage = Extract<HydratedTranscriptMessage, { kind: 'tool' }>;

function toolCall(toolKind: string, input: unknown, toolName = ''): ToolMessage {
	return {
		id: 't1',
		kind: 'tool',
		toolKind,
		toolName,
		toolId: 't1',
		input,
		hasResult: true,
		timestamp: '',
	} as ToolMessage;
}

describe('toolParts', () => {
	test('splits known tools into a name and a detail', () => {
		expect(toolParts(toolCall('grep', { pattern: 'foo' }))).toEqual({
			name: 'Find',
			detail: 'foo',
		});
		expect(toolParts(toolCall('glob', { pattern: '**/*' }))).toEqual({
			name: 'Search',
			detail: 'all directories',
		});
		expect(toolParts(toolCall('delete_file', { filePath: 'a/b.ts' }))).toEqual({
			name: 'Delete',
			detail: 'a/b.ts',
		});
	});

	test('falls back to a title-cased tool name with no detail', () => {
		expect(toolParts(toolCall('web_search', { query: 'x' }))).toEqual({ name: 'Web Search' });
	});
});
