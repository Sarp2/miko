import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { APP_NAME, getRuntimeProfile } from '../shared/branding';
import type { ChatAttachment } from '../shared/types';
import { AgentCoordinator } from './agent';
import {
	cleanupStaleInstructionAttachments,
	getAgentInstructionFilePath,
} from './agent-instruction-attachments';
import type { UpdateInstallAttemptResult } from './cli-runtime';
import { DiffStore } from './diff-store';
import type { WorkspaceRecord } from './event';
import { EventStore } from './event-store';
import { KeybindingsManager } from './keybindings';
import { getMachineDisplayName } from './machine-name';
import { getWorkspaceUploadDir } from './paths';
import { PrManager } from './pr-manager';
import { PrRefreshPoller } from './pr-refresh-poller';
import { ScratchpadManager } from './scratchpad-manager';
import { TerminalManager } from './terminal-manager';
import { UpdateManager } from './update-manager';
import {
	deleteWorkspaceUpload,
	inferAttachmentContentType,
	inferWorkspaceFileContentType,
	persistWorkspaceUpload,
} from './uploads';
import { WorkspaceManager } from './workspace-manager';
import { type ClientState, createWsRouter } from './ws-router';

const MAX_UPLOAD_FILES = 50;
const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_WORKSPACE_FILE_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_AGENT_INSTRUCTION_CONTENT_BYTES = MAX_WORKSPACE_FILE_CONTENT_BYTES;

function safeDecodePathSegment(segment: string): string | null {
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
}

export function shouldRefreshWorkspaceGitOnStartup(workspace: WorkspaceRecord): boolean {
	return (
		workspace.visibilityState === 'active' &&
		workspace.setupState === 'ready' &&
		workspace.reviewState !== 'done' &&
		workspace.reviewState !== 'closed'
	);
}

export function shouldRefreshWorkspacePrOnStartup(workspace: WorkspaceRecord): boolean {
	return (
		workspace.visibilityState === 'active' &&
		workspace.reviewState !== 'done' &&
		workspace.reviewState !== 'closed'
	);
}

export interface StartupWorkspaceRefreshDeps {
	listWorkspaces: () => WorkspaceRecord[];
	refreshWorkspaceGitSnapshot: (workspaceId: string, localPath: string) => Promise<boolean>;
	refreshWorkspacePrStage: (
		workspaceId: string,
		options?: { force?: boolean },
	) => Promise<{ refreshed: boolean }>;
	broadcastSnapshots: () => Promise<void>;
	logger?: Pick<Console, 'warn'>;
}

/**
 * Refreshes git/PR state for active workspaces after startup. Intended to run in the background
 * once the server is reachable so the sidebar can render cached state immediately. Each workspace
 * is isolated in its own try/catch so one bad workspace cannot stop refresh for the rest.
 */
export async function refreshStartupWorkspaceState(
	deps: StartupWorkspaceRefreshDeps,
): Promise<void> {
	const logger = deps.logger ?? console;

	for (const workspace of deps.listWorkspaces()) {
		if (!shouldRefreshWorkspaceGitOnStartup(workspace)) continue;
		try {
			const changed = await deps.refreshWorkspaceGitSnapshot(workspace.id, workspace.localPath);
			if (changed) await deps.broadcastSnapshots();
		} catch (error) {
			logger.warn('[miko] failed to refresh startup workspace git state', {
				workspaceId: workspace.id,
				error,
			});
		}
	}

	for (const workspace of deps.listWorkspaces()) {
		if (!shouldRefreshWorkspacePrOnStartup(workspace)) continue;
		try {
			const result = await deps.refreshWorkspacePrStage(workspace.id, { force: true });
			if (result.refreshed) await deps.broadcastSnapshots();
		} catch (error) {
			logger.warn('[miko] failed to refresh startup workspace PR state', {
				workspaceId: workspace.id,
				error,
			});
		}
	}
}

