import { existsSync, readFileSync as readFileSyncImmediate } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { getDataDir, LOG_PREFIX } from 'src/shared/branding';
import type {
	AgentProvider,
	SessionHistoryPage,
	SessionHistorySnapshot,
	TranscriptEntry,
	WorkspacePullRequestSummary,
	WorkspaceReviewState,
	WorkspaceVisibilityState,
} from 'src/shared/types';
import {
	cloneTranscriptEntries,
	createEmptyState,
	type DirectoryEvent,
	type SessionEvent,
	type SnapshotFile,
	type StoreEvent,
	type StoreState,
	type TurnEvent,
	type WorkspaceEvent,
} from './event';
import { resolveLocalPath } from './paths';

const COMPACTION_THRESHOLD_BYTES = 2 * 1024 * 1024;

interface TranscriptPageResult {
	entries: TranscriptEntry[];
	hasOlder: boolean;
	olderCursor: string | null;
}

function encodeHistoryCursor(index: number) {
	return `idx:${index}`;
}

function decodeCursor(cursor: string) {
	if (cursor.startsWith('idx:')) {
		const value = Number.parseInt(cursor.slice('idx:'.length), 10);
		if (!Number.isInteger(value) || value < 0) {
			throw new Error('Invalid history cursor');
		}
		return value;
	}
	throw new Error('Invalid history cursor');
}

function getHistorySnapshot(
	page: TranscriptPageResult,
	recentLimit: number,
): SessionHistorySnapshot {
	return {
		hasOlder: page.hasOlder,
		olderCursor: page.olderCursor,
		recentLimit,
	};
}

export class EventStore {
	readonly dataDir: string;
	readonly state: StoreState = createEmptyState();
	private writeChain = Promise.resolve();
	private storageReset = false;
	private readonly snapshotPath: string;
	private readonly directoriesLogPath: string;
	private readonly workspacesLogPath: string;
	private readonly sessionsLogPath: string;
	private readonly turnsLogPath: string;
	private readonly transcriptsDir: string;
	private cachedTranscript: { sessionId: string; entries: TranscriptEntry[] } | null = null;

	constructor(dataDir = getDataDir(homedir())) {
		this.dataDir = dataDir;
		this.snapshotPath = path.join(this.dataDir, 'snapshot.json');
		this.directoriesLogPath = path.join(this.dataDir, 'directories.jsonl');
		this.workspacesLogPath = path.join(this.dataDir, 'workspaces.jsonl');
		this.sessionsLogPath = path.join(this.dataDir, 'sessions.jsonl');
		this.turnsLogPath = path.join(this.dataDir, 'turns.jsonl');
		this.transcriptsDir = path.join(this.dataDir, 'transcripts');
	}

	async initialize() {
		await mkdir(this.dataDir, { recursive: true });
		await mkdir(this.transcriptsDir, { recursive: true });
		await this.ensureFile(this.directoriesLogPath);
		await this.ensureFile(this.workspacesLogPath);
		await this.ensureFile(this.sessionsLogPath);
		await this.ensureFile(this.turnsLogPath);
		await this.loadSnapshot();
		await this.replayLogs();
		this.rebuildSessionMetadataFromTranscripts();

		if (await this.shouldCompact()) {
			await this.compact();
		}
	}

	private async ensureFile(filePath: string) {
		const file = Bun.file(filePath);
		if (!(await file.exists())) {
			await Bun.write(filePath, '');
		}
	}

	private async clearStorage() {
		if (this.storageReset) return;
		this.storageReset = true;
		this.resetState();

		await Promise.all([
			Bun.write(this.snapshotPath, ''),
			Bun.write(this.directoriesLogPath, ''),
			Bun.write(this.workspacesLogPath, ''),
			Bun.write(this.sessionsLogPath, ''),
			Bun.write(this.turnsLogPath, ''),
		]);
	}

