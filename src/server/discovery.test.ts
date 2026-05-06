import { afterEach, describe, expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	ClaudeProjectDiscoveryAdapter,
	CodexProjectDiscoveryAdapter,
	collectCodexSessionFiles,
	mergeDiscoveredProjects,
	normalizeExistingDirectory,
	readCodexConfiguredProjects,
	readCodexSessionIndex,
	readCodexSessionMetadata,
	resolveEncodedClaudePath,
} from './discovery';

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
	const dir = await mkdtemp(path.join(tmpdir(), 'miko-discovery-'));
	tempDirs.push(dir);
	return dir;
}

describe('resolveEncodedClaudePath', () => {
	test('returns "/" for empty folder name', () => {
		expect(resolveEncodedClaudePath('')).toBe('/');
	});

	test('decodes dashes back to slashes when no real dir matches', async () => {
		const root = await createTempDir();
		const encoded = `${root.replace(/\//g, '-')}-foo-bar`;

		expect(resolveEncodedClaudePath(encoded)).toBe(`${root}/foo/bar`);
	});

	test('greedily matches longest existing dir name with dashes', async () => {
		const root = await createTempDir();
		await mkdir(path.join(root, 'my-app'));
		const encoded = `${root.replace(/\//g, '-')}-my-app`;

		expect(resolveEncodedClaudePath(encoded)).toBe(`${root}/my-app`);
	});
});

describe('normalizeExistingDirectory', () => {
	test('returns the resolved path for an existing directory', async () => {
		const root = await createTempDir();

		expect(normalizeExistingDirectory(root)).toBe(root);
	});

	test('returns null when path points to a file, not a directory', async () => {
		const root = await createTempDir();
		const filePath = path.join(root, 'note.txt');
		await writeFile(filePath, 'hi');

		expect(normalizeExistingDirectory(filePath)).toBeNull();
	});
});

describe('mergeDiscoveredProjects', () => {
	test('dedupes by localPath keeping newest modifiedAt and sorts desc', () => {
		const result = mergeDiscoveredProjects([
			{ localPath: '/a/foo', title: 'foo', modifiedAt: 100 },
			{ localPath: '/a/foo', title: 'foo', modifiedAt: 300 },
			{ localPath: '/a/bar', title: 'bar', modifiedAt: 200 },
		]);

		expect(result).toEqual([
			{ localPath: '/a/foo', title: 'foo', modifiedAt: 300 },
			{ localPath: '/a/bar', title: 'bar', modifiedAt: 200 },
		]);
	});

	test('falls back to basename when title is empty', () => {
		const result = mergeDiscoveredProjects([{ localPath: '/a/foo', title: '', modifiedAt: 100 }]);

		expect(result[0]?.title).toBe('foo');
	});
});

describe('ClaudeProjectDiscoveryAdapter.scan', () => {
	test('returns empty when ~/.claude/projects does not exist', async () => {
		const home = await createTempDir();

		expect(new ClaudeProjectDiscoveryAdapter().scan(home)).toEqual([]);
	});

	test('discovers a project from an encoded folder', async () => {
		const home = await createTempDir();
		const projectRoot = await createTempDir();

		const projectsDir = path.join(home, '.claude', 'projects');
		await mkdir(projectsDir, { recursive: true });

		const encoded = projectRoot.replace(/\//g, '-');
		await mkdir(path.join(projectsDir, encoded));

		const result = new ClaudeProjectDiscoveryAdapter().scan(home);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			provider: 'claude',
			localPath: projectRoot,
			title: path.basename(projectRoot),
		});
	});

	test('skips entries whose decoded path no longer exists', async () => {
		const home = await createTempDir();
		const projectsDir = path.join(home, '.claude', 'projects');
		await mkdir(projectsDir, { recursive: true });
		await mkdir(path.join(projectsDir, '-nonexistent-ghost-dir'));

		expect(new ClaudeProjectDiscoveryAdapter().scan(home)).toEqual([]);
	});
});

describe('readCodexSessionIndex', () => {
	test('returns empty map when index file does not exist', async () => {
		const root = await createTempDir();

		expect(readCodexSessionIndex(path.join(root, 'missing.jsonl')).size).toBe(0);
	});

	test('parses valid records, keeps newest per id, skips invalid lines', async () => {
		const root = await createTempDir();
		const indexPath = path.join(root, 'session_index.jsonl');
		const lines = [
			JSON.stringify({ id: 'a', updated_at: '2026-01-01T00:00:00Z' }),
			JSON.stringify({ id: 'a', updated_at: '2026-02-01T00:00:00Z' }),
			JSON.stringify({ id: 'b', updated_at: '2026-01-15T00:00:00Z' }),
			'not-json',
			JSON.stringify({ id: 'c', updated_at: 'bogus-date' }),
			JSON.stringify({ updated_at: '2026-01-01T00:00:00Z' }),
			'',
		];

		await writeFile(indexPath, lines.join('\n'));
		const result = readCodexSessionIndex(indexPath);

		expect(result.size).toBe(2);
		expect(result.get('a')).toBe(Date.parse('2026-02-01T00:00:00Z'));
		expect(result.get('b')).toBe(Date.parse('2026-01-15T00:00:00Z'));
	});
});

