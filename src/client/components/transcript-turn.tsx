import { CaretRight, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import type { TranscriptTurn } from '../lib/group-transcript-turns';
import { distinctToolKinds, summarizeTurn } from '../lib/turn-summary';
import { AssistantText } from './messages/assistant-text';
import { ToolKindIcon, ToolLine } from './messages/tool-line';
import { RunningTimer } from './transcript-running-timer';
import { TurnFooter } from './transcript-turn-footer';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

function ActivityList({ activity }: { activity: TranscriptTurn['activity'] }) {
	return (
		<>
			{activity.map((item) => {
				if (item.kind === 'tool') return <ToolLine key={item.id} tool={item} />;
				if (item.kind === 'assistant_text')
					return <AssistantText key={item.id} text={item.text} mode="markdown" className="py-1" />;
				return null;
			})}
		</>
	);
}

function TurnActivity({ turn }: { turn: TranscriptTurn }) {
	const [open, setOpen] = useState(false);

	// While a turn is running, tool calls stream inline; once complete they
	// collapse behind a summary.
	if (!turn.isComplete) {
		return (
			<div className="flex flex-col">
				<ActivityList activity={turn.activity} />
			</div>
		);
	}

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger className="group flex items-center gap-2 text-body-sm text-ink-subtle transition-colors hover:text-ink-muted">
				<CaretRight
					className="size-3.5 shrink-0 text-ink-tertiary transition-transform group-data-[state=open]:rotate-90"
					weight="bold"
				/>
				<span>{summarizeTurn(turn.toolCount, turn.messageCount)}</span>
				<span className="flex items-center gap-1 text-ink-tertiary">
					{distinctToolKinds(turn.tools).map((kind) => (
						<ToolKindIcon key={kind} kind={kind} className="size-3.5" />
					))}
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent className="mt-1.5 ml-[7px] flex flex-col border-l border-hairline pl-3">
				<ActivityList activity={turn.activity} />
			</CollapsibleContent>
		</Collapsible>
	);
}

export function TranscriptTurnView({
	turn,
	workspaceRoot,
}: {
	turn: TranscriptTurn;
	workspaceRoot: string;
}) {
	const start = Date.parse(turn.startTimestamp);

	return (
		<div className="flex flex-col gap-2">
			{turn.activity.length > 0 ? <TurnActivity turn={turn} /> : null}

			{turn.finalText ? <AssistantText text={turn.finalText.text} mode="markdown" /> : null}

			{turn.errorText ? (
				<div className="flex items-start gap-2 rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-body-sm text-ink-muted">
					<WarningCircle className="mt-0.5 size-4 shrink-0 text-ink-subtle" weight="fill" />
					<span className="whitespace-pre-wrap break-words">{turn.errorText}</span>
				</div>
			) : null}

			{turn.isComplete ? (
				<TurnFooter turn={turn} durationMs={turn.durationMs} workspaceRoot={workspaceRoot} />
			) : (
				<RunningTimer startMs={Number.isNaN(start) ? undefined : start} />
			)}
		</div>
	);
}