export async function persistUploadedFiles(args: {
	workspaceId: string;
	dataDir?: string;
	files: File[];
	persistUpload?: typeof persistWorkspaceUpload;
}): Promise<ChatAttachment[]> {
	const persistUpload = args.persistUpload ?? persistWorkspaceUpload;
	const attachments: ChatAttachment[] = [];

	try {
		for (const file of args.files) {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const attachment = await persistUpload({
				workspaceId: args.workspaceId,
				dataDir: args.dataDir,
				fileName: file.name,
				bytes,
				fallbackMimeType: file.type || undefined,
			});
			attachments.push(attachment);
		}
	} catch (error) {
		await Promise.allSettled(
			attachments.map((attachment) =>
				deleteWorkspaceUpload({
					workspaceId: args.workspaceId,
					dataDir: args.dataDir,
					storedName: path.basename(attachment.absolutePath),
				}),
			),
		);
		throw error;
	}

	return attachments;
}

export interface StartServerOptions {
	port?: number;
	host?: string;
	strictPort?: boolean;
	onMigrationProgress?: (message: string) => void;
	update?: {
		version: string;
		fetchLatestVersion: (packageName: string) => Promise<string>;
		installVersion: (packageName: string, version: string) => UpdateInstallAttemptResult;
	};
}

export async function startServer(options: StartServerOptions = {}) {
	const port = options.port ?? 3210;
	const hostname = options.host ?? '127.0.0.1';
	const strictPort = options.strictPort ?? false;

	const store = new EventStore();
	const diffStore = new DiffStore(store.dataDir);
	const prManager = new PrManager(store);
	const scratchpadManager = new ScratchpadManager(store.dataDir);
	const workspaceManager = new WorkspaceManager(store, {
		diffStore,
		prManager,
		onWorkspaceSetupStateChanged: () => router.broadcastSnapshots(),
	});

	const machineDisplayName = getMachineDisplayName();

	await store.initialize();
	await diffStore.initialize();

	let server: ReturnType<typeof Bun.serve<ClientState>>;
	let router: ReturnType<typeof createWsRouter>;

	const terminals = new TerminalManager();
	const keybindings = new KeybindingsManager();
	await keybindings.initialize();
	const updateManager = options.update
		? new UpdateManager({
				currentVersion: options.update.version,
				fetchLatestVersion: options.update.fetchLatestVersion,
				installVersion: options.update.installVersion,
				devMode: getRuntimeProfile() === 'dev',
			})
		: null;

	async function refreshWorkspacePrStage(workspaceId: string, options?: { force?: boolean }) {
		return workspaceManager.refreshWorkspacePrStage(workspaceId, options);
	}

	function refreshStartupWorkspaceStateInBackground() {
		void refreshStartupWorkspaceState({
			listWorkspaces: () => store.listWorkspaces(),
			refreshWorkspaceGitSnapshot: (workspaceId, localPath) =>
				diffStore.refreshWorkspaceGitSnapshot(workspaceId, localPath),
			refreshWorkspacePrStage: (workspaceId, prOptions) =>
				refreshWorkspacePrStage(workspaceId, prOptions),
			broadcastSnapshots: () => router.broadcastSnapshots(),
		}).catch((error) => {
			console.warn('[miko] failed to refresh startup workspace state', error);
		});
	}

	function cleanupStaleInstructionAttachmentsInBackground() {
		void cleanupStaleInstructionAttachments([...store.state.workspacesById.values()]).catch(
			(error) => {
				console.warn('[miko] failed to cleanup instruction attachments', error);
			},
		);
	}

	const prRefreshPoller = new PrRefreshPoller({
		listWorkspaces: () => store.listWorkspaces(),
		getWorkspaceGitHubSnapshot: (workspaceId) => prManager.getWorkspaceGitHubSnapshot(workspaceId),
		refreshWorkspacePrStage: (workspaceId, prOptions) =>
			refreshWorkspacePrStage(workspaceId, prOptions),
		broadcastSnapshots: () => router.broadcastSnapshots(),
	});

	const agent = new AgentCoordinator({
		store,
		onStateChange: () => {
			void router.broadcastSnapshots();
		},
		onTurnSettled: async ({ sessionId }) => {
			const result = await workspaceManager.handleWorkspaceTurnSettled({ sessionId });
			if (result.changed) await router.broadcastSnapshots();
		},
		renameWorkspaceBranch: async ({ workspaceId, branchName, expectedCurrentBranchName }) => {
			const currentBranchName = store.requireWorkspace(workspaceId).branchName;
			if (expectedCurrentBranchName && currentBranchName !== expectedCurrentBranchName) {
				return { branchName: currentBranchName, changed: false };
			}

			const workspace = await workspaceManager.renameWorkspaceBranch(workspaceId, branchName);
			return {
				branchName: workspace.branchName,
				changed: workspace.branchName !== currentBranchName,
			};
		},
	});

	router = createWsRouter({
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
	});

	const distDir = path.join(import.meta.dir, '..', '..', 'dist', 'client');

	const MAX_PORT_ATTEMPTS = 20;
	let actualPort = port;

	for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
		try {
			server = Bun.serve<ClientState>({
				port: actualPort,
				hostname,
				async fetch(req, serverInstance) {
					const url = new URL(req.url);

					if (url.pathname === '/ws') {
						const upgraded = serverInstance.upgrade(req, {
							data: {
								subscriptions: new Map(),
								snapshotSignatures: new Map(),
							},
						});

						return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
					}

					if (url.pathname === '/health') {
						return Response.json({ ok: true, port: actualPort });
					}

					const uploadResponse = await handleWorkspaceUpload(req, url, store);
					if (uploadResponse) {
						return uploadResponse;
					}

					const deleteUploadResponse = await handleWorkspaceUploadDelete(req, url, store);
					if (deleteUploadResponse) {
						return deleteUploadResponse;
					}

					const attachmentContentResponse = await handleAttachmentContent(req, url, store);
					if (attachmentContentResponse) {
						return attachmentContentResponse;
					}

					const agentInstructionContentResponse = await handleAgentInstructionContent(req, url);
					if (agentInstructionContentResponse) {
						return agentInstructionContentResponse;
					}

					const workspaceFileContentResponse = await handleWorkspaceFileContent(req, url, store);
					if (workspaceFileContentResponse) {
						return workspaceFileContentResponse;
					}

					const externalFileContentResponse = await handleExternalFileContent(req, url);
					if (externalFileContentResponse) {
						return externalFileContentResponse;
					}

					return serveStatic(distDir, url.pathname);
				},
				websocket: {
					open(ws) {
						router.handleOpen(ws);
					},
					message(ws, raw) {
						router.handleMessage(ws, raw);
					},
					close(ws) {
						router.handleClose(ws);
					},
				},
			});
			break;
		} catch (err: unknown) {
			const isAddrInUse =
				err instanceof Error &&
				'code' in err &&
				(err as NodeJS.ErrnoException).code === 'EADDRINUSE';

			if (!isAddrInUse || strictPort || attempt === MAX_PORT_ATTEMPTS - 1) {
				throw err;
			}

			console.log(`Port ${actualPort} is in use, trying ${actualPort + 1}...`);
			actualPort++;
		}
	}

	cleanupStaleInstructionAttachmentsInBackground();
	refreshStartupWorkspaceStateInBackground();
	prRefreshPoller.start();

	const shutdown = async () => {
		for (const sessionId of [...agent.activeTurns.keys()]) {
			await agent.cancel(sessionId);
		}

		await prRefreshPoller.stop();
		router.dispose();
		keybindings.dispose();
		terminals.closeAll();
		await store.compact();
		server.stop(true);
	};

	return {
		port: actualPort,
		store,
		diffStore,
		workspaceManager,
		prManager,
		updateManager,
		stop: shutdown,
	};
}

