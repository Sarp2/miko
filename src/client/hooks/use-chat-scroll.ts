import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { TranscriptItem } from '../lib/group-transcript-turns';

const BOTTOM_THRESHOLD_PX = 48;
const TOP_LOAD_THRESHOLD_PX = 160;
const MAX_SCROLL_MEMORY_ENTRIES = 200;

interface ChatScrollMemory {
	scrollTop: number;
	pinnedToBottom: boolean;
	updatedAt: number;
}

interface ScrollAnchor {
	itemId: string;
	top: number;
	scrollHeight: number;
}

type PendingPrependPosition =
	| { type: 'item'; anchor: ScrollAnchor }
	| { type: 'scrollTop'; scrollTop: number }
	| { type: 'heightDelta'; scrollHeight: number };

interface UseChatScrollArgs {
	sessionId: string;
	items: TranscriptItem[];
	initialized: boolean;
	hasOlder: boolean;
	loadingOlder: boolean;
	onLoadOlder?: () => void;
}

const scrollMemoryBySessionId = new Map<string, ChatScrollMemory>();

function pruneScrollMemory() {
	while (scrollMemoryBySessionId.size > MAX_SCROLL_MEMORY_ENTRIES) {
		let oldestSessionId: string | null = null;
		let oldestUpdatedAt = Number.POSITIVE_INFINITY;

		for (const [sessionId, memory] of scrollMemoryBySessionId.entries()) {
			if (memory.updatedAt >= oldestUpdatedAt) continue;
			oldestSessionId = sessionId;
			oldestUpdatedAt = memory.updatedAt;
		}

		if (!oldestSessionId) return;
		scrollMemoryBySessionId.delete(oldestSessionId);
	}
}

function isPinnedToBottom(element: HTMLElement) {
	return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD_PX;
}

function scrollToBottom(element: HTMLElement) {
	element.scrollTop = element.scrollHeight;
}

function transcriptItemElements(element: HTMLElement) {
	return Array.from(element.querySelectorAll<HTMLElement>('[data-transcript-item-id]'));
}

function captureFirstVisibleAnchor(element: HTMLElement): ScrollAnchor | null {
	const containerTop = element.getBoundingClientRect().top;
	const item = transcriptItemElements(element).find((candidate) => {
		return candidate.getBoundingClientRect().bottom >= containerTop + 1;
	});
	const itemId = item?.dataset.transcriptItemId;
	if (!item || !itemId) return null;

	return {
		itemId,
		top: item.getBoundingClientRect().top,
		scrollHeight: element.scrollHeight,
	};
}

function restoreAnchor(element: HTMLElement, anchor: ScrollAnchor) {
	const item = transcriptItemElements(element).find(
		(candidate) => candidate.dataset.transcriptItemId === anchor.itemId,
	);

	if (item) {
		element.scrollTop += item.getBoundingClientRect().top - anchor.top;
		return;
	}

	element.scrollTop += element.scrollHeight - anchor.scrollHeight;
}

function capturePrependPosition(element: HTMLElement): PendingPrependPosition {
	const anchor = captureFirstVisibleAnchor(element);
	if (anchor) return { type: 'item', anchor };

	return transcriptItemElements(element).length > 0
		? { type: 'heightDelta', scrollHeight: element.scrollHeight }
		: { type: 'scrollTop', scrollTop: element.scrollTop };
}

