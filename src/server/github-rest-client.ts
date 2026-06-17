import { runCommand } from './diff-store';

export type GitHubRestResult<T> = { status: 'ok'; data: T } | { status: 'not_modified' };

interface GitHubRestClientDeps {
	fetch?: typeof fetch;
	runGh?: (args: string[]) => Promise<Awaited<ReturnType<typeof runCommand>>>;
	now?: () => number;
}

interface CacheEntry {
	etag?: string;
	lastModified?: string;
	data?: unknown;
	link?: string | null;
}

type GitHubRestPageResult<T> =
	| { status: 'ok'; data: T; link?: string | null }
	| { status: 'not_modified' };

const TOKEN_TTL_MS = 45 * 60 * 1000;
const GITHUB_API_BASE_URL = 'https://api.github.com';

function retryAfterMs(headers: Headers, now: () => number) {
	const retryAfter = headers.get('retry-after');
	if (retryAfter) {
		const seconds = Number.parseInt(retryAfter, 10);
		if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
	}

	const reset = headers.get('x-ratelimit-reset');
	if (!reset) return null;
	const resetSeconds = Number.parseInt(reset, 10);
	if (!Number.isFinite(resetSeconds) || resetSeconds <= 0) return null;
	return Math.max(0, resetSeconds * 1000 - now());
}

function isGitHubRateLimitResponse(status: number, headers: Headers, body: string) {
	if (status === 429) return true;
	if (status !== 403) return false;
	if (headers.get('retry-after')) return true;
	if (headers.get('x-ratelimit-remaining') === '0' && headers.get('x-ratelimit-reset')) return true;
	const normalizedBody = body.toLowerCase();
	return normalizedBody.includes('rate limit') || normalizedBody.includes('secondary limit');
}

function nextLink(linkHeader: string | null | undefined) {
	if (!linkHeader) return null;
	for (const part of linkHeader.split(',')) {
		const match = part.match(/<([^>]+)>;\s*rel="next"/);
		if (match?.[1]) return match[1];
	}
	return null;
}

export class GitHubRateLimitError extends Error {
	readonly retryAfterMs: number | null;

	constructor(message: string, retryAfterMs: number | null) {
		super(message);
		this.name = 'GitHubRateLimitError';
		this.retryAfterMs = retryAfterMs;
	}
}

export class GitHubRestClient {
	private readonly fetchImpl: typeof fetch;
	private readonly runGhCommand: (
		args: string[],
	) => Promise<Awaited<ReturnType<typeof runCommand>>>;
	private readonly now: () => number;
	private readonly cacheByKey = new Map<string, CacheEntry>();
	private token: { value: string; expiresAt: number } | null = null;

	constructor(deps: GitHubRestClientDeps = {}) {
		this.fetchImpl = deps.fetch ?? fetch;
		this.runGhCommand = deps.runGh ?? ((args) => runCommand(['gh', ...args]));
		this.now = deps.now ?? Date.now;
	}

	private async getToken() {
		if (this.token && this.token.expiresAt > this.now()) return this.token.value;

		const result = await this.runGhCommand(['auth', 'token']);
		if (result.exitCode !== 0) {
			throw new Error(
				[result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n') ||
					'GitHub authentication token lookup failed',
			);
		}

		const value = result.stdout.trim();
		if (!value) throw new Error('GitHub authentication token lookup returned an empty token');
		this.token = { value, expiresAt: this.now() + TOKEN_TTL_MS };
		return value;
	}

	private async requestJsonPage<T>(
		cacheKey: string,
		path: string,
	): Promise<GitHubRestPageResult<T>> {
		const token = await this.getToken();
		const headers = new Headers({
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': '2022-11-28',
		});
		const cache = this.cacheByKey.get(cacheKey);
		if (cache?.etag) headers.set('If-None-Match', cache.etag);
		else if (cache?.lastModified) headers.set('If-Modified-Since', cache.lastModified);

		const response = await this.fetchImpl(new URL(path, GITHUB_API_BASE_URL), { headers });
		if (response.status === 304) {
			if (cache && 'data' in cache) {
				return {
					status: 'ok',
					data: cache.data as T,
					link: response.headers.get('link') ?? cache.link,
				};
			}
			return { status: 'not_modified' };
		}
		const errorBody = response.ok ? '' : await response.text().catch(() => '');
		if (isGitHubRateLimitResponse(response.status, response.headers, errorBody)) {
			throw new GitHubRateLimitError(
				`GitHub REST request was rate limited (${response.status})`,
				retryAfterMs(response.headers, this.now),
			);
		}
		if (response.status === 401) this.token = null;
		if (!response.ok) {
			throw new Error(errorBody.trim() || `GitHub REST request failed (${response.status})`);
		}

		const data = (await response.json()) as T;
		const etag = response.headers.get('etag') ?? undefined;
		const lastModified = response.headers.get('last-modified') ?? undefined;
		if (etag || lastModified) {
			this.cacheByKey.set(cacheKey, {
				etag,
				lastModified,
				data,
				link: response.headers.get('link'),
			});
		}

		return { status: 'ok', data, link: response.headers.get('link') };
	}

	async requestJson<T>(cacheKey: string, path: string): Promise<GitHubRestResult<T>> {
		const result = await this.requestJsonPage<T>(cacheKey, path);
		return result.status === 'ok' ? { status: 'ok', data: result.data } : result;
	}

	async requestJsonPages<TPage, TItem>(
		cacheKey: string,
		path: string,
		getItems: (page: TPage) => TItem[],
	): Promise<GitHubRestResult<TItem[]>> {
		const items: TItem[] = [];
		let page = 1;
		let currentPath: string | null = path;

		while (currentPath) {
			const result = await this.requestJsonPage<TPage>(`${cacheKey}:page:${page}`, currentPath);
			if (result.status === 'not_modified')
				return page === 1 ? result : { status: 'ok', data: items };
			items.push(...getItems(result.data));
			currentPath = nextLink(result.link);
			page += 1;
		}

		return { status: 'ok', data: items };
	}
}