describe('collectCodexSessionFiles', () => {
	test('returns empty when directory does not exist', async () => {
		const root = await createTempDir();

		expect(collectCodexSessionFiles(path.join(root, 'missing'))).toEqual([]);
	});

	test('walks subdirectories and only includes .jsonl files', async () => {
		const root = await createTempDir();
		await mkdir(path.join(root, '2026', '01'), { recursive: true });

		const a = path.join(root, 'a.jsonl');
		const b = path.join(root, '2026', '01', 'b.jsonl');
		const noise = path.join(root, '2026', 'notes.txt');

		await writeFile(a, '');
		await writeFile(b, '');
		await writeFile(noise, '');

		const result = collectCodexSessionFiles(root).sort();
		expect(result).toEqual([a, b].sort());
	});
});

describe('readCodexConfiguredProjects', () => {
	test('returns empty map when config file does not exist', async () => {
		const root = await createTempDir();
		expect(readCodexConfiguredProjects(path.join(root, 'missing.toml')).size).toBe(0);
	});

	test('parses [projects."..."] headers and tags each with config mtime', async () => {
		const root = await createTempDir();
		const configPath = path.join(root, 'config.toml');
		const toml = [
			'model = "gpt-5"',
			'[projects."/Users/sarp/foo"]',
			'trust_level = "trusted"',
			'[projects."/Users/sarp/bar"]',
			'[other.section]',
		].join('\n');

		await writeFile(configPath, toml);
		const mtime = statSync(configPath).mtimeMs;

		const result = readCodexConfiguredProjects(configPath);

		expect(result.size).toBe(2);
		expect(result.get('/Users/sarp/foo')).toBe(mtime);
		expect(result.get('/Users/sarp/bar')).toBe(mtime);
	});
});

describe('readCodexSessionMetadata', () => {
	test('returns empty map when sessions dir does not exist', async () => {
		const root = await createTempDir();

		expect(readCodexSessionMetadata(path.join(root, 'missing')).size).toBe(0);
	});

	test('reads session_meta first line and prefers record timestamp', async () => {
		const root = await createTempDir();
		const valid = path.join(root, 'valid.jsonl');
		const noCwd = path.join(root, 'no-cwd.jsonl');
		const wrongType = path.join(root, 'wrong-type.jsonl');
		const ts = '2026-03-01T00:00:00Z';

		await writeFile(
			valid,
			`${JSON.stringify({
				type: 'session_meta',
				timestamp: ts,
				payload: { id: 's1', cwd: '/Users/sarp/foo', timestamp: '2026-01-01T00:00:00Z' },
			})}\n`,
		);

		await writeFile(noCwd, `${JSON.stringify({ type: 'session_meta', payload: { id: 's2' } })}\n`);

		await writeFile(wrongType, `${JSON.stringify({ type: 'event', payload: {} })}\n`);
		const result = readCodexSessionMetadata(root);

		expect(result.size).toBe(1);
		expect(result.get('s1')).toEqual({ cwd: '/Users/sarp/foo', modifiedAt: Date.parse(ts) });
	});
});

describe('CodexProjectDiscoveryAdapter.scan', () => {
	test('returns empty when ~/.codex has no sessions or config', async () => {
		const home = await createTempDir();

		expect(new CodexProjectDiscoveryAdapter().scan(home)).toEqual([]);
	});

	test('discovers project from a session_meta cwd', async () => {
		const home = await createTempDir();
		const projectRoot = await createTempDir();
		const sessionsDir = path.join(home, '.codex', 'sessions');

		await mkdir(sessionsDir, { recursive: true });
		await writeFile(
			path.join(sessionsDir, 'session.jsonl'),
			`${JSON.stringify({
				type: 'session_meta',
				timestamp: '2026-03-01T00:00:00Z',
				payload: { id: 's1', cwd: projectRoot },
			})}\n`,
		);

		const result = new CodexProjectDiscoveryAdapter().scan(home);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			provider: 'codex',
			localPath: projectRoot,
			title: path.basename(projectRoot),
			modifiedAt: Date.parse('2026-03-01T00:00:00Z'),
		});
	});

	test('discovers project from a config.toml pinned path and skips missing paths', async () => {
		const home = await createTempDir();
		const projectRoot = await createTempDir();
		const codexDir = path.join(home, '.codex');

		await mkdir(codexDir, { recursive: true });
		await writeFile(
			path.join(codexDir, 'config.toml'),
			[`[projects."${projectRoot}"]`, '[projects."/nope/does/not/exist"]'].join('\n'),
		);

		const result = new CodexProjectDiscoveryAdapter().scan(home);

		expect(result).toHaveLength(1);
		expect(result[0]?.localPath).toBe(projectRoot);
	});
});
