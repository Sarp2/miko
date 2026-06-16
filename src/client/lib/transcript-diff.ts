import { parseDiffFromFile } from '@pierre/diffs';
import type { TranscriptEntry } from '../../shared/types';
import { composeTranscriptWindow } from './compose-transcript-window';
import { groupTranscriptTurns } from './group-transcript-turns';
import { hydrateTranscriptMessages } from './hydrate-transcript-messages';
import { toRelativePath } from './relative-path';
import { type TurnChangedFile, turnChangedFiles } from './turn-changed-files';

export interface TranscriptDiffLookupInput {
	messages: TranscriptEntry[];
	path: string;
	turnId: string;
	workspaceRoot: string;
}

export function findTranscriptChangedFile({
	messages,
	path,
	turnId,
	workspaceRoot,
}: TranscriptDiffLookupInput): TurnChangedFile | null {
	const composedMessages = composeTranscriptWindow(hydrateTranscriptMessages(messages));
	const turnItem = groupTranscriptTurns(composedMessages).find(
		(item) => item.type === 'turn' && item.id === turnId,
	);
	if (!turnItem || turnItem.type !== 'turn') return null;

	return (
		turnChangedFiles(turnItem.turn.tools).find((file) => {
			const relativePath = toRelativePath(file.path, workspaceRoot);
			return relativePath === path || file.path === path;
		}) ?? null
	);
}

export function transcriptFileDiff(file: TurnChangedFile) {
	return parseDiffFromFile(
		{ name: file.name, contents: file.before },
		{ name: file.name, contents: file.after },
	);
}
