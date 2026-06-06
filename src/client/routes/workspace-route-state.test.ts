import { describe, expect, test } from 'bun:test';
import { deriveWorkspaceRoutePage, selectFirstSessionId } from './workspace-route-state';

describe('selectFirstSessionId', () => {
	test('returns the first-created remaining session', () => {
		expect(
			selectFirstSessionId([
				{ id: 'second', createdAt: 20 },
				{ id: 'first', createdAt: 10 },
			]),
		).toBe('first');
	});

	test('returns null when there are no sessions', () => {
		expect(selectFirstSessionId([])).toBeNull();
	});
});

describe('deriveWorkspaceRoutePage', () => {
	test('keeps the base workspace route as redirect/fallback only', () => {
		expect(
			deriveWorkspaceRoutePage({
				kind: 'workspace',
			}),
		).toBeNull();
	});

	test('derives explicit session routes as chat pages', () => {
		expect(deriveWorkspaceRoutePage({ kind: 'session', sessionId: 'session-1' })).toEqual({
			type: 'chat',
			sessionId: 'session-1',
		});
	});
});
