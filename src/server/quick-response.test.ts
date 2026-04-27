import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import {
	getQuickResponseWorkspace,
	parseJsonText,
	QuickResponseAdapter,
	type StructuredQuickResponseArgs,
	structuredOutputFromSdkMessage,
} from 'src/server/quick-response';

const TITLE_SCHEMA = {
	type: 'object' as const,
	properties: { title: { type: 'string' } },
	required: ['title'],
	additionalProperties: false,
};

function titleArgs(
	overrides: Partial<StructuredQuickResponseArgs<string>> = {},
): StructuredQuickResponseArgs<string> {
	return {
		cwd: '/tmp/project',
		task: 'title',
		prompt: 'pick a title',
		schema: TITLE_SCHEMA,
		parse: (value) => {
			const output = value && typeof value === 'object' ? (value as { title?: unknown }) : {};
			return typeof output.title === 'string' ? output.title : null;
		},
		...overrides,
	};
}

describe('getQuickResponseWorkspace', () => {
	test('returns the prod data root when the runtime profile is unset', () => {
		expect(getQuickResponseWorkspace({})).toBe(`${homedir()}/.miko`);
	});

	test('returns the dev data root when the runtime profile is dev', () => {
		expect(getQuickResponseWorkspace({ MIKO_RUNTIME_PROFILE: 'dev' })).toBe(
			`${homedir()}/.miko-dev`,
		);
	});

	test('treats unknown profile values as prod', () => {
		expect(getQuickResponseWorkspace({ MIKO_RUNTIME_PROFILE: 'staging' })).toBe(
			`${homedir()}/.miko`,
		);
	});

	test('reads from process.env when called without arguments', () => {
		const previous = process.env.MIKO_RUNTIME_PROFILE;
		process.env.MIKO_RUNTIME_PROFILE = 'dev';
		try {
			expect(getQuickResponseWorkspace()).toBe(`${homedir()}/.miko-dev`);
		} finally {
			if (previous === undefined) {
				delete process.env.MIKO_RUNTIME_PROFILE;
			} else {
				process.env.MIKO_RUNTIME_PROFILE = previous;
			}
		}
	});
});

describe('parseJsonText', () => {
	test('parses a plain JSON object', () => {
		expect(parseJsonText('{"title":"hello"}')).toEqual({ title: 'hello' });
	});

	test('extracts JSON from a fenced code block surrounded by prose', () => {
		const input = 'preamble {"wrong":1} ```json\n{"right":2}\n```';
		expect(parseJsonText(input)).toEqual({ right: 2 });
	});

	test('returns null when input is not valid JSON', () => {
		expect(parseJsonText('not json at all')).toBeNull();
	});

	test('returns null for empty input', () => {
		expect(parseJsonText('   ')).toBeNull();
	});
});

describe('structuredOutputFromSdkMessage', () => {
	test('returns structured_output from a result message', () => {
		const message = {
			type: 'result',
			structured_output: { title: 'final' },
		};
		expect(structuredOutputFromSdkMessage(message)).toEqual({ title: 'final' });
	});

	test('returns input from a StructuredOutput tool_use in an assistant message', () => {
		const message = {
			type: 'assistant',
			message: {
				role: 'assistant',
				content: [
					{ type: 'text', text: 'thinking...' },
					{ type: 'tool_use', name: 'StructuredOutput', input: { title: 'tool' } },
				],
			},
		};
		expect(structuredOutputFromSdkMessage(message)).toEqual({ title: 'tool' });
	});

	test('returns null for tool_use blocks with a different name', () => {
		const message = {
			type: 'assistant',
			message: {
				content: [{ type: 'tool_use', name: 'SomethingElse', input: { title: 'nope' } }],
			},
		};
		expect(structuredOutputFromSdkMessage(message)).toBeNull();
	});
});

describe('QuickResponseAdapter.generateStructuredWithDiagnostics', () => {
	test('returns the Claude result and skips Codex when Claude succeeds', async () => {
		let codexCalls = 0;
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => ({ title: 'from claude' }),
			runCodexStructured: async () => {
				codexCalls += 1;
				return { title: 'from codex' };
			},
		});

		const result = await adapter.generateStructuredWithDiagnostics(titleArgs());

		expect(result.value).toBe('from claude');
		expect(result.failures).toEqual([]);
		expect(codexCalls).toBe(0);
	});

	test('falls back to Codex and records the Claude failure when Claude fails', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => null,
			runCodexStructured: async () => ({ title: 'from codex' }),
		});

		const result = await adapter.generateStructuredWithDiagnostics(titleArgs());

		expect(result.value).toBe('from codex');
		expect(result.failures).toEqual([
			{ provider: 'claude', reason: 'claude returned no result for title' },
		]);
	});

	test('returns null with both failures when both providers fail', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => {
				throw new Error('boom');
			},
			runCodexStructured: async () => null,
		});

		const result = await adapter.generateStructuredWithDiagnostics(titleArgs());

		expect(result.value).toBeNull();
		expect(result.failures).toEqual([
			{ provider: 'claude', reason: 'claude failed title: boom' },
			{ provider: 'codex', reason: 'codex returned no result for title' },
		]);
	});
});

describe('QuickResponseAdapter.generateStructured', () => {
	test('returns just the parsed value, dropping diagnostics', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => ({ title: 'plain' }),
			runCodexStructured: async () => null,
		});

		expect(await adapter.generateStructured(titleArgs())).toBe('plain');
	});

	test('returns null when both providers fail', async () => {
		const adapter = new QuickResponseAdapter({
			runClaudeStructured: async () => null,
			runCodexStructured: async () => null,
		});

		expect(await adapter.generateStructured(titleArgs())).toBeNull();
	});
});
