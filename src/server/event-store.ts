import { existsSync, readFileSync as readFileSyncImmediate } from 'node:fs';
import { appendFile, mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { getDataDir, LOG_PREFIX } from 'src/shared/branding';
import type {
	AgentProvider,
	ChatHistoryPage,
	ChatHistorySnapshot,
	TranscriptEntry,
} from 'src/shared/types';
import {
	type ChatEvent,
	cloneTranscriptEntries,
	createEmptyState,
	type ProjectEvent,
	type SnapshotFile,
	type StoreEvent,
	type StoreState,
	type TurnEvent,
} from './event';
import { resolveLocalPath } from './paths';

const COMPACTION_THRESHOLD_BYTES = 2 * 1024 * 1024;
const STALE_EMPTY_CHAT_MAX_AGE_MS = 5 * 60 * 1000;

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

function getHistorySnapshot(page: TranscriptPageResult, recentLimit: number): ChatHistorySnapshot {
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
	private readonly projectsLogPath: string;
	private readonly chatsLogPath: string;
	private readonly turnsLogPath: string;
	private readonly transcriptsDir: string;
	private cachedTranscript: { chatId: string; entries: TranscriptEntry[] } | null = null;

	constructor(dataDir = getDataDir(homedir())) {
		this.dataDir = dataDir;
		this.snapshotPath = path.join(this.dataDir, 'snapshot.json');
		this.projectsLogPath = path.join(this.dataDir, 'projects.jsonl');
		this.chatsLogPath = path.join(this.dataDir, 'chats.jsonl');
		this.turnsLogPath = path.join(this.dataDir, 'turns.jsonl');
		this.transcriptsDir = path.join(this.dataDir, 'transcripts');
	}

	async initialize() {
		await mkdir(this.dataDir, { recursive: true });
		await mkdir(this.transcriptsDir, { recursive: true });
		await this.ensureFile(this.projectsLogPath);
		await this.ensureFile(this.chatsLogPath);
		await this.ensureFile(this.turnsLogPath);
		await this.loadSnapshot();
		await this.replayLogs();

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
			Bun.write(this.projectsLogPath, ''),
			Bun.write(this.chatsLogPath, ''),
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
			for (const project of parsed.projects) {
				this.state.projectsById.set(project.id, { ...project });
				this.state.projectIdsByPath.set(project.localPath, project.id);
			}

			for (const chat of parsed.chats) {
				this.state.chatsById.set(chat.id, { ...chat });
			}
		} catch (error) {
			console.warn(`${LOG_PREFIX} Failed to load snapshot, resetting local history:`, error);
			await this.clearStorage();
		}
	}

	private resetState() {
		this.state.projectsById.clear();
		this.state.projectIdsByPath.clear();
		this.state.chatsById.clear();
		this.cachedTranscript = null;
	}

	private async replayLogs() {
		if (this.storageReset) return;
		await this.replayLog<ProjectEvent>(this.projectsLogPath);
		if (this.storageReset) return;
		await this.replayLog<ChatEvent>(this.chatsLogPath);
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
						`${LOG_PREFIX} Ignoring corrupt trailing line in
  ${path.basename(filePath)}`,
					);
					return;
				}

				console.warn(
					`${LOG_PREFIX} Failed to replay ${path.basename(filePath)}, resetting local
  history:`,
					error,
				);

				await this.clearStorage();
				return;
			}
		}
	}

	private applyEvent(event: StoreEvent) {
		switch (event.type) {
			case 'project_opened': {
				const localPath = resolveLocalPath(event.localPath);
				const project = {
					id: event.projectId,
					localPath,
					title: event.title,
					createdAt: event.timestamp,
					updatedAt: event.timestamp,
				};
				this.state.projectsById.set(project.id, project);
				this.state.projectIdsByPath.set(localPath, project.id);
				break;
			}
			case 'project_removed': {
				const project = this.state.projectsById.get(event.projectId);
				if (!project) break;
				project.deletedAt = event.timestamp;
				project.updatedAt = event.timestamp;
				this.state.projectIdsByPath.delete(project.localPath);
				break;
			}
			case 'chat_created': {
				const chat = {
					id: event.chatId,
					projectId: event.projectId,
					title: event.title,
					createdAt: event.timestamp,
					updatedAt: event.timestamp,
					unread: false,
					provider: null,
					planMode: false,
					sessionToken: null,
					lastTurnOutcome: null,
				};
				this.state.chatsById.set(chat.id, chat);
				break;
			}
			case 'chat_renamed': {
				const chat = this.state.chatsById.get(event.chatId);
				if (!chat) break;
				chat.title = event.title;
				chat.updatedAt = event.timestamp;
				break;
			}
			case 'chat_deleted': {
				const chat = this.state.chatsById.get(event.chatId);
				if (!chat) break;
				chat.deletedAt = event.timestamp;
				chat.updatedAt = event.timestamp;
				break;
			}
			case 'chat_provider_set': {
				const chat = this.state.chatsById.get(event.chatId);
				if (!chat) break;
				chat.provider = event.provider;
				chat.updatedAt = event.timestamp;
				break;
			}
			case 'chat_plan_mode_set': {
				const chat = this.state.chatsById.get(event.chatId);
				if (!chat) break;
				chat.planMode = event.planMode;
				chat.updatedAt = event.timestamp;
				break;
			}
			case 'chat_read_state_set': {
				const chat = this.state.chatsById.get(event.chatId);
				if (!chat) break;
				chat.unread = event.unread;
				chat.updatedAt = event.timestamp;
				break;
			}
			case 'turn_started': {
				const chat = this.state.chatsById.get(event.chatId);
				if (!chat) break;
				chat.updatedAt = event.timestamp;
				break;
			}
			case 'turn_finished': {
				const chat = this.state.chatsById.get(event.chatId);
				if (!chat) break;
				chat.updatedAt = event.timestamp;
				chat.unread = true;
				chat.lastTurnOutcome = 'success';
				break;
			}
			case 'turn_failed': {
				const chat = this.state.chatsById.get(event.chatId);
				if (!chat) break;
				chat.updatedAt = event.timestamp;
				chat.unread = true;
				chat.lastTurnOutcome = 'failed';
				break;
			}
			case 'turn_cancelled': {
				const chat = this.state.chatsById.get(event.chatId);
				if (!chat) break;
				chat.updatedAt = event.timestamp;
				chat.lastTurnOutcome = 'cancelled';
				break;
			}
			case 'session_token_set': {
				const chat = this.state.chatsById.get(event.chatId);
				if (!chat) break;
				chat.sessionToken = event.sessionToken;
				chat.updatedAt = event.timestamp;
				break;
			}
		}
	}

	private applyMessageMetadata(chatId: string, entry: TranscriptEntry) {
		const chat = this.state.chatsById.get(chatId);
		if (!chat) return;

		if (entry.kind === 'user_prompt') {
			chat.lastMessageAt = entry.createdAt;
		}
		chat.updatedAt = Math.max(chat.updatedAt, entry.createdAt);
	}

	private append<TEvent extends StoreEvent>(filePath: string, event: TEvent) {
		const payload = `${JSON.stringify(event)}\n`;
		this.writeChain = this.writeChain.then(async () => {
			await appendFile(filePath, payload, 'utf-8');
			this.applyEvent(event);
		});
		return this.writeChain;
	}

	private transcriptPath(chatId: string) {
		return path.join(this.transcriptsDir, `${chatId}.jsonl`);
	}

	private loadTranscriptFromDisk(chatId: string) {
		const transcriptPath = this.transcriptPath(chatId);
		if (!existsSync(transcriptPath)) return [];

		const text = readFileSyncImmediate(transcriptPath, 'utf-8');
		if (!text.trim()) return [];

		const entries: TranscriptEntry[] = [];
		for (const rawLine of text.split('\n')) {
			const line = rawLine.trim();
			if (!line) continue;
			entries.push(JSON.parse(line) as TranscriptEntry);
		}
		return entries;
	}

	async openProject(localPath: string, title?: string) {
		const normalized = resolveLocalPath(localPath);
		const existingId = this.state.projectIdsByPath.get(normalized);
		if (existingId) {
			const existing = this.state.projectsById.get(existingId);
			if (existing && !existing.deletedAt) {
				return existing;
			}
		}

		const projectId = crypto.randomUUID();
		const event: ProjectEvent = {
			type: 'project_opened',
			timestamp: Date.now(),
			projectId,
			localPath: normalized,
			title: title?.trim() || path.basename(normalized) || normalized,
		};

		await this.append(this.projectsLogPath, event);
		// biome-ignore lint/style/noNonNullAssertion: <>
		return this.state.projectsById.get(projectId)!;
	}

	async removeProject(projectId: string) {
		const project = this.getProject(projectId);
		if (!project) throw new Error('Project not found');

		const event: ProjectEvent = {
			type: 'project_removed',
			timestamp: Date.now(),
			projectId,
		};
		await this.append(this.projectsLogPath, event);
	}

	async createChat(projectId: string) {
		const project = this.state.projectsById.get(projectId);
		if (!project || project.deletedAt) throw new Error('Project not found');

		const chatId = crypto.randomUUID();
		const event: ChatEvent = {
			type: 'chat_created',
			timestamp: Date.now(),
			chatId,
			projectId,
			title: 'New Chat',
		};

		await this.append(this.chatsLogPath, event);
		// biome-ignore lint/style/noNonNullAssertion: <>
		return this.state.chatsById.get(chatId)!;
	}

	async renameChat(chatId: string, title: string) {
		const trimmed = title.trim();
		if (!trimmed) return;

		const chat = this.requireChat(chatId);
		if (chat.title === trimmed) return;

		const event: ChatEvent = {
			type: 'chat_renamed',
			timestamp: Date.now(),
			chatId,
			title: trimmed,
		};
		await this.append(this.chatsLogPath, event);
	}

	async deleteChat(chatId: string) {
		this.requireChat(chatId);
		const event: ChatEvent = {
			type: 'chat_deleted',
			timestamp: Date.now(),
			chatId,
		};
		await this.append(this.chatsLogPath, event);
	}

	async pruneStaleEmptyChats(args?: {
		now?: number;
		maxAgeMs?: number;
		activeChatIds?: Iterable<string>;
	}) {
		const now = args?.now ?? Date.now();
		const maxAgeMs = args?.maxAgeMs ?? STALE_EMPTY_CHAT_MAX_AGE_MS;
		const activeChatIds = new Set(args?.activeChatIds ?? []);
		const prunedChatIds: string[] = [];

		for (const chat of this.state.chatsById.values()) {
			if (chat.deletedAt || activeChatIds.has(chat.id)) continue;
			if (now - chat.createdAt < maxAgeMs) continue;
			if (this.getMessages(chat.id).length > 0) continue;

			const event: ChatEvent = {
				type: 'chat_deleted',
				timestamp: now,
				chatId: chat.id,
			};
			await this.append(this.chatsLogPath, event);

			const transcriptPath = this.transcriptPath(chat.id);
			await rm(transcriptPath, { force: true });
			if (this.cachedTranscript?.chatId === chat.id) {
				this.cachedTranscript = null;
			}

			prunedChatIds.push(chat.id);
		}
		return prunedChatIds;
	}

	async setChatProvider(chatId: string, provider: AgentProvider) {
		const chat = this.requireChat(chatId);
		if (chat.provider === provider) return;

		const event: ChatEvent = {
			type: 'chat_provider_set',
			timestamp: Date.now(),
			chatId,
			provider,
		};
		await this.append(this.chatsLogPath, event);
	}

	async setPlanMode(chatId: string, planMode: boolean) {
		const chat = this.requireChat(chatId);
		if (chat.planMode === planMode) return;

		const event: ChatEvent = {
			type: 'chat_plan_mode_set',
			timestamp: Date.now(),
			chatId,
			planMode,
		};
		await this.append(this.chatsLogPath, event);
	}

	async setChatReadState(chatId: string, unread: boolean) {
		const chat = this.requireChat(chatId);
		if (chat.unread === unread) return;

		const event: ChatEvent = {
			type: 'chat_read_state_set',
			timestamp: Date.now(),
			chatId,
			unread,
		};
		await this.append(this.chatsLogPath, event);
	}

	async appendMessage(chatId: string, entry: TranscriptEntry) {
		this.requireChat(chatId);
		const payload = `${JSON.stringify(entry)}\n`;
		const transcriptPath = this.transcriptPath(chatId);

		this.writeChain = this.writeChain.then(async () => {
			await mkdir(this.transcriptsDir, { recursive: true });
			await appendFile(transcriptPath, payload, 'utf-8');
			this.applyMessageMetadata(chatId, entry);

			if (this.cachedTranscript?.chatId === chatId) {
				this.cachedTranscript.entries.push({ ...entry });
			}
		});

		return this.writeChain;
	}

	async recordTurnStarted(chatId: string) {
		this.requireChat(chatId);
		const event: TurnEvent = {
			type: 'turn_started',
			timestamp: Date.now(),
			chatId,
		};
		await this.append(this.turnsLogPath, event);
	}

	async recordTurnFinished(chatId: string) {
		this.requireChat(chatId);
		const event: TurnEvent = {
			type: 'turn_finished',
			timestamp: Date.now(),
			chatId,
		};
		await this.append(this.turnsLogPath, event);
	}

	async recordTurnFailed(chatId: string, error: string) {
		this.requireChat(chatId);
		const event: TurnEvent = {
			type: 'turn_failed',
			timestamp: Date.now(),
			chatId,
			error,
		};
		await this.append(this.turnsLogPath, event);
	}

	async recordTurnCancelled(chatId: string) {
		this.requireChat(chatId);
		const event: TurnEvent = {
			type: 'turn_cancelled',
			timestamp: Date.now(),
			chatId,
		};
		await this.append(this.turnsLogPath, event);
	}

	async setSessionToken(chatId: string, sessionToken: string | null) {
		const chat = this.requireChat(chatId);
		if (chat.sessionToken === sessionToken) return;
		const event: TurnEvent = {
			type: 'session_token_set',
			timestamp: Date.now(),
			chatId,
			sessionToken,
		};
		await this.append(this.turnsLogPath, event);
	}

	getProject(projectId: string) {
		const project = this.state.projectsById.get(projectId);
		if (!project || project.deletedAt) return null;
		return project;
	}

	requireChat(chatId: string) {
		const chat = this.state.chatsById.get(chatId);
		if (!chat || chat.deletedAt) {
			throw new Error('Chat not found');
		}
		return chat;
	}

	getChat(chatId: string) {
		const chat = this.state.chatsById.get(chatId);
		if (!chat || chat.deletedAt) return null;
		return chat;
	}

	getMessages(chatId: string) {
		if (this.cachedTranscript?.chatId === chatId) {
			return cloneTranscriptEntries(this.cachedTranscript.entries);
		}

		const entries = this.loadTranscriptFromDisk(chatId);
		this.cachedTranscript = { chatId, entries };
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

	getRecentMessagesPage(chatId: string, limit: number): ChatHistoryPage {
		if (limit <= 0) return { messages: [], hasOlder: false, olderCursor: null };

		const { entries, ...rest } = this.getMessagesPageFromEntries(this.getMessages(chatId), limit);
		return { messages: entries, ...rest };
	}

	getMessagesPageBefore(chatId: string, beforeCursor: string, limit: number): ChatHistoryPage {
		if (limit <= 0) return { messages: [], hasOlder: false, olderCursor: null };

		const beforeIndex = decodeCursor(beforeCursor);
		const { entries, ...rest } = this.getMessagesPageFromEntries(
			this.getMessages(chatId),
			limit,
			beforeIndex,
		);
		return { messages: entries, ...rest };
	}

	getRecentChatHistory(chatId: string, recentLimit: number) {
		const page = this.getRecentMessagesPage(chatId, recentLimit);
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

	listProjects() {
		return [...this.state.projectsById.values()].filter((project) => !project.deletedAt);
	}

	listChatsByProject(projectId: string) {
		return [...this.state.chatsById.values()]
			.filter((chat) => chat.projectId === projectId && !chat.deletedAt)
			.sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt));
	}

	getChatCount(projectId: string) {
		return this.listChatsByProject(projectId).length;
	}

	private createSnapshot(): SnapshotFile {
		return {
			generatedAt: Date.now(),
			projects: this.listProjects().map((project) => ({ ...project })),
			chats: [...this.state.chatsById.values()]
				.filter((chat) => !chat.deletedAt)
				.map((chat) => ({ ...chat })),
		};
	}

	async compact() {
		const snapshot = this.createSnapshot();
		await Bun.write(this.snapshotPath, JSON.stringify(snapshot, null, 2));
		await Promise.all([
			Bun.write(this.projectsLogPath, ''),
			Bun.write(this.chatsLogPath, ''),
			Bun.write(this.turnsLogPath, ''),
		]);
	}

	private async shouldCompact() {
		const sizes = await Promise.all([
			Bun.file(this.projectsLogPath).size,
			Bun.file(this.chatsLogPath).size,
			Bun.file(this.turnsLogPath).size,
		]);
		return sizes.reduce((total, size) => total + size, 0) >= COMPACTION_THRESHOLD_BYTES;
	}
}