export async function handleWorkspaceUpload(req: Request, url: URL, store: EventStore) {
	if (req.method !== 'POST') {
		return null;
	}

	const match = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/uploads$/);
	if (!match) {
		return null;
	}

	const workspace = store.getWorkspace(match[1]);
	if (!workspace) {
		return Response.json({ error: 'Workspace not found' }, { status: 404 });
	}

	const formData = await req.formData();
	const files = formData.getAll('files').filter((value): value is File => value instanceof File);

	if (files.length === 0) {
		return Response.json({ error: 'No files uploaded' }, { status: 400 });
	}

	if (files.length > MAX_UPLOAD_FILES) {
		return Response.json(
			{ error: `You can upload up to ${MAX_UPLOAD_FILES} files at a time.` },
			{ status: 400 },
		);
	}

	for (const file of files) {
		if (file.size > MAX_UPLOAD_SIZE_BYTES) {
			return Response.json(
				{
					error: `File "${file.name}" exceeds the ${Math.floor(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))} MB limit.`,
				},
				{ status: 413 },
			);
		}
	}

	try {
		const attachments = await persistUploadedFiles({
			workspaceId: workspace.id,
			dataDir: store.dataDir,
			files,
		});
		return Response.json({ attachments });
	} catch (error) {
		console.error('[uploads] Upload failed:', error);
		return Response.json({ error: 'Upload failed' }, { status: 500 });
	}
}

