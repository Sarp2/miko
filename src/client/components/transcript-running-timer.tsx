import { useEffect, useRef, useState } from 'react';
import { formatElapsed } from '../lib/format-duration';
import { Icons } from '../lib/icons';

function useLiveElapsed(startMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 100);
		return () => window.clearInterval(id);
	}, []);
	return Math.max(0, now - startMs);
}

/** Live streaming indicator: animated mark + ticking elapsed time. */
export function RunningTimer({ startMs }: { startMs?: number }) {
const startRef = useRef(startMs !== undefined && !Number.isNaN(startMs) ? startMs : Date.now());
	const elapsed = useLiveElapsed(startRef.current);
	return (
		<span className="inline-flex items-center gap-1.5 text-caption text-ink-tertiary">
			{Icons.activeIcon({ className: 'size-3.5' })}
			<span className="tabular-nums">{formatElapsed(elapsed)}</span>
		</span>
	);
}
