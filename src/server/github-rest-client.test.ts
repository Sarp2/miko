import { describe, expect, test } from 'bun:test';
import { GitHubRateLimitError, GitHubRestClient } from './github-rest-client';

function okGhToken() {
	return async () => ({ stdout: 'token\n', stderr: '', exitCode: 0 });
}

describe('GitHubRestClient', () => {
	test('sends authorization and reuses etags for conditional cached requests', async () => {
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
			status: 'ok',
			data: { ok: true },
		});

		expect(seenHeaders[0]?.get('authorization')).toBe('Bearer token');
		expect(seenHeaders[1]?.get('if-none-match')).toBe('etag-1');
	});

	test('follows paginated REST links and reuses cached pages on 304', async () => {
		const seenUrls: string[] = [];
		const seenHeaders: Headers[] = [];
		let pass = 0;
		const client = new GitHubRestClient({
			runGh: okGhToken(),
			fetch: (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
				const url = String(input);
				seenUrls.push(url);
				seenHeaders.push(new Headers(init?.headers));
				const isSecondPass = pass >= 2;
				pass += 1;
				if (isSecondPass) return new Response(null, { status: 304 });
				if (url.includes('page=2')) {
					return new Response(JSON.stringify([{ id: 2 }]), {
						status: 200,
						headers: { etag: 'etag-2' },
					});
				}
				return new Response(JSON.stringify([{ id: 1 }]), {
					status: 200,
					headers: {
						etag: 'etag-1',
						link: '<https://api.github.com/repos/sarp/miko/issues/1/comments?page=2>; rel="next"',
					},
				});
			}) as unknown as typeof fetch,
		});

		await expect(
			client.requestJsonPages<Array<{ id: number }>, { id: number }>(
				'comments',
				'/repos/sarp/miko/issues/1/comments?per_page=100',
				(page) => page,
			),
		).resolves.toEqual({ status: 'ok', data: [{ id: 1 }, { id: 2 }] });
		await expect(
			client.requestJsonPages<Array<{ id: number }>, { id: number }>(
				'comments',
				'/repos/sarp/miko/issues/1/comments?per_page=100',
				(page) => page,
			),
		).resolves.toEqual({ status: 'ok', data: [{ id: 1 }, { id: 2 }] });

		expect(seenUrls.filter((url) => url.includes('page=2'))).toHaveLength(2);
		expect(seenHeaders[2]?.get('if-none-match')).toBe('etag-1');
		expect(seenHeaders[3]?.get('if-none-match')).toBe('etag-2');
	});

	test('uses x-ratelimit-reset for primary rate limit backoff', async () => {
		const client = new GitHubRestClient({
			now: () => 1_000,
			runGh: okGhToken(),
			fetch: (async () =>
				new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
					status: 403,
					headers: {
						'x-ratelimit-remaining': '0',
						'x-ratelimit-reset': '10',
					},
				})) as unknown as typeof fetch,
		});

		try {
			await client.requestJson('key', '/repos/sarp/miko/pulls');
			throw new Error('expected request to fail');
		} catch (error) {
			expect(error).toBeInstanceOf(GitHubRateLimitError);
			expect((error as GitHubRateLimitError).retryAfterMs).toBe(9_000);
		}
	});

	test('does not classify ordinary 403 responses as rate limits', async () => {
		const client = new GitHubRestClient({
			runGh: okGhToken(),
			fetch: (async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch,
		});

		try {
			await client.requestJson('key', '/repos/sarp/miko/pulls');
			throw new Error('expected request to fail');
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).not.toBeInstanceOf(GitHubRateLimitError);
			expect((error as Error).message).toBe('forbidden');
		}
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
