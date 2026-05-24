import { randomUUID } from 'node:crypto';
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type { ScratchpadSnapshot } from '../shared/types';

const SAFE_WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class ScratchpadManager {
	private readonly scratchpadsDir: string;

	constructor(dataDir: string) {
		this.scratchpadsDir = path.join(dataDir, 'scratchpads');
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
		await mkdir(this.scratchpadsDir, { recursive: true });

		const filePath = this.getScratchpadPath(workspaceId);
		const tempPath = path.join(this.scratchpadsDir, `.${workspaceId}.${randomUUID()}.tmp`);

		await Bun.write(tempPath, content);
		await rename(tempPath, filePath);

		return this.getSnapshot(workspaceId);
	}

	private getScratchpadPath(workspaceId: string) {
		if (!SAFE_WORKSPACE_ID_PATTERN.test(workspaceId)) {
			throw new Error('Invalid workspace id');
		}
		return path.join(this.scratchpadsDir, `${workspaceId}.md`);
	}
}
