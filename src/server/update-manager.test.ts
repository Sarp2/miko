import { describe, expect, test } from 'bun:test';
import { PACKAGE_NAME } from '../shared/branding';
import { UpdateManager, type UpdateManagerDeps } from './update-manager';

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((innerResolve, innerReject) => {
		resolve = innerResolve;
		reject = innerReject;
	});
	return { promise, resolve, reject };
}

function createUpdateManager(overrides: Partial<UpdateManagerDeps> = {}) {
	return new UpdateManager({
		currentVersion: '1.0.0',
		fetchLatestVersion: async () => '1.0.0',
		installVersion: () => ({
			ok: true,
			errorCode: null,
			userTitle: null,
			userMessage: null,
		}),
		...overrides,
	});
}

describe('UpdateManager.onChange', () => {
	test('emits snapshots when manager state changes', async () => {
		const manager = createUpdateManager({ devMode: true });

		const statuses: string[] = [];
		manager.onChange((snapshot) => {
			statuses.push(snapshot.status);
		});

		await manager.installUpdate();

		expect(statuses).toEqual(['updating', 'restart_pending']);
	});

	test('stops emitting after unsubscribe is called', async () => {
		const manager = createUpdateManager({ devMode: true });

		const listener = { calls: 0 };
		const unsubscribe = manager.onChange(() => {
			listener.calls += 1;
		});

		unsubscribe();

		await manager.installUpdate();

		expect(listener.calls).toBe(0);
	});
});

describe('UpdateManager.checkForUpdates', () => {
	test('sets status to available when a newer version exists', async () => {
		const manager = createUpdateManager({
			fetchLatestVersion: async () => '1.2.0',
		});

		const statuses: string[] = [];
		manager.onChange((snapshot) => {
			statuses.push(snapshot.status);
		});

		const snapshot = await manager.checkForUpdates();

		expect(statuses).toEqual(['checking', 'available']);
		expect(snapshot).toMatchObject({
			currentVersion: '1.0.0',
			latestVersion: '1.2.0',
			status: 'available',
			updateAvailable: true,
			error: null,
		});

		expect(snapshot.lastCheckedAt).not.toBeNull();
	});

	test('sets status to up_to_date when latest version matches current', async () => {
		const manager = createUpdateManager({
			fetchLatestVersion: async () => '1.0.0',
		});

		const snapshot = await manager.checkForUpdates();

		expect(snapshot).toMatchObject({
			latestVersion: '1.0.0',
			status: 'up_to_date',
			updateAvailable: false,
			error: null,
		});
	});

	test('sets status to error when fetching latest version fails', async () => {
		const manager = createUpdateManager({
			fetchLatestVersion: async () => {
				throw new Error('network unavailable');
			},
		});

		const snapshot = await manager.checkForUpdates();

		expect(snapshot.status).toBe('error');
		expect(snapshot.error).toBe('network unavailable');
		expect(snapshot.lastCheckedAt).not.toBeNull();
	});

	test('uses cached snapshot within ttl unless force is true', async () => {
		let fetchCalls = 0;
		let latestVersion = '1.0.1';
		const manager = createUpdateManager({
			fetchLatestVersion: async () => {
				fetchCalls += 1;
				return latestVersion;
			},
		});

		const first = await manager.checkForUpdates();
		expect(fetchCalls).toBe(1);
		expect(first.latestVersion).toBe('1.0.1');

		latestVersion = '1.0.2';
		const second = await manager.checkForUpdates();
		expect(fetchCalls).toBe(1);
		expect(second.latestVersion).toBe('1.0.1');

		const third = await manager.checkForUpdates({ force: true });
		expect(fetchCalls).toBe(2);
		expect(third.latestVersion).toBe('1.0.2');
	});

	test('reuses in-flight check promise for concurrent callers', async () => {
		let fetchCalls = 0;
		const latestVersionDeferred = createDeferred<string>();
		const manager = createUpdateManager({
			fetchLatestVersion: () => {
				fetchCalls += 1;
				return latestVersionDeferred.promise;
			},
		});

		const first = manager.checkForUpdates();
		const second = manager.checkForUpdates();

		expect(fetchCalls).toBe(1);
		latestVersionDeferred.resolve('1.1.0');

		const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
		expect(firstSnapshot.status).toBe('available');
		expect(secondSnapshot.status).toBe('available');
		expect(firstSnapshot.latestVersion).toBe('1.1.0');
		expect(secondSnapshot.latestVersion).toBe('1.1.0');
	});
});

