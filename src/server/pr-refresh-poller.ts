import type { WorkspaceGitHubSnapshot } from 'src/shared/types';
import type { WorkspaceRecord } from './event';
import { GitHubRateLimitError } from './github-rest-client';

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_BACKOFF_MS = 60_000;

export interface PrRefreshPollerDeps {
	listWorkspaces: () => WorkspaceRecord[];
	getWorkspaceGitHubSnapshot: (workspaceId: string) => WorkspaceGitHubSnapshot | null;
	refreshWorkspacePrStage: (
		workspaceId: string,
		options?: { force?: boolean },
	) => Promise<{ snapshot?: WorkspaceGitHubSnapshot | null }>;
	broadcastSnapshots: () => Promise<void>;
	setInterval?: typeof setInterval;
	clearInterval?: typeof clearInterval;
	now?: () => number;
	logger?: Pick<Console, 'warn'>;
	intervalMs?: number;
	defaultBackoffMs?: number;
}

function shouldPollWorkspace(workspace: WorkspaceRecord) {
	return (
		workspace.visibilityState === 'active' &&
		workspace.setupState === 'ready' &&
		workspace.reviewState !== 'done' &&
		workspace.reviewState !== 'closed'
	);
}

function snapshotFingerprint(snapshot: WorkspaceGitHubSnapshot | null) {
	if (!snapshot) return 'null';
	const { lastRefreshedAt: _lastRefreshedAt, ...stable } = snapshot;
	return JSON.stringify(stable);
}

function retryAfterMs(error: unknown, defaultBackoffMs: number) {
	if (error instanceof GitHubRateLimitError) return error.retryAfterMs ?? defaultBackoffMs;
	return null;
}

export class PrRefreshPoller {
	private readonly intervalMs: number;
	private readonly defaultBackoffMs: number;
	private readonly setIntervalImpl: typeof setInterval;
	private readonly clearIntervalImpl: typeof clearInterval;
	private readonly now: () => number;
	private readonly logger: Pick<Console, 'warn'>;
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = false;
	private backoffUntil = 0;
	private stopped = false;
	private inFlight: Promise<void> | null = null;

	constructor(private readonly deps: PrRefreshPollerDeps) {
		this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.defaultBackoffMs = deps.defaultBackoffMs ?? DEFAULT_BACKOFF_MS;
		this.setIntervalImpl = deps.setInterval ?? setInterval;
		this.clearIntervalImpl = deps.clearInterval ?? clearInterval;
		this.now = deps.now ?? Date.now;
		this.logger = deps.logger ?? console;
	}

	start() {
		if (this.timer) return;
		this.stopped = false;
		this.timer = this.setIntervalImpl(() => {
			void this.tick();
		}, this.intervalMs);
		void this.tick();
	}

	async stop() {
		this.stopped = true;
		this.backoffUntil = 0;
		if (this.timer) this.clearIntervalImpl(this.timer);
		this.timer = null;
		await this.inFlight;
	}

	async tick() {
		if (this.stopped) return;
		if (this.running) return this.inFlight ?? undefined;
		if (this.now() < this.backoffUntil) return;

		this.running = true;
		const run = this.runTick();
		this.inFlight = run;
		try {
			await run;
		} finally {
			this.running = false;
			this.inFlight = null;
		}
	}

	private async runTick() {
		try {
			let changed = false;
			let backoffMs: number | null = null;
			const errors: unknown[] = [];
			const workspaces = this.deps.listWorkspaces().filter(shouldPollWorkspace);

			await Promise.all(
				workspaces.map(async (workspace) => {
					try {
						const before = snapshotFingerprint(this.deps.getWorkspaceGitHubSnapshot(workspace.id));
						await this.deps.refreshWorkspacePrStage(workspace.id, { force: true });
						const after = snapshotFingerprint(this.deps.getWorkspaceGitHubSnapshot(workspace.id));
						if (before !== after) changed = true;
					} catch (error) {
						errors.push(error);
						const nextBackoffMs = retryAfterMs(error, this.defaultBackoffMs);
						if (nextBackoffMs !== null) backoffMs = Math.max(backoffMs ?? 0, nextBackoffMs);
					}
				}),
			);

			if (this.stopped) return;
			if (backoffMs !== null) this.backoffUntil = this.now() + backoffMs;
			if (changed) await this.deps.broadcastSnapshots();
			if (errors.length > 0) {
				this.logger.warn('[miko] failed to poll workspace PR state', errors[0]);
			}
		} catch (error) {
			if (this.stopped) return;
			const backoffMs = retryAfterMs(error, this.defaultBackoffMs);
			if (backoffMs !== null) this.backoffUntil = this.now() + backoffMs;
			this.logger.warn('[miko] failed to poll workspace PR state', error);
		}
	}
}