export async function handleAttachmentContent(req: Request, url: URL, store: EventStore) {
	const match = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/uploads\/([^/]+)\/content$/);
	if (!match) {
		return null;
	}

	if (req.method !== 'GET') {
		return new Response(null, {
			status: 405,
			headers: {
				Allow: 'GET',
			},
		});
	}

	const workspace = store.getWorkspace(match[1]);
	if (!workspace) {
		return Response.json({ error: 'Workspace not found' }, { status: 404 });
	}

	const storedName = safeDecodePathSegment(match[2]);
	if (
		!storedName ||
		storedName.includes('/') ||
		storedName.includes('\\') ||
		storedName === '.' ||
		storedName === '..'
	) {
		return Response.json({ error: 'Invalid attachment path' }, { status: 400 });
	}

	const filePath = path.join(getWorkspaceUploadDir(workspace.id, store.dataDir), storedName);
	const file = Bun.file(filePath);

	try {
		const info = await stat(filePath);
		if (!info.isFile()) {
			return Response.json({ error: 'Attachment not found' }, { status: 404 });
		}
	} catch {
		return Response.json({ error: 'Attachment not found' }, { status: 404 });
	}

	return new Response(file, {
		headers: {
			'Content-Type': inferAttachmentContentType(storedName, file.type),
		},
	});
}

export async function handleAgentInstructionContent(
	req: Request,
	url: URL,
	options: { getFilePath?: (fileName: string) => string } = {},
) {
	const match = url.pathname.match(/^\/api\/agent-instructions\/([^/]+)\/content$/);
	if (!match) {
		return null;
	}

	if (req.method !== 'GET') {
		return new Response(null, {
			status: 405,
			headers: {
				Allow: 'GET',
			},
		});
	}

	const fileName = safeDecodePathSegment(match[1]);
	if (!fileName) {
		return Response.json({ error: 'Invalid agent instruction path' }, { status: 400 });
	}

	let filePath: string;
	try {
		filePath = (options.getFilePath ?? getAgentInstructionFilePath)(fileName);
	} catch {
		return Response.json({ error: 'Invalid agent instruction path' }, { status: 400 });
	}

	const file = Bun.file(filePath);
	try {
		const info = await stat(filePath);
		if (!info.isFile()) {
			return Response.json({ error: 'Agent instruction not found' }, { status: 404 });
		}
		if (info.size > MAX_AGENT_INSTRUCTION_CONTENT_BYTES) {
			return Response.json({ error: 'Agent instruction is too large to preview' }, { status: 413 });
		}
	} catch {
		return Response.json({ error: 'Agent instruction not found' }, { status: 404 });
	}

	return new Response(file, {
		headers: {
			'Content-Type': inferAttachmentContentType(fileName, file.type),
			'Content-Disposition': 'inline',
			'X-Content-Type-Options': 'nosniff',
		},
	});
}

