import { afterEach, describe, expect, test } from 'bun:test';
import type {
	AgentProvider,
	ChatAttachment,
	ProviderCatalogEntry,
	SessionSnapshot,
	WorkspaceDiffFile,
} from '../../../shared/types';
import {
	activeMentionRange,
	defaultProviderForRuntime,
	mentionOptionsFromGitFiles,
	modelForProvider,
	modelOptionsForSubmit,
	preferredClaudeContextWindowForComposer,
	preferredModelByProviderForComposer,
	preferredPlanModeForComposer,
	preferredProviderForComposer,
	providerCatalogs,
	runtimePlanModeForComposer,
	uploadAttachments,
} from './chat-composer-utils';

const originalFetch = globalThis.fetch;

const emptyPreferences = {
	provider: null,
	selectedModelByProvider: {},
	claudeReasoningEffort: null,
	claudeContextWindow: null,
	codexReasoningEffort: null,
	codexFastMode: null,
	planMode: null,
};

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function provider(
	id: AgentProvider,
	models: ProviderCatalogEntry['models'] = [
		{ id: `${id}-default`, label: 'Default', supportsEffort: true },
	],
): ProviderCatalogEntry {
	return {
		id,
		label: id,
		defaultModel: models[0]?.id ?? 'missing',
		supportsPlanMode: true,
		models,
		efforts: [],
	};
}

function diffFile(path: string): WorkspaceDiffFile {
	return {
		path,
		changeType: 'modified',
		isUntracked: false,
		additions: 1,
		deletions: 0,
		patchDigest: path,
	};
}

describe('activeMentionRange', () => {
	test('finds the active mention token at the cursor', () => {
		expect(activeMentionRange('please inspect @src/client/app.ts', 30)).toEqual({
			start: 15,
			end: 30,
			query: 'src/client/app',
		});
		expect(activeMentionRange('@', 1)).toEqual({ start: 0, end: 1, query: '' });
	});

	test('ignores email addresses, embedded mentions, and completed tokens', () => {
		expect(activeMentionRange('mail sarp@example.com', 21)).toBeNull();
		expect(activeMentionRange('prefix@src/app.ts', 17)).toBeNull();
		expect(activeMentionRange('@src @nested@bad', 16)).toBeNull();
		expect(activeMentionRange('@src/app.ts ', 12)).toBeNull();
	});
});

describe('provider and model helpers', () => {
	test('uses session provider catalogs only when the session supplies any', () => {
		const customProviders = [provider('codex')];

		expect(providerCatalogs({ availableProviders: customProviders } as SessionSnapshot)).toBe(
			customProviders,
		);
		expect(providerCatalogs({ availableProviders: [] } as unknown as SessionSnapshot)).not.toBe(
			customProviders,
		);
		expect(providerCatalogs(null).length).toBeGreaterThan(0);
	});

	test('keeps valid runtime providers and otherwise falls back predictably', () => {
		const providers = [provider('codex'), provider('claude')];

		expect(defaultProviderForRuntime('claude', providers)).toBe('claude');
		expect(defaultProviderForRuntime('claude', [provider('codex')])).toBe('codex');
		expect(defaultProviderForRuntime(null, [])).toBe('claude');
	});

	test('resolves selected models and falls back to provider default before first model', () => {
		const catalog = provider('claude', [
			{ id: 'sonnet', label: 'Sonnet', supportsEffort: true },
			{ id: 'opus', label: 'Opus', supportsEffort: true },
		]);

		expect(modelForProvider(catalog, { claude: 'opus' })?.id).toBe('opus');
		expect(modelForProvider({ ...catalog, defaultModel: 'opus' }, { claude: 'missing' })?.id).toBe(
			'opus',
		);
		expect(modelForProvider(provider('claude', []), {})).toBeNull();
	});
	test('resolves composer provider preferences against the available catalog', () => {
		const providers = [provider('claude'), provider('codex')];

		expect(
			preferredProviderForComposer({
				preferences: { ...emptyPreferences, provider: 'codex' },
				providers,
			}),
		).toBe('codex');
		expect(
			preferredProviderForComposer({
				preferences: { ...emptyPreferences, provider: 'codex' },
				providers: [provider('claude')],
			}),
		).toBe('claude');
		expect(
			preferredProviderForComposer({
				preferences: { ...emptyPreferences, provider: 'codex' },
				providers,
				runtimeProvider: 'claude',
			}),
		).toBe('claude');
	});

	test('resolves composer model preferences against provider catalogs', () => {
		const providers = [
			provider('claude', [
				{ id: 'sonnet', label: 'Sonnet', supportsEffort: true },
				{ id: 'opus', label: 'Opus', supportsEffort: true },
			]),
			provider('codex', [
				{ id: 'gpt-5.5', label: 'GPT-5.5', supportsEffort: false },
				{ id: 'gpt-5.4', label: 'GPT-5.4', supportsEffort: false },
			]),
		];

		expect(
			preferredModelByProviderForComposer({
				preferences: {
					...emptyPreferences,
					selectedModelByProvider: { claude: 'opus', codex: 'missing' },
				},
				providers,
			}),
		).toEqual({ claude: 'opus', codex: 'gpt-5.5' });
	});

	test('uses Claude 1m context only when the selected model supports it', () => {
		const supportsOneMillion = {
			id: 'opus',
			label: 'Opus',
			supportsEffort: true,
			contextWindowOptions: [
				{ id: '200k', label: '200k' },
				{ id: '1m', label: '1M' },
			],
		} as const;
		const standardContext = { id: 'haiku', label: 'Haiku', supportsEffort: true } as const;

		expect(
			preferredClaudeContextWindowForComposer({
				model: supportsOneMillion,
				preferences: { ...emptyPreferences, claudeContextWindow: '1m' },
			}),
		).toBe('1m');
		expect(
			preferredClaudeContextWindowForComposer({
				model: standardContext,
				preferences: { ...emptyPreferences, claudeContextWindow: '1m' },
			}),
		).toBe('200k');
	});

	test('uses backend runtime plan mode only after a provider is established', () => {
		const unlockedSession = {
			runtime: { provider: null, planMode: false },
		} as SessionSnapshot;
		const lockedSession = {
			runtime: { provider: 'claude', planMode: false },
		} as SessionSnapshot;

		expect(runtimePlanModeForComposer(unlockedSession)).toBeNull();
		expect(runtimePlanModeForComposer(lockedSession)).toBe(false);
		expect(
			preferredPlanModeForComposer({
				preferences: { ...emptyPreferences, planMode: true },
				runtimePlanMode: runtimePlanModeForComposer(lockedSession),
			}),
		).toBe(false);
		expect(
			preferredPlanModeForComposer({
				preferences: { ...emptyPreferences, planMode: true },
				runtimePlanMode: runtimePlanModeForComposer(unlockedSession),
			}),
		).toBe(true);
	});
});

