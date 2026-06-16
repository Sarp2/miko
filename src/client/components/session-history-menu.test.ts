import { describe, expect, test } from 'bun:test';
import type { SessionSummary } from '../../shared/types';
import { sortSessionsByRecency } from './session-history-menu';

function session(id: string, updatedAt: number, lastMessageAt?: number): SessionSummary {
	return {
		id,
		workspaceId: 'w1',
		title: id,
		createdAt: 0,
		updatedAt,
		provider: null,
		planMode: false,
		sessionToken: null,
		lastMessageAt,
		lastTurnOutcome: null,
	};
}

describe('sortSessionsByRecency', () => {
	test('orders by lastMessageAt, falling back to updatedAt, without mutating input', () => {
		const input = [session('a', 100), session('b', 50, 300), session('c', 200)];
		const ordered = sortSessionsByRecency(input);

		expect(ordered.map((s) => s.id)).toEqual(['b', 'c', 'a']);
		expect(input.map((s) => s.id)).toEqual(['a', 'b', 'c']);
	});
});