	private async loadSnapshot() {
		const file = Bun.file(this.snapshotPath);
		if (!(await file.exists())) return;

		try {
			const text = await file.text();
			if (!text.trim()) return;

			const parsed = JSON.parse(text) as SnapshotFile;
			for (const directory of parsed.directories) {
				this.state.directoriesById.set(directory.id, { ...directory });
			}

			for (const workspace of parsed.workspaces) {
				this.state.workspacesById.set(workspace.id, { ...workspace });
			}
			for (const session of parsed.sessions) {
				this.state.sessionsById.set(session.id, { ...session });
			}
		} catch (error) {
			console.warn(`${LOG_PREFIX} Failed to load snapshot, resetting local history:`, error);
			await this.clearStorage();
		}
	}

	private resetState() {
		this.state.directoriesById.clear();
		this.state.workspacesById.clear();
		this.state.sessionsById.clear();
		this.cachedTranscript = null;
	}

	private async replayLogs() {
		if (this.storageReset) return;
		await this.replayLog<DirectoryEvent>(this.directoriesLogPath);
		if (this.storageReset) return;
		await this.replayLog<WorkspaceEvent>(this.workspacesLogPath);
		if (this.storageReset) return;
		await this.replayLog<SessionEvent>(this.sessionsLogPath);
		if (this.storageReset) return;
		await this.replayLog<TurnEvent>(this.turnsLogPath);
	}

	private async replayLog<_TEvent extends StoreEvent>(filePath: string) {
		const file = Bun.file(filePath);
		if (!(await file.exists())) return;

		const text = await file.text();
		if (!text.trim()) return;

		const lines = text.split('\n');
		let lastNonEmpty = -1;
		for (let index = lines.length - 1; index >= 0; index--) {
			if (lines[index].trim()) {
				lastNonEmpty = index;
				break;
			}
		}

		for (let index = 0; index < lines.length; index++) {
			const line = lines[index].trim();
			if (!line) continue;
			try {
				const event = JSON.parse(line) as Partial<StoreEvent>;
				this.applyEvent(event as StoreEvent);
			} catch (error) {
				if (index === lastNonEmpty) {
					console.warn(
						`${LOG_PREFIX} Ignoring corrupt trailing line in ${path.basename(filePath)}`,
					);
					return;
				}

				console.warn(
					`${LOG_PREFIX} Failed to replay ${path.basename(filePath)}, resetting local history:`,
					error,
				);
				await this.clearStorage();
				return;
			}
		}
	}

