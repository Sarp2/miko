import type { WorkspaceRecord } from './event';
import { shouldPollActiveWorkspace } from './workspace-polling';

const DEFAULT_INTERVAL_MS = 2_000;

export interface GitRefreshPollerDeps {
	listWorkspaces: () => WorkspaceRecord[];
	refreshWorkspaceGitSnapshot: (workspaceId: string, localPath: string) => Promise<boolean>;
	broadcastSnapshots: () => Promise<void>;
	setInterval?: typeof setInterval;
	clearInterval?: typeof clearInterval;
	logger?: Pick<Console, 'warn'>;
	intervalMs?: number;
}

export class GitRefreshPoller {
	private readonly intervalMs: number;
	private readonly setIntervalImpl: typeof setInterval;
	private readonly clearIntervalImpl: typeof clearInterval;
	private readonly logger: Pick<Console, 'warn'>;
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = false;
	private stopped = false;
	private inFlight: Promise<void> | null = null;

	constructor(private readonly deps: GitRefreshPollerDeps) {
		this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.setIntervalImpl = deps.setInterval ?? setInterval;
		this.clearIntervalImpl = deps.clearInterval ?? clearInterval;
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
		if (this.timer) this.clearIntervalImpl(this.timer);
		this.timer = null;
		await this.inFlight;
	}

	async tick() {
		if (this.stopped) return;
		if (this.running) return this.inFlight ?? undefined;

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
			const errors: unknown[] = [];
			const workspaces = this.deps.listWorkspaces().filter(shouldPollActiveWorkspace);

			await Promise.all(
				workspaces.map(async (workspace) => {
					try {
						if (await this.deps.refreshWorkspaceGitSnapshot(workspace.id, workspace.localPath)) {
							changed = true;
						}
					} catch (error) {
						errors.push(error);
					}
				}),
			);

			if (this.stopped) return;
			if (changed) await this.deps.broadcastSnapshots();
			if (errors.length > 0) {
				this.logger.warn('[miko] failed to poll workspace git state', errors[0]);
			}
		} catch (error) {
			if (this.stopped) return;
			this.logger.warn('[miko] failed to poll workspace git state', error);
		}
	}
}
