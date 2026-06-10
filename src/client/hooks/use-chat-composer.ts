import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
	type AgentProvider,
	type ClaudeContextWindow,
	type ClaudeReasoningEffort,
	type CodexReasoningEffort,
	PROVIDERS,
	type ProviderCatalogEntry,
	type SessionSnapshot,
	type WorkspaceSnapshot,
} from '../../shared/types';
import type { LocalAttachment } from '../components/chat-composer/chat-composer-types';
import {
	DEFAULT_COMPOSER_MODEL_OPTIONS,
	modelForProvider,
	modelOptionsForSubmit,
	providerCatalogs,
	uploadAttachments,
} from '../components/chat-composer/chat-composer-utils';
import { useSessionStore } from '../stores/session-store';

const MAX_ATTACHMENTS = 50;

function providerCatalogSignature(providers: ProviderCatalogEntry[]) {
	return providers
		.map((provider) =>
			[
				provider.id,
				provider.defaultModel,
				provider.models.map((model) => model.id).join(','),
				provider.efforts.map((effort) => effort.id).join(','),
			].join(':'),
		)
		.join('|');
}

function defaultProviderFromCatalogs(
	sessionProvider: AgentProvider | null,
	providers: ProviderCatalogEntry[],
) {
	if (sessionProvider && providers.some((provider) => provider.id === sessionProvider)) {
		return sessionProvider;
	}
	return providers[0]?.id ?? 'claude';
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
	const resolvedDefaultProvider = useMemo(
		() => defaultProviderFromCatalogs(sessionProvider, providers),
		[providers, sessionProvider],
	);
	const [provider, setProvider] = useState<AgentProvider>(() => resolvedDefaultProvider);
	const [selectedModelByProvider, setSelectedModelByProvider] = useState<Record<string, string>>(
		() => Object.fromEntries(providers.map((entry) => [entry.id, entry.defaultModel])),
	);
	const [planMode, setPlanMode] = useState(sessionPlanMode);
	const [claudeReasoningEffort, setClaudeReasoningEffort] = useState<ClaudeReasoningEffort>(
		DEFAULT_COMPOSER_MODEL_OPTIONS.claudeReasoningEffort,
	);
	const [claudeContextWindow, setClaudeContextWindow] = useState<ClaudeContextWindow>(
		DEFAULT_COMPOSER_MODEL_OPTIONS.claudeContextWindow,
	);
	const [codexReasoningEffort] = useState<CodexReasoningEffort>(
		DEFAULT_COMPOSER_MODEL_OPTIONS.codexReasoningEffort,
	);
	const [codexFastMode, setCodexFastMode] = useState<boolean>(
		DEFAULT_COMPOSER_MODEL_OPTIONS.codexFastMode,
	);

	const providerWasChangedByUserRef = useRef(false);
	const previousSessionIdRef = useRef(sessionId);
	const providerCatalog =
		providers.find((entry) => entry.id === provider) ?? providers[0] ?? PROVIDERS[0];

	const model = modelForProvider(providerCatalog, selectedModelByProvider);
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
		providerWasChangedByUserRef.current = false;
		setProvider(resolvedDefaultProvider);
		setSelectedModelByProvider(
			Object.fromEntries(providers.map((entry) => [entry.id, entry.defaultModel])),
		);
		setPlanMode(sessionPlanMode);
	}, [providers, resolvedDefaultProvider, sessionId, sessionPlanMode]);

	useEffect(() => {
		setPlanMode(sessionPlanMode);
	}, [sessionPlanMode]);

	useEffect(() => {
		setSelectedModelByProvider((current) => ({
			...Object.fromEntries(providers.map((entry) => [entry.id, entry.defaultModel])),
			...current,
		}));
	}, [providers]);

	useEffect(() => {
		const providerIsAvailable = providers.some((entry) => entry.id === provider);
		if (sessionProvider) {
			if (provider !== sessionProvider) setProvider(sessionProvider);
		} else if (
			!providerIsAvailable ||
			(!providerWasChangedByUserRef.current && provider !== resolvedDefaultProvider)
		) {
			setProvider(resolvedDefaultProvider);
		}
	}, [provider, providers, resolvedDefaultProvider, sessionProvider]);

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
			providerWasChangedByUserRef.current = true;
			setProvider(nextProvider);
		},
		[sessionProvider],
	);

	const changeModel = useCallback((nextProvider: AgentProvider, modelId: string) => {
		setSelectedModelByProvider((current) => ({
			...current,
			[nextProvider]: modelId,
		}));
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
		setPlanMode,
		claudeReasoningEffort,
		setClaudeReasoningEffort,
		claudeContextWindow,
		setClaudeContextWindow,
		codexFastMode,
		setCodexFastMode,
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