	private applyEvent(event: StoreEvent) {
		switch (event.type) {
			case 'directory_added': {
				const localPath = resolveLocalPath(event.localPath);
				this.state.directoriesById.set(event.directoryId, {
					id: event.directoryId,
					localPath,
					title: event.title,
					githubOwner: event.githubOwner,
					githubRepo: event.githubRepo,
					defaultBranchName: event.defaultBranchName,
					createdAt: event.timestamp,
					updatedAt: event.timestamp,
				});
				break;
			}
			case 'directory_removed': {
				const directory = this.state.directoriesById.get(event.directoryId);
				if (!directory) break;

				directory.removedAt = event.timestamp;
				directory.updatedAt = event.timestamp;
				break;
			}
			case 'workspace_created': {
				this.state.workspacesById.set(event.workspaceId, {
					id: event.workspaceId,
					directoryId: event.directoryId,
					localPath: resolveLocalPath(event.localPath),
					branchName: event.branchName,
					setupState: 'creating',
					reviewState: 'in_progress',
					visibilityState: 'active',
					hasUnreadAgentResult: false,
					createdAt: event.timestamp,
					updatedAt: event.timestamp,
				});
				break;
			}
			case 'workspace_removed': {
				const workspace = this.state.workspacesById.get(event.workspaceId);
				if (!workspace) break;

				workspace.removedAt = event.timestamp;
				workspace.updatedAt = event.timestamp;
				break;
			}
			case 'workspace_setup_completed': {
				const workspace = this.state.workspacesById.get(event.workspaceId);
				if (!workspace) break;
				workspace.setupState = 'ready';
				workspace.setupError = undefined;
				workspace.updatedAt = event.timestamp;
				break;
			}
			case 'workspace_setup_failed': {
				const workspace = this.state.workspacesById.get(event.workspaceId);
				if (!workspace) break;
				workspace.setupState = 'failed';
				workspace.setupError = event.error;
				workspace.updatedAt = event.timestamp;
				break;
			}
			case 'workspace_branch_name_changed': {
				const workspace = this.state.workspacesById.get(event.workspaceId);
				if (!workspace) break;

				workspace.branchName = event.branchName;
				workspace.updatedAt = event.timestamp;
				break;
			}
			case 'workspace_review_state_changed': {
				const workspace = this.state.workspacesById.get(event.workspaceId);
				if (!workspace) break;
				workspace.reviewState = event.reviewState;
				workspace.updatedAt = event.timestamp;
				break;
			}
			case 'workspace_visibility_changed': {
				const workspace = this.state.workspacesById.get(event.workspaceId);
				if (!workspace) break;
				workspace.visibilityState = event.visibilityState;
				workspace.updatedAt = event.timestamp;
				break;
			}
			case 'workspace_pr_observed': {
				const workspace = this.state.workspacesById.get(event.workspaceId);
				if (!workspace) break;
				workspace.pullRequest = event.pullRequest;
				workspace.updatedAt = event.timestamp;
				break;
			}
			case 'workspace_unread_agent_result_set': {
				const workspace = this.state.workspacesById.get(event.workspaceId);
				if (!workspace) break;
				workspace.hasUnreadAgentResult = event.hasUnreadAgentResult;
				workspace.updatedAt = event.timestamp;
				break;
			}
			case 'session_created': {
				this.state.sessionsById.set(event.sessionId, {
					id: event.sessionId,
					workspaceId: event.workspaceId,
					title: event.title,
					createdAt: event.timestamp,
					updatedAt: event.timestamp,
					provider: null,
					planMode: false,
					sessionToken: null,
					lastTurnOutcome: null,
				});
				break;
			}
			case 'session_renamed': {
				const session = this.state.sessionsById.get(event.sessionId);
				if (!session) break;

				session.title = event.title;
				session.updatedAt = event.timestamp;
				break;
			}
			case 'session_removed': {
				const session = this.state.sessionsById.get(event.sessionId);
				if (!session) break;
				session.removedAt = event.timestamp;
				session.updatedAt = event.timestamp;
				break;
			}
			case 'session_provider_set': {
				const session = this.state.sessionsById.get(event.sessionId);
				if (!session) break;
				session.provider = event.provider;
				session.updatedAt = event.timestamp;
				break;
			}
			case 'session_plan_mode_set': {
				const session = this.state.sessionsById.get(event.sessionId);
				if (!session) break;
				session.planMode = event.planMode;
				session.updatedAt = event.timestamp;
				break;
			}
			case 'turn_started': {
				const session = this.state.sessionsById.get(event.sessionId);
				if (!session) break;
				session.updatedAt = event.timestamp;
				break;
			}
			case 'turn_finished': {
				const session = this.state.sessionsById.get(event.sessionId);
				if (!session) break;
				session.updatedAt = event.timestamp;
				session.lastTurnOutcome = 'success';
				break;
			}
			case 'turn_failed': {
				const session = this.state.sessionsById.get(event.sessionId);
				if (!session) break;
				session.updatedAt = event.timestamp;
				session.lastTurnOutcome = 'failed';
				break;
			}
			case 'turn_cancelled': {
				const session = this.state.sessionsById.get(event.sessionId);
				if (!session) break;
				session.updatedAt = event.timestamp;
				session.lastTurnOutcome = 'cancelled';
				break;
			}
			case 'session_token_set': {
				const session = this.state.sessionsById.get(event.sessionId);
				if (!session) break;
				session.sessionToken = event.sessionToken;
				session.updatedAt = event.timestamp;
				break;
			}
		}
	}

	private applyMessageMetadata(sessionId: string, entry: TranscriptEntry) {
		const session = this.state.sessionsById.get(sessionId);
		if (!session) return;

		if (entry.kind === 'user_prompt') {
			session.lastMessageAt = entry.createdAt;
		}
		session.updatedAt = Math.max(session.updatedAt, entry.createdAt);
	}

	private append<TEvent extends StoreEvent>(filePath: string, event: TEvent) {
		const payload = `${JSON.stringify(event)}\n`;
		return this.enqueueWrite(async () => {
			await appendFile(filePath, payload, 'utf-8');
			this.applyEvent(event);
		});
	}

