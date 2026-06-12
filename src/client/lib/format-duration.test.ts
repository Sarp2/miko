import { describe, expect, test } from 'bun:test';
import { formatElapsed } from './format-duration';

describe('formatElapsed', () => {
	test('shows one decimal of seconds under a minute', () => {
		expect(formatElapsed(8400)).toBe('8.4s');
		expect(formatElapsed(0)).toBe('0.0s');
	});

	test('shows minutes and seconds at or above a minute', () => {
		expect(formatElapsed(65_000)).toBe('1m, 5.0s');
		expect(formatElapsed(600_000)).toBe('10m, 0.0s');
	});

	test('clamps negative durations to zero', () => {
		expect(formatElapsed(-500)).toBe('0.0s');
	});
});
