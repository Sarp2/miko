/** Formats a millisecond duration as a compact elapsed string (e.g. `8.4s`, `1m, 5.0s`). */
export function formatElapsed(ms: number): string {
	const totalSeconds = Math.round(Math.max(0, ms / 1000) * 10) / 10;
	if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m, ${seconds.toFixed(1)}s`;
}
