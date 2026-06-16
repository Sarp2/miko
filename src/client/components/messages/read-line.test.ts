import { describe, expect, test } from 'bun:test';
import type { HydratedTranscriptMessage } from '../../../shared/types';
import { readLineCount } from './read-line';

type ReadMessage = Extract<HydratedTranscriptMessage, { kind: 'tool'; toolKind: 'read_file' }>;

function readCall(result: unknown): ReadMessage {
	return {
		id: 'r1',
		kind: 'tool',
		toolKind: 'read_file',
		toolName: 'read_file',
		toolId: 'r1',
		input: { filePath: 'a.ts' },
		hasResult: true,
		result,
		timestamp: '',
	} as ReadMessage;
}

describe('readLineCount', () => {
	test('counts lines from string and object content, trimming trailing newlines', () => {
		expect(readLineCount(readCall('a\nb\nc\n'))).toBe(3);
		expect(readLineCount(readCall({ content: 'x\ny' }))).toBe(2);
	});

	test('returns 0 when there is no readable content', () => {
		expect(readLineCount(readCall(undefined))).toBe(0);
		expect(readLineCount(readCall(''))).toBe(0);
	});
});
