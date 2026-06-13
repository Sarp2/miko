import type { TranscriptItem } from '../lib/group-transcript-turns';
import { UserPrompt } from './messages';
import { RunningTimer } from './transcript-running-timer';
import { TranscriptTurnView } from './transcript-turn';

export function TranscriptActivityIndicator() {
	return (
		<div className="mb-5">
			<RunningTimer />
		</div>
	);
}

/**
 * TranscriptItemView owns transcript layout: column alignment, row spacing, and
 * the chrome for each item kind. Message components render content only.
 */
export function TranscriptItemView({
	item,
	sessionId,
	workspaceId,
	workspaceRoot,
}: {
	item: TranscriptItem;
	sessionId: string;
	workspaceId: string;
	workspaceRoot: string;
}) {
	if (item.type === 'user') {
		return (
			<div data-transcript-item-id={item.id} className="mb-5 flex justify-end">
				<div className="inline-flex max-w-[80%] flex-col rounded-lg border border-hairline bg-surface-1 px-[15px] py-[11px]">
					<UserPrompt content={item.message.content} attachments={item.message.attachments} />
				</div>
			</div>
		);
	}

	return (
		<div data-transcript-item-id={item.id} className="mb-5">
			<TranscriptTurnView
				turn={item.turn}
				sessionId={sessionId}
				workspaceId={workspaceId}
				workspaceRoot={workspaceRoot}
			/>
		</div>
	);
}
