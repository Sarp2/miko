import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
	type AgentProvider,
	type ClaudeContextWindow,
	type ClaudeReasoningEffort,
	PROVIDERS,
	type SessionSnapshot,
	type WorkspaceSnapshot,
} from '../../shared/types';
import type { LocalAttachment } from '../components/chat-composer/chat-composer-types';
import {
	DEFAULT_COMPOSER_MODEL_OPTIONS,
	modelForProvider,
	modelOptionsForSubmit,
	providerCatalogs,
	resolvePreferredClaudeContextWindow,
	resolvePreferredModelByProvider,
	resolvePreferredProvider,
	uploadAttachments,
} from '../components/chat-composer/chat-composer-utils';
import { useComposerPreferencesStore } from '../stores/composer-preferences-store';
import { useSessionStore } from '../stores/session-store';

const MAX_ATTACHMENTS = 50;

function providerCatalogSignature(providers: ReturnType<typeof providerCatalogs>) {
	return JSON.stringify(providers);
}

interface UseChatComposerArgs {
	workspaceId: string;
	sessionId: string;
	workspaceSnapshot: WorkspaceSnapshot;
	sessionSnapshot: SessionSnapshot | null;
}

export function useChatComposer({
	workspaceId,
	sessionId,
	workspaceSnapshot,
	sessionSnapshot,
}: UseChatComposerArgs) {
	const [content, setContent] = useState('');
	const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const rawAvailableProviders = providerCatalogs(sessionSnapshot);
	const providerCatalogKey = providerCatalogSignature(rawAvailableProviders);
	const stableAvailableProvidersRef = useRef({
		key: providerCatalogKey,
		providers: rawAvailableProviders,
	});
	if (stableAvailableProvidersRef.current.key !== providerCatalogKey) {
		stableAvailableProvidersRef.current = {
			key: providerCatalogKey,
			providers: rawAvailableProviders,
		};
	}

	const availableProviders = stableAvailableProvidersRef.current.providers;
	const sessionProvider = sessionSnapshot?.runtime.provider ?? null;
	const sessionPlanMode = sessionSnapshot?.runtime.planMode ?? false;
	const providers = useMemo(() => {
		if (!sessionProvider) return availableProviders;
		const lockedProvider = availableProviders.find((entry) => entry.id === sessionProvider);
		return lockedProvider ? [lockedProvider] : availableProviders;
	}, [availableProviders, sessionProvider]);

	// Model controls are sourced from the persisted preference store so they survive
	// refresh and workspace/session switches, while existing sessions stay locked to
	// their backend runtime provider.
	const providerPreference = useComposerPreferencesStore((state) => state.provider);
	const modelPreference = useComposerPreferencesStore((state) => state.selectedModelByProvider);
	const claudeReasoningEffortPreference = useComposerPreferencesStore(
		(state) => state.claudeReasoningEffort,
	);
	const claudeContextWindowPreference = useComposerPreferencesStore(
		(state) => state.claudeContextWindow,
	);
	const codexReasoningEffortPreference = useComposerPreferencesStore(
		(state) => state.codexReasoningEffort,
	);
	const codexFastModePreference = useComposerPreferencesStore((state) => state.codexFastMode);
	const planModePreference = useComposerPreferencesStore((state) => state.planMode);

	const provider = sessionProvider ?? resolvePreferredProvider(providerPreference, providers);
	const selectedModelByProvider = useMemo(
		() => resolvePreferredModelByProvider(modelPreference, providers),
		[modelPreference, providers],
	);
	const providerCatalog =
		providers.find((entry) => entry.id === provider) ?? providers[0] ?? PROVIDERS[0];
	const model = modelForProvider(providerCatalog, selectedModelByProvider);

	const claudeReasoningEffort =
		claudeReasoningEffortPreference ?? DEFAULT_COMPOSER_MODEL_OPTIONS.claudeReasoningEffort;
	const claudeContextWindow = useMemo(
		() =>
			resolvePreferredClaudeContextWindow(
				provider === 'claude' ? model : null,
				claudeContextWindowPreference,
			),
		[provider, model, claudeContextWindowPreference],
	);
	const codexReasoningEffort =
		codexReasoningEffortPreference ?? DEFAULT_COMPOSER_MODEL_OPTIONS.codexReasoningEffort;
	const codexFastMode = codexFastModePreference ?? DEFAULT_COMPOSER_MODEL_OPTIONS.codexFastMode;

	// Plan mode stays local because it tracks the active session's backend runtime
	// rather than acting as a pure preference: existing sessions follow runtime, and
	// new sessions seed from the persisted default.
	const [planMode, setPlanMode] = useState(() =>
		sessionProvider ? sessionPlanMode : (planModePreference ?? false),
	);

	const previousSessionIdRef = useRef(sessionId);

	const sessionStatus = sessionSnapshot?.runtime.status;
	const isStreaming =
		sessionStatus === 'running' ||
		sessionStatus === 'starting' ||
		sessionStatus === 'waiting_for_user';

	const sessionLoaded = sessionSnapshot !== null;
	const disabled =
		!sessionLoaded || workspaceSnapshot.workspace.setupState !== 'ready' || submitting;
	const canSubmit =
		(content.trim().length > 0 || attachments.length > 0) && !disabled && !isStreaming;

	useEffect(() => {
		if (previousSessionIdRef.current === sessionId) return;

		previousSessionIdRef.current = sessionId;
		setContent('');
		setAttachments([]);
		setSubmitting(false);
		setPlanMode(sessionProvider ? sessionPlanMode : (planModePreference ?? false));
	}, [sessionId, sessionProvider, sessionPlanMode, planModePreference]);

	// Existing sessions mirror backend plan mode; new sessions keep the seeded default
	// so localStorage never silently overrides an existing session's runtime state.
	useEffect(() => {
		if (sessionProvider) setPlanMode(sessionPlanMode);
	}, [sessionProvider, sessionPlanMode]);

	const addFiles = useCallback((files: File[]) => {
		setAttachments((current) => {
			const remaining = Math.max(MAX_ATTACHMENTS - current.length, 0);
			return [
				...current,
				...files.slice(0, remaining).map(
					(file) =>
						({
							id: crypto.randomUUID(),
							file,
							kind: file.type.toLowerCase().startsWith('image/') ? 'image' : 'file',
						}) as LocalAttachment,
				),
			];
		});
	}, []);

	const removeAttachment = useCallback((attachmentId: string) => {
		setAttachments((current) => current.filter((item) => item.id !== attachmentId));
	}, []);

	const changeProvider = useCallback(
		(nextProvider: AgentProvider) => {
			if (sessionProvider) return;
			useComposerPreferencesStore.getState().setProviderPreference(nextProvider);
		},
		[sessionProvider],
	);

	const changeModel = useCallback((nextProvider: AgentProvider, modelId: string) => {
		useComposerPreferencesStore.getState().setModelPreference(nextProvider, modelId);
	}, []);

	const changeClaudeReasoningEffort = useCallback((value: ClaudeReasoningEffort) => {
		useComposerPreferencesStore.getState().setClaudeReasoningEffortPreference(value);
	}, []);

	const changeClaudeContextWindow = useCallback((value: ClaudeContextWindow) => {
		useComposerPreferencesStore.getState().setClaudeContextWindowPreference(value);
	}, []);

	const changeCodexFastMode = useCallback((value: boolean) => {
		useComposerPreferencesStore.getState().setCodexFastModePreference(value);
	}, []);

	const changePlanMode = useCallback((value: boolean) => {
		setPlanMode(value);
		useComposerPreferencesStore.getState().setPlanModePreference(value);
	}, []);

	const submit = useCallback(async () => {
		if (!canSubmit || !model) return;
		setSubmitting(true);
		try {
			const uploadedAttachments = await uploadAttachments(workspaceId, attachments);
			await useSessionStore.getState().sendSessionMessage({
				sessionId,
				workspaceId,
				provider,
				content,
				attachments: uploadedAttachments,
				model: model.id,
				modelOptions: modelOptionsForSubmit({
					provider,
					claudeReasoningEffort,
					claudeContextWindow,
					codexReasoningEffort,
					codexFastMode,
				}),
				planMode,
			});
			setContent('');
			setAttachments([]);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Could not send message';
			toast.error(message);
		} finally {
			setSubmitting(false);
		}
	}, [
		attachments,
		canSubmit,
		claudeContextWindow,
		claudeReasoningEffort,
		codexFastMode,
		codexReasoningEffort,
		content,
		model,
		planMode,
		provider,
		sessionId,
		workspaceId,
	]);

	const stop = useCallback(() => {
		void useSessionStore
			.getState()
			.cancelSession(sessionId)
			.catch((error) => {
				console.warn('[chat-composer] failed to stop session', error);
				toast.error('Could not stop the session');
			});
	}, [sessionId]);

	return {
		content,
		setContent,
		attachments,
		provider,
		setProvider: changeProvider,
		providers,
		providerCatalog,
		model,
		planMode,
		setPlanMode: changePlanMode,
		claudeReasoningEffort,
		setClaudeReasoningEffort: changeClaudeReasoningEffort,
		claudeContextWindow,
		setClaudeContextWindow: changeClaudeContextWindow,
		codexFastMode,
		setCodexFastMode: changeCodexFastMode,
		isStreaming,
		disabled,
		canSubmit,
		addFiles,
		removeAttachment,
		changeModel,
		submit,
		stop,
	};
}
