import { describe, expect, test } from 'bun:test';
import type { ChatAttachment, PromptPart } from '../../shared/types';
import {
	compactPromptParts,
	fallbackPromptParts,
	promptPartLabel,
	promptPartsPlainText,
	promptPartsSubmissionText,
	promptPartText,
	replaceRangeWithParts,
} from './prompt-parts';

function attachment(id: string, displayName: string): ChatAttachment {
	return {
		id,
		kind: 'file',
		displayName,
		absolutePath: displayName,
		relativePath: displayName,
		contentUrl: '',
		mimeType: 'text/plain',
		size: 0,
	};
}

describe('compactPromptParts', () => {
	test('merges adjacent text and drops empties, keeping tokens atomic', () => {
		const parts: PromptPart[] = [
			{ type: 'text', text: 'a' },
			{ type: 'text', text: '' },
			{ type: 'text', text: 'b' },
			{ type: 'mention', path: 'src/x.ts' },
			{ type: 'text', text: 'c' },
		];

		expect(compactPromptParts(parts)).toEqual([
			{ type: 'text', text: 'ab' },
			{ type: 'mention', path: 'src/x.ts' },
			{ type: 'text', text: 'c' },
		]);
	});
});

describe('promptPartsPlainText', () => {
	test('flattens tokens to their inline text representation', () => {
		const parts: PromptPart[] = [
			{ type: 'text', text: 'see ' },
			{ type: 'mention', path: 'src/x.ts', label: 'x.ts' },
			{ type: 'text', text: ' and ' },
			{ type: 'attachment', attachmentId: 'a1' },
		];

		expect(promptPartsPlainText(parts, [attachment('a1', 'photo.png')])).toBe(
			'see @src/x.ts and photo.png',
		);
	});
});

describe('promptPartsSubmissionText', () => {
	test('omits attachment labels so attachment-only prompts can use the backend fallback', () => {
		const parts: PromptPart[] = [{ type: 'attachment', attachmentId: 'a1' }];

		expect(promptPartsSubmissionText(parts)).toBe('');
	});
});

describe('promptPartLabel', () => {
	test('labels mentions, pasted text, and attachments', () => {
		expect(promptPartLabel({ type: 'mention', path: 'src/deep/x.ts' })).toBe('x.ts');
		expect(promptPartLabel({ type: 'pasted_text', id: 'p1', text: 'hi' })).toBe('Pasted text');
		expect(
			promptPartLabel({ type: 'attachment', attachmentId: 'a1' }, [attachment('a1', 'f.txt')]),
		).toBe('f.txt');
	});
});

describe('fallbackPromptParts', () => {
	test('rebuilds parts from legacy content and attachments', () => {
		const parts = fallbackPromptParts('hello', [attachment('a1', 'f.txt')]);
		expect(parts).toEqual([
			{ type: 'text', text: 'hello\n' },
			{ type: 'attachment', attachmentId: 'a1' },
		]);
	});
});

describe('replaceRangeWithParts', () => {
	test('splits a text part and inserts a token at the caret', () => {
		const parts: PromptPart[] = [{ type: 'text', text: 'hello world' }];
		const inserted: PromptPart[] = [{ type: 'mention', path: 'src/x.ts' }];

		expect(replaceRangeWithParts(parts, [], 6, 6, inserted)).toEqual([
			{ type: 'text', text: 'hello ' },
			{ type: 'mention', path: 'src/x.ts' },
			{ type: 'text', text: 'world' },
		]);
	});

	test('drops a token whole when the replaced range overlaps it', () => {
		const parts: PromptPart[] = [
			{ type: 'text', text: 'a' },
			{ type: 'mention', path: 'src/x.ts' },
			{ type: 'text', text: 'b' },
		];
		const mentionLength = promptPartText(parts[1]).length;

		expect(replaceRangeWithParts(parts, [], 1, 1 + mentionLength, [])).toEqual([
			{ type: 'text', text: 'ab' },
		]);
	});
});
