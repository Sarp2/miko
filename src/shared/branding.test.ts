import { describe, expect, test } from 'bun:test';
import {
	getDataDir,
	getDataDirDisplay,
	getDataRootName,
	getKeybindingsFilePath,
	getKeybindingsFilePathDisplay,
	getRuntimeProfile,
} from 'src/shared/branding';

describe('runtime profile helpers', () => {
	test('default to the prod profile when unset', () => {
		expect(getRuntimeProfile({})).toBe('prod');
		expect(getDataRootName({})).toBe('.miko');
		expect(getDataDir('/tmp/home', {})).toBe('/tmp/home/.miko/data');
		expect(getDataDirDisplay({})).toBe('~/.miko/data');
		expect(getKeybindingsFilePath('/tmp/home', {})).toBe('/tmp/home/.miko/keybindings.json');
		expect(getKeybindingsFilePathDisplay({})).toBe('~/.miko/keybindings.json');
	});

	test('switches to dev paths for the dev profile', () => {
		const env = { MIKO_RUNTIME_PROFILE: 'dev' };

		expect(getRuntimeProfile(env)).toBe('dev');
		expect(getDataRootName(env)).toBe('.miko-dev');
		expect(getDataDir('/tmp/home', env)).toBe('/tmp/home/.miko-dev/data');
		expect(getDataDirDisplay(env)).toBe('~/.miko-dev/data');
		expect(getKeybindingsFilePath('/tmp/home', env)).toBe('/tmp/home/.miko-dev/keybindings.json');
		expect(getKeybindingsFilePathDisplay(env)).toBe('~/.miko-dev/keybindings.json');
	});
});
