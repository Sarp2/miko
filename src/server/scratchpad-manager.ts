import { randomUUID } from 'node:crypto';
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type { ScratchpadSnapshot } from '../shared/types';

const SAFE_WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

interface ScratchpadStorageAdapter {
	write: (destination: string, content: string) => Promise<unknown>;
	rename: (oldPath: string, newPath: string) => Promise<unknown>;
	mkdir: (directoryPath: string, options: { recursive: true }) => Promise<unknown>;
}

const defaultStorageAdapter: ScratchpadStorageAdapter = {
	write: Bun.write,
	rename,
	mkdir,
};

export class ScratchpadManager {
	private readonly scratchpadsDir: string;
	private readonly storage: ScratchpadStorageAdapter;
	private readonly writeChainsByWorkspaceId = new Map<string, Promise<unknown>>();

	constructor(dataDir: string, storage: ScratchpadStorageAdapter = defaultStorageAdapter) {
		this.scratchpadsDir = path.join(dataDir, 'scratchpads');
		this.storage = storage;
	}

	async getSnapshot(workspaceId: string): Promise<ScratchpadSnapshot> {
		const filePath = this.getScratchpadPath(workspaceId);
		const file = Bun.file(filePath);

		if (!(await file.exists())) {
			return { workspaceId, content: '', updatedAt: null };
		}

		const content = await file.text();
		return { workspaceId, content, updatedAt: file.lastModified };
	}

	async updateScratchpad(workspaceId: string, content: string): Promise<ScratchpadSnapshot> {
		this.assertSafeWorkspaceId(workspaceId);
		return this.enqueueWorkspaceScratchpadWrite(workspaceId, async () => {
			await this.storage.mkdir(this.scratchpadsDir, { recursive: true });

			const filePath = this.getScratchpadPath(workspaceId);
			const tempPath = path.join(this.scratchpadsDir, `.${workspaceId}.${randomUUID()}.tmp`);

			await this.storage.write(tempPath, content);
			await this.storage.rename(tempPath, filePath);

			return this.getSnapshot(workspaceId);
		});
	}

	private enqueueWorkspaceScratchpadWrite<T>(
		workspaceId: string,
		operation: () => Promise<T>,
	): Promise<T> {
		const previous = this.writeChainsByWorkspaceId.get(workspaceId) ?? Promise.resolve();
		const run = previous.catch(() => undefined).then(operation);

		this.writeChainsByWorkspaceId.set(workspaceId, run);

		void run
			.finally(() => {
				if (this.writeChainsByWorkspaceId.get(workspaceId) === run) {
					this.writeChainsByWorkspaceId.delete(workspaceId);
				}
			})
			.catch(() => undefined);

		return run;
	}

	private assertSafeWorkspaceId(workspaceId: string) {
		if (!SAFE_WORKSPACE_ID_PATTERN.test(workspaceId)) {
			throw new Error('Invalid workspace id');
		}
	}

	private getScratchpadPath(workspaceId: string) {
		this.assertSafeWorkspaceId(workspaceId);
		return path.join(this.scratchpadsDir, `${workspaceId}.md`);
	}
}
