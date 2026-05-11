import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'node:child_process';
import {
	classifyInstallVersionFailure,
	compareVersions,
	fetchLatestPackageVersion,
	installPackageVersion,
	openUrl,
	parseArgs,
	runCli,
} from './cli-runtime';
import * as processUtils from './process-utils';
import { CLI_SUPPRESS_OPEN_ONCE_ENV_VAR } from './restart';

const originalRuntimeProfile = process.env.MIKO_RUNTIME_PROFILE;
const originalSuppressOpen = process.env[CLI_SUPPRESS_OPEN_ONCE_ENV_VAR];

afterEach(() => {
	if (originalRuntimeProfile === undefined) {
		delete process.env.MIKO_RUNTIME_PROFILE;
	} else {
		process.env.MIKO_RUNTIME_PROFILE = originalRuntimeProfile;
	}
	if (originalSuppressOpen === undefined) {
		delete process.env[CLI_SUPPRESS_OPEN_ONCE_ENV_VAR];
	} else {
		process.env[CLI_SUPPRESS_OPEN_ONCE_ENV_VAR] = originalSuppressOpen;
	}
});

function createDeps(overrides: Partial<Parameters<typeof runCli>[1]> = {}) {
	const calls = {
		startServer: [] as Array<{
			port: number;
			host: string;
			openBrowser: boolean;
			strictPort: boolean;
			update: {
				version: string;
				argv: string[];
				command: string;
			};
		}>,
		fetchLatestVersion: [] as string[],
		installVersion: [] as Array<{ packageName: string; version: string }>,
		openUrl: [] as string[],
		log: [] as string[],
		warn: [] as string[],
		shareTunnel: [] as string[],
		renderShareQr: [] as string[],
		shareTunnelStops: 0,
	};

	const deps: Parameters<typeof runCli>[1] = {
		version: '0.3.0',
		bunVersion: '1.3.10',
		startServer: async (options) => {
			calls.startServer.push(options);
			return {
				port: options.port,
				stop: async () => {},
			};
		},
		fetchLatestVersion: async (packageName) => {
			calls.fetchLatestVersion.push(packageName);
			return '0.3.0';
		},
		installVersion: (packageName, version) => {
			calls.installVersion.push({ packageName, version });
			return {
				ok: true,
				errorCode: null,
				userTitle: null,
				userMessage: null,
			};
		},
		openUrl: (url) => {
			calls.openUrl.push(url);
		},
		log: (message) => {
			calls.log.push(message);
		},
		warn: (message) => {
			calls.warn.push(message);
		},
		renderShareQr: async (url) => {
			calls.renderShareQr.push(url);
			return `[qr:${url}]`;
		},
		startShareTunnel: async (localUrl) => {
			calls.shareTunnel.push(localUrl);
			return {
				publicUrl: 'https://miko.trycloudflare.com',
				stop: () => {
					calls.shareTunnelStops += 1;
				},
			};
		},
		...overrides,
	};

	return { calls, deps };
}

describe('parseArgs', () => {
	test('parses runtime options', () => {
		expect(parseArgs(['--port', '4000', '--no-open'])).toEqual({
			kind: 'run',
			options: {
				port: 4000,
				host: '127.0.0.1',
				openBrowser: false,
				share: false,
				strictPort: false,
			},
		});
	});

	test('parses strict port mode', () => {
		expect(parseArgs(['--strict-port'])).toEqual({
			kind: 'run',
			options: {
				port: 3210,
				host: '127.0.0.1',
				openBrowser: true,
				share: false,
				strictPort: true,
			},
		});
	});

	test('--remote without value binds all interfaces', () => {
		expect(parseArgs(['--remote'])).toEqual({
			kind: 'run',
			options: {
				port: 3210,
				host: '0.0.0.0',
				openBrowser: true,
				share: false,
				strictPort: false,
			},
		});
	});

	test('--share enables public sharing', () => {
		expect(parseArgs(['--share'])).toEqual({
			kind: 'run',
			options: {
				port: 3210,
				host: '127.0.0.1',
				openBrowser: true,
				share: true,
				strictPort: false,
			},
		});
	});

	test('--host with IP binds to that address', () => {
		expect(parseArgs(['--host', '100.64.0.1'])).toEqual({
			kind: 'run',
			options: {
				port: 3210,
				host: '100.64.0.1',
				openBrowser: true,
				share: false,
				strictPort: false,
			},
		});
	});

	test('--host with hostname binds to that name', () => {
		expect(parseArgs(['--host', 'dev-box'])).toEqual({
			kind: 'run',
			options: {
				port: 3210,
				host: 'dev-box',
				openBrowser: true,
				share: false,
				strictPort: false,
			},
		});
	});

	test('--host without a value throws', () => {
		expect(() => parseArgs(['--host'])).toThrow('Missing value for --host');
		expect(() => parseArgs(['--host', '--no-open'])).toThrow('Missing value for --host');
	});

	test('--share is incompatible with --host and --remote', () => {
		expect(() => parseArgs(['--share', '--host', 'dev-box'])).toThrow(
			'--share cannot be used with --host',
		);
		expect(() => parseArgs(['--host', 'dev-box', '--share'])).toThrow(
			'--share cannot be used with --host',
		);
		expect(() => parseArgs(['--share', '--remote'])).toThrow(
			'--share cannot be used with --remote',
		);
		expect(() => parseArgs(['--remote', '--share'])).toThrow(
			'--share cannot be used with --remote',
		);
	});

	test('returns version and help actions without running startup', () => {
		expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
		expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
	});
});

