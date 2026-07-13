import { spawn, spawnSync } from 'node:child_process';

export function spawnDetached(command: string, args: string[]) {
	const child = spawn(command, args, { stdio: 'ignore', detached: true });
	// A failed launch (e.g. ENOENT/EACCES) must not crash the server, but it must
	// not be silent either — a swallowed error here looks like "nothing happened"
	// to the user. Log it so the failure is diagnosable.
	child.on('error', (error) => {
		console.warn('[miko] spawnDetached failed', { command, args, error });
	});
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
