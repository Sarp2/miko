import { describe, expect, test } from 'bun:test';
import {
	deriveWorkspaceRoutePage,
	selectFirstSessionId,
	selectSessionRouteTarget,
} from './workspace-route-state';

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

describe('selectSessionRouteTarget', () => {
	test('keeps an existing requested session', () => {
		expect(
			selectSessionRouteTarget(
				[
					{ id: 'first', createdAt: 10 },
					{ id: 'second', createdAt: 20 },
				],
				'second',
			),
		).toBe('second');
	});

	test('falls back to the first-created session when the requested session is missing', () => {
		expect(
			selectSessionRouteTarget(
				[
					{ id: 'second', createdAt: 20 },
					{ id: 'first', createdAt: 10 },
				],
				'missing',
			),
		).toBe('first');
	});

	test('returns null when no fallback session exists', () => {
		expect(selectSessionRouteTarget([], 'missing')).toBeNull();
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
