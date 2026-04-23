import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranscriptEntry } from 'src/shared/types';
import { EventStore } from './event-store';

const originalRuntimeProfile = process.env.MIKO_RUNTIME_PROFILE;
const tempDirs: string[] = [];

afterEach(async () => {
	if (originalRuntimeProfile === undefined) {
		delete process.env.MIKO_RUNTIME_PROFILE;
	} else {
		process.env.MIKO_RUNTIME_PROFILE = originalRuntimeProfile;
	}

	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDataDir() {
	const dir = await mkdtemp(join(tmpdir(), 'miko-event-store-'));
	tempDirs.push(dir);
	return dir;
}

function entry(
	kind: 'user_prompt' | 'assistant_text',
	createdAt: number,
	extra: Record<string, unknown> = {},
): TranscriptEntry {
	const base = { _id: `${kind}-${createdAt}`, createdAt };
	if (kind === 'user_prompt') {
		return { ...base, kind, content: String(extra.content ?? '') };
	}
	return { ...base, kind, text: String(extra.content ?? extra.text ?? '') };
}

describe('EventStore', () => {
	test('uses the runtime profile for the default data dir', () => {
		process.env.MIKO_RUNTIME_PROFILE = 'dev';
		const store = new EventStore();

		expect(store.dataDir).toEndWith('/.miko-dev/data');
	});

	describe('initialize', () => {
		test('creates data dir, transcripts subdir, and empty log files for project, chats and turns', async () => {                
			const dataDir = await createTempDataDir();
			const store = new EventStore(dataDir);                            
			await store.initialize();                                                                  
	 
			expect(existsSync(store.dataDir)).toBe(true);                                              
			expect(existsSync(join(dataDir, 'transcripts'))).toBe(true);
			expect(existsSync(join(dataDir, 'projects.jsonl'))).toBe(true);                            
			expect(existsSync(join(dataDir, 'chats.jsonl'))).toBe(true);
			expect(existsSync(join(dataDir, 'turns.jsonl'))).toBe(true);                               
		});         
	});
});
