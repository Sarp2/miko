import type { ChatAttachment, PromptPart } from '../../shared/types';
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
	onOpenFile,
	onOpenPastedText,
	onOpenAttachment,
}: {
	item: TranscriptItem;
	sessionId: string;
	workspaceId: string;
	workspaceRoot: string;
	onOpenFile?: (path: string) => void;
	onOpenPastedText?: (part: Extract<PromptPart, { type: 'pasted_text' }>) => void;
	onOpenAttachment?: (attachment: ChatAttachment) => void;
}) {
	if (item.type === 'user') {
		return (
			<div data-transcript-item-id={item.id} className="mb-6 flex justify-end">
				<div className="max-w-[80%] border-r-2 border-hairline-tertiary pr-3.5 text-right">
					<UserPrompt
						content={item.message.content}
						attachments={item.message.attachments}
						parts={item.message.parts}
						onOpenFile={onOpenFile}
						onOpenPastedText={onOpenPastedText}
						onOpenAttachment={onOpenAttachment}
					/>
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
