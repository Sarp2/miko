import { describe, expect, test } from 'bun:test';
import type { WorkspaceFileSearchResult } from '../../shared/types';
import { buildWorkspaceFileTree } from './workspace-file-tree';

function file(relativePath: string): WorkspaceFileSearchResult {
	return {
		id: relativePath,
		name: relativePath.split('/').at(-1) ?? relativePath,
		relativePath,
	};
}

describe('buildWorkspaceFileTree', () => {
	test('groups files into sorted folders before files', () => {
		expect(
			buildWorkspaceFileTree([
				file('src/client/app.tsx'),
				file('README.md'),
				file('src/server/index.ts'),
				file('package.json'),
			]),
		).toEqual([
			{
				type: 'folder',
				id: 'folder:src',
				name: 'src',
				path: 'src',
				children: [
					{
						type: 'folder',
						id: 'folder:src/client',
						name: 'client',
						path: 'src/client',
						children: [
							{
								type: 'file',
								id: 'file:src/client/app.tsx',
								name: 'app.tsx',
								path: 'src/client/app.tsx',
							},
						],
					},
					{
						type: 'folder',
						id: 'folder:src/server',
						name: 'server',
						path: 'src/server',
						children: [
							{
								type: 'file',
								id: 'file:src/server/index.ts',
								name: 'index.ts',
								path: 'src/server/index.ts',
							},
						],
					},
				],
			},
			{ type: 'file', id: 'file:package.json', name: 'package.json', path: 'package.json' },
			{ type: 'file', id: 'file:README.md', name: 'README.md', path: 'README.md' },
		]);
	});

	test('normalizes slashes and ignores invalid empty paths', () => {
		expect(buildWorkspaceFileTree([file('src\\app.ts'), file(''), file('/README.md')])).toEqual([
			{
				type: 'folder',
				id: 'folder:src',
				name: 'src',
				path: 'src',
				children: [{ type: 'file', id: 'file:src/app.ts', name: 'app.ts', path: 'src/app.ts' }],
			},
			{ type: 'file', id: 'file:README.md', name: 'README.md', path: 'README.md' },
		]);
	});
});
