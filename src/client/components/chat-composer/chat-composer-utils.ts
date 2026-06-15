import {
	type AgentProvider,
	type ChatAttachment,
	type ClaudeContextWindow,
	type ClaudeReasoningEffort,
	type CodexReasoningEffort,
	DEFAULT_CLAUDE_MODEL_OPTIONS,
	DEFAULT_CODEX_MODEL_OPTIONS,
	type ModelOptions,
	PROVIDERS,
	type ProviderCatalogEntry,
	type ProviderModelOption,
	type SessionSnapshot,
	type WorkspaceDiffFile,
} from '../../../shared/types';
import { basename } from '../../lib/relative-path';
import type { ComposerPreferencesSnapshot } from '../../stores/composer-preferences-store';
import type { LocalAttachment, UploadResponse } from './chat-composer-types';
import type { FileMentionOption } from './file-mention-popover';

export type MentionRange = { start: number; end: number; query: string };

export function activeMentionRange(value: string, cursor: number): MentionRange | null {
	const beforeCursor = value.slice(0, cursor);
	const boundary = beforeCursor.search(/\S+$/);
	if (boundary === -1) return null;

	const tokenStart = boundary;
	const token = beforeCursor.slice(tokenStart);
	if (!token.startsWith('@')) return null;
	if (token.length > 1 && token.includes('@', 1)) return null;

	const charBefore = value[tokenStart - 1];
	if (charBefore && !/\s/.test(charBefore)) return null;

	return { start: tokenStart, end: cursor, query: token.slice(1) };
}

export function providerCatalogs(sessionSnapshot: SessionSnapshot | null) {
	return sessionSnapshot?.availableProviders.length
		? sessionSnapshot.availableProviders
		: PROVIDERS;
}

export function defaultProviderForRuntime(
	runtimeProvider: AgentProvider | null | undefined,
	providers: ProviderCatalogEntry[],
) {
	if (runtimeProvider && providers.some((provider) => provider.id === runtimeProvider)) {
		return runtimeProvider;
	}
	return providers[0]?.id ?? 'claude';
}

export function modelForProvider(
	provider: ProviderCatalogEntry,
	selectedModelByProvider: Record<string, string | undefined>,
): ProviderModelOption | null {
	const selected = selectedModelByProvider[provider.id];
	return (
		provider.models.find((model) => model.id === selected) ??
		provider.models.find((model) => model.id === provider.defaultModel) ??
		provider.models[0] ??
		null
	);
}

export function preferredProviderForComposer(args: {
	preferences: ComposerPreferencesSnapshot;
	providers: ProviderCatalogEntry[];
	runtimeProvider?: AgentProvider | null;
}) {
	if (args.runtimeProvider && args.providers.some((entry) => entry.id === args.runtimeProvider)) {
		return args.runtimeProvider;
	}
	if (
		args.preferences.provider &&
		args.providers.some((entry) => entry.id === args.preferences.provider)
	) {
		return args.preferences.provider;
	}
	return defaultProviderForRuntime(null, args.providers);
}

export function preferredModelByProviderForComposer(args: {
	preferences: ComposerPreferencesSnapshot;
	providers: ProviderCatalogEntry[];
}) {
	return Object.fromEntries(
		args.providers.map((provider) => {
			const model = modelForProvider(provider, args.preferences.selectedModelByProvider);
			return [provider.id, model?.id ?? provider.defaultModel];
		}),
	) as Record<AgentProvider, string>;
}

export function preferredClaudeReasoningEffortForComposer(
	preferences: ComposerPreferencesSnapshot,
) {
	return preferences.claudeReasoningEffort ?? DEFAULT_COMPOSER_MODEL_OPTIONS.claudeReasoningEffort;
}

export function preferredCodexReasoningEffortForComposer(preferences: ComposerPreferencesSnapshot) {
	return preferences.codexReasoningEffort ?? DEFAULT_COMPOSER_MODEL_OPTIONS.codexReasoningEffort;
}

export function preferredCodexFastModeForComposer(preferences: ComposerPreferencesSnapshot) {
	return preferences.codexFastMode ?? DEFAULT_COMPOSER_MODEL_OPTIONS.codexFastMode;
}

export function runtimePlanModeForComposer(sessionSnapshot: SessionSnapshot | null) {
	if (!sessionSnapshot?.runtime.provider) return null;
	return sessionSnapshot.runtime.planMode;
}

export function preferredPlanModeForComposer(args: {
	preferences: ComposerPreferencesSnapshot;
	runtimePlanMode?: boolean | null;
}) {
	return args.runtimePlanMode ?? args.preferences.planMode ?? false;
}

export function preferredClaudeContextWindowForComposer(args: {
	model: ProviderModelOption | null;
	preferences: ComposerPreferencesSnapshot;
}) {
	const preferred =
		args.preferences.claudeContextWindow ?? DEFAULT_COMPOSER_MODEL_OPTIONS.claudeContextWindow;
	const contextWindowOptions = args.model?.contextWindowOptions ?? [];
	if (contextWindowOptions.length === 0) return DEFAULT_COMPOSER_MODEL_OPTIONS.claudeContextWindow;
	return contextWindowOptions.some((option) => option.id === preferred)
		? preferred
		: DEFAULT_COMPOSER_MODEL_OPTIONS.claudeContextWindow;
}

export function mentionOptionsFromGitFiles(files: WorkspaceDiffFile[] = []): FileMentionOption[] {
	return files.map((file) => ({
		id: file.path,
		name: basename(file.path),
		relativePath: file.path,
	}));
}

export function modelOptionsForSubmit(args: {
	provider: AgentProvider;
	claudeReasoningEffort: ClaudeReasoningEffort;
	claudeContextWindow: ClaudeContextWindow;
	codexReasoningEffort: CodexReasoningEffort;
	codexFastMode: boolean;
}): ModelOptions {
	if (args.provider === 'claude') {
		return {
			claude: {
				reasoningEffort: args.claudeReasoningEffort,
				contextWindow: args.claudeContextWindow,
			},
		};
	}

	return {
		codex: {
			reasoningEffort: args.codexReasoningEffort,
			fastMode: args.codexFastMode,
		},
	};
}

export async function uploadAttachments(workspaceId: string, attachments: LocalAttachment[]) {
	if (attachments.length === 0) return [] satisfies ChatAttachment[];

	const formData = new FormData();
	for (const attachment of attachments) formData.append('files', attachment.file);

	const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/uploads`, {
		method: 'POST',
		body: formData,
	});

	if (!response.ok) {
		const payload = (await response.json().catch(() => null)) as { error?: string } | null;
		throw new Error(payload?.error ?? 'Upload failed');
	}

	const payload = (await response.json()) as UploadResponse;
	return payload.attachments ?? [];
}

export const DEFAULT_COMPOSER_MODEL_OPTIONS = {
	claudeReasoningEffort: DEFAULT_CLAUDE_MODEL_OPTIONS.reasoningEffort,
	claudeContextWindow: DEFAULT_CLAUDE_MODEL_OPTIONS.contextWindow,
	codexReasoningEffort: DEFAULT_CODEX_MODEL_OPTIONS.reasoningEffort,
	codexFastMode: DEFAULT_CODEX_MODEL_OPTIONS.fastMode,
};
