import { describe, expect, test } from 'bun:test';
import { GitHubRateLimitError, GitHubRestClient } from './github-rest-client';

function okGhToken() {
	return async () => ({ stdout: 'token\n', stderr: '', exitCode: 0 });
}

describe('GitHubRestClient', () => {
	test('sends authorization and reuses etags for conditional requests', async () => {
		const seenHeaders: Headers[] = [];
		const client = new GitHubRestClient({
			runGh: okGhToken(),
			fetch: (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
				const headers = new Headers(init?.headers);
				seenHeaders.push(headers);
				if (seenHeaders.length === 1) {
					return new Response(JSON.stringify({ ok: true }), {
						status: 200,
						headers: { etag: 'etag-1' },
					});
				}
				return new Response(null, { status: 304 });
			}) as unknown as typeof fetch,
		});

		await expect(client.requestJson('key', '/repos/sarp/miko/pulls')).resolves.toEqual({
			status: 'ok',
			data: { ok: true },
		});
		await expect(client.requestJson('key', '/repos/sarp/miko/pulls')).resolves.toEqual({
			status: 'not_modified',
		});

		expect(seenHeaders[0]?.get('authorization')).toBe('Bearer token');
		expect(seenHeaders[1]?.get('if-none-match')).toBe('etag-1');
	});

	test('surfaces retry-after rate limit errors', async () => {
		const client = new GitHubRestClient({
			runGh: okGhToken(),
			fetch: (async () =>
				new Response('slow down', {
					status: 429,
					headers: { 'retry-after': '7' },
				})) as unknown as typeof fetch,
		});

		try {
			await client.requestJson('key', '/repos/sarp/miko/pulls');
			throw new Error('expected request to fail');
		} catch (error) {
			expect(error).toBeInstanceOf(GitHubRateLimitError);
			expect((error as GitHubRateLimitError).retryAfterMs).toBe(7_000);
		}
	});
});
