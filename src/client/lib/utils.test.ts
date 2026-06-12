import { describe, expect, test } from 'bun:test';
import { cn } from './utils';

describe('cn', () => {
	test('combines conditional class values', () => {
		expect(cn('inline-flex', false && 'hidden', ['items-center'], { 'font-medium': true })).toBe(
			'inline-flex items-center font-medium',
		);
	});

	test('lets later tailwind utilities win for conflicting classes', () => {
		expect(cn('px-2 py-1', 'px-4', 'text-sm text-lg')).toBe('py-1 px-4 text-lg');
	});
});
