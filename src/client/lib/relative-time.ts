/** Compact relative time like `now`, `5m ago`, `3h ago`, `9d ago`; empty for no timestamp. */
export function formatRelativeTime(timestamp: number | undefined, now = Date.now()): string {
	if (!timestamp) return '';
	const diffMs = Math.max(0, now - timestamp);
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;

	if (diffMs < minute) return 'now';
	if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
	if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
	return `${Math.floor(diffMs / day)}d ago`;
}
