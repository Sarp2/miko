import { afterEach, describe, expect, test } from 'bun:test';
import type { ChatAttachment } from '../../shared/types';
import {
	attachmentPreviewResult,
	isTextLikeAttachment,
	localFilePreviewResult,
} from './workspace-file-previews';

const originalFetch = globalThis.fetch;

function attachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
	return {
		id: 'attachment-1',
		kind: 'file',
		displayName: 'large.log',
		absolutePath: 'large.log',
		relativePath: 'large.log',
		contentUrl: 'https://example.test/large.log',
		mimeType: 'text/plain',
		size: 2 * 1024 * 1024 + 1,
		...overrides,
	};
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('isTextLikeAttachment', () => {
	test('detects common source files when browser MIME is empty', () => {
		for (const name of ['main.py', 'server.go', 'lib.rs', 'script.sh', 'config.toml', 'icon.svg']) {
			expect(isTextLikeAttachment(name, '')).toBe(true);
		}
	});
});

describe('localFilePreviewResult', () => {
	test('returns binary metadata for oversized text-like local files without reading text', async () => {
		const file = new File(['x'], 'large.log', { type: 'text/plain' });
		Object.defineProperty(file, 'size', { value: 2 * 1024 * 1024 + 1 });
		Object.defineProperty(file, 'text', {
			value: async () => {
				throw new Error('text should not be read');
			},
		});

		const result = await localFilePreviewResult({
			attachmentId: 'local-1',
			file,
			kind: 'file',
		});

		expect(result).toMatchObject({
			kind: 'binary',
			name: 'large.log',
			size: 2 * 1024 * 1024 + 1,
		});
		expect(result.mimeType).toStartWith('text/plain');
	});
});

describe('attachmentPreviewResult', () => {
	test('returns binary metadata for oversized text-like uploaded attachments without fetching', async () => {
		let fetched = false;
		globalThis.fetch = (async () => {
			fetched = true;
			return new Response('too large');
		}) as unknown as typeof fetch;

		const result = await attachmentPreviewResult(attachment());

		expect(fetched).toBe(false);
		expect(result).toMatchObject({
			kind: 'binary',
			name: 'large.log',
			mimeType: 'text/plain',
			size: 2 * 1024 * 1024 + 1,
		});
	});
});