describe('mentionOptionsFromGitFiles', () => {
	test('uses the relative path as a stable id and basename as display name', () => {
		expect(
			mentionOptionsFromGitFiles([
				diffFile('src/client/app.tsx'),
				diffFile('README.md'),
				diffFile('docs/'),
			]),
		).toEqual([
			{ id: 'src/client/app.tsx', name: 'app.tsx', relativePath: 'src/client/app.tsx' },
			{ id: 'README.md', name: 'README.md', relativePath: 'README.md' },
			{ id: 'docs/', name: 'docs', relativePath: 'docs/' },
		]);
	});
});

describe('modelOptionsForSubmit', () => {
	test('returns only the selected provider options', () => {
		expect(
			modelOptionsForSubmit({
				provider: 'claude',
				claudeReasoningEffort: 'max',
				claudeContextWindow: '1m',
				codexReasoningEffort: 'xhigh',
				codexFastMode: true,
			}),
		).toEqual({ claude: { reasoningEffort: 'max', contextWindow: '1m' } });

		expect(
			modelOptionsForSubmit({
				provider: 'codex',
				claudeReasoningEffort: 'max',
				claudeContextWindow: '1m',
				codexReasoningEffort: 'low',
				codexFastMode: true,
			}),
		).toEqual({ codex: { reasoningEffort: 'low', fastMode: true } });
	});
});

describe('uploadAttachments', () => {
	test('skips the network when there are no attachments', async () => {
		globalThis.fetch = (() => {
			throw new Error('fetch should not be called');
		}) as unknown as typeof fetch;

		await expect(uploadAttachments('workspace 1', [])).resolves.toEqual([]);
	});

	test('posts files to the workspace upload endpoint and returns attachments', async () => {
		const uploaded: ChatAttachment[] = [
			{
				id: 'attachment-1',
				kind: 'file',
				displayName: 'notes.txt',
				absolutePath: '/tmp/notes.txt',
				relativePath: 'notes.txt',
				contentUrl: '/uploads/notes.txt',
				mimeType: 'text/plain',
				size: 5,
			},
		];
		const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
		globalThis.fetch = (async (
			url: Parameters<typeof fetch>[0],
			init: Parameters<typeof fetch>[1],
		) => {
			calls.push({ url: String(url), init });
			return Response.json({ attachments: uploaded });
		}) as unknown as typeof fetch;

		const result = await uploadAttachments('workspace 1', [
			{ id: 'local-1', file: new File(['hello'], 'notes.txt'), kind: 'file' },
		]);

		expect(result).toEqual(uploaded);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe('/api/workspaces/workspace%201/uploads');
		expect(calls[0]?.init?.method).toBe('POST');
		expect(calls[0]?.init?.body).toBeInstanceOf(FormData);
		expect((calls[0]?.init?.body as FormData).getAll('files')).toHaveLength(1);
	});

	test('throws the server error message when upload fails', async () => {
		globalThis.fetch = (async () =>
			Response.json({ error: 'Too large' }, { status: 413 })) as unknown as typeof fetch;

		await expect(
			uploadAttachments('workspace-1', [
				{ id: 'local-1', file: new File(['x'], 'large.bin'), kind: 'file' },
			]),
		).rejects.toThrow('Too large');
	});
});
