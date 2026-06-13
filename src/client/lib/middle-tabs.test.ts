import { describe, expect, test } from 'bun:test';
import type { MiddleTabDescriptor } from '../stores/ui-store';
import { middleTabTitle, workspacePagePath } from './middle-tabs';

function tab(overrides: Partial<MiddleTabDescriptor>): MiddleTabDescriptor {
	return {
		id: 'tab-1',
		page: { type: 'diff' },
		closable: true,
		updatedAt: 1,
		...overrides,
	};
}

describe('middleTabTitle', () => {
	test('uses backend chat title with empty fallback', () => {
		expect(
			middleTabTitle(tab({ page: { type: 'chat', sessionId: 's1' } }), [
				{ id: 's1', title: 'Build tabs' },
			]),
		).toBe('Build tabs');
		expect(
			middleTabTitle(tab({ page: { type: 'chat', sessionId: 's1' } }), [
				{ id: 's1', title: '   ' },
			]),
		).toBe('Untitled');
	});

	test('uses stable titles for diff and files', () => {
		expect(
			middleTabTitle(
				tab({ fallbackTitle: 'foo.ts', page: { type: 'diff', path: 'src/server/foo.ts' } }),
			),
		).toBe('foo.ts');
		expect(
			middleTabTitle(
				tab({
					fallbackTitle: 'foo.ts',
					page: {
						type: 'file',
						path: 'src/server/foo.ts',
						title: 'Foo',
						source: 'workspace_file',
					},
				}),
			),
		).toBe('foo.ts');
	});
});

describe('workspacePagePath', () => {
	test('builds workspace route paths for every middle page kind', () => {
		expect(workspacePagePath('ws 1', { type: 'chat', sessionId: 's 1' })).toBe(
			'/workspaces/ws%201/sessions/s%201',
		);
		expect(workspacePagePath('ws1', { type: 'diff' })).toBe('/workspaces/ws1/diff');
		expect(workspacePagePath('ws1', { type: 'diff', path: 'src/a.ts' })).toBe(
			'/workspaces/ws1/diff?path=src%2Fa.ts',
		);
		expect(
			workspacePagePath('ws1', {
				type: 'diff',
				path: 'src/a.ts',
				sourceSessionId: 'session-1',
			}),
		).toBe('/workspaces/ws1/diff?path=src%2Fa.ts&sessionId=session-1');
		expect(
			workspacePagePath('ws1', {
				type: 'file',
				source: 'pr_comment',
				sourceId: 'c1',
				title: 'Comment by CodeRabbit',
			}),
		).toBe('/workspaces/ws1/file?source=pr_comment&sourceId=c1&title=Comment+by+CodeRabbit');
	});
});
