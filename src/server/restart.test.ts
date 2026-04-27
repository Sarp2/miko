import { describe, expect, test } from 'bun:test';
import {
	CLI_CHILD_ARGS_ENV_VAR,
	CLI_STARTUP_UPDATE_RESTART_EXIT_CODE,
	CLI_UI_UPDATE_RESTART_EXIT_CODE,
	isUiUpdateRestart,
	parseChildArgsEnv,
	shouldRestartCliProcess,
} from './restart';

describe('shouldRestartCliProcess', () => {
	test('restarts on either sentinel exit code with no signal', () => {
		expect(shouldRestartCliProcess(CLI_STARTUP_UPDATE_RESTART_EXIT_CODE, null)).toBe(true);
		expect(shouldRestartCliProcess(CLI_UI_UPDATE_RESTART_EXIT_CODE, null)).toBe(true);
	});

	test('does not restart for non-sentinel codes', () => {
		expect(shouldRestartCliProcess(0, null)).toBe(false);
		expect(shouldRestartCliProcess(1, null)).toBe(false);
	});

	test('does not restart when killed by a signal', () => {
		expect(shouldRestartCliProcess(CLI_STARTUP_UPDATE_RESTART_EXIT_CODE, 'SIGTERM')).toBe(false);
	});
});

describe('isUiUpdateRestart', () => {
	test('matches only the UI update exit code', () => {
		expect(isUiUpdateRestart(CLI_UI_UPDATE_RESTART_EXIT_CODE, null)).toBe(true);
		expect(isUiUpdateRestart(CLI_STARTUP_UPDATE_RESTART_EXIT_CODE, null)).toBe(false);
	});
});

describe('parseChildArgsEnv', () => {
	test('returns empty array when env var is unset', () => {
		expect(parseChildArgsEnv(undefined)).toEqual([]);
	});

	test('parses a JSON-encoded string array', () => {
		expect(parseChildArgsEnv('["run","./scripts/dev-server.ts"]')).toEqual([
			'run',
			'./scripts/dev-server.ts',
		]);
	});

	test('throws a labeled error on non-array JSON', () => {
		expect(() => parseChildArgsEnv('{"bad":true}')).toThrow(`Invalid ${CLI_CHILD_ARGS_ENV_VAR}`);
	});
});