export async function handleWorkspaceFileContent(req: Request, url: URL, store: EventStore) {
	const match = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/files\/([^/]+)\/content$/);
	if (!match) {
		return null;
	}

	if (req.method !== 'GET') {
		return new Response(null, {
			status: 405,
			headers: {
				Allow: 'GET',
			},
		});
	}

	const workspace = store.getWorkspace(match[1]);
	if (!workspace) {
		return Response.json({ error: 'Workspace not found' }, { status: 404 });
	}

	const decodedPathSegment = safeDecodePathSegment(match[2]);
	if (!decodedPathSegment) {
		return Response.json({ error: 'Invalid workspace file path' }, { status: 400 });
	}

	const relativePath = path.posix.normalize(decodedPathSegment.replaceAll('\\', '/'));
	if (
		!relativePath ||
		relativePath === '.' ||
		relativePath.startsWith('../') ||
		relativePath.includes('/../') ||
		path.posix.isAbsolute(relativePath)
	) {
		return Response.json({ error: 'Invalid workspace file path' }, { status: 400 });
	}

	const filePath = path.resolve(workspace.localPath, relativePath);
	const workspaceRoot = path.resolve(workspace.localPath);
	if (filePath !== workspaceRoot && !filePath.startsWith(`${workspaceRoot}${path.sep}`)) {
		return Response.json({ error: 'Invalid workspace file path' }, { status: 400 });
	}

	let targetRealPath: string;
	try {
		const [workspaceRootRealPath, fileRealPath] = await Promise.all([
			realpath(workspaceRoot),
			realpath(filePath),
		]);
		if (
			fileRealPath !== workspaceRootRealPath &&
			!fileRealPath.startsWith(`${workspaceRootRealPath}${path.sep}`)
		) {
			return Response.json({ error: 'Invalid workspace file path' }, { status: 400 });
		}

		targetRealPath = fileRealPath;
		const info = await stat(targetRealPath);
		if (!info.isFile()) {
			return Response.json({ error: 'File not found' }, { status: 404 });
		}

		if (info.size > MAX_WORKSPACE_FILE_CONTENT_BYTES) {
			return Response.json({ error: 'File is too large to preview' }, { status: 413 });
		}
	} catch {
		return Response.json({ error: 'File not found' }, { status: 404 });
	}

	const file = Bun.file(targetRealPath);
	return new Response(file, {
		headers: {
			'Content-Type': inferWorkspaceFileContentType(targetRealPath, file.type),
			'Content-Disposition': 'inline',
			'X-Content-Type-Options': 'nosniff',
		},
	});
}

export async function handleExternalFileContent(req: Request, url: URL) {
	if (url.pathname !== '/api/external-files/content') {
		return null;
	}

	if (req.method !== 'GET') {
		return new Response(null, {
			status: 405,
			headers: {
				Allow: 'GET',
			},
		});
	}

	const requestedPath = url.searchParams.get('path')?.trim();
	if (!requestedPath || !path.isAbsolute(requestedPath)) {
		return Response.json({ error: 'Invalid external file path' }, { status: 400 });
	}

	let targetRealPath: string;
	let info: Awaited<ReturnType<typeof stat>>;
	try {
		targetRealPath = await realpath(requestedPath);
		info = await stat(targetRealPath);
		if (!info.isFile()) {
			return Response.json({ error: 'File not found' }, { status: 404 });
		}
		if (info.size > MAX_WORKSPACE_FILE_CONTENT_BYTES) {
			return Response.json({ error: 'File is too large to preview' }, { status: 413 });
		}
	} catch {
		return Response.json({ error: 'File not found' }, { status: 404 });
	}

	const file = Bun.file(targetRealPath);
	const inferredContentType = inferWorkspaceFileContentType(targetRealPath, file.type);
	const contentType =
		inferredContentType.toLowerCase() === 'image/svg+xml'
			? 'text/plain; charset=utf-8'
			: inferredContentType;

	return new Response(file, {
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': 'inline',
			'X-Content-Type-Options': 'nosniff',
		},
	});
}

export async function handleWorkspaceUploadDelete(req: Request, url: URL, store: EventStore) {
	if (req.method !== 'DELETE') {
		return null;
	}

	const match = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/uploads\/([^/]+)$/);
	if (!match) {
		return null;
	}

	const workspace = store.getWorkspace(match[1]);
	if (!workspace) {
		return Response.json({ error: 'Workspace not found' }, { status: 404 });
	}

	const storedName = safeDecodePathSegment(match[2]);
	if (
		!storedName ||
		storedName.includes('/') ||
		storedName.includes('\\') ||
		storedName === '.' ||
		storedName === '..'
	) {
		return Response.json({ error: 'Invalid attachment path' }, { status: 400 });
	}

	const deleted = await deleteWorkspaceUpload({
		workspaceId: workspace.id,
		dataDir: store.dataDir,
		storedName,
	});

	return Response.json({ ok: deleted });
}

export async function serveStatic(distDir: string, pathname: string) {
	const requestedPath = pathname === '/' ? '/index.html' : pathname;
	const filePath = path.join(distDir, requestedPath);
	const indexPath = path.join(distDir, 'index.html');

	const file = Bun.file(filePath);
	if (await file.exists()) {
		return new Response(file);
	}

	const indexFile = Bun.file(indexPath);
	if (await indexFile.exists()) {
		return new Response(indexFile, {
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
			},
		});
	}

	return new Response(
		`${APP_NAME} client bundle not found. Run \`bun run build\` inside workbench/ first.`,
		{
			status: 503,
		},
	);
}
