import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ServerWebSocket } from 'bun';
import {
	type ClientEnvelope,
	isClientEnvelope,
	type ServerEnvelope,
	type SubscriptionTopic,
} from 'src/shared/protocol';
import type {
	ChatAttachment,
	MikoStatus,
	WorkspaceGitHubSnapshot,
	WorkspaceGitSnapshot,
	WorkspaceHealthState,
} from 'src/shared/types';
import type { AgentCoordinator } from './agent';
import {
	writeCreatePrInstructionsAttachment,
	writeFailingCiLogsAttachment,
	writeMergeConflictInstructionsAttachment,
	writeReviewInstructionsAttachment,
	writeSelectedReviewCommentsAttachment,
} from './agent-instruction-attachments';
import type { DiffStore } from './diff-store';
import type { EventStore } from './event-store';
import { openExternal } from './external-open';
import type { KeybindingsManager } from './keybindings';
import { requireExistingDirectoryPath } from './paths';
import type { PrManager } from './pr-manager';
import {
	deriveDirectoryListSnapshot,
	deriveSessionSnapshot,
	deriveSidebarSnapshot,
	deriveWorkspaceSnapshot,
} from './read-models';
import type { ScratchpadManager } from './scratchpad-manager';
import type { TerminalManager } from './terminal-manager';
import type { UpdateManager } from './update-manager';
import { listWorkspaceFiles, searchWorkspaceFiles } from './workspace-file-search';
import type { WorkspaceManager, WorkspaceTurnIntent } from './workspace-manager';

const DEFAULT_SESSION_RECENT_LIMIT = 300;

export interface ClientState {
	subscriptions: Map<string, SubscriptionTopic>;
	snapshotSignatures: Map<string, string>;
}

interface CreateWsRouterArgs {
	store: EventStore;
	diffStore: Pick<
		DiffStore,
		| 'getWorkspaceGitSnapshot'
		| 'refreshWorkspaceGitSnapshot'
		| 'fetchWorkspaceGit'
		| 'initializeGit'
		| 'getGitHubPublishInfo'
		| 'checkGitHubRepoAvailability'
		| 'publishToGitHub'
		| 'inspectGitHubBackedRepo'
		| 'discardFile'
		| 'ignoreFile'
		| 'readPatch'
		| 'readFileContents'
		| 'readExternalFileContents'
	>;
	workspaceManager: WorkspaceManager;
	prManager: PrManager;
	scratchpadManager: ScratchpadManager;
	agent: AgentCoordinator;
	terminals: TerminalManager;
	keybindings: KeybindingsManager;
	machineDisplayName: string;
	updateManager: UpdateManager | null;
	refreshWorkspacePrStage: (workspaceId: string, options?: { force?: boolean }) => Promise<unknown>;
}

function send(ws: ServerWebSocket<ClientState>, message: ServerEnvelope) {
	ws.send(JSON.stringify(message));
}

function ensureSnapshotSignatures(ws: ServerWebSocket<ClientState>) {
	if (!ws.data.snapshotSignatures) {
		ws.data.snapshotSignatures = new Map();
	}
	return ws.data.snapshotSignatures;
}

async function realpathOrNull(filePath: string) {
	try {
		return await realpath(filePath);
	} catch {
		return null;
	}
}

function toolInputFilePath(input: unknown) {
	if (!input || typeof input !== 'object') return null;
	const filePath = (input as { filePath?: unknown }).filePath;
	return typeof filePath === 'string' ? filePath : null;
}

async function sessionTranscriptAllowsExternalPath(args: {
	store: EventStore;
	workspaceId: string;
	sessionId: string;
	requestedPath: string;
}) {
	if (!path.isAbsolute(args.requestedPath)) return false;
	const session = args.store.getSession(args.sessionId);
	if (!session || session.workspaceId !== args.workspaceId) return false;

	const requestedRealPath = await realpathOrNull(args.requestedPath);
	if (!requestedRealPath) return false;

	for (const entry of args.store.getMessages(args.sessionId)) {
		if (entry.kind !== 'tool_call') continue;
		const filePath = toolInputFilePath(entry.tool.input);
		if (!filePath || !path.isAbsolute(filePath)) continue;
		const candidateRealPath = await realpathOrNull(filePath);
		if (candidateRealPath === requestedRealPath) return true;
	}

	return false;
}

