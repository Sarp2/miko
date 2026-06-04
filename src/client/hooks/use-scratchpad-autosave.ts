import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScratchpadSnapshot } from '../../shared/types';
import { useScratchpadStore } from '../stores/scratchpad-store';

const AUTOSAVE_DEBOUNCE_MS = 600;
const AUTOSAVE_RETRY_BASE_MS = 1500;
const AUTOSAVE_RETRY_MAX_MS = 12_000;
const AUTOSAVE_MAX_RETRIES = 6;

interface UseScratchpadAutosaveArgs {
	workspaceId: string;
	snapshot: ScratchpadSnapshot | null;
}

export function useScratchpadAutosave({ workspaceId, snapshot }: UseScratchpadAutosaveArgs) {
	const updateScratchpad = useScratchpadStore((state) => state.updateScratchpad);
	const loaded = snapshot !== null;
	const [draft, setDraftState] = useState(snapshot?.content ?? '');
	const draftRef = useRef(draft);
	const dirtyRef = useRef(false);
	const inFlightRef = useRef(false);
	const lastSavedContentRef = useRef(snapshot?.content ?? '');
	const retryCountRef = useRef(0);
	const debounceTimeoutIdRef = useRef<number | null>(null);
	const retryTimeoutIdRef = useRef<number | null>(null);
	const unmountedRef = useRef(false);

	const clearDebounceTimeout = useCallback(() => {
		if (debounceTimeoutIdRef.current === null) return;
		window.clearTimeout(debounceTimeoutIdRef.current);
		debounceTimeoutIdRef.current = null;
	}, []);

	const clearRetryTimeout = useCallback(() => {
		if (retryTimeoutIdRef.current === null) return;
		window.clearTimeout(retryTimeoutIdRef.current);
		retryTimeoutIdRef.current = null;
	}, []);

	const saveLatestDraft = useCallback(async () => {
		if (unmountedRef.current || inFlightRef.current) return;

		const contentToSave = draftRef.current;
		if (contentToSave === lastSavedContentRef.current) return;

		inFlightRef.current = true;
		try {
			const updated = await updateScratchpad(workspaceId, contentToSave);
			lastSavedContentRef.current = updated.content;
			retryCountRef.current = 0;

			if (draftRef.current === updated.content) {
				dirtyRef.current = false;
				return;
			}

			dirtyRef.current = true;
		} catch {
			// Retry scheduling happens in finally after the in-flight flag is released.
		} finally {
			inFlightRef.current = false;
		}

		if (unmountedRef.current || draftRef.current === lastSavedContentRef.current) return;

		const retryCount = retryCountRef.current;
		if (retryCount >= AUTOSAVE_MAX_RETRIES) return;

		const delayMs = Math.min(AUTOSAVE_RETRY_BASE_MS * 2 ** retryCount, AUTOSAVE_RETRY_MAX_MS);
		retryCountRef.current = retryCount + 1;
		clearRetryTimeout();
		retryTimeoutIdRef.current = window.setTimeout(() => {
			retryTimeoutIdRef.current = null;
			void saveLatestDraft();
		}, delayMs);
	}, [clearRetryTimeout, updateScratchpad, workspaceId]);

	useEffect(() => {
		draftRef.current = draft;
	}, [draft]);

	useEffect(() => {
		if (!snapshot || dirtyRef.current) return;
		const nextContent = snapshot.content;
		if (nextContent === lastSavedContentRef.current) return;
		lastSavedContentRef.current = nextContent;
		setDraftState(nextContent);
	}, [snapshot]);

	useEffect(() => {
		if (!loaded || draft === lastSavedContentRef.current) return;
		clearDebounceTimeout();
		clearRetryTimeout();
		retryCountRef.current = 0;
		debounceTimeoutIdRef.current = window.setTimeout(() => {
			debounceTimeoutIdRef.current = null;
			void saveLatestDraft();
		}, AUTOSAVE_DEBOUNCE_MS);

		return clearDebounceTimeout;
	}, [clearDebounceTimeout, clearRetryTimeout, draft, loaded, saveLatestDraft]);

	useEffect(() => {
		unmountedRef.current = false;
		return () => {
			unmountedRef.current = true;
			clearDebounceTimeout();
			clearRetryTimeout();
			const latestDraft = draftRef.current;
			if (!useScratchpadStore.getState().getScratchpadSnapshot(workspaceId)) return;
			if (latestDraft === lastSavedContentRef.current) return;
			void useScratchpadStore.getState().updateScratchpad(workspaceId, latestDraft);
		};
	}, [clearDebounceTimeout, clearRetryTimeout, workspaceId]);

	const setDraft = (nextDraft: string) => {
		dirtyRef.current = true;
		setDraftState(nextDraft);
	};

	return { draft, loaded, setDraft };
}
