import { spawn, spawnSync } from 'node:child_process';

export function spawnDetached(command: string, args: string[]) {
	const child = spawn(command, args, { stdio: 'ignore', detached: true });
	// Swallow ENOENT/EACCES so a missing binary cannot crash the server.
	child.on('error', () => {});
	child.unref();
}

export function hasCommand(command: string) {
	const result = spawnSync('sh', ['-lc', 'command -v "$1"', 'sh', command], { stdio: 'ignore' });
	return result.status === 0;
}

export function canOpenMacApp(appName: string) {
	const result = spawnSync('open', ['-Ra', appName], { stdio: 'ignore' });
	return result.status === 0;
}
