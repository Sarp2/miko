import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type {
	AgentProvider,
	ChatAttachment,
	ClaudeContextWindow,
	ClaudeReasoningEffort,
	PromptPart,
	SessionSnapshot,
	WorkspaceSnapshot,
} from '../../shared/types';
import type { LocalAttachment } from '../components/chat-composer/chat-composer-types';
import {
	deleteUploadedAttachment,
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
import {
	compactPromptParts,
	promptPartsPlainText,
	promptPartsSubmissionText,
} from '../lib/prompt-parts';
import { useComposerDraftStore } from '../stores/composer-draft-store';
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
	const [parts, setParts] = useState<PromptPart[]>(() =>
		useComposerDraftStore.getState().getDraft(sessionId),
	);
	const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
	const attachmentsRef = useRef<LocalAttachment[]>([]);
	const uploadingAttachmentByIdRef = useRef(new Map<string, Promise<ChatAttachment | null>>());
	const [submitting, setSubmitting] = useState(false);
	const submittingRef = useRef(false);
	const submittingAttachmentIdsRef = useRef(new Set<string>());
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
	const hasVisibleAttachmentToken = parts.some((part) => part.type === 'attachment');
	const canSubmit =
		(content.trim().length > 0 || hasVisibleAttachmentToken) && !disabled && !isStreaming;

	useEffect(() => {
		const targetSessionId = previousSessionIdRef.current;
		const textParts = parts.filter((part) => part.type !== 'attachment');
		if (textParts.length > 0) {
			useComposerDraftStore.getState().setDraft(targetSessionId, textParts);
		} else {
			useComposerDraftStore.getState().clearDraft(targetSessionId);
		}
	}, [parts]);

	const addFiles = useCallback((files: File[]) => {
		const remaining = Math.max(MAX_ATTACHMENTS - attachmentsRef.current.length, 0);
		const created = files.slice(0, remaining).map(
			(file) =>
				({
					id: crypto.randomUUID(),
					file,
					kind: file.type.toLowerCase().startsWith('image/') ? 'image' : 'file',
				}) as LocalAttachment,
		);
		if (created.length === 0) return;

		attachmentsRef.current = [...attachmentsRef.current, ...created];
		setAttachments(attachmentsRef.current);
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
	}, []);

	const markAttachmentsUploaded = useCallback((uploadedByLocalId: Map<string, ChatAttachment>) => {
		if (uploadedByLocalId.size === 0) return;
		attachmentsRef.current = attachmentsRef.current.map((attachment) => {
			const uploaded = uploadedByLocalId.get(attachment.id);
			return uploaded ? { ...attachment, uploaded } : attachment;
		});
		setAttachments(attachmentsRef.current);
	}, []);

	const ensureAttachmentUploaded = useCallback(
		async (attachmentId: string) => {
			const attachment = attachmentsRef.current.find((item) => item.id === attachmentId);
			if (!attachment) return null;
			if (attachment.uploaded) return attachment.uploaded;

			const inFlight = uploadingAttachmentByIdRef.current.get(attachmentId);
			if (inFlight) return await inFlight;

			const upload = uploadAttachments(workspaceId, [attachment])
				.then((uploadedAttachments) => {
					const uploaded = uploadedAttachments[0] ?? null;
					if (uploaded) markAttachmentsUploaded(new Map([[attachmentId, uploaded]]));
					return uploaded;
				})
				.finally(() => {
					uploadingAttachmentByIdRef.current.delete(attachmentId);
				});

			uploadingAttachmentByIdRef.current.set(attachmentId, upload);
			return await upload;
		},
		[markAttachmentsUploaded, workspaceId],
	);

	const deleteUnsubmittedUpload = useCallback(
		(attachment: ChatAttachment) => {
			void deleteUploadedAttachment(workspaceId, attachment).catch((error) => {
				console.warn('[chat-composer] failed to delete unsubmitted attachment upload', error);
			});
		},
		[workspaceId],
	);

	const cleanupUnsubmittedAttachments = useCallback(
		(items: LocalAttachment[]) => {
			const submittedAttachmentIds = submittingAttachmentIdsRef.current;
			for (const attachment of items) {
				if (submittingRef.current && submittedAttachmentIds.has(attachment.id)) continue;
				if (attachment.uploaded) {
					deleteUnsubmittedUpload(attachment.uploaded);
					continue;
				}

				const inFlightUpload = uploadingAttachmentByIdRef.current.get(attachment.id);
				if (!inFlightUpload) continue;
				void inFlightUpload
					.then((uploadedAttachment) => {
						if (!uploadedAttachment) return;
						if (submittingRef.current && submittedAttachmentIds.has(attachment.id)) return;
						deleteUnsubmittedUpload(uploadedAttachment);
					})
					.catch(() => undefined);
			}
		},
		[deleteUnsubmittedUpload],
	);

	useEffect(() => {
		if (previousSessionIdRef.current === sessionId) return;

		cleanupUnsubmittedAttachments(attachmentsRef.current);
		previousSessionIdRef.current = sessionId;
		attachmentsRef.current = [];
		setParts(useComposerDraftStore.getState().getDraft(sessionId));
		setAttachments([]);
		setSubmitting(false);
		submittingRef.current = false;
	}, [cleanupUnsubmittedAttachments, sessionId]);

	useEffect(() => {
		return () => {
			cleanupUnsubmittedAttachments(attachmentsRef.current);
		};
	}, [cleanupUnsubmittedAttachments]);

	const removeAttachment = useCallback(
		(attachmentId: string) => {
			const removedAttachment = attachmentsRef.current.find((item) => item.id === attachmentId);
			if (removedAttachment) cleanupUnsubmittedAttachments([removedAttachment]);
			attachmentsRef.current = attachmentsRef.current.filter((item) => item.id !== attachmentId);
			setAttachments(attachmentsRef.current);
			setParts((current) =>
				compactPromptParts(
					current.filter(
						(part) => part.type !== 'attachment' || part.attachmentId !== attachmentId,
					),
				),
			);
		},
		[cleanupUnsubmittedAttachments],
	);

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
		submittingRef.current = true;
		setSubmitting(true);
		try {
			const visibleAttachmentIds = new Set(
				parts.flatMap((part) => (part.type === 'attachment' ? [part.attachmentId] : [])),
			);
			const visibleAttachments = attachments.filter((attachment) =>
				visibleAttachmentIds.has(attachment.id),
			);
			submittingAttachmentIdsRef.current = new Set(
				visibleAttachments.map((attachment) => attachment.id),
			);
			const uploadedAttachmentByLocalId = new Map<string, ChatAttachment>();
			for (const attachment of visibleAttachments) {
				if (attachment.uploaded)
					uploadedAttachmentByLocalId.set(attachment.id, attachment.uploaded);
			}

			const attachmentsToUpload: LocalAttachment[] = [];
			for (const attachment of visibleAttachments) {
				if (attachment.uploaded) continue;
				const inFlight = uploadingAttachmentByIdRef.current.get(attachment.id);
				if (inFlight) {
					const uploaded = await inFlight;
					if (uploaded) uploadedAttachmentByLocalId.set(attachment.id, uploaded);
					continue;
				}
				attachmentsToUpload.push(attachment);
			}

			const newlyUploadedAttachments = await uploadAttachments(workspaceId, attachmentsToUpload);
			for (const [index, uploaded] of newlyUploadedAttachments.entries()) {
				const localAttachment = attachmentsToUpload[index];
				if (localAttachment && uploaded)
					uploadedAttachmentByLocalId.set(localAttachment.id, uploaded);
			}
			markAttachmentsUploaded(uploadedAttachmentByLocalId);
			const uploadedAttachments = visibleAttachments.flatMap((attachment) => {
				const uploaded = uploadedAttachmentByLocalId.get(attachment.id);
				return uploaded ? [uploaded] : [];
			});
			const submittedParts = compactPromptParts(
				parts.flatMap((part): PromptPart[] => {
					if (part.type !== 'attachment') return [part];
					const uploaded = uploadedAttachmentByLocalId.get(part.attachmentId);
					return uploaded ? [{ type: 'attachment' as const, attachmentId: uploaded.id }] : [];
				}),
			);
			const submittedContent = promptPartsSubmissionText(submittedParts);
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
			useComposerDraftStore.getState().clearDraft(sessionId);
			setParts([]);
			attachmentsRef.current = [];
			setAttachments([]);
		} catch (error) {
			cleanupUnsubmittedAttachments(attachmentsRef.current);
			const message = error instanceof Error ? error.message : 'Could not send message';
			toast.error(message);
		} finally {
			submittingRef.current = false;
			submittingAttachmentIdsRef.current = new Set();
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
		cleanupUnsubmittedAttachments,
		markAttachmentsUploaded,
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
		ensureAttachmentUploaded,
		changeModel,
		submit,
		stop,
	};
}
