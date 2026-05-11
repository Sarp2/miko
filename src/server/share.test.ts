import { describe, expect, test } from 'bun:test';
import { ensureCloudflaredInstalled, type ShareTunnelProcess, startShareTunnel } from './share';

function createMockTunnel() {
	const listeners = {
		url: [] as Array<(url: string) => void>,
		error: [] as Array<(error: Error) => void>,
		exit: [] as Array<(code: number | null, signal: NodeJS.Signals | null) => void>,
	};
	let stopCalls = 0;
	let tunnel: ShareTunnelProcess;

	function once(event: 'url', listener: (url: string) => void): ShareTunnelProcess;
	function once(event: 'error', listener: (error: Error) => void): ShareTunnelProcess;
	function once(
		event: 'exit',
		listener: (code: number | null, signal: NodeJS.Signals | null) => void,
	): ShareTunnelProcess;
	function once(
		event: 'url' | 'error' | 'exit',
		listener:
			| ((url: string) => void)
			| ((error: Error) => void)
			| ((code: number | null, signal: NodeJS.Signals | null) => void),
	): ShareTunnelProcess {
		if (event === 'url') {
			listeners.url.push(listener as (url: string) => void);
			return tunnel;
		}
		if (event === 'error') {
			listeners.error.push(listener as (error: Error) => void);
			return tunnel;
		}
		listeners.exit.push(listener as (code: number | null, signal: NodeJS.Signals | null) => void);
		return tunnel;
	}

	function off(event: 'url', listener: (url: string) => void): ShareTunnelProcess;
	function off(event: 'error', listener: (error: Error) => void): ShareTunnelProcess;
	function off(
		event: 'exit',
		listener: (code: number | null, signal: NodeJS.Signals | null) => void,
	): ShareTunnelProcess;
	function off(
		event: 'url' | 'error' | 'exit',
		listener:
			| ((url: string) => void)
			| ((error: Error) => void)
			| ((code: number | null, signal: NodeJS.Signals | null) => void),
	): ShareTunnelProcess {
		if (event === 'url') {
			const next = listeners.url.filter((candidate) => candidate !== listener);
			listeners.url.length = 0;
			listeners.url.push(...next);
			return tunnel;
		}
		if (event === 'error') {
			const next = listeners.error.filter((candidate) => candidate !== listener);
			listeners.error.length = 0;
			listeners.error.push(...next);
			return tunnel;
		}
		const next = listeners.exit.filter((candidate) => candidate !== listener);
		listeners.exit.length = 0;
		listeners.exit.push(...next);
		return tunnel;
	}

	tunnel = {
		once,
		off,
		stop() {
			stopCalls += 1;
			return true;
		},
	};

	return {
		tunnel,
		emitUrl(url: string) {
			for (const listener of listeners.url) listener(url);
		},
		emitError(error: Error) {
			for (const listener of listeners.error) listener(error);
		},
		emitExit(code: number | null, signal: NodeJS.Signals | null) {
			for (const listener of listeners.exit) listener(code, signal);
		},
		getStopCalls() {
			return stopCalls;
		},
	};
}

describe('ensureCloudflaredInstalled', () => {
	test('returns immediately when cloudflared binary already exists', async () => {
		const installCalls: string[] = [];

		const result = await ensureCloudflaredInstalled({
			cloudflaredBin: '/tmp/cloudflared',
			existsSync: () => true,
			installCloudflared: async (to) => {
				installCalls.push(to);
				return to;
			},
		});

		expect(result).toBe('/tmp/cloudflared');
		expect(installCalls).toEqual([]);
	});

	test('installs cloudflared binary when missing', async () => {
		const installCalls: string[] = [];
		const logLines: string[] = [];

		const result = await ensureCloudflaredInstalled({
			cloudflaredBin: '/tmp/cloudflared',
			existsSync: () => false,
			installCloudflared: async (to) => {
				installCalls.push(to);
				return to;
			},
			log: (message) => {
				logLines.push(message);
			},
		});

		expect(result).toBe('/tmp/cloudflared');
		expect(installCalls).toEqual(['/tmp/cloudflared']);
		expect(logLines).toEqual(['installing cloudflared binary']);
	});
});

describe('startShareTunnel', () => {
	test('returns public url and exposes stop handler after url event', async () => {
		const installCalls: string[] = [];
		const quickTunnelUrls: string[] = [];
		const mock = createMockTunnel();

		const resultPromise = startShareTunnel('http://localhost:3333', {
			cloudflaredBin: '/tmp/cloudflared',
			existsSync: () => false,
			installCloudflared: async (to) => {
				installCalls.push(to);
				return to;
			},
			createQuickTunnel: (localUrl) => {
				quickTunnelUrls.push(localUrl);
				queueMicrotask(() => {
					mock.emitUrl('https://miko.trycloudflare.com');
				});
				return mock.tunnel;
			},
		});

		const shareTunnel = await resultPromise;
		expect(installCalls).toEqual(['/tmp/cloudflared']);
		expect(quickTunnelUrls).toEqual(['http://localhost:3333']);
		expect(shareTunnel.publicUrl).toBe('https://miko.trycloudflare.com');

		shareTunnel.stop();
		expect(mock.getStopCalls()).toBe(1);
	});

	test('rejects when tunnel exits before url is ready', async () => {
		const mock = createMockTunnel();

		const resultPromise = startShareTunnel('http://localhost:3333', {
			cloudflaredBin: '/tmp/cloudflared',
			existsSync: () => true,
			createQuickTunnel: () => {
				queueMicrotask(() => {
					mock.emitExit(1, null);
				});
				return mock.tunnel;
			},
		});

		await expect(resultPromise).rejects.toThrow(
			'Cloudflare tunnel exited before a public URL was ready',
		);
	});
});
