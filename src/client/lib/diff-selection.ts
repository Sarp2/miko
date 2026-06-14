import type { SelectedLineRange } from '@pierre/diffs';

export type DiffSelectionRoot = HTMLElement | ShadowRoot;

type DiffLineSide = NonNullable<SelectedLineRange['side']>;

interface DiffLinePoint {
	lineNumber: number;
	side?: DiffLineSide;
}

function containsSelectionNode(root: DiffSelectionRoot, node: Node | null) {
	return node ? root.contains(node) : false;
}

function elementFromNode(node: Node | null) {
	if (!node) return null;
	return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function closestDiffLineElement(node: Node | null) {
	return elementFromNode(node)?.closest<HTMLElement>('[data-line], [data-column-number]') ?? null;
}

function sideFromLineType(lineType: string | undefined): DiffLineSide | undefined {
	if (lineType?.includes('deletion')) return 'deletions';
	if (lineType?.includes('addition')) return 'additions';
	return undefined;
}

function parseDiffLineElement(element: HTMLElement): DiffLinePoint | null {
	const rawLineNumber = element.dataset.line ?? element.dataset.columnNumber;
	if (!rawLineNumber) return null;

	const lineNumber = Number(rawLineNumber);
	if (!Number.isFinite(lineNumber)) return null;

	return { lineNumber, side: sideFromLineType(element.dataset.lineType) };
}

function selectionForRoot(root: DiffSelectionRoot) {
	const shadowRoot =
		typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot
			? (root as ShadowRoot & { getSelection?: () => Selection | null })
			: null;

	return shadowRoot?.getSelection?.() ?? document.getSelection();
}

function rangeFromEndpoints(startPoint: DiffLinePoint, endPoint: DiffLinePoint): SelectedLineRange {
	const reversed = startPoint.lineNumber > endPoint.lineNumber;
	return {
		start: Math.min(startPoint.lineNumber, endPoint.lineNumber),
		end: Math.max(startPoint.lineNumber, endPoint.lineNumber),
		side: reversed ? endPoint.side : startPoint.side,
		endSide: reversed ? startPoint.side : endPoint.side,
	};
}

function rangeFromIntersectingLines(
	root: DiffSelectionRoot,
	range: Range,
): SelectedLineRange | null {
	const linePoints = Array.from(root.querySelectorAll<HTMLElement>('[data-line]'))
		.filter((element) => range.intersectsNode(element))
		.map(parseDiffLineElement)
		.filter((point): point is DiffLinePoint => point !== null);

	if (linePoints.length === 0) return null;

	const firstPoint = linePoints[0];
	const lastPoint = linePoints.at(-1) ?? firstPoint;
	return rangeFromEndpoints(firstPoint, lastPoint);
}

export function selectedRangeFromNativeSelection(
	root: DiffSelectionRoot,
): SelectedLineRange | null {
	const selection = selectionForRoot(root);
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
	if (
		!containsSelectionNode(root, selection.anchorNode) ||
		!containsSelectionNode(root, selection.focusNode)
	) {
		return null;
	}

	const startElement = closestDiffLineElement(selection.anchorNode);
	const endElement = closestDiffLineElement(selection.focusNode);
	const startPoint = startElement ? parseDiffLineElement(startElement) : null;
	const endPoint = endElement ? parseDiffLineElement(endElement) : null;

	if (startPoint && endPoint) return rangeFromEndpoints(startPoint, endPoint);

	return rangeFromIntersectingLines(root, selection.getRangeAt(0));
}
