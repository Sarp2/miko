import { describe, expect, test } from 'bun:test';
import { isClientEnvelope } from './protocol';

describe('isClientEnvelope', () => {
	test('accepts subscribe, unsubscribe, and command envelopes with required shape', () => {
		expect(isClientEnvelope({ type: 'subscribe', id: 'sub-1', topic: { type: 'sidebar' } })).toBe(
			true,
		);
		expect(isClientEnvelope({ type: 'unsubscribe', id: 'sub-1' })).toBe(true);
		expect(
			isClientEnvelope({
				type: 'command',
				id: 'cmd-1',
				command: { type: 'session.cancel', sessionId: 'session-1' },
			}),
		).toBe(true);
	});

	test('rejects unknown or incomplete envelope objects', () => {
		expect(isClientEnvelope({ type: 'foo', id: 'bad-1' })).toBe(false);
		expect(isClientEnvelope({ type: 'subscribe', id: 'sub-1' })).toBe(false);
		expect(isClientEnvelope({ type: 'command', id: 'cmd-1' })).toBe(false);
		expect(isClientEnvelope({ type: 'unsubscribe' })).toBe(false);
		expect(isClientEnvelope(null)).toBe(false);
	});

	test('validates continue-on-new-branch command payload', () => {
		expect(
			isClientEnvelope({
				type: 'command',
				id: 'cmd-continue',
				command: { type: 'workspace.continueOnNewBranch', workspaceId: 'workspace-1' },
			}),
		).toBe(true);
		expect(
			isClientEnvelope({
				type: 'command',
				id: 'cmd-continue',
				command: { type: 'workspace.continueOnNewBranch' },
			}),
		).toBe(false);
	});
});
