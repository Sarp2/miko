import { CaretRight, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import type { TranscriptTurn } from '../lib/group-transcript-turns';
import { distinctToolKinds, summarizeTurn } from '../lib/turn-summary';
import { AssistantText } from './messages/assistant-text';
import { ToolKindIcon, ToolLine, type ToolLineContext } from './messages/tool-line';
import { RunningTimer } from './transcript-running-timer';
import { TurnFooter } from './transcript-turn-footer';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

function ActivityList({
	activity,
	context,
}: {
	activity: TranscriptTurn['activity'];
	context: ToolLineContext;
}) {
	return (
		<>
			{activity.map((item, index) => {
				const previous = activity[index - 1];
				const boundaryClassName =
					previous &&
					((previous.kind === 'tool' && item.kind === 'assistant_text') ||
						(previous.kind === 'assistant_text' && item.kind === 'tool'))
						? 'mt-3'
						: undefined;

				if (item.kind === 'tool')
					return (
						<ToolLine key={item.id} tool={item} context={context} className={boundaryClassName} />
					);
				if (item.kind === 'assistant_text')
					return (
						<AssistantText
							key={item.id}
							text={item.text}
							mode="markdown"
							className={boundaryClassName}
						/>
					);
				return null;
			})}
		</>
	);
}

function TurnActivity({ turn, context }: { turn: TranscriptTurn; context: ToolLineContext }) {
	const [open, setOpen] = useState(false);

	// While a turn is running, tool calls stream inline; once complete they
	// collapse behind a summary.
	if (!turn.isComplete) {
		return (
			<div className="flex flex-col">
				<ActivityList activity={turn.activity} context={context} />
			</div>
		);
	}

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger className="group flex items-center gap-2 text-body-sm text-ink-subtle transition-colors hover:text-ink">
				<CaretRight
					className="size-3.5 shrink-0 text-ink-tertiary transition-transform group-hover:text-ink-subtle group-data-[state=open]:rotate-90"
					weight="bold"
				/>
				<span className="tabular-nums">{summarizeTurn(turn.toolCount, turn.messageCount)}</span>
				<span className="flex items-center gap-1 text-ink-tertiary">
					{distinctToolKinds(turn.tools).map((kind) => (
						<ToolKindIcon key={kind} kind={kind} className="size-3.5" />
					))}
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent className="mt-2.5 ml-[7px] flex flex-col border-l border-hairline pl-3">
				<ActivityList activity={turn.activity} context={context} />
			</CollapsibleContent>
		</Collapsible>
	);
}

export function TranscriptTurnView({
	turn,
	sessionId,
	workspaceId,
	workspaceRoot,
}: {
	turn: TranscriptTurn;
	sessionId: string;
	workspaceId: string;
	workspaceRoot: string;
}) {
	const start = Date.parse(turn.startTimestamp);
	const context: ToolLineContext = { sessionId, workspaceId, workspaceRoot, turnId: turn.id };

	return (
		<div className="flex flex-col gap-3.5">
			{turn.activity.length > 0 ? <TurnActivity turn={turn} context={context} /> : null}

			{turn.finalText ? <AssistantText text={turn.finalText.text} mode="markdown" /> : null}

			{turn.errorText ? (
				<div className="flex items-start gap-2 rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-body-sm text-ink-muted">
					<WarningCircle className="mt-0.5 size-4 shrink-0 text-ink-subtle" weight="fill" />
					<span className="whitespace-pre-wrap break-words">{turn.errorText}</span>
				</div>
			) : null}

			{turn.isComplete ? (
				<TurnFooter
					turn={turn}
					durationMs={turn.durationMs}
					sessionId={sessionId}
					workspaceId={workspaceId}
					workspaceRoot={workspaceRoot}
				/>
			) : (
				<RunningTimer startMs={Number.isNaN(start) ? undefined : start} />
			)}
		</div>
	);
}