describe('compareVersions', () => {
	test('orders semver-like versions', () => {
		expect(compareVersions('0.3.0', '0.3.0')).toBe(0);
		expect(compareVersions('0.3.0', '0.3.1')).toBe(-1);
		expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
	});
});

describe('classifyInstallVersionFailure', () => {
	test('maps version propagation failures to a user-facing retry message', () => {
		expect(
			classifyInstallVersionFailure(
				'error: No version matching "0.13.3" found for specifier "miko-code"',
			),
		).toEqual({
			ok: false,
			errorCode: 'version_not_live_yet',
			userTitle: 'Update not live yet',
			userMessage: 'This update is still propagating. Try again in a few minutes.',
		});
	});

	test('falls back to generic install failure for unknown errors', () => {
		expect(classifyInstallVersionFailure('EACCES: permission denied')).toEqual({
			ok: false,
			errorCode: 'install_failed',
			userTitle: 'Update failed',
			userMessage: 'Miko could not install the update. Try again later.',
		});
	});
});

describe('runCli', () => {
	test('skips update checks for --version', async () => {
		const { calls, deps } = createDeps();

		const result = await runCli(['--version'], deps);

		expect(result).toEqual({ kind: 'exited', code: 0 });
		expect(calls.fetchLatestVersion).toEqual([]);
		expect(calls.startServer).toEqual([]);
		expect(calls.log).toEqual(['0.3.0']);
	});

	test('fails fast on unsupported Bun versions', async () => {
		const { calls, deps } = createDeps({
			bunVersion: '1.3.1',
		});

		const result = await runCli(['--no-open'], deps);

		expect(result).toEqual({ kind: 'exited', code: 1 });
		expect(calls.startServer).toEqual([]);
		expect(calls.warn).toContain(
			'[miko] Bun 1.3.5+ is required for the embedded terminal. Current Bun: 1.3.1',
		);
	});

	test('suppresses browser open for a ui-triggered restarted child', async () => {
		process.env[CLI_SUPPRESS_OPEN_ONCE_ENV_VAR] = '1';
		const { calls, deps } = createDeps();

		await runCli(['--port', '4000'], deps);

		expect(calls.openUrl).toEqual([]);
	});

	test('starts a share tunnel and prints qr/public/local urls', async () => {
		delete process.env[CLI_SUPPRESS_OPEN_ONCE_ENV_VAR];
		const { calls, deps } = createDeps();

		const result = await runCli(['--share', '--port', '4000'], deps);

		expect(result.kind).toBe('started');
		expect(calls.openUrl).toEqual([]);
		expect(calls.shareTunnel).toEqual(['http://localhost:4000']);
		expect(calls.renderShareQr).toEqual(['https://miko.trycloudflare.com']);
		expect(calls.log).toContain('https://miko.trycloudflare.com');

		if (result.kind !== 'started') {
			throw new Error(`expected started result, got ${result.kind}`);
		}

		await result.stop();
		expect(calls.shareTunnelStops).toBe(1);
	});

	test('uses actual bound port for share tunnel target url', async () => {
		const { calls, deps } = createDeps({
			startServer: async (options) => {
				calls.startServer.push(options);
				return {
					port: 4001,
					stop: async () => {},
				};
			},
		});

		const result = await runCli(['--share', '--port', '4000'], deps);

		expect(result.kind).toBe('started');
		expect(calls.shareTunnel).toEqual(['http://localhost:4001']);
	});

	test('fails cleanly when share tunnel startup fails', async () => {
		let serverStopped = false;
		const { calls, deps } = createDeps({
			startServer: async (options) => {
				calls.startServer.push(options);
				return {
					port: options.port,
					stop: async () => {
						serverStopped = true;
					},
				};
			},
			startShareTunnel: async () => {
				throw new Error('cloudflared unavailable');
			},
		});

		const result = await runCli(['--share'], deps);

		expect(result).toEqual({ kind: 'exited', code: 1 });
		expect(serverStopped).toBe(true);
		expect(calls.warn).toContain('[miko] failed to start Cloudflare share tunnel');
		expect(calls.warn).toContain('[miko] cloudflared unavailable');
	});

	test('returns restarting when a newer version is available', async () => {
		const { calls, deps } = createDeps({
			fetchLatestVersion: async (packageName) => {
				calls.fetchLatestVersion.push(packageName);
				return '0.4.0';
			},
		});

		const result = await runCli(['--port', '4000', '--no-open'], deps);

		expect(result).toEqual({ kind: 'restarting', reason: 'startup_update' });
		expect(calls.installVersion).toEqual([{ packageName: 'miko-code', version: '0.4.0' }]);
		expect(calls.startServer).toEqual([]);
	});

	test('falls back to current version when install fails', async () => {
		const { calls, deps } = createDeps({
			fetchLatestVersion: async (packageName) => {
				calls.fetchLatestVersion.push(packageName);
				return '0.4.0';
			},
			installVersion: (packageName, version) => {
				calls.installVersion.push({ packageName, version });
				return {
					ok: false,
					errorCode: 'install_failed',
					userTitle: 'Update failed',
					userMessage: 'Miko could not install the update. Try again later.',
				};
			},
		});

		const result = await runCli(['--no-open'], deps);

		expect(result.kind).toBe('started');
		expect(calls.installVersion).toEqual([{ packageName: 'miko-code', version: '0.4.0' }]);
		expect(calls.warn).toContain('[miko] update failed, continuing current version');
	});
});