function createGitSnapshots(store: EventStore, diffStore: CreateWsRouterArgs['diffStore']) {
	const gitSnapshots = new Map<string, WorkspaceGitSnapshot>();
	for (const workspace of store.listWorkspaces()) {
		gitSnapshots.set(workspace.id, diffStore.getWorkspaceGitSnapshot(workspace.id));
	}
	return gitSnapshots;
}

function createGithubSnapshots(store: EventStore, prManager: PrManager) {
	const githubSnapshots = new Map<string, WorkspaceGitHubSnapshot>();
	for (const workspace of store.listWorkspaces()) {
		const snapshot = prManager.getWorkspaceGitHubSnapshot(workspace.id);
		if (snapshot) githubSnapshots.set(workspace.id, snapshot);
	}
	return githubSnapshots;
}

export function createWsRouter({
	store,
	diffStore,
	workspaceManager,
	prManager,
	scratchpadManager,
	agent,
	terminals,
	keybindings,
	machineDisplayName,
	updateManager,
	refreshWorkspacePrStage,
}: CreateWsRouterArgs) {
	const sockets = new Set<ServerWebSocket<ClientState>>();
	const workspaceHealthStates = new Map<string, WorkspaceHealthState>();

	function getActiveStatuses() {
		return agent.getActiveStatuses() as Map<string, MikoStatus>;
	}

	function getDrainingSessionIds() {
		return agent.getDrainingSessionIds();
	}

	async function refreshWorkspaceOpenState(workspaceId: string) {
		if (!store.getWorkspace(workspaceId)) return;

		const [healthState] = await Promise.all([
			workspaceManager.getWorkspaceHealthState(workspaceId),
			refreshWorkspaceGit(workspaceId, false),
		]);

		workspaceHealthStates.set(workspaceId, healthState);

		const workspace = store.getWorkspace(workspaceId);
		if (workspace?.reviewState !== 'in_review') return;

		if (refreshWorkspacePrStage) {
			await refreshWorkspacePrStage(workspace.id);
		} else {
			await prManager.refreshWorkspacePrState(workspace.id);
		}
	}

	async function createEnvelope(id: string, topic: SubscriptionTopic): Promise<ServerEnvelope> {
		if (topic.type === 'sidebar') {
			return {
				type: 'snapshot',
				id,
				snapshot: {
					type: 'sidebar',
					data: deriveSidebarSnapshot({
						state: store.state,
						activeStatuses: getActiveStatuses(),
						gitSnapshots: createGitSnapshots(store, diffStore),
						githubSnapshots: createGithubSnapshots(store, prManager),
					}),
				},
			};
		}

		if (topic.type === 'directories') {
			return {
				type: 'snapshot',
				id,
				snapshot: {
					type: 'directories',
					data: deriveDirectoryListSnapshot(store.state, machineDisplayName),
				},
			};
		}

		if (topic.type === 'workspace') {
			const workspace = store.getWorkspace(topic.workspaceId);
			return {
				type: 'snapshot',
				id,
				snapshot: {
					type: 'workspace',
					data: workspace
						? deriveWorkspaceSnapshot({
								state: store.state,
								activeStatuses: getActiveStatuses(),
								workspaceId: topic.workspaceId,
								healthState: workspaceHealthStates.get(topic.workspaceId),
								git: diffStore.getWorkspaceGitSnapshot(topic.workspaceId),
								github: prManager.getWorkspaceGitHubSnapshot(topic.workspaceId),
							})
						: null,
				},
			};
		}

		if (topic.type === 'session') {
			return {
				type: 'snapshot',
				id,
				snapshot: {
					type: 'session',
					data: deriveSessionSnapshot(
						store.state,
						getActiveStatuses(),
						getDrainingSessionIds(),
						topic.sessionId,
						(sessionId) =>
							store.getRecentSessionHistory(
								sessionId,
								topic.recentLimit ?? DEFAULT_SESSION_RECENT_LIMIT,
							),
					),
				},
			};
		}

		if (topic.type === 'scratchpad') {
			return {
				type: 'snapshot',
				id,
				snapshot: {
					type: 'scratchpad',
					data: await scratchpadManager.getSnapshot(topic.workspaceId),
				},
			};
		}

		if (topic.type === 'keybindings') {
			return {
				type: 'snapshot',
				id,
				snapshot: { type: 'keybindings', data: keybindings.getSnapshot() },
			};
		}

		if (topic.type === 'update') {
			return {
				type: 'snapshot',
				id,
				snapshot: {
					type: 'update',
					data: updateManager?.getSnapshot() ?? {
						currentVersion: 'unknown',
						latestVersion: null,
						status: 'idle',
						updateAvailable: false,
						lastCheckedAt: null,
						error: null,
						installAction: 'restart',
					},
				},
			};
		}

		return {
			type: 'snapshot',
			id,
			snapshot: {
				type: 'terminal',
				data: terminals.getSnapshot(topic.terminalId),
			},
		};
	}

	async function pushSnapshots(ws: ServerWebSocket<ClientState>) {
		const snapshotSignatures = ensureSnapshotSignatures(ws);
		for (const [id, topic] of ws.data.subscriptions.entries()) {
			const envelope = await createEnvelope(id, topic);
			if (envelope.type !== 'snapshot') continue;

			const signature = JSON.stringify(envelope.snapshot);
			if (snapshotSignatures.get(id) === signature) continue;

			snapshotSignatures.set(id, signature);
			send(ws, envelope);
		}
	}

	async function broadcastSnapshots() {
		for (const ws of sockets) {
			await pushSnapshots(ws);
		}
	}

	function broadcastError(message: string) {
		for (const ws of sockets) {
			send(ws, { type: 'error', message });
		}
	}

	async function pushSubscribedSnapshot(topicType: SubscriptionTopic['type']) {
		for (const ws of sockets) {
			const snapshotSignatures = ensureSnapshotSignatures(ws);
			for (const [id, topic] of ws.data.subscriptions.entries()) {
				if (topic.type !== topicType) continue;
				const envelope = await createEnvelope(id, topic);
				if (envelope.type !== 'snapshot') continue;

				const signature = JSON.stringify(envelope.snapshot);
				if (snapshotSignatures.get(id) === signature) continue;

				snapshotSignatures.set(id, signature);
				send(ws, envelope);
			}
		}
	}

	async function pushScratchpadSnapshot(workspaceId: string) {
		for (const ws of sockets) {
			const snapshotSignatures = ensureSnapshotSignatures(ws);
			for (const [id, topic] of ws.data.subscriptions.entries()) {
				if (topic.type !== 'scratchpad' || topic.workspaceId !== workspaceId) continue;
				const envelope = await createEnvelope(id, topic);
				if (envelope.type !== 'snapshot') continue;

				const signature = JSON.stringify(envelope.snapshot);
				if (snapshotSignatures.get(id) === signature) continue;

				snapshotSignatures.set(id, signature);
				send(ws, envelope);
			}
		}
	}

	async function pushTerminalSnapshot(terminalId: string) {
		for (const ws of sockets) {
			const snapshotSignatures = ensureSnapshotSignatures(ws);
			for (const [id, topic] of ws.data.subscriptions.entries()) {
				if (topic.type !== 'terminal' || topic.terminalId !== terminalId) continue;
				const envelope = await createEnvelope(id, topic);
				if (envelope.type !== 'snapshot') continue;

				const signature = JSON.stringify(envelope.snapshot);
				if (snapshotSignatures.get(id) === signature) continue;

				snapshotSignatures.set(id, signature);
				send(ws, envelope);
			}
		}
	}

	function pushTerminalEvent(
		terminalId: string,
		event: Extract<ServerEnvelope, { type: 'event' }>['event'],
	) {
		for (const ws of sockets) {
			for (const [id, topic] of ws.data.subscriptions.entries()) {
				if (topic.type !== 'terminal' || topic.terminalId !== terminalId) continue;
				send(ws, { type: 'event', id, event });
			}
		}
	}

	const disposeTerminalEvents = terminals.onEvent((event) => {
		pushTerminalEvent(event.terminalId, event);
	});

	const disposeKeybindingEvents = keybindings.onChange(() => {
		void pushSubscribedSnapshot('keybindings');
	});

	const disposeUpdateEvents =
		updateManager?.onChange(() => {
			void pushSubscribedSnapshot('update');
		}) ?? (() => {});

	agent.setBackgroundErrorReporter?.(broadcastError);

	function requireWorkspace(workspaceId: string) {
		return store.requireWorkspace(workspaceId);
	}

	function stripTrailingSlash(value: string) {
		return value.replace(/\/+$/u, '');
	}

	function readPersistedPullRequestPatch(workspaceId: string, filePath: string) {
		const workspace = store.getWorkspace(workspaceId);
		const normalizedPath = stripTrailingSlash(filePath);
		const file = workspace?.pullRequest?.files?.find(
			(candidate) => stripTrailingSlash(candidate.path) === normalizedPath,
		);
		if (!file?.patch) return null;
		return { path: file.path, patch: file.patch, patchDigest: file.patchDigest };
	}

	async function sendWorkspaceInstruction(
		workspaceId: string,
		sessionId: string,
		content: string,
		attachments: ChatAttachment[] = [],
		intent: WorkspaceTurnIntent,
	) {
		const session = store.requireSession(sessionId);
		if (session.workspaceId !== workspaceId) {
			throw new Error('Session does not belong to workspace');
		}

		workspaceManager.markWorkspaceInstructionTurnStarted({ workspaceId, sessionId, intent });

		try {
			return await agent.send({
				type: 'session.send',
				sessionId,
				workspaceId,
				content,
				attachments,
				modelOptions: {},
			});
		} catch (error) {
			workspaceManager.clearWorkspaceInstructionTurn(sessionId);
			throw error;
		}
	}

	async function refreshWorkspaceGit(workspaceId: string, fetchRemote: boolean) {
		const workspace = requireWorkspace(workspaceId);
		if (fetchRemote) {
			const result = await diffStore.fetchWorkspaceGit({
				workspaceId: workspace.id,
				workspacePath: workspace.localPath,
			});
			return result;
		}

		const snapshotChanged = await diffStore.refreshWorkspaceGitSnapshot(
			workspace.id,
			workspace.localPath,
		);
		return { ok: true as const, branchName: workspace.branchName, snapshotChanged };
	}

	async function handleCommand(
		ws: ServerWebSocket<ClientState>,
		message: Extract<ClientEnvelope, { type: 'command' }>,
	) {
		const { command, id } = message;
		try {
			switch (command.type) {
				case 'system.ping': {
					send(ws, { type: 'ack', id });
					return;
				}
				case 'system.openExternal': {
					await openExternal(command);
					send(ws, { type: 'ack', id });
					return;
				}
				case 'update.check': {
					const snapshot = updateManager
						? await updateManager.checkForUpdates({ force: command.force })
						: {
								currentVersion: 'unknown',
								latestVersion: null,
								status: 'error' as const,
								updateAvailable: false,
								lastCheckedAt: Date.now(),
								error: 'Update manager unavailable.',
								installAction: 'restart' as const,
							};
					send(ws, { type: 'ack', id, result: snapshot });
					return;
				}
				case 'update.install': {
					if (!updateManager) throw new Error('Update manager unavailable.');
					const result = await updateManager.installUpdate();
					send(ws, { type: 'ack', id, result });
					return;
				}
				case 'settings.readKeybindings': {
					send(ws, { type: 'ack', id, result: keybindings.getSnapshot() });
					return;
				}
				case 'settings.writeKeybindings': {
					const snapshot = await keybindings.write(command.bindings);
					send(ws, { type: 'ack', id, result: snapshot });
					return;
				}
				case 'directory.add': {
					const localPath = await requireExistingDirectoryPath(command.localPath);
					const inspection = await diffStore.inspectGitHubBackedRepo(localPath);
					if (!inspection.ok) {
						throw new Error(
							inspection.message ?? 'Directory must be a GitHub-backed git repository.',
						);
					}

					if (!inspection.githubOwner || !inspection.githubRepo) {
						throw new Error('Directory must have a GitHub origin remote.');
					}

					if (inspection.defaultBranchName !== 'main') {
						throw new Error('Directory must have a main branch before it can be added.');
					}

					const directory = await store.addDirectory({
						...command,
						localPath: inspection.repoRoot ?? localPath,
						githubOwner: inspection.githubOwner,
						githubRepo: inspection.githubRepo,
					});
					send(ws, { type: 'ack', id, result: { directoryId: directory.id } });
					break;
				}
				case 'directory.remove': {
					await store.removeDirectory(command.directoryId);
					send(ws, { type: 'ack', id });
					break;
				}
				case 'directory.initializeGit': {
					const result = await diffStore.initializeGit({ localPath: command.localPath });
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'directory.getGithubPublishInfo': {
					const result = await diffStore.getGitHubPublishInfo({ localPath: command.localPath });
					send(ws, { type: 'ack', id, result });
					return;
				}
				case 'directory.checkGithubRepoAvailability': {
					const result = await diffStore.checkGitHubRepoAvailability(command);
					send(ws, { type: 'ack', id, result });
					return;
				}
				case 'directory.publishToGithub': {
					const result = await diffStore.publishToGitHub(command);
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'workspace.create': {
					const result = await workspaceManager.createWorkspace(command.directoryId);
					send(ws, {
						type: 'ack',
						id,
						result: { workspaceId: result.workspace.id, sessionId: result.session?.id ?? null },
					});
					break;
				}
				case 'workspace.remove': {
					await store.removeWorkspace(command.workspaceId);
					send(ws, { type: 'ack', id });
					break;
				}
				case 'workspace.setVisibility': {
					await store.setWorkspaceVisibilityState(command.workspaceId, command.visibilityState);
					send(ws, { type: 'ack', id });
					break;
				}
				case 'workspace.renameBranch': {
					const workspace = await workspaceManager.renameWorkspaceBranch(
						command.workspaceId,
						command.branchName,
					);
					send(ws, { type: 'ack', id, result: { workspaceId: workspace.id } });
					break;
				}
				case 'workspace.markRead': {
					await store.setWorkspaceUnreadAgentResult(command.workspaceId, false);
					send(ws, { type: 'ack', id });
					break;
				}
				case 'workspace.refreshGit': {
					const result = await refreshWorkspaceGit(command.workspaceId, true);
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'workspace.refreshPrStage': {
					const result = await refreshWorkspacePrStage(command.workspaceId, { force: true });
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'workspace.readDiffPatch': {
					const workspace = requireWorkspace(command.workspaceId);
					try {
						const result = await diffStore.readPatch({
							workspacePath: workspace.localPath,
							path: command.path,
						});
						send(ws, { type: 'ack', id, result });
						return;
					} catch (error) {
						const canUsePersistedPatch =
							error instanceof Error && error.message.startsWith('File is no longer changed:');
						const fallback = canUsePersistedPatch
							? readPersistedPullRequestPatch(command.workspaceId, command.path)
							: null;
						if (!fallback) throw error;
						send(ws, { type: 'ack', id, result: fallback });
						return;
					}
				}
				case 'workspace.discardFile': {
					const workspace = requireWorkspace(command.workspaceId);
					const result = await diffStore.discardFile({
						workspaceId: workspace.id,
						workspacePath: workspace.localPath,
						path: command.path,
					});
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'workspace.readFile': {
					const workspace = requireWorkspace(command.workspaceId);
					const result = await diffStore.readFileContents({
						workspaceId: workspace.id,
						workspacePath: workspace.localPath,
						path: command.path,
					});
					send(ws, { type: 'ack', id, result });
					return;
				}
				case 'file.readExternal': {
					const allowed = await sessionTranscriptAllowsExternalPath({
						store,
						workspaceId: command.workspaceId,
						sessionId: command.sessionId,
						requestedPath: command.path,
					});
					if (!allowed) throw new Error('External file is not available in this session.');
					const result = await diffStore.readExternalFileContents({ path: command.path });
					send(ws, { type: 'ack', id, result });
					return;
				}

				case 'workspace.listFiles': {
					const workspace = requireWorkspace(command.workspaceId);
					if (workspace.setupState !== 'ready') throw new Error('Workspace is not ready yet');
					const result = await listWorkspaceFiles(workspace.localPath, command.limit);
					send(ws, { type: 'ack', id, result });
					return;
				}
				case 'workspace.searchFiles': {
					const workspace = requireWorkspace(command.workspaceId);
					if (workspace.setupState !== 'ready') throw new Error('Workspace is not ready yet');
					const result = await searchWorkspaceFiles(
						workspace.localPath,
						command.query,
						command.limit,
					);
					send(ws, { type: 'ack', id, result });
					return;
				}
				case 'workspace.commitAndPush': {
					const result = await sendWorkspaceInstruction(
						command.workspaceId,
						command.sessionId,
						'Commit and Push',
						[],
						'commit_and_push',
					);
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'workspace.pullLatestMain': {
					const result = await sendWorkspaceInstruction(
						command.workspaceId,
						command.sessionId,
						'Pull latest main',
						[],
						'pull_latest_main',
					);
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'workspace.createPr': {
					const workspace = requireWorkspace(command.workspaceId);
					const directory = store.requireDirectory(workspace.directoryId);
					await diffStore.refreshWorkspaceGitSnapshot(workspace.id, workspace.localPath);
					const attachment = await writeCreatePrInstructionsAttachment({
						workspace,
						directory,
						git: diffStore.getWorkspaceGitSnapshot(workspace.id),
					});
					const result = await sendWorkspaceInstruction(
						command.workspaceId,
						command.sessionId,
						'Create a pull request using the attached instructions.',
						[attachment],
						'create_pr',
					);
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'workspace.fixCi': {
					const workspace = requireWorkspace(command.workspaceId);
					const logs = await prManager.fetchFailingCheckLogs(workspace.id);
					const attachment = await writeFailingCiLogsAttachment({ workspace, logs });
					const result = await sendWorkspaceInstruction(
						command.workspaceId,
						command.sessionId,
						'Fix the failing CI using the attached logs.',
						[attachment],
						'fix_ci',
					);
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'workspace.resolveMergeConflicts': {
					const workspace = requireWorkspace(command.workspaceId);
					const directory = store.requireDirectory(workspace.directoryId);
					const github = prManager.getWorkspaceGitHubSnapshot(workspace.id);
					if (!github || github.status === 'none' || github.status === 'unknown') {
						throw new Error('Workspace does not have a current pull request snapshot');
					}
					if (github.hasMergeConflicts === undefined) {
						throw new Error('Workspace merge conflict status is unknown');
					}
					if (!github.hasMergeConflicts) {
						throw new Error('Workspace does not have merge conflicts to resolve');
					}
					await diffStore.refreshWorkspaceGitSnapshot(workspace.id, workspace.localPath);
					const attachment = await writeMergeConflictInstructionsAttachment({
						workspace,
						directory,
						git: diffStore.getWorkspaceGitSnapshot(workspace.id),
						github,
					});
					const result = await sendWorkspaceInstruction(
						command.workspaceId,
						command.sessionId,
						'Resolve merge conflicts using the attached instructions.',
						[attachment],
						'resolve_merge_conflicts',
					);
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'workspace.markPrReady': {
					const result = await prManager.markWorkspacePullRequestReady(command.workspaceId);
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'workspace.addressReviewComments': {
					const workspace = requireWorkspace(command.workspaceId);
					const github = prManager.getWorkspaceGitHubSnapshot(workspace.id);
					if (!github || github.status === 'none' || github.status === 'unknown') {
						throw new Error('Workspace does not have a current pull request snapshot');
					}
					if (command.commentIds.length === 0) {
						throw new Error('Select at least one review comment');
					}

					const commentsById = new Map(github.comments.map((comment) => [comment.id, comment]));
					const selectedComments = command.commentIds.map((commentId) => {
						const comment = commentsById.get(commentId);
						if (!comment) throw new Error(`Review comment is no longer available: ${commentId}`);
						return comment;
					});

					const attachment = await writeSelectedReviewCommentsAttachment({
						workspace,
						comments: selectedComments,
						prNumber: github.prNumber,
						prTitle: github.title,
					});
					const result = await sendWorkspaceInstruction(
						command.workspaceId,
						command.sessionId,
						'Address the selected PR review comments using the attached review context.',
						[attachment],
						'address_review_comments',
					);
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'workspace.mergePr': {
					const result = await prManager.mergeWorkspacePullRequest(command.workspaceId);
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'workspace.reviewChanges': {
					const workspace = requireWorkspace(command.workspaceId);
					const directory = store.requireDirectory(workspace.directoryId);
					await diffStore.refreshWorkspaceGitSnapshot(workspace.id, workspace.localPath);
					const attachment = await writeReviewInstructionsAttachment({
						workspace,
						directory,
						git: diffStore.getWorkspaceGitSnapshot(workspace.id),
					});
					const session = await store.createSession(workspace.id);
					try {
						await sendWorkspaceInstruction(
							command.workspaceId,
							session.id,
							'Review the changes in this workspace using the attached instructions.',
							[attachment],
							'review',
						);
					} catch (error) {
						await agent.cancel(session.id);
						await agent.closeSession(session.id);
						await store.removeSession(session.id);
						throw error;
					}
					await broadcastSnapshots();
					send(ws, { type: 'ack', id, result: { sessionId: session.id } });
					return;
				}
				case 'workspace.updateScratchpad': {
					requireWorkspace(command.workspaceId);
					const snapshot = await scratchpadManager.updateScratchpad(
						command.workspaceId,
						command.content,
					);
					send(ws, { type: 'ack', id, result: snapshot });
					await pushScratchpadSnapshot(command.workspaceId);
					return;
				}
				case 'session.create': {
					const session = await store.createSession(command.workspaceId);
					send(ws, { type: 'ack', id, result: { sessionId: session.id } });
					break;
				}
				case 'session.rename': {
					await store.renameSession(command.sessionId, command.title);
					send(ws, { type: 'ack', id });
					break;
				}
				case 'session.remove': {
					await agent.cancel(command.sessionId);
					await agent.closeSession(command.sessionId);
					await store.removeSession(command.sessionId);
					send(ws, { type: 'ack', id });
					break;
				}
				case 'session.send': {
					const result = await agent.send(command);
					send(ws, { type: 'ack', id, result });
					break;
				}
				case 'session.cancel': {
					await agent.cancel(command.sessionId);
					send(ws, { type: 'ack', id });
					break;
				}
				case 'session.stopDraining': {
					await agent.stopDraining(command.sessionId);
					send(ws, { type: 'ack', id });
					break;
				}
				case 'session.loadHistory': {
					const result = store.getMessagesPageBefore(
						command.sessionId,
						command.beforeCursor,
						command.limit,
					);
					send(ws, { type: 'ack', id, result });
					return;
				}
				case 'session.respondTool': {
					await agent.respondTool(command);
					send(ws, { type: 'ack', id });
					break;
				}
				case 'terminal.create': {
					const workspace = requireWorkspace(command.workspaceId);
					if (workspace.setupState !== 'ready') throw new Error('Workspace is not ready yet');
					const snapshot = terminals.createTerminal({
						workspacePath: workspace.localPath,
						terminalId: command.terminalId,
						cols: command.cols,
						rows: command.rows,
						scrollback: command.scrollback,
					});
					send(ws, { type: 'ack', id, result: snapshot });
					return;
				}
				case 'terminal.input': {
					terminals.write(command.terminalId, command.data);
					send(ws, { type: 'ack', id });
					return;
				}
				case 'terminal.resize': {
					terminals.resize(command.terminalId, command.cols, command.rows);
					send(ws, { type: 'ack', id });
					return;
				}
				case 'terminal.close': {
					terminals.close(command.terminalId);
					send(ws, { type: 'ack', id });
					await pushTerminalSnapshot(command.terminalId);
					return;
				}
			}

			await broadcastSnapshots();
		} catch (error) {
			const messageText = error instanceof Error ? error.message : String(error);
			console.error('[ws-router] command failed', { id, type: command.type, message: messageText });
			send(ws, { type: 'error', id, message: messageText });
		}
	}

	return {
		handleOpen(ws: ServerWebSocket<ClientState>) {
			sockets.add(ws);
		},
		handleClose(ws: ServerWebSocket<ClientState>) {
			sockets.delete(ws);
		},
		broadcastSnapshots,
		async handleMessage(
			ws: ServerWebSocket<ClientState>,
			raw: string | Buffer | ArrayBuffer | Uint8Array,
		) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(String(raw));
			} catch {
				send(ws, { type: 'error', message: 'Invalid JSON' });
				return;
			}

			if (!isClientEnvelope(parsed)) {
				send(ws, { type: 'error', message: 'Invalid envelope' });
				return;
			}

			if (parsed.type === 'subscribe') {
				const snapshotSignatures = ensureSnapshotSignatures(ws);
				ws.data.subscriptions.set(parsed.id, parsed.topic);
				snapshotSignatures.delete(parsed.id);

				if (parsed.topic.type === 'workspace') {
					const { workspaceId } = parsed.topic;
					if (store.getWorkspace(workspaceId)) {
						void refreshWorkspaceOpenState(workspaceId)
							.then(() => pushSnapshots(ws))
							.catch((error) =>
								broadcastError(error instanceof Error ? error.message : String(error)),
							);
					}
				}

				await pushSnapshots(ws);
				return;
			}

			if (parsed.type === 'unsubscribe') {
				const snapshotSignatures = ensureSnapshotSignatures(ws);
				ws.data.subscriptions.delete(parsed.id);
				snapshotSignatures.delete(parsed.id);
				send(ws, { type: 'ack', id: parsed.id });
				return;
			}

			await handleCommand(ws, parsed);
		},
		dispose() {
			agent.setBackgroundErrorReporter?.(null);
			disposeTerminalEvents();
			disposeKeybindingEvents();
			disposeUpdateEvents();
		},
	};
}
