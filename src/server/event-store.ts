import { existsSync, readFileSync as readFileSyncImmediate } from 'node:fs';
import { appendFile, chmod, mkdir, open, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { getDataDir, LOG_PREFIX } from 'src/shared/branding';
import type {
	AgentProvider,
	SessionHistoryPage,
	SessionHistorySnapshot,
	TranscriptEntry,
	WorkspaceDiffFile,
	WorkspacePullRequestSummary,
	WorkspaceReviewState,
	WorkspaceVisibilityState,
} from 'src/shared/types';
import { acquireDataDirLock, type DataDirLock } from './data-dir-lock';
import { atomicWriteFile, quarantineFile, readTextIfExists } from './durable-file';
import {
	cloneTranscriptEntries,
	createEmptyState,
	type DirectoryEvent,
	type QueuedSessionMessageRecord,
	type QueuedSessionSendPayload,
	type QueueEvent,
	type SessionEvent,
	type SnapshotFile,
	type StoreEvent,
	type StoreState,
	type TurnEvent,
	type WorkspaceEvent,
} from './event';
import { resolveLocalPath } from './paths';

const COMPACTION_THRESHOLD_BYTES = 2 * 1024 * 1024;
const SESSION_MESSAGE_PREVIEW_MAX_LENGTH = 140;
export const MAX_QUEUED_SESSION_MESSAGES = 25;

function workspaceDiffFilesSignature(files: WorkspaceDiffFile[] | undefined) {
	return JSON.stringify(
		(files ?? [])
			.map((file) => ({
				path: file.path,
				changeType: file.changeType,
				isUntracked: file.isUntracked,
				additions: file.additions,
				deletions: file.deletions,
				patchDigest: file.patchDigest,
				mimeType: file.mimeType,
				size: file.size,
			}))
			.sort((left, right) => left.path.localeCompare(right.path)),
	);
}

function pullRequestCommentsSignature(comments: WorkspacePullRequestSummary['comments']) {
	return JSON.stringify(
		(comments ?? [])
			.map((comment) => ({
				id: comment.id,
				author: comment.author,
				authorAssociation: comment.authorAssociation,
				body: comment.body,
				url: comment.url,
				path: comment.path,
				line: comment.line,
				isResolved: comment.isResolved,
				isBot: comment.isBot,
				source: comment.source,
				createdAt: comment.createdAt,
				updatedAt: comment.updatedAt,
			}))
			.sort((left, right) => left.id.localeCompare(right.id)),
	);
}

function pullRequestChecksSignature(checks: WorkspacePullRequestSummary['checks']) {
	return JSON.stringify(
		(checks ?? [])
			.map((check) => ({
				name: check.name,
				workflowName: check.workflowName,
				status: check.status,
				conclusion: check.conclusion,
				detailsUrl: check.detailsUrl,
				startedAt: check.startedAt,
				completedAt: check.completedAt,
				summary: check.summary,
				canFetchLogs: check.canFetchLogs,
			}))
			.sort((left, right) =>
				[
					left.workflowName ?? '',
					left.name,
					left.detailsUrl ?? '',
					left.startedAt ?? '',
					left.completedAt ?? '',
					left.conclusion ?? '',
				]
					.join('\0')
					.localeCompare(
						[
							right.workflowName ?? '',
							right.name,
							right.detailsUrl ?? '',
							right.startedAt ?? '',
							right.completedAt ?? '',
							right.conclusion ?? '',
						].join('\0'),
					),
			),
	);
}

function pullRequestFilesEqual(
	left: WorkspacePullRequestSummary['files'],
	right: WorkspacePullRequestSummary['files'],
) {
	return workspaceDiffFilesSignature(left) === workspaceDiffFilesSignature(right);
}

function pullRequestCommentsEqual(
	left: WorkspacePullRequestSummary['comments'],
	right: WorkspacePullRequestSummary['comments'],
) {
	return pullRequestCommentsSignature(left) === pullRequestCommentsSignature(right);
}

function pullRequestChecksEqual(
	left: WorkspacePullRequestSummary['checks'],
	right: WorkspacePullRequestSummary['checks'],
) {
	return pullRequestChecksSignature(left) === pullRequestChecksSignature(right);
}

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

function messagePreview(content: string) {
	const collapsed = content.replace(/\s+/g, ' ').trim();
	if (collapsed.length <= SESSION_MESSAGE_PREVIEW_MAX_LENGTH) return collapsed;
	return `${collapsed.slice(0, SESSION_MESSAGE_PREVIEW_MAX_LENGTH - 1).trimEnd()}…`;
}

interface EventStoreOptions {
	lockDataDir?: boolean;
}

export class EventStore {
	readonly dataDir: string;
	readonly state: StoreState = createEmptyState();
	private writeChain = Promise.resolve();
	private readonly snapshotPath: string;
	private readonly snapshotBackupPath: string;
	private readonly directoriesLogPath: string;
	private readonly workspacesLogPath: string;
	private readonly sessionsLogPath: string;
	private readonly turnsLogPath: string;
	private readonly queuesLogPath: string;
	private readonly transcriptsDir: string;
	private readonly lockDataDir: boolean;
	private dataDirLock: DataDirLock | null = null;
	private cachedTranscript: { sessionId: string; entries: TranscriptEntry[] } | null = null;
	private nextQueueSequence = 1;

	constructor(dataDir = getDataDir(homedir()), options: EventStoreOptions = {}) {
		this.dataDir = dataDir;
		this.lockDataDir = options.lockDataDir ?? false;
		this.snapshotPath = path.join(this.dataDir, 'snapshot.json');
		this.snapshotBackupPath = path.join(this.dataDir, 'snapshot.previous.json');
		this.directoriesLogPath = path.join(this.dataDir, 'directories.jsonl');
		this.workspacesLogPath = path.join(this.dataDir, 'workspaces.jsonl');
		this.sessionsLogPath = path.join(this.dataDir, 'sessions.jsonl');
		this.turnsLogPath = path.join(this.dataDir, 'turns.jsonl');
		this.queuesLogPath = path.join(this.dataDir, 'queues.jsonl');
		this.transcriptsDir = path.join(this.dataDir, 'transcripts');
	}

	private normalizeQueuedMessage(message: QueuedSessionMessageRecord) {
		this.nextQueueSequence = Math.max(this.nextQueueSequence, message.sequence + 1);
		return structuredClone(message);
	}

	async initialize() {
		if (this.lockDataDir) {
			this.dataDirLock = await acquireDataDirLock(this.dataDir);
		}

		try {
			await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
			await chmod(this.dataDir, 0o700);
			await mkdir(this.transcriptsDir, { recursive: true, mode: 0o700 });
			await chmod(this.transcriptsDir, 0o700);
			await this.ensureFile(this.directoriesLogPath);
			await this.ensureFile(this.workspacesLogPath);
			await this.ensureFile(this.sessionsLogPath);
			await this.ensureFile(this.turnsLogPath);
			await this.ensureFile(this.queuesLogPath);
			await this.loadSnapshot();
			await this.replayLogs();
			await this.repairTranscriptLogs();
			this.rebuildSessionMetadataFromTranscripts();

			if (await this.shouldCompact()) {
				await this.compact();
			}
		} catch (error) {
			await this.releaseDataDirLock();
			throw error;
		}
	}

	async releaseDataDirLock() {
		const lock = this.dataDirLock;
		this.dataDirLock = null;
		await lock?.release();
	}

	private async ensureFile(filePath: string) {
		const handle = await open(filePath, 'a', 0o600);
		await handle.close();
		await chmod(filePath, 0o600);
	}

	private async loadSnapshot() {
		const snapshotText = await readTextIfExists(this.snapshotPath);
		if (snapshotText?.trim()) {
			try {
				this.applySnapshot(JSON.parse(snapshotText) as SnapshotFile);
				return;
			} catch (error) {
				const quarantinePath = await quarantineFile(this.snapshotPath);
				console.warn(
					`${LOG_PREFIX} Failed to load snapshot; quarantined it at ${quarantinePath}:`,
					error,
				);
				this.resetState();
			}
		}

		const backupText = await readTextIfExists(this.snapshotBackupPath);
		if (!backupText?.trim()) return;

		try {
			this.applySnapshot(JSON.parse(backupText) as SnapshotFile);
			await atomicWriteFile(this.snapshotPath, backupText);
			console.warn(`${LOG_PREFIX} Recovered local history from the previous snapshot.`);
		} catch (error) {
			const quarantinePath = await quarantineFile(this.snapshotBackupPath);
			console.warn(
				`${LOG_PREFIX} Failed to load previous snapshot; quarantined it at ${quarantinePath}:`,
				error,
			);
			this.resetState();
		}
	}

	private applySnapshot(parsed: SnapshotFile) {
		if (
			!Array.isArray(parsed.directories) ||
			!Array.isArray(parsed.workspaces) ||
			!Array.isArray(parsed.sessions) ||
			(parsed.queuedMessages !== undefined && !Array.isArray(parsed.queuedMessages))
		) {
			throw new Error('Snapshot has an invalid shape');
		}

		for (const directory of parsed.directories) {
			this.state.directoriesById.set(directory.id, { ...directory });
		}
		for (const workspace of parsed.workspaces) {
			this.state.workspacesById.set(workspace.id, { ...workspace });
		}
		for (const session of parsed.sessions) {
			this.state.sessionsById.set(session.id, { ...session });
		}
		for (const queued of parsed.queuedMessages ?? []) {
			const normalized = this.normalizeQueuedMessage(queued);
			this.state.queuedMessagesById.set(normalized.id, normalized);
		}
	}

	private resetState() {
		this.state.directoriesById.clear();
		this.state.workspacesById.clear();
		this.state.sessionsById.clear();
		this.state.queuedMessagesById.clear();
		this.cachedTranscript = null;
		this.nextQueueSequence = 1;
	}

	private async replayLogs() {
		await this.replayLog<DirectoryEvent>(this.directoriesLogPath);
		await this.replayLog<WorkspaceEvent>(this.workspacesLogPath);
		await this.replayLog<SessionEvent>(this.sessionsLogPath);
		await this.replayLog<TurnEvent>(this.turnsLogPath);
		await this.replayLog<QueueEvent>(this.queuesLogPath);
	}

	private async replayLog<_TEvent extends StoreEvent>(filePath: string) {
		const text = await readTextIfExists(filePath);
		if (text === null) return;
		if (!text.trim()) return;

		const lines = text.split('\n');
		const validLines: string[] = [];
		let corruptionDetected = false;

		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) continue;
			try {
				const event = JSON.parse(line) as Partial<StoreEvent>;
				this.applyEvent(event as StoreEvent);
				validLines.push(line);
			} catch {
				corruptionDetected = true;
			}
		}

		if (!corruptionDetected) return;

		const quarantinePath = await quarantineFile(filePath);
		await atomicWriteFile(filePath, validLines.length > 0 ? `${validLines.join('\n')}\n` : '');
		console.warn(
			`${LOG_PREFIX} Recovered valid events from ${path.basename(filePath)}; quarantined the damaged log at ${quarantinePath}.`,
		);
	}

	private async repairTranscriptLogs() {
		const entries = await readdir(this.transcriptsDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

			const filePath = path.join(this.transcriptsDir, entry.name);
			const text = await readTextIfExists(filePath);
			if (!text?.trim()) continue;

			const validLines: string[] = [];
			let corruptionDetected = false;
			for (const rawLine of text.split('\n')) {
				const line = rawLine.trim();
				if (!line) continue;
				try {
					JSON.parse(line);
					validLines.push(line);
				} catch {
					corruptionDetected = true;
				}
			}

			if (!corruptionDetected) {
				await chmod(filePath, 0o600);
				continue;
			}

			const quarantinePath = await quarantineFile(filePath);
			await atomicWriteFile(filePath, validLines.length > 0 ? `${validLines.join('\n')}\n` : '');
			console.warn(
				`${LOG_PREFIX} Recovered valid transcript entries from ${entry.name}; quarantined the damaged transcript at ${quarantinePath}.`,
			);
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
			case 'workspace_pr_cleared': {
				const workspace = this.state.workspacesById.get(event.workspaceId);
				if (!workspace) break;
				workspace.pullRequest = undefined;
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
				for (const queued of this.state.queuedMessagesById.values()) {
					if (queued.sessionId === event.sessionId) {
						this.state.queuedMessagesById.delete(queued.id);
					}
				}
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
			case 'session_message_queued': {
				const message = this.normalizeQueuedMessage(event.message);
				if (!this.getSession(message.sessionId)) break;
				this.state.queuedMessagesById.set(message.id, message);
				break;
			}
			case 'session_message_claimed': {
				const queued = this.state.queuedMessagesById.get(event.messageId);
				if (!queued || queued.sessionId !== event.sessionId || queued.status !== 'queued') break;
				queued.status = 'draining';
				queued.promptEntryId = event.promptEntryId;
				queued.updatedAt = event.timestamp;
				break;
			}
			case 'session_message_requeued': {
				const queued = this.state.queuedMessagesById.get(event.messageId);
				if (!queued || queued.sessionId !== event.sessionId || queued.status !== 'draining') break;
				queued.status = 'queued';
				queued.updatedAt = event.timestamp;
				break;
			}
			case 'session_message_completed':
			case 'session_message_failed':
			case 'session_message_dequeued': {
				const queued = this.state.queuedMessagesById.get(event.messageId);
				if (!queued || queued.sessionId !== event.sessionId) break;
				this.state.queuedMessagesById.delete(event.messageId);
				break;
			}
			case 'session_queue_cleared': {
				for (const queued of this.state.queuedMessagesById.values()) {
					if (queued.sessionId === event.sessionId) {
						this.state.queuedMessagesById.delete(queued.id);
					}
				}
				break;
			}
		}
	}

	private applyMessageMetadata(sessionId: string, entry: TranscriptEntry) {
		const session = this.state.sessionsById.get(sessionId);
		if (!session) return;

		if (!entry.hidden && (entry.kind === 'user_prompt' || entry.kind === 'assistant_text')) {
			session.lastMessageAt = entry.createdAt;
		}

		if (entry.kind === 'assistant_text' && !entry.hidden) {
			session.lastAssistantPreview = messagePreview(entry.text);
		}

		session.updatedAt = Math.max(session.updatedAt, entry.createdAt);
	}

	private append<TEvent extends StoreEvent>(filePath: string, event: TEvent) {
		return this.enqueueWrite(async () => {
			await this.appendEventNow(filePath, event);
		});
	}

	private async appendEventNow<TEvent extends StoreEvent>(filePath: string, event: TEvent) {
		await appendFile(filePath, `${JSON.stringify(event)}\n`, {
			encoding: 'utf8',
			mode: 0o600,
		});
		this.applyEvent(event);
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

	private workspaceUploadDir(workspaceId: string) {
		return path.join(this.dataDir, 'uploads', workspaceId);
	}

	private scratchpadPath(workspaceId: string) {
		return path.join(this.dataDir, 'scratchpads', `${workspaceId}.md`);
	}

	private workspaceInstructionAttachmentPaths(workspaceId: string) {
		const instructionsDir = path.join(this.dataDir, 'agent-instructions');
		return [
			path.join(instructionsDir, `create-pr-${workspaceId}.md`),
			path.join(instructionsDir, `failing-ci-${workspaceId}.txt`),
			path.join(instructionsDir, `merge-conflict-${workspaceId}.md`),
			path.join(instructionsDir, `selected-review-comments-${workspaceId}.txt`),
		];
	}

	private async deleteSessionData(sessionId: string) {
		if (this.cachedTranscript?.sessionId === sessionId) {
			this.cachedTranscript = null;
		}
		await rm(this.transcriptPath(sessionId), { force: true });
	}

	private async deleteWorkspaceOwnedData(workspaceId: string) {
		await Promise.all([
			rm(this.workspaceUploadDir(workspaceId), { recursive: true, force: true }),
			rm(this.scratchpadPath(workspaceId), { force: true }),
			...this.workspaceInstructionAttachmentPaths(workspaceId).map((filePath) =>
				rm(filePath, { force: true }),
			),
		]);
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
		const workspaces = this.listWorkspacesByDirectory(directoryId);
		for (const workspace of workspaces) {
			await this.removeWorkspace(workspace.id);
		}
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
		const sessions = this.listSessionsByWorkspace(workspaceId);
		for (const session of sessions) {
			await this.removeSession(session.id);
		}
		const event: WorkspaceEvent = {
			type: 'workspace_removed',
			timestamp: Date.now(),
			workspaceId,
		};

		await this.append(this.workspacesLogPath, event);
		await this.deleteWorkspaceOwnedData(workspaceId);
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
			workspace.pullRequest.body === pullRequest.body &&
			workspace.pullRequest.url === pullRequest.url &&
			workspace.pullRequest.headRefName === pullRequest.headRefName &&
			workspace.pullRequest.baseRefName === pullRequest.baseRefName &&
			workspace.pullRequest.ciStatus === pullRequest.ciStatus &&
			workspace.pullRequest.isDraft === pullRequest.isDraft &&
			workspace.pullRequest.mergeStateStatus === pullRequest.mergeStateStatus &&
			workspace.pullRequest.hasMergeConflicts === pullRequest.hasMergeConflicts &&
			workspace.pullRequest.unresolvedCommentCount === pullRequest.unresolvedCommentCount &&
			workspace.pullRequest.additions === pullRequest.additions &&
			workspace.pullRequest.deletions === pullRequest.deletions &&
			workspace.pullRequest.createdAt === pullRequest.createdAt &&
			pullRequestFilesEqual(workspace.pullRequest.files, pullRequest.files) &&
			pullRequestCommentsEqual(workspace.pullRequest.comments, pullRequest.comments) &&
			pullRequestChecksEqual(workspace.pullRequest.checks, pullRequest.checks)
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

	async clearWorkspacePullRequest(workspaceId: string) {
		const workspace = this.requireWorkspace(workspaceId);
		if (!workspace.pullRequest) return;

		const event: WorkspaceEvent = {
			type: 'workspace_pr_cleared',
			timestamp: Date.now(),
			workspaceId,
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

	async createSession(workspaceId: string, title = 'Untitled') {
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
		await this.deleteSessionData(sessionId);
	}

	async enqueueSessionMessage(sessionId: string, payload: QueuedSessionSendPayload) {
		return this.enqueueWrite(async () => {
			this.requireSession(sessionId);
			const queueSize = [...this.state.queuedMessagesById.values()].filter(
				(message) => message.sessionId === sessionId,
			).length;
			if (queueSize >= MAX_QUEUED_SESSION_MESSAGES) {
				throw new Error(`Too many queued messages (max ${MAX_QUEUED_SESSION_MESSAGES}).`);
			}

			const id = crypto.randomUUID();
			const timestamp = Date.now();
			const message: QueuedSessionMessageRecord = {
				id,
				sessionId,
				payload: structuredClone(payload),
				status: 'queued',
				sequence: this.nextQueueSequence,
				promptEntryId: `queued-prompt:${id}`,
				createdAt: timestamp,
				updatedAt: timestamp,
			};
			this.nextQueueSequence += 1;

			await this.appendEventNow(this.queuesLogPath, {
				type: 'session_message_queued',
				timestamp,
				message,
			} satisfies QueueEvent);
			return structuredClone(message);
		});
	}

	async claimNextQueuedSessionMessage(sessionId: string) {
		return this.enqueueWrite(async () => {
			if (!this.getSession(sessionId)) return null;
			const messages = [...this.state.queuedMessagesById.values()].filter(
				(message) => message.sessionId === sessionId,
			);
			if (messages.some((message) => message.status === 'draining')) return null;

			const next =
				messages
					.filter((message) => message.status === 'queued')
					.toSorted((left, right) => left.sequence - right.sequence)[0] ?? null;
			if (!next) return null;
			await this.appendEventNow(this.queuesLogPath, {
				type: 'session_message_claimed',
				timestamp: Date.now(),
				sessionId,
				messageId: next.id,
				promptEntryId: next.promptEntryId,
			} satisfies QueueEvent);
			return this.getQueuedSessionMessage(next.id);
		});
	}

	async requeueSessionMessage(sessionId: string, messageId: string) {
		return this.enqueueWrite(async () => {
			const queued = this.state.queuedMessagesById.get(messageId);
			if (!queued || queued.sessionId !== sessionId || queued.status !== 'draining') return null;
			await this.appendEventNow(this.queuesLogPath, {
				type: 'session_message_requeued',
				timestamp: Date.now(),
				sessionId,
				messageId,
			} satisfies QueueEvent);
			return this.getQueuedSessionMessage(messageId);
		});
	}

	private async finishQueuedSessionMessage(
		type: 'session_message_completed' | 'session_message_failed' | 'session_message_dequeued',
		sessionId: string,
		messageId: string,
	) {
		return this.enqueueWrite(async () => {
			const queued = this.state.queuedMessagesById.get(messageId);
			if (!queued || queued.sessionId !== sessionId) return null;
			const snapshot = structuredClone(queued);
			await this.appendEventNow(this.queuesLogPath, {
				type,
				timestamp: Date.now(),
				sessionId,
				messageId,
			} satisfies QueueEvent);
			return snapshot;
		});
	}

	completeQueuedSessionMessage(sessionId: string, messageId: string) {
		return this.finishQueuedSessionMessage('session_message_completed', sessionId, messageId);
	}

	failQueuedSessionMessage(sessionId: string, messageId: string) {
		return this.finishQueuedSessionMessage('session_message_failed', sessionId, messageId);
	}

	dequeueSessionMessage(sessionId: string, messageId: string) {
		return this.finishQueuedSessionMessage('session_message_dequeued', sessionId, messageId);
	}

	async clearQueuedSessionMessages(sessionId: string) {
		return this.enqueueWrite(async () => {
			const queued = [...this.state.queuedMessagesById.values()]
				.filter((message) => message.sessionId === sessionId)
				.map((message) => structuredClone(message));
			if (queued.length === 0) return [];
			await this.appendEventNow(this.queuesLogPath, {
				type: 'session_queue_cleared',
				timestamp: Date.now(),
				sessionId,
			} satisfies QueueEvent);
			return queued;
		});
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

		return this.enqueueWrite(async () => {
			await this.appendMessageNow(sessionId, storedEntry);
		});
	}

	async appendMessageOnce(sessionId: string, entry: TranscriptEntry) {
		this.requireSession(sessionId);
		const storedEntry = cloneTranscriptEntries([entry])[0];
		return this.enqueueWrite(async () => {
			const entries =
				this.cachedTranscript?.sessionId === sessionId
					? this.cachedTranscript.entries
					: this.loadTranscriptFromDisk(sessionId);
			if (entries.some((candidate) => candidate._id === storedEntry._id)) return false;
			await this.appendMessageNow(sessionId, storedEntry);
			return true;
		});
	}

	private async appendMessageNow(sessionId: string, storedEntry: TranscriptEntry) {
		await mkdir(this.transcriptsDir, { recursive: true, mode: 0o700 });
		await appendFile(this.transcriptPath(sessionId), `${JSON.stringify(storedEntry)}\n`, {
			encoding: 'utf8',
			mode: 0o600,
		});
		this.applyMessageMetadata(sessionId, storedEntry);
		if (this.cachedTranscript?.sessionId === sessionId) {
			this.cachedTranscript.entries.push(storedEntry);
		}
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

	getQueuedSessionMessage(messageId: string) {
		const queued = this.state.queuedMessagesById.get(messageId);
		if (!queued || !this.getSession(queued.sessionId)) return null;
		return structuredClone(queued);
	}

	listQueuedSessionMessages(sessionId: string) {
		this.requireSession(sessionId);
		return [...this.state.queuedMessagesById.values()]
			.filter((message) => message.sessionId === sessionId && message.status === 'queued')
			.toSorted((left, right) => left.sequence - right.sequence)
			.map((message) => structuredClone(message));
	}

	listDrainingSessionMessages() {
		return [...this.state.queuedMessagesById.values()]
			.filter(
				(message) => message.status === 'draining' && Boolean(this.getSession(message.sessionId)),
			)
			.toSorted((left, right) => left.sequence - right.sequence)
			.map((message) => structuredClone(message));
	}

	listSessionIdsWithQueuedMessages() {
		return [
			...new Set(
				[...this.state.queuedMessagesById.values()]
					.filter((message) => Boolean(this.getSession(message.sessionId)))
					.map((message) => message.sessionId),
			),
		];
	}

	hasQueuedSessionMessages(sessionId: string) {
		if (!this.getSession(sessionId)) return false;
		return [...this.state.queuedMessagesById.values()].some(
			(message) => message.sessionId === sessionId,
		);
	}

	getMessages(sessionId: string) {
		return cloneTranscriptEntries(this.readEntries(sessionId));
	}

	/**
	 * Internal no-clone read of the session transcript (loading the cache on miss).
	 * Callers must not mutate or leak the returned array — public readers clone
	 * (getMessages clones everything; pagination clones only the returned page).
	 */
	private readEntries(sessionId: string) {
		if (this.cachedTranscript?.sessionId === sessionId) {
			return this.cachedTranscript.entries;
		}

		const entries = this.loadTranscriptFromDisk(sessionId);
		this.cachedTranscript = { sessionId, entries };
		return entries;
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
			this.readEntries(sessionId),
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
			this.readEntries(sessionId),
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
		// Tombstoned records are only needed while log events may still reference
		// them; compact() empties the logs right after writing this snapshot, and
		// applyEvent no-ops on unknown ids, so dropping them here is safe and keeps
		// snapshot.json (and post-restart memory) from growing forever.
		return {
			generatedAt: Date.now(),
			directories: [...this.state.directoriesById.values()]
				.filter((directory) => !directory.removedAt)
				.map((directory) => ({ ...directory })),
			workspaces: [...this.state.workspacesById.values()]
				.filter((workspace) => !workspace.removedAt)
				.map((workspace) => ({ ...workspace })),
			sessions: [...this.state.sessionsById.values()]
				.filter((session) => !session.removedAt)
				.map((session) => ({ ...session })),
			queuedMessages: [...this.state.queuedMessagesById.values()].map((message) =>
				structuredClone(message),
			),
		};
	}

	async compact() {
		return this.enqueueWrite(async () => {
			const snapshot = this.createSnapshot();
			await atomicWriteFile(this.snapshotPath, JSON.stringify(snapshot, null, 2), {
				backupPath: this.snapshotBackupPath,
			});
			await Promise.all([
				atomicWriteFile(this.directoriesLogPath, ''),
				atomicWriteFile(this.workspacesLogPath, ''),
				atomicWriteFile(this.sessionsLogPath, ''),
				atomicWriteFile(this.turnsLogPath, ''),
				atomicWriteFile(this.queuesLogPath, ''),
			]);
		});
	}

	private async shouldCompact() {
		const sizes = await Promise.all([
			Bun.file(this.directoriesLogPath).size,
			Bun.file(this.workspacesLogPath).size,
			Bun.file(this.sessionsLogPath).size,
			Bun.file(this.turnsLogPath).size,
			Bun.file(this.queuesLogPath).size,
		]);
		return sizes.reduce((total, size) => total + size, 0) >= COMPACTION_THRESHOLD_BYTES;
	}
}
