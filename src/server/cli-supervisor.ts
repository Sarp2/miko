import { spawn } from 'node:child_process';
import process from 'node:process';
import { CLI_COMMAND, LOG_PREFIX } from '../shared/branding';
import {
	CLI_CHILD_ARGS_ENV_VAR,
	CLI_CHILD_COMMAND_ENV_VAR,
	CLI_CHILD_MODE,
	CLI_CHILD_MODE_ENV_VAR,
	CLI_SUPPRESS_OPEN_ONCE_ENV_VAR,
	isUiUpdateRestart,
	parseChildArgsEnv,
	shouldRestartCliProcess,
} from './restart';

interface ChildExit {
	code: number | null;
	signal: NodeJS.Signals | null;
}

export function getChildProcessSpec(env: NodeJS.ProcessEnv = process.env) {
	const command = env[CLI_CHILD_COMMAND_ENV_VAR] || CLI_COMMAND;
	const args = parseChildArgsEnv(env[CLI_CHILD_ARGS_ENV_VAR]);
	return { command, args };
}

export function spawnChild(argv: string[], suppressOpenThisChild: boolean) {
	const childProcess = getChildProcessSpec();
	return new Promise<ChildExit>((resolve, reject) => {
		const child = spawn(childProcess.command, [...childProcess.args, ...argv], {
			stdio: 'inherit',
			env: {
				...process.env,
				[CLI_CHILD_MODE_ENV_VAR]: CLI_CHILD_MODE,
				...(suppressOpenThisChild ? { [CLI_SUPPRESS_OPEN_ONCE_ENV_VAR]: '1' } : {}),
			},
		});

		const forwardSignal = (signal: NodeJS.Signals) => {
			if (child.exitCode !== null) return;
			child.kill(signal);
		};

		const onSigint = () => {
			forwardSignal('SIGINT');
		};

		const onSigterm = () => {
			forwardSignal('SIGTERM');
		};

		process.on('SIGINT', onSigint);
		process.on('SIGTERM', onSigterm);

		child.once('error', (error) => {
			process.off('SIGINT', onSigint);
			process.off('SIGTERM', onSigterm);
			reject(error);
		});

		child.once('exit', (code, signal) => {
			process.off('SIGINT', onSigint);
			process.off('SIGTERM', onSigterm);
			resolve({ code, signal });
		});
	});
}

export async function runCliSupervisor(argv: string[]) {
	let suppressOpenOnNextChild = false;

	while (true) {
		const suppressOpenThisChild = suppressOpenOnNextChild;
		suppressOpenOnNextChild = false;

		const result = await spawnChild(argv, suppressOpenThisChild);
		if (shouldRestartCliProcess(result.code, result.signal)) {
			suppressOpenOnNextChild = isUiUpdateRestart(result.code, result.signal);
			console.log(
				`${LOG_PREFIX} supervisor restarting ${CLI_COMMAND} in the same terminal session`,
			);
			continue;
		}

		process.exit(result.code ?? (result.signal ? 1 : 0));
	}
}

if (import.meta.main) {
	await runCliSupervisor(process.argv.slice(2));
}