describe('openUrl', () => {
	const originalPlatform = process.platform;

	afterEach(() => {
		Object.defineProperty(process, 'platform', { value: originalPlatform });
		spyOn(processUtils, 'spawnDetached').mockRestore();
		spyOn(console, 'log').mockRestore();
	});

	test('uses macOS open command on darwin', () => {
		Object.defineProperty(process, 'platform', { value: 'darwin' });
		const spawn = spyOn(processUtils, 'spawnDetached').mockImplementation(() => {});
		spyOn(console, 'log').mockImplementation(() => {});

		openUrl('http://localhost:4000');

		expect(spawn).toHaveBeenCalledWith('open', ['http://localhost:4000']);
	});

	test('uses cmd start command on win32', () => {
		Object.defineProperty(process, 'platform', { value: 'win32' });
		const spawn = spyOn(processUtils, 'spawnDetached').mockImplementation(() => {});
		spyOn(console, 'log').mockImplementation(() => {});

		openUrl('http://localhost:4000');

		expect(spawn).toHaveBeenCalledWith('cmd', ['/c', 'start', '', 'http://localhost:4000']);
	});

	test('uses xdg-open on non-darwin/non-win32 platforms', () => {
		Object.defineProperty(process, 'platform', { value: 'linux' });
		const spawn = spyOn(processUtils, 'spawnDetached').mockImplementation(() => {});
		spyOn(console, 'log').mockImplementation(() => {});

		openUrl('http://localhost:4000');

		expect(spawn).toHaveBeenCalledWith('xdg-open', ['http://localhost:4000']);
	});
});

describe('fetchLatestPackageVersion', () => {
	afterEach(() => {
		spyOn(globalThis, 'fetch').mockRestore();
	});

	test('returns version when registry responds with a valid payload', async () => {
		spyOn(globalThis, 'fetch').mockResolvedValue(
			Response.json({ version: '2.3.4' }) as unknown as Response,
		);

		await expect(fetchLatestPackageVersion('miko-code')).resolves.toBe('2.3.4');
	});

	test('throws when registry returns a non-ok status', async () => {
		spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('nope', { status: 503 }) as unknown as Response,
		);

		await expect(fetchLatestPackageVersion('miko-code')).rejects.toThrow('registry returned 503');
	});

	test('throws when payload is missing version', async () => {
		spyOn(globalThis, 'fetch').mockResolvedValue(
			Response.json({ distTag: 'latest' }) as unknown as Response,
		);

		await expect(fetchLatestPackageVersion('miko-code')).rejects.toThrow(
			'registry response did not include a version',
		);
	});
});

describe('installPackageVersion', () => {
	afterEach(() => {
		spyOn(processUtils, 'hasCommand').mockRestore();
		spyOn(childProcess, 'spawnSync').mockRestore();
	});

	test('returns command_missing when bun is unavailable', () => {
		spyOn(processUtils, 'hasCommand').mockReturnValue(false);
		const spawn = spyOn(childProcess, 'spawnSync');

		const result = installPackageVersion('miko-code', '1.2.3');

		expect(result).toEqual({
			ok: false,
			errorCode: 'command_missing',
			userTitle: 'Bun not found',
			userMessage: 'Miko could not find Bun to install the update.',
		});
		expect(spawn).toHaveBeenCalledTimes(0);
	});

	test('returns ok when bun install exits with status 0', () => {
		spyOn(processUtils, 'hasCommand').mockReturnValue(true);
		const spawn = spyOn(childProcess, 'spawnSync').mockReturnValue({
			status: 0,
			stdout: '',
			stderr: '',
		} as unknown as ReturnType<typeof childProcess.spawnSync>);

		const result = installPackageVersion('miko-code', '1.2.3');

		expect(spawn).toHaveBeenCalledWith('bun', ['install', '-g', 'miko-code@1.2.3'], {
			stdio: ['ignore', 'pipe', 'pipe'],
			encoding: 'utf8',
		});
		expect(result).toEqual({
			ok: true,
			errorCode: null,
			userTitle: null,
			userMessage: null,
		});
	});
});