export function useChatScroll({
	sessionId,
	items,
	initialized,
	hasOlder,
	loadingOlder,
	onLoadOlder,
}: UseChatScrollArgs) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const anchorRef = useRef<ScrollAnchor | null>(null);
	const pendingPrependPositionRef = useRef<PendingPrependPosition | null>(null);
	const pinnedToBottomRef = useRef(true);
	const restoredSessionRef = useRef<string | null>(null);
	const frameRef = useRef<number | null>(null);
	const scrollFrameRef = useRef<number | null>(null);
	const olderLoadRequestedRef = useRef(false);
	const hasOlderRef = useRef(hasOlder);
	const loadingOlderRef = useRef(loadingOlder);
	const onLoadOlderRef = useRef(onLoadOlder);
	const latestUserItemIdRef = useRef<string | null>(null);
	const latestUserItemId = useMemo(() => {
		return items.findLast((item) => item.type === 'user')?.id ?? null;
	}, [items]);
	const itemSignature = useMemo(
		() =>
			items
				.map((item) =>
					item.type === 'turn'
						? `${item.id}:${item.turn.isComplete ? 'complete' : 'active'}:${item.turn.toolCount}:${item.turn.messageCount}`
						: item.id,
				)
				.join('|'),
		[items],
	);

	hasOlderRef.current = hasOlder;
	loadingOlderRef.current = loadingOlder;
	onLoadOlderRef.current = onLoadOlder;

	const saveMemory = useCallback(() => {
		const element = scrollRef.current;
		if (!element || !initialized) return;
		scrollMemoryBySessionId.set(sessionId, {
			scrollTop: element.scrollTop,
			pinnedToBottom: isPinnedToBottom(element),
			updatedAt: Date.now(),
		});
		pruneScrollMemory();
	}, [initialized, sessionId]);

	const requestOlderPageIfNearTop = useCallback((element: HTMLElement) => {
		const shouldLoadOlder =
			element.scrollTop <= TOP_LOAD_THRESHOLD_PX &&
			hasOlderRef.current &&
			!loadingOlderRef.current &&
			!olderLoadRequestedRef.current;

		if (!shouldLoadOlder) return;
		pendingPrependPositionRef.current = capturePrependPosition(element);
		olderLoadRequestedRef.current = true;
		onLoadOlderRef.current?.();
	}, []);

	const updateAnchorState = useCallback(() => {
		const element = scrollRef.current;
		if (!element || !initialized) return;
		pinnedToBottomRef.current = isPinnedToBottom(element);
		anchorRef.current = captureFirstVisibleAnchor(element);
		saveMemory();
		requestOlderPageIfNearTop(element);
	}, [initialized, requestOlderPageIfNearTop, saveMemory]);

	const loadOlder = useCallback(() => {
		const element = scrollRef.current;
		if (
			!element ||
			!hasOlderRef.current ||
			loadingOlderRef.current ||
			olderLoadRequestedRef.current
		)
			return;

		pendingPrependPositionRef.current = capturePrependPosition(element);
		olderLoadRequestedRef.current = true;
		onLoadOlderRef.current?.();
	}, []);

	const maintainScrollPosition = useCallback(() => {
		const element = scrollRef.current;
		if (!element || !initialized) return;

		if (restoredSessionRef.current !== sessionId) {
			const memory = scrollMemoryBySessionId.get(sessionId);
			if (memory && !memory.pinnedToBottom) {
				element.scrollTop = Math.min(memory.scrollTop, element.scrollHeight);
			} else {
				scrollToBottom(element);
			}
			restoredSessionRef.current = sessionId;
			latestUserItemIdRef.current = latestUserItemId;
			updateAnchorState();
			return;
		}

		const userPromptAppended =
			latestUserItemId !== null &&
			latestUserItemIdRef.current !== null &&
			latestUserItemIdRef.current !== latestUserItemId;
		if (userPromptAppended) {
			scrollToBottom(element);
			pinnedToBottomRef.current = true;
			latestUserItemIdRef.current = latestUserItemId;
			updateAnchorState();
			return;
		}

		const pendingPrependPosition = pendingPrependPositionRef.current;
		if (pendingPrependPosition) {
			if (pendingPrependPosition.type === 'item') {
				restoreAnchor(element, pendingPrependPosition.anchor);
			} else if (pendingPrependPosition.type === 'heightDelta') {
				element.scrollTop += element.scrollHeight - pendingPrependPosition.scrollHeight;
			} else {
				element.scrollTop = pendingPrependPosition.scrollTop;
			}
			pendingPrependPositionRef.current = null;
			latestUserItemIdRef.current = latestUserItemId;
			updateAnchorState();
			return;
		}

		if (pinnedToBottomRef.current) {
			scrollToBottom(element);
			latestUserItemIdRef.current = latestUserItemId;
			updateAnchorState();
			return;
		}

		const anchor = anchorRef.current;
		if (anchor) restoreAnchor(element, anchor);
		latestUserItemIdRef.current = latestUserItemId;
		updateAnchorState();
	}, [initialized, latestUserItemId, sessionId, updateAnchorState]);

	const scheduleMaintainScrollPosition = useCallback(() => {
		if (typeof window === 'undefined') return;
		if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
		frameRef.current = window.requestAnimationFrame(() => {
			frameRef.current = null;
			maintainScrollPosition();
		});
	}, [maintainScrollPosition]);

	const handleScroll = useCallback(() => {
		if (typeof window === 'undefined' || scrollFrameRef.current !== null) return;
		scrollFrameRef.current = window.requestAnimationFrame(() => {
			scrollFrameRef.current = null;
			updateAnchorState();
		});
	}, [updateAnchorState]);

	useEffect(() => {
		restoredSessionRef.current = null;
		anchorRef.current = null;
		pendingPrependPositionRef.current = null;
		pinnedToBottomRef.current = true;
		latestUserItemIdRef.current = null;

		return () => {
			saveMemory();
		};
	}, [saveMemory]);

	useEffect(() => {
		if (!loadingOlder) olderLoadRequestedRef.current = false;
	}, [loadingOlder]);

	useLayoutEffect(() => {
		void itemSignature;
		void loadingOlder;
		scheduleMaintainScrollPosition();
	}, [itemSignature, loadingOlder, scheduleMaintainScrollPosition]);

	useEffect(() => {
		void itemSignature;
		const content = contentRef.current;
		if (!content || typeof ResizeObserver === 'undefined') return;

		const observer = new ResizeObserver(() => scheduleMaintainScrollPosition());
		observer.observe(content);

		return () => observer.disconnect();
	}, [itemSignature, scheduleMaintainScrollPosition]);

	useEffect(() => {
		return () => {
			if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
			if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
		};
	}, []);

	return {
		scrollRef,
		contentRef,
		handleScroll,
		loadOlder,
	};
}
