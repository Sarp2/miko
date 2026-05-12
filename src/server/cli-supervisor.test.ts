import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'node:child_process';
import { CLI_COMMAND } from '../shared/branding';
import { getChildProcessSpec, spawnChild } from './cli-supervisor';
import {
	CLI_CHILD_ARGS_ENV_VAR,
	CLI_CHILD_COMMAND_ENV_VAR,
	CLI_CHILD_MODE,
	CLI_CHILD_MODE_ENV_VAR,
	CLI_SUPPRESS_OPEN_ONCE_ENV_VAR,
} from './restart';

const originalChildCommand = process.env[CLI_CHILD_COMMAND_ENV_VAR];
const originalChildArgs = process.env[CLI_CHILD_ARGS_ENV_VAR];

afterEach(() => {
	if (originalChildCommand === undefined) {
		delete process.env[CLI_CHILD_COMMAND_ENV_VAR];
	} else {
		process.env[CLI_CHILD_COMMAND_ENV_VAR] = originalChildCommand;
	}

	if (originalChildArgs === undefined) {
		delete process.env[CLI_CHILD_ARGS_ENV_VAR];
	} else {
		process.env[CLI_CHILD_ARGS_ENV_VAR] = originalChildArgs;
	}

	spyOn(childProcess, 'spawn').mockRestore();
});

describe('getChildProcessSpec', () => {
	test('uses default command and empty args when env vars are unset', () => {
		delete process.env[CLI_CHILD_COMMAND_ENV_VAR];
		delete process.env[CLI_CHILD_ARGS_ENV_VAR];

		expect(getChildProcessSpec()).toEqual({
			command: CLI_COMMAND,
			args: [],
		});
	});

	test('uses env-provided command and parses env-provided args', () => {
		process.env[CLI_CHILD_COMMAND_ENV_VAR] = 'bun';
		process.env[CLI_CHILD_ARGS_ENV_VAR] = '["run","./scripts/dev.ts"]';

		expect(getChildProcessSpec()).toEqual({
			command: 'bun',
			args: ['run', './scripts/dev.ts'],
		});
	});
});

describe('spawnChild', () => {
	test('spawns with merged args/env and resolves with child exit status', async () => {
		process.env[CLI_CHILD_COMMAND_ENV_VAR] = 'bun';
		process.env[CLI_CHILD_ARGS_ENV_VAR] = '["run","./scripts/dev.ts"]';

		const handlers: Partial<Record<'exit' | 'error', (...args: unknown[]) => void>> = {};
		const fakeChild = {
			exitCode: null as number | null,
			kill: () => true,
			once: (event: 'exit' | 'error', cb: (...args: unknown[]) => void) => {
				handlers[event] = cb;
				return fakeChild;
			},
		} as unknown as ReturnType<typeof childProcess.spawn>;

		const spawn = spyOn(childProcess, 'spawn').mockImplementation(((..._spawnArgs: unknown[]) => {
			queueMicrotask(() => {
				handlers.exit?.(7, null);
			});
			return fakeChild;
		}) as never);

		const result = await spawnChild(['--port', '4000'], true);

		expect(spawn).toHaveBeenCalledWith(
			'bun',
			['run', './scripts/dev.ts', '--port', '4000'],
			expect.objectContaining({
				stdio: 'inherit',
				env: expect.objectContaining({
					[CLI_CHILD_MODE_ENV_VAR]: CLI_CHILD_MODE,
					[CLI_SUPPRESS_OPEN_ONCE_ENV_VAR]: '1',
				}),
			}),
		);
		expect(result).toEqual({ code: 7, signal: null });
	});
});
