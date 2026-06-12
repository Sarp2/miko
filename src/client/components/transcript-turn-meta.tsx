import type { TranscriptTurn } from '../lib/group-transcript-turns';

function providerLabel(provider: TranscriptTurn['provider']): string | null {
	if (provider === 'claude') return 'Claude Code';
	if (provider === 'codex') return 'Codex';
	return null;
}

function formatDateTime(ms: number): string {
	return new Date(ms).toLocaleString('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	});
}

function formatCount(value: number): string {
	return value.toLocaleString('en-US');
}

function MetaRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-6">
			<span className="text-ink-subtle">{label}</span>
			<span className="tabular-nums text-ink">{value}</span>
		</div>
	);
}

/** Hover-card content for the footer timer: model, time range, and token usage. */
export function TurnMetaContent({ turn }: { turn: TranscriptTurn }) {
	const start = Date.parse(turn.startTimestamp);
	const hasStart = !Number.isNaN(start);
	const end = hasStart && turn.durationMs !== null ? start + turn.durationMs : null;
	const provider = providerLabel(turn.provider);
	const usage = turn.usage;
	const input = usage?.lastInputTokens ?? usage?.inputTokens;
	const output = usage?.lastOutputTokens ?? usage?.outputTokens;
	const cacheRead = usage?.lastCachedInputTokens ?? usage?.cachedInputTokens;
	const hasTokens = input !== undefined || output !== undefined || cacheRead !== undefined;

	return (
		<div className="flex flex-col gap-2">
			{turn.model ? (
				<div className="text-[12px] font-medium text-ink">
					{turn.model}
					{provider ? <span className="text-ink-subtle"> via {provider}</span> : null}
				</div>
			) : null}
			{hasStart ? (
				<div className="text-[11px] text-ink-subtle">
					{formatDateTime(start)}
					{end !== null ? ` → ${formatDateTime(end)}` : ''}
				</div>
			) : null}
			{hasTokens ? (
				<div className="flex flex-col gap-1 border-t border-hairline pt-2">
					{input !== undefined ? <MetaRow label="Input" value={formatCount(input)} /> : null}
					{output !== undefined ? <MetaRow label="Output" value={formatCount(output)} /> : null}
					{cacheRead !== undefined ? (
						<MetaRow label="Cache read" value={formatCount(cacheRead)} />
					) : null}
				</div>
			) : null}
		</div>
	);
}