describe('UpdateManager.installUpdate', () => {
	test('in dev mode, transitions to restart_pending and returns success', async () => {
		const manager = createUpdateManager({ devMode: true });

		const statuses: string[] = [];
		manager.onChange((snapshot) => {
			statuses.push(snapshot.status);
		});

		const result = await manager.installUpdate();
		const snapshot = manager.getSnapshot();

		expect(result).toEqual({
			ok: true,
			action: 'restart',
			errorCode: null,
			userTitle: null,
			userMessage: null,
		});
		
		expect(statuses).toEqual(['updating', 'restart_pending']);
		expect(snapshot.status).toBe('restart_pending');
		expect(snapshot.updateAvailable).toBe(false);
	});

	test('returns not ok when no update is available after forced check', async () => {
		let installCalls = 0;
		const manager = createUpdateManager({
			fetchLatestVersion: async () => '1.0.0',
			installVersion: () => {
				installCalls += 1;
				return {
					ok: true,
					errorCode: null,
					userTitle: null,
					userMessage: null,
				};
			},
		});

		const result = await manager.installUpdate();

		expect(result).toEqual({
			ok: false,
			action: 'restart',
			errorCode: null,
			userTitle: null,
			userMessage: null,
		});
		
		expect(installCalls).toBe(0);
		expect(manager.getSnapshot().status).toBe('up_to_date');
	});

	test('installs latest version and marks restart pending', async () => {
		const installCalls: Array<{ packageName: string; version: string }> = [];
		const manager = createUpdateManager({
			fetchLatestVersion: async () => '1.2.0',
			installVersion: (packageName, version) => {
				installCalls.push({ packageName, version });
				return {
					ok: true,
					errorCode: null,
					userTitle: null,
					userMessage: null,
				};
			},
		});

		const result = await manager.installUpdate();
		const snapshot = manager.getSnapshot();

		expect(result.ok).toBe(true);
		expect(installCalls).toEqual([{ packageName: PACKAGE_NAME, version: '1.2.0' }]);
		expect(snapshot.currentVersion).toBe('1.2.0');
		expect(snapshot.status).toBe('restart_pending');
		expect(snapshot.updateAvailable).toBe(false);
		expect(snapshot.error).toBeNull();
	});

	test('surfaces install errors and updates snapshot error state', async () => {
		const manager = createUpdateManager({
			fetchLatestVersion: async () => '1.2.0',
			installVersion: () => ({
				ok: false,
				errorCode: 'install_failed',
				userTitle: 'Update failed',
				userMessage: 'Permission denied',
			}),
		});

		const result = await manager.installUpdate();
		const snapshot = manager.getSnapshot();

		expect(result).toEqual({
			ok: false,
			action: 'restart',
			errorCode: 'install_failed',
			userTitle: 'Update failed',
			userMessage: 'Permission denied',
		});
		expect(snapshot.status).toBe('error');
		expect(snapshot.error).toBe('Permission denied');
	});

	test('reuses in-flight install promise for concurrent callers', async () => {
		let fetchCalls = 0;
		let installCalls = 0;
		
		const latestVersionDeferred = createDeferred<string>();
		const manager = createUpdateManager({
			fetchLatestVersion: () => {
				fetchCalls += 1;
				return latestVersionDeferred.promise;
			},
			installVersion: () => {
				installCalls += 1;
				return {
					ok: true,
					errorCode: null,
					userTitle: null,
					userMessage: null,
				};
			},
		});

		const first = manager.installUpdate();
		const second = manager.installUpdate();

		expect(fetchCalls).toBe(1);
		latestVersionDeferred.resolve('1.3.0');

		const [firstResult, secondResult] = await Promise.all([first, second]);
		expect(firstResult.ok).toBe(true);
		expect(secondResult.ok).toBe(true);
		expect(installCalls).toBe(1);
	});
});
