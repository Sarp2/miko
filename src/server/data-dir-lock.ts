import { createHash } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';
import { chmod, mkdir, realpath } from 'node:fs/promises';

const LOCK_HOST = '127.0.0.1';
const LOCK_PORT_START = 40_000;
const LOCK_PORT_COUNT = 20_000;
const MAX_LOCK_PORT_ATTEMPTS = 32;
const LOCK_PROBE = 'miko-data-dir-lock';

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

function bind(socket: Socket, port: number) {
	return new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			socket.off('listening', onListening);
			reject(error);
		};
		const onListening = () => {
			socket.off('error', onError);
			resolve();
		};

		socket.once('error', onError);
		socket.once('listening', onListening);
		socket.bind(port, LOCK_HOST);
	});
}

function readLockOwner(port: number) {
	return new Promise<LockOwner | null>((resolve) => {
		const socket = createSocket('udp4');
		const timeout = setTimeout(() => {
			socket.close();
			resolve(null);
		}, 300);

		socket.once('message', (message) => {
			clearTimeout(timeout);
			socket.close();
			try {
				const candidate = JSON.parse(message.toString('utf8')) as Partial<LockOwner>;
				resolve(
					typeof candidate.key === 'string' &&
						typeof candidate.pid === 'number' &&
						Number.isInteger(candidate.pid)
						? (candidate as LockOwner)
						: null,
				);
			} catch {
				resolve(null);
			}
		});
		socket.once('error', () => {
			clearTimeout(timeout);
			socket.close();
			resolve(null);
		});
		socket.send(LOCK_PROBE, port, LOCK_HOST);
	});
}

async function closeSocket(socket: Socket) {
	await new Promise<void>((resolve) => {
		socket.close(() => resolve());
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
		const socket = createSocket('udp4');
		socket.on('message', (message, remote) => {
			if (message.toString('utf8') !== LOCK_PROBE) return;
			socket.send(JSON.stringify(owner), remote.port, remote.address);
		});

		try {
			await bind(socket, port);

			let released = false;
			return {
				path: `udp://${LOCK_HOST}:${port}`,
				release: async () => {
					if (released) return;
					released = true;
					await closeSocket(socket);
				},
			};
		} catch (error) {
			socket.close();
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