	private enqueueWrite<T>(operation: () => Promise<T>) {
		const run = this.writeChain.catch(() => undefined).then(operation);
		this.writeChain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	private transcriptPath(sessionId: string) {
		return path.join(this.transcriptsDir, `${sessionId}.jsonl`);
	}

	private loadTranscriptFromDisk(sessionId: string) {
		const transcriptPath = this.transcriptPath(sessionId);
		if (!existsSync(transcriptPath)) return [];

		const text = readFileSyncImmediate(transcriptPath, 'utf-8');
		if (!text.trim()) return [];

		const entries: TranscriptEntry[] = [];
		const lines = text.split('\n');
		let lastNonEmpty = -1;
		for (let index = lines.length - 1; index >= 0; index--) {
			if (lines[index].trim()) {
				lastNonEmpty = index;
				break;
			}
		}

		for (let index = 0; index < lines.length; index++) {
			const rawLine = lines[index];
			const line = rawLine.trim();
			if (!line) continue;
			try {
				entries.push(JSON.parse(line) as TranscriptEntry);
			} catch (error) {
				if (index === lastNonEmpty) {
					console.warn(`${LOG_PREFIX} Ignoring corrupt trailing line in transcript ${sessionId}`);
					return entries;
				}

				console.warn(`${LOG_PREFIX} Stopped reading corrupt transcript ${sessionId}:`, error);
				return entries;
			}
		}
		return entries;
	}

	private rebuildSessionMetadataFromTranscripts() {
		for (const session of this.state.sessionsById.values()) {
			if (session.removedAt) continue;
			for (const entry of this.loadTranscriptFromDisk(session.id)) {
				this.applyMessageMetadata(session.id, entry);
			}
		}
	}

	async addDirectory(args: {
		localPath: string;
		title?: string;
		githubOwner: string;
		githubRepo: string;
	}) {
		const localPath = resolveLocalPath(args.localPath);
		const existing = this.listDirectories().find((directory) => directory.localPath === localPath);
		if (existing) return existing;

		const directoryId = crypto.randomUUID();
		const event: DirectoryEvent = {
			type: 'directory_added',
			timestamp: Date.now(),
			directoryId,
			localPath,
			title: args.title?.trim() || path.basename(localPath) || localPath,
			githubOwner: args.githubOwner,
			githubRepo: args.githubRepo,
			defaultBranchName: 'main',
		};

		await this.append(this.directoriesLogPath, event);
		return this.requireDirectory(directoryId);
	}

	async removeDirectory(directoryId: string) {
		this.requireDirectory(directoryId);
		const event: DirectoryEvent = {
			type: 'directory_removed',
			timestamp: Date.now(),
			directoryId,
		};

		await this.append(this.directoriesLogPath, event);
	}

	async createWorkspace(args: { directoryId: string; localPath: string; branchName: string }) {
		this.requireDirectory(args.directoryId);
		const localPath = resolveLocalPath(args.localPath);
		const existingWorkspaces = this.listWorkspaces();
		if (existingWorkspaces.some((workspace) => workspace.localPath === localPath)) {
			throw new Error('Workspace path is already in use');
		}

		if (
			existingWorkspaces.some(
				(workspace) =>
					workspace.directoryId === args.directoryId && workspace.branchName === args.branchName,
			)
		) {
			throw new Error('Workspace branch is already in use for this directory');
		}

		const workspaceId = crypto.randomUUID();
		const event: WorkspaceEvent = {
			type: 'workspace_created',
			timestamp: Date.now(),
			workspaceId,
			directoryId: args.directoryId,
			localPath,
			branchName: args.branchName,
		};

		await this.append(this.workspacesLogPath, event);
		return this.requireWorkspace(workspaceId);
	}

	async removeWorkspace(workspaceId: string) {
		this.requireWorkspace(workspaceId);
		const event: WorkspaceEvent = {
			type: 'workspace_removed',
			timestamp: Date.now(),
			workspaceId,
		};

		await this.append(this.workspacesLogPath, event);
	}

	async markWorkspaceSetupCompleted(workspaceId: string) {
		const workspace = this.requireWorkspace(workspaceId);
		if (workspace.setupState === 'ready') return;

		const event: WorkspaceEvent = {
			type: 'workspace_setup_completed',
			timestamp: Date.now(),
			workspaceId,
		};

		await this.append(this.workspacesLogPath, event);
	}

	async markWorkspaceSetupFailed(workspaceId: string, error: string) {
		const workspace = this.requireWorkspace(workspaceId);
		if (workspace.setupState === 'failed' && workspace.setupError === error) return;

		const event: WorkspaceEvent = {
			type: 'workspace_setup_failed',
			timestamp: Date.now(),
			workspaceId,
			error,
		};

		await this.append(this.workspacesLogPath, event);
	}

	async setWorkspaceBranch(workspaceId: string, branchName: string) {
		const workspace = this.requireWorkspace(workspaceId);
		if (workspace.branchName === branchName) return;

		const event: WorkspaceEvent = {
			type: 'workspace_branch_name_changed',
			timestamp: Date.now(),
			workspaceId,
			branchName,
		};

		await this.append(this.workspacesLogPath, event);
	}

	async setWorkspaceReviewState(workspaceId: string, reviewState: WorkspaceReviewState) {
		const workspace = this.requireWorkspace(workspaceId);
		if (workspace.reviewState === reviewState) return;

		const event: WorkspaceEvent = {
			type: 'workspace_review_state_changed',
			timestamp: Date.now(),
			workspaceId,
			reviewState,
		};

		await this.append(this.workspacesLogPath, event);
	}

	async setWorkspaceVisibilityState(
		workspaceId: string,
		visibilityState: WorkspaceVisibilityState,
	) {
		const workspace = this.requireWorkspace(workspaceId);
		if (workspace.visibilityState === visibilityState) return;

		const event: WorkspaceEvent = {
			type: 'workspace_visibility_changed',
			timestamp: Date.now(),
			workspaceId,
			visibilityState,
		};

		await this.append(this.workspacesLogPath, event);
	}

	async observeWorkspacePullRequest(workspaceId: string, pullRequest: WorkspacePullRequestSummary) {
		const workspace = this.requireWorkspace(workspaceId);
		if (
			workspace.pullRequest?.number === pullRequest.number &&
			workspace.pullRequest.status === pullRequest.status &&
			workspace.pullRequest.title === pullRequest.title &&
			workspace.pullRequest.url === pullRequest.url &&
			workspace.pullRequest.headRefName === pullRequest.headRefName &&
			workspace.pullRequest.baseRefName === pullRequest.baseRefName &&
			workspace.pullRequest.ciStatus === pullRequest.ciStatus &&
			workspace.pullRequest.createdAt === pullRequest.createdAt
		) {
			return;
		}

		const event: WorkspaceEvent = {
			type: 'workspace_pr_observed',
			timestamp: Date.now(),
			workspaceId,
			pullRequest,
		};

		await this.append(this.workspacesLogPath, event);
	}

	async setWorkspaceUnreadAgentResult(workspaceId: string, hasUnreadAgentResult: boolean) {
		const workspace = this.requireWorkspace(workspaceId);
		if (workspace.hasUnreadAgentResult === hasUnreadAgentResult) return;

		const event: WorkspaceEvent = {
			type: 'workspace_unread_agent_result_set',
			timestamp: Date.now(),
			workspaceId,
			hasUnreadAgentResult,
		};

		await this.append(this.workspacesLogPath, event);
	}

	async createSession(workspaceId: string, title = 'New Session') {
		const workspace = this.requireWorkspace(workspaceId);
		if (workspace.setupState !== 'ready') {
			throw new Error('Workspace is not ready');
		}
		const sessionId = crypto.randomUUID();
		const event: SessionEvent = {
			type: 'session_created',
			timestamp: Date.now(),
			sessionId,
			workspaceId,
			title,
		};

		await this.append(this.sessionsLogPath, event);
		return this.requireSession(sessionId);
	}

	async renameSession(sessionId: string, title: string) {
		const trimmed = title.trim();
		if (!trimmed) return;

		const session = this.requireSession(sessionId);

		if (session.title === trimmed) return;
		const event: SessionEvent = {
			type: 'session_renamed',
			timestamp: Date.now(),
			sessionId,
			title: trimmed,
		};

		await this.append(this.sessionsLogPath, event);
	}

	async removeSession(sessionId: string) {
		this.requireSession(sessionId);
		const event: SessionEvent = {
			type: 'session_removed',
			timestamp: Date.now(),
			sessionId,
		};

		await this.append(this.sessionsLogPath, event);
	}

	async setSessionProvider(sessionId: string, provider: AgentProvider) {
		const session = this.requireSession(sessionId);
		if (session.provider === provider) return;

		const event: SessionEvent = {
			type: 'session_provider_set',
			timestamp: Date.now(),
			sessionId,
			provider,
		};

		await this.append(this.sessionsLogPath, event);
	}

	async setPlanMode(sessionId: string, planMode: boolean) {
		const session = this.requireSession(sessionId);
		if (session.planMode === planMode) return;

		const event: SessionEvent = {
			type: 'session_plan_mode_set',
			timestamp: Date.now(),
			sessionId,
			planMode,
		};

		await this.append(this.sessionsLogPath, event);
	}

	async appendMessage(sessionId: string, entry: TranscriptEntry) {
		this.requireSession(sessionId);
		const storedEntry = cloneTranscriptEntries([entry])[0];
		const payload = `${JSON.stringify(storedEntry)}\n`;
		const transcriptPath = this.transcriptPath(sessionId);

		return this.enqueueWrite(async () => {
			await mkdir(this.transcriptsDir, { recursive: true });
			await appendFile(transcriptPath, payload, 'utf-8');

			this.applyMessageMetadata(sessionId, storedEntry);
			if (this.cachedTranscript?.sessionId === sessionId) {
				this.cachedTranscript.entries.push(storedEntry);
			}
		});
	}

	async recordTurnStarted(sessionId: string) {
		this.requireSession(sessionId);
		await this.append(this.turnsLogPath, {
			type: 'turn_started',
			timestamp: Date.now(),
			sessionId,
		} satisfies TurnEvent);
	}

	async recordTurnFinished(sessionId: string) {
		const session = this.requireSession(sessionId);
		await this.append(this.turnsLogPath, {
			type: 'turn_finished',
			timestamp: Date.now(),
			sessionId,
		} satisfies TurnEvent);
		await this.setWorkspaceUnreadAgentResult(session.workspaceId, true);
	}

	async recordTurnFailed(sessionId: string, error: string) {
		const session = this.requireSession(sessionId);
		await this.append(this.turnsLogPath, {
			type: 'turn_failed',
			timestamp: Date.now(),
			sessionId,
			error,
		} satisfies TurnEvent);

		await this.setWorkspaceUnreadAgentResult(session.workspaceId, true);
	}

	async recordTurnCancelled(sessionId: string) {
		this.requireSession(sessionId);
		await this.append(this.turnsLogPath, {
			type: 'turn_cancelled',
			timestamp: Date.now(),
			sessionId,
		} satisfies TurnEvent);
	}

	async setSessionToken(sessionId: string, sessionToken: string | null) {
		const session = this.requireSession(sessionId);
		if (session.sessionToken === sessionToken) return;

		await this.append(this.turnsLogPath, {
			type: 'session_token_set',
			timestamp: Date.now(),
			sessionId,
			sessionToken,
		} satisfies TurnEvent);
	}

	getDirectory(directoryId: string) {
		const directory = this.state.directoriesById.get(directoryId);
		if (!directory || directory.removedAt) return null;
		return directory;
	}

	requireDirectory(directoryId: string) {
		const directory = this.getDirectory(directoryId);
		if (!directory) throw new Error('Directory not found');
		return directory;
	}

	getWorkspace(workspaceId: string) {
		const workspace = this.state.workspacesById.get(workspaceId);
		if (!workspace || workspace.removedAt) return null;
		if (!this.getDirectory(workspace.directoryId)) return null;
		return workspace;
	}

	requireWorkspace(workspaceId: string) {
		const workspace = this.getWorkspace(workspaceId);
		if (!workspace) throw new Error('Workspace not found');
		return workspace;
	}

	getSession(sessionId: string) {
		const session = this.state.sessionsById.get(sessionId);
		if (!session || session.removedAt) return null;
		return session;
	}

	requireSession(sessionId: string) {
		const session = this.getSession(sessionId);
		if (!session) throw new Error('Session not found');
		return session;
	}

	getMessages(sessionId: string) {
		if (this.cachedTranscript?.sessionId === sessionId) {
			return cloneTranscriptEntries(this.cachedTranscript.entries);
		}

		const entries = this.loadTranscriptFromDisk(sessionId);
		this.cachedTranscript = { sessionId, entries };
		return cloneTranscriptEntries(entries);
	}

	private getMessagesPageFromEntries(
		entries: TranscriptEntry[],
		limit: number,
		beforeIndex?: number,
	): TranscriptPageResult {
		if (entries.length === 0) return { entries: [], hasOlder: false, olderCursor: null };
		const endIndex =
			beforeIndex === undefined
				? entries.length
				: Math.max(0, Math.min(beforeIndex, entries.length));
		const startIndex = Math.max(0, endIndex - limit);
		return {
			entries: cloneTranscriptEntries(entries.slice(startIndex, endIndex)),
			hasOlder: startIndex > 0,
			olderCursor: startIndex > 0 ? encodeHistoryCursor(startIndex) : null,
		};
	}

	getRecentMessagesPage(sessionId: string, limit: number): SessionHistoryPage {
		if (limit <= 0) return { messages: [], hasOlder: false, olderCursor: null };
		const { entries, ...rest } = this.getMessagesPageFromEntries(
			this.getMessages(sessionId),
			limit,
		);
		return { messages: entries, ...rest };
	}

	getMessagesPageBefore(
		sessionId: string,
		beforeCursor: string,
		limit: number,
	): SessionHistoryPage {
		if (limit <= 0) return { messages: [], hasOlder: false, olderCursor: null };
		const beforeIndex = decodeCursor(beforeCursor);
		const { entries, ...rest } = this.getMessagesPageFromEntries(
			this.getMessages(sessionId),
			limit,
			beforeIndex,
		);
		return { messages: entries, ...rest };
	}

	getRecentSessionHistory(sessionId: string, recentLimit: number) {
		const page = this.getRecentMessagesPage(sessionId, recentLimit);
		return {
			messages: page.messages,
			history: getHistorySnapshot(
				{
					entries: page.messages,
					hasOlder: page.hasOlder,
					olderCursor: page.olderCursor,
				},
				recentLimit,
			),
		};
	}

	listDirectories() {
		return [...this.state.directoriesById.values()].filter((directory) => !directory.removedAt);
	}

	listWorkspaces() {
		return [...this.state.workspacesById.values()].filter(
			(workspace) => !workspace.removedAt && Boolean(this.getDirectory(workspace.directoryId)),
		);
	}

	listWorkspacesByDirectory(directoryId: string) {
		return this.listWorkspaces().filter((workspace) => workspace.directoryId === directoryId);
	}

	listSessionsByWorkspace(workspaceId: string) {
		return [...this.state.sessionsById.values()].filter(
			(session) => session.workspaceId === workspaceId && !session.removedAt,
		);
	}

	private createSnapshot(): SnapshotFile {
		return {
			generatedAt: Date.now(),
			directories: [...this.state.directoriesById.values()].map((directory) => ({
				...directory,
			})),
			workspaces: [...this.state.workspacesById.values()].map((workspace) => ({ ...workspace })),
			sessions: [...this.state.sessionsById.values()].map((session) => ({ ...session })),
		};
	}

	async compact() {
		return this.enqueueWrite(async () => {
			const snapshot = this.createSnapshot();
			await Bun.write(this.snapshotPath, JSON.stringify(snapshot, null, 2));
			await Promise.all([
				Bun.write(this.directoriesLogPath, ''),
				Bun.write(this.workspacesLogPath, ''),
				Bun.write(this.sessionsLogPath, ''),
				Bun.write(this.turnsLogPath, ''),
			]);
		});
	}

	private async shouldCompact() {
		const sizes = await Promise.all([
			Bun.file(this.directoriesLogPath).size,
			Bun.file(this.workspacesLogPath).size,
			Bun.file(this.sessionsLogPath).size,
			Bun.file(this.turnsLogPath).size,
		]);
		return sizes.reduce((total, size) => total + size, 0) >= COMPACTION_THRESHOLD_BYTES;
	}
}
