import process from 'node:process';
import { fetchLatestPackageVersion, installPackageVersion, openUrl, runCli } from './cli-runtime';
import { CLI_STARTUP_UPDATE_RESTART_EXIT_CODE } from './restart';
import { startServer } from './server';

// Read version from package.json at the package root.
const pkg = await Bun.file(new URL('../../package.json', import.meta.url)).json();
const VERSION: string = pkg.version ?? '0.0.0';

const argv = process.argv.slice(2);

const result = await runCli(argv, {
	version: VERSION,
	bunVersion: Bun.version,
	startServer: async (options) => {
		const started = await startServer({
			port: options.port,
			host: options.host,
			strictPort: options.strictPort,
			onMigrationProgress: options.onMigrationProgress,
		});

		return {
			port: started.port,
			stop: () => started.stop(),
		};
	},
	fetchLatestVersion: fetchLatestPackageVersion,
	installVersion: installPackageVersion,
	openUrl,
	log: console.log,
	warn: console.warn,
});

if (result.kind === 'exited') {
	process.exit(result.code);
}

if (result.kind === 'restarting') {
	process.exit(CLI_STARTUP_UPDATE_RESTART_EXIT_CODE);
}

await new Promise<void>((resolve) => {
	process.once('SIGINT', () => resolve());
	process.once('SIGTERM', () => resolve());
});

await result.stop();
process.exit(0);
