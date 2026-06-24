import { createHash } from 'node:crypto';
import { chmod, mkdir, realpath } from 'node:fs/promises';
import { createConnection, createServer, type Server } from 'node:net';

const LOCK_HOST = '127.0.0.1';
const LOCK_PORT_START = 40_000;
const LOCK_PORT_COUNT = 20_000;
const MAX_LOCK_PORT_ATTEMPTS = 32;

interface LockOwner {
	key: string;
	pid: number;
}

export interface DataDirLock {
	path: string;
	release: () => Promise<void>;
}

function lockKey(dataDir: string) {
	return createHash('sha256').update(dataDir).digest('hex');
}

function lockPort(key: string, attempt: number) {
	const offset = (Number.parseInt(key.slice(0, 8), 16) + attempt) % LOCK_PORT_COUNT;
	return LOCK_PORT_START + offset;
}

function listen(server: Server, port: number) {
	return new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			server.off('listening', onListening);
			reject(error);
		};
		const onListening = () => {
			server.off('error', onError);
			resolve();
		};

		server.once('error', onError);
		server.once('listening', onListening);
		server.listen(port, LOCK_HOST);
	});
}

function readLockOwner(port: number) {
	return new Promise<LockOwner | null>((resolve) => {
		const socket = createConnection({ host: LOCK_HOST, port });
		let response = '';
		let settled = false;

		const finish = (owner: LockOwner | null) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(owner);
		};

		socket.setEncoding('utf8');
		socket.setTimeout(500);
		socket.on('data', (chunk) => {
			response += chunk;
		});
		socket.once('end', () => {
			try {
				const candidate = JSON.parse(response || 'null') as Partial<LockOwner> | null;
				finish(
					candidate &&
						typeof candidate.key === 'string' &&
						typeof candidate.pid === 'number' &&
						Number.isInteger(candidate.pid)
						? (candidate as LockOwner)
						: null,
				);
			} catch {
				finish(null);
			}
		});
		socket.once('timeout', () => finish(null));
		socket.once('error', () => finish(null));
	});
}

async function closeServer(server: Server) {
	await new Promise<void>((resolve) => {
		server.close(() => resolve());
	});
}

export async function acquireDataDirLock(dataDir: string): Promise<DataDirLock> {
	await mkdir(dataDir, { recursive: true, mode: 0o700 });
	await chmod(dataDir, 0o700);
	const canonicalDataDir = await realpath(dataDir);
	const key = lockKey(canonicalDataDir);

	for (let attempt = 0; attempt < MAX_LOCK_PORT_ATTEMPTS; attempt++) {
		const port = lockPort(key, attempt);
		const owner: LockOwner = { key, pid: process.pid };
		const server = createServer((socket) => {
			socket.end(`${JSON.stringify(owner)}\n`);
		});

		try {
			await listen(server, port);

			let released = false;
			return {
				path: `tcp://${LOCK_HOST}:${port}`,
				release: async () => {
					if (released) return;
					released = true;
					await closeServer(server);
				},
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;

			const current = await readLockOwner(port);
			if (current?.key === key) {
				throw new Error(
					`Miko is already using this data directory (process ${current.pid}). Close the other Miko instance and try again.`,
				);
			}
		}
	}

	throw new Error('Could not reserve a process lock for the Miko data directory.');
}
