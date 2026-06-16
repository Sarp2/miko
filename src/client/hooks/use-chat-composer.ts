import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type {
	AgentProvider,
	ClaudeContextWindow,
	ClaudeReasoningEffort,
	PromptPart,
	SessionSnapshot,
	WorkspaceSnapshot,
} from '../../shared/types';
import type { LocalAttachment } from '../components/chat-composer/chat-composer-types';
import {
	modelForProvider,
	modelOptionsForSubmit,
	preferredClaudeContextWindowForComposer,
	preferredClaudeReasoningEffortForComposer,
	preferredCodexFastModeForComposer,
	preferredCodexReasoningEffortForComposer,
	preferredModelByProviderForComposer,
	preferredPlanModeForComposer,
	preferredProviderForComposer,
	providerCatalogs,
	runtimePlanModeForComposer,
	uploadAttachments,
} from '../components/chat-composer/chat-composer-utils';
import { compactPromptParts, promptPartsPlainText } from '../lib/prompt-parts';
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
	const [parts, setParts] = useState<PromptPart[]>([]);
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
	const preferences = useComposerPreferencesStore();
	const sessionProvider = sessionSnapshot?.runtime.provider ?? null;
	const sessionPlanMode = runtimePlanModeForComposer(sessionSnapshot);
	const providers = useMemo(() => {
		if (!sessionProvider) return availableProviders;
		const lockedProvider = availableProviders.find((entry) => entry.id === sessionProvider);
		return lockedProvider ? [lockedProvider] : availableProviders;
	}, [availableProviders, sessionProvider]);
	const provider = useMemo(
		() =>
			preferredProviderForComposer({ preferences, providers, runtimeProvider: sessionProvider }),
		[preferences, providers, sessionProvider],
	);
	const selectedModelByProvider = useMemo(
		() => preferredModelByProviderForComposer({ preferences, providers }),
		[preferences, providers],
	);
	const planMode = preferredPlanModeForComposer({
		preferences,
		runtimePlanMode: sessionPlanMode,
	});
	const claudeReasoningEffort = preferredClaudeReasoningEffortForComposer(preferences);
	const codexReasoningEffort = preferredCodexReasoningEffortForComposer(preferences);
	const codexFastMode = preferredCodexFastModeForComposer(preferences);

	const previousSessionIdRef = useRef(sessionId);
	const providerCatalog = providers.find((entry) => entry.id === provider) ?? providers[0];
	const model = providerCatalog ? modelForProvider(providerCatalog, selectedModelByProvider) : null;
	const claudeContextWindow = preferredClaudeContextWindowForComposer({ model, preferences });
	const sessionStatus = sessionSnapshot?.runtime.status;
	const isStreaming =
		sessionStatus === 'running' ||
		sessionStatus === 'starting' ||
		sessionStatus === 'waiting_for_user';

	const sessionLoaded = sessionSnapshot !== null;
	const disabled =
		!sessionLoaded || workspaceSnapshot.workspace.setupState !== 'ready' || submitting;
	const content = useMemo(() => promptPartsPlainText(parts), [parts]);
	const canSubmit =
		(content.trim().length > 0 || attachments.length > 0) && !disabled && !isStreaming;

	useEffect(() => {
		if (previousSessionIdRef.current === sessionId) return;

		previousSessionIdRef.current = sessionId;
		setParts([]);
		setAttachments([]);
		setSubmitting(false);
	}, [sessionId]);

	const addFiles = useCallback(
		(files: File[]) => {
			const created = files.slice(0, Math.max(MAX_ATTACHMENTS - attachments.length, 0)).map(
				(file) =>
					({
						id: crypto.randomUUID(),
						file,
						kind: file.type.toLowerCase().startsWith('image/') ? 'image' : 'file',
					}) as LocalAttachment,
			);
			if (created.length === 0) return;
			setAttachments((current) => [...current, ...created]);
			setParts((current) =>
				compactPromptParts([
					...current,
					...(current.length > 0 ? [{ type: 'text' as const, text: ' ' }] : []),
					...created.map((attachment) => ({
						type: 'attachment' as const,
						attachmentId: attachment.id,
					})),
					{ type: 'text', text: ' ' },
				]),
			);
		},
		[attachments.length],
	);

	const removeAttachment = useCallback((attachmentId: string) => {
		setAttachments((current) => current.filter((item) => item.id !== attachmentId));
		setParts((current) =>
			compactPromptParts(
				current.filter((part) => part.type !== 'attachment' || part.attachmentId !== attachmentId),
			),
		);
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

	const setPlanMode = useCallback((nextPlanMode: boolean) => {
		useComposerPreferencesStore.getState().setPlanModePreference(nextPlanMode);
	}, []);

	const setClaudeReasoningEffort = useCallback((nextEffort: ClaudeReasoningEffort) => {
		useComposerPreferencesStore.getState().setClaudeReasoningEffortPreference(nextEffort);
	}, []);

	const setClaudeContextWindow = useCallback((nextContextWindow: ClaudeContextWindow) => {
		useComposerPreferencesStore.getState().setClaudeContextWindowPreference(nextContextWindow);
	}, []);

	const setCodexFastMode = useCallback((nextFastMode: boolean) => {
		useComposerPreferencesStore.getState().setCodexFastModePreference(nextFastMode);
	}, []);

	const submit = useCallback(async () => {
		if (!canSubmit || !model) return;
		setSubmitting(true);
		try {
			const uploadedAttachments = await uploadAttachments(workspaceId, attachments);
			const uploadedAttachmentByLocalId = new Map(
				attachments.map((attachment, index) => [attachment.id, uploadedAttachments[index]]),
			);
			const submittedParts = compactPromptParts(
				parts.flatMap((part): PromptPart[] => {
					if (part.type !== 'attachment') return [part];
					const uploaded = uploadedAttachmentByLocalId.get(part.attachmentId);
					return uploaded ? [{ type: 'attachment' as const, attachmentId: uploaded.id }] : [];
				}),
			);
			const submittedContent = promptPartsPlainText(submittedParts, uploadedAttachments);
			await useSessionStore.getState().sendSessionMessage({
				sessionId,
				workspaceId,
				provider,
				content: submittedContent,
				attachments: uploadedAttachments,
				parts: submittedParts,
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
			setParts([]);
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
		parts,
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
		parts,
		setParts,
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
