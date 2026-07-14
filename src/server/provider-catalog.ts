import {
	type AgentProvider,
	type ClaudeModelOptions,
	type CodexModelOptions,
	DEFAULT_CLAUDE_MODEL_OPTIONS,
	DEFAULT_CODEX_MODEL_OPTIONS,
	isClaudeReasoningEffort,
	isCodexReasoningEffort,
	type ModelOptions,
	normalizeClaudeContextWindow,
	PROVIDERS,
	type ProviderCatalogEntry,
	type ServiceTier,
} from 'src/shared/types';

// The server exposes the shared catalog as-is. If the server ever needs to
// diverge from what the client bundle ships (e.g. a server-only beta model),
// reintroduce a mapped override here — do not fork the model list by hand.
export const SERVER_PROVIDERS: ProviderCatalogEntry[] = PROVIDERS;

export function getServerProviderCatalog(provider: AgentProvider): ProviderCatalogEntry {
	const entry = SERVER_PROVIDERS.find((candidate) => candidate.id === provider);
	if (!entry) {
		throw new Error(`Unknown provider: ${provider}`);
	}
	return entry;
}

export function normalizeServerModel(provider: AgentProvider, model?: string): string {
	const catalog = getServerProviderCatalog(provider);
	if (model && catalog.models.some((candidate) => candidate.id === model)) {
		return model;
	}
	return catalog.defaultModel;
}

export function normalizeClaudeModelOptions(
	model: string,
	modelOptions?: ModelOptions,
	legacyEffort?: string,
): ClaudeModelOptions {
	const reasoningEffort = modelOptions?.claude?.reasoningEffort;
	return {
		reasoningEffort: isClaudeReasoningEffort(reasoningEffort)
			? reasoningEffort
			: isClaudeReasoningEffort(legacyEffort)
				? legacyEffort
				: DEFAULT_CLAUDE_MODEL_OPTIONS.reasoningEffort,
		contextWindow: normalizeClaudeContextWindow(model, modelOptions?.claude?.contextWindow),
	};
}

export function normalizeCodexModelOptions(
	modelOptions?: ModelOptions,
	legacyEffort?: string,
): CodexModelOptions {
	const reasoningEffort = modelOptions?.codex?.reasoningEffort;
	return {
		reasoningEffort: isCodexReasoningEffort(reasoningEffort)
			? reasoningEffort
			: isCodexReasoningEffort(legacyEffort)
				? legacyEffort
				: DEFAULT_CODEX_MODEL_OPTIONS.reasoningEffort,
		fastMode:
			typeof modelOptions?.codex?.fastMode === 'boolean'
				? modelOptions.codex.fastMode
				: DEFAULT_CODEX_MODEL_OPTIONS.fastMode,
	};
}

export function codexServiceTierFromModelOptions(
	modelOptions: CodexModelOptions,
): ServiceTier | undefined {
	return modelOptions.fastMode ? 'fast' : undefined;
}
