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
}

const TOKEN_TTL_MS = 45 * 60 * 1000;
const GITHUB_API_BASE_URL = 'https://api.github.com';

function retryAfterMs(headers: Headers) {
	const retryAfter = headers.get('retry-after');
	if (!retryAfter) return null;
	const seconds = Number.parseInt(retryAfter, 10);
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
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

	async requestJson<T>(cacheKey: string, path: string): Promise<GitHubRestResult<T>> {
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
		if (response.status === 304) return { status: 'not_modified' };
		if (response.status === 403 || response.status === 429) {
			throw new GitHubRateLimitError(
				`GitHub REST request was rate limited (${response.status})`,
				retryAfterMs(response.headers),
			);
		}
		if (response.status === 401) this.token = null;
		if (!response.ok) {
			const body = await response.text().catch(() => '');
			throw new Error(body.trim() || `GitHub REST request failed (${response.status})`);
		}

		const etag = response.headers.get('etag') ?? undefined;
		const lastModified = response.headers.get('last-modified') ?? undefined;
		if (etag || lastModified) this.cacheByKey.set(cacheKey, { etag, lastModified });

		return { status: 'ok', data: (await response.json()) as T };
	}
}
