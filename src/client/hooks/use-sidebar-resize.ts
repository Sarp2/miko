import * as React from 'react';

const DEFAULT_WIDTH = 292;
export const MIN_WIDTH = 256;
export const MAX_WIDTH = 420;
const CLOSE_THRESHOLD = 148;

export function useSidebarResize({
	collapsed,
	width,
	onCollapsedChange,
	onWidthChange,
}: {
	collapsed: boolean | undefined;
	width: number | undefined;
	onCollapsedChange?: (collapsed: boolean) => void;
	onWidthChange?: (width: number) => void;
}) {
	const rootRef = React.useRef<HTMLDivElement | null>(null);
	const isCollapsedControlled = collapsed !== undefined;
	const [internalCollapsed, setInternalCollapsed] = React.useState(false);
	const [internalWidth, setInternalWidth] = React.useState(width ?? DEFAULT_WIDTH);
	const [lastOpenWidth, setLastOpenWidth] = React.useState(width ?? DEFAULT_WIDTH);
	const [isResizing, setIsResizing] = React.useState(false);
	const resizeCleanupRef = React.useRef<(() => void) | null>(null);

	const isCollapsed = isCollapsedControlled ? collapsed : internalCollapsed;

	// Adopt an externally-controlled width while idle by adjusting state during render
	// (guarded by equality) instead of via an effect, so there is no extra commit.
	if (width !== undefined && !isResizing) {
		if (width !== internalWidth) setInternalWidth(width);
		if (width >= MIN_WIDTH && width !== lastOpenWidth) setLastOpenWidth(width);
	}

	// Update only the collapsed flag, with no width side-effect. The resize handler uses
	// this directly so a finished drag keeps the width it just committed.
	const applyCollapsed = React.useCallback(
		(next: boolean) => {
			if (!isCollapsedControlled) setInternalCollapsed(next);
			onCollapsedChange?.(next);
		},
		[isCollapsedControlled, onCollapsedChange],
	);

	const setCollapsed = React.useCallback(
		(next: boolean) => {
			applyCollapsed(next);
			if (!next) {
				const nextWidth = internalWidth < MIN_WIDTH ? lastOpenWidth : internalWidth;
				setInternalWidth(nextWidth);
				onWidthChange?.(nextWidth);
			}
		},
		[applyCollapsed, internalWidth, lastOpenWidth, onWidthChange],
	);

	React.useEffect(() => {
		return () => {
			resizeCleanupRef.current?.();
		};
	}, []);

	const onResizePointerDown = React.useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (isCollapsed || !rootRef.current) return;

			event.preventDefault();
			resizeCleanupRef.current?.();

			const left = rootRef.current.getBoundingClientRect().left;
			let nextWidth = internalWidth;
			let nextRawWidth = internalWidth;
			let didFinish = false;

			setIsResizing(true);
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';

			const cleanup = () => {
				document.removeEventListener('pointermove', onPointerMove);
				document.removeEventListener('pointerup', onPointerUp);
				document.removeEventListener('pointercancel', onPointerCancel);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				resizeCleanupRef.current = null;
				setIsResizing(false);
			};

			const finishResize = () => {
				if (didFinish) return;
				didFinish = true;
				cleanup();

				if (nextRawWidth <= CLOSE_THRESHOLD) {
					applyCollapsed(true);
					setInternalWidth(0);
					onWidthChange?.(0);
					return;
				}

				const clampedWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, nextWidth));
				setInternalWidth(clampedWidth);
				setLastOpenWidth(clampedWidth);
				onWidthChange?.(clampedWidth);
				applyCollapsed(false);
			};

			function onPointerMove(moveEvent: PointerEvent) {
				const rawWidth = moveEvent.clientX - left;
				nextRawWidth = rawWidth;
				nextWidth = Math.max(0, Math.min(MAX_WIDTH, rawWidth));
				setInternalWidth(nextWidth);
			}

			function onPointerUp() {
				finishResize();
			}

			function onPointerCancel() {
				finishResize();
			}

			resizeCleanupRef.current = cleanup;
			document.addEventListener('pointermove', onPointerMove);
			document.addEventListener('pointerup', onPointerUp);
			document.addEventListener('pointercancel', onPointerCancel);
		},
		[isCollapsed, applyCollapsed, internalWidth, onWidthChange],
	);

	const openWidth = isResizing
		? internalWidth
		: internalWidth < MIN_WIDTH
			? lastOpenWidth
			: internalWidth;

	return { rootRef, isCollapsed, isResizing, openWidth, setCollapsed, onResizePointerDown };
}
