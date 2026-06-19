import { afterEach, describe, expect, test } from 'bun:test';
import type { ChatAttachment } from '../../shared/types';
import {
	agentInstructionContentUrlFromPath,
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

test('detects agent instruction paths from stale workspace-file routes', () => {
	expect(
		agentInstructionContentUrlFromPath(
			'Users/sarp/.miko-dev/data/agent-instructions/create-pr-workspace-1.md',
		),
	).toEqual({
		fileName: 'create-pr-workspace-1.md',
		contentUrl: '/api/agent-instructions/create-pr-workspace-1.md/content',
	});

	expect(
		agentInstructionContentUrlFromPath(
			'Users/sarp/.miko-dev/data/agent-instructions/review-workspace-1.md',
		),
	).toEqual({
		fileName: 'review-workspace-1.md',
		contentUrl: '/api/agent-instructions/review-workspace-1.md/content',
	});

	expect(agentInstructionContentUrlFromPath('/tmp/not-agent-instructions/notes.md')).toBeNull();
	expect(agentInstructionContentUrlFromPath('agent-instructions/create-pr-guide.md')).toBeNull();
	expect(
		agentInstructionContentUrlFromPath('/repo/agent-instructions/create-pr-workspace-1.md'),
	).toBeNull();
	expect(agentInstructionContentUrlFromPath('agent-instructions/../../secret.txt')).toBeNull();
});

describe('attachmentPreviewResult', () => {
	test('loads legacy file-url agent instruction attachments through the server endpoint', async () => {
		let fetchedUrl = '';
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			fetchedUrl = String(input);
			return new Response('# create pr', { status: 200 });
		}) as unknown as typeof fetch;

		const result = await attachmentPreviewResult({
			...attachment({ size: 11 }),
			displayName: 'create-pr-instructions.md',
			contentUrl: 'file:///Users/sarp/.miko-dev/data/agent-instructions/create-pr-workspace-1.md',
			mimeType: 'text/markdown',
		});

		expect(fetchedUrl).toBe('/api/agent-instructions/create-pr-workspace-1.md/content');
		expect(result).toMatchObject({
			kind: 'text',
			name: 'create-pr-instructions.md',
			contents: '# create pr',
		});
	});

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
