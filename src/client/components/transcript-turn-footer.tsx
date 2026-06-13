import { Copy, DotsThree } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { formatElapsed } from '../lib/format-duration';
import type { TranscriptTurn } from '../lib/group-transcript-turns';
import { turnChangedFiles } from '../lib/turn-changed-files';
import { ChangedFileChip } from './changed-file-chip';
import { TurnMetaContent } from './transcript-turn-meta';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

const MAX_VISIBLE_FILES = 4;

/** Footer for a completed turn: duration (with meta on hover), actions, changed files. */
export function TurnFooter({
	turn,
	durationMs,
	sessionId,
	workspaceId,
	workspaceRoot,
}: {
	turn: TranscriptTurn;
	durationMs: number | null;
	sessionId: string;
	workspaceId: string;
	workspaceRoot: string;
}) {
	const files = useMemo(() => turnChangedFiles(turn.tools), [turn.tools]);
	const visible = files.slice(0, MAX_VISIBLE_FILES);
	const overflow = files.slice(MAX_VISIBLE_FILES);
	const overflowAdditions = overflow.reduce((sum, file) => sum + file.additions, 0);
	const overflowDeletions = overflow.reduce((sum, file) => sum + file.deletions, 0);

	const copyMessage = () => {
		if (turn.finalText) void navigator.clipboard?.writeText(turn.finalText.text);
	};
	const hasMeta =
		Boolean(turn.model) || turn.usage !== null || !Number.isNaN(Date.parse(turn.startTimestamp));

	return (
		<div className="flex flex-wrap items-center gap-2 text-caption text-ink-tertiary">
			{durationMs !== null ? (
				hasMeta ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="cursor-default tabular-nums">{formatElapsed(durationMs)}</span>
						</TooltipTrigger>
						<TooltipContent side="top" align="start" className="w-64 p-3">
							<TurnMetaContent turn={turn} />
						</TooltipContent>
					</Tooltip>
				) : (
					<span className="tabular-nums">{formatElapsed(durationMs)}</span>
				)
			) : null}

			{turn.finalText ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={copyMessage}
							className="rounded p-0.5 text-ink-tertiary transition-colors hover:text-ink-muted"
							aria-label="Copy final message"
						>
							<Copy className="size-3.5" />
						</button>
					</TooltipTrigger>
					<TooltipContent>Copy final message</TooltipContent>
				</Tooltip>
			) : null}

			<DropdownMenu modal={false}>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger
							className="rounded p-0.5 text-ink-tertiary transition-colors hover:text-ink-muted"
							aria-label="More actions"
						>
							<DotsThree className="size-4" weight="bold" />
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent>More actions</TooltipContent>
				</Tooltip>
				<DropdownMenuContent className="w-44 rounded-[10px] border-hairline bg-surface-1 p-1 shadow-none">
					{/* TODO: Wire this to fork the turn into a new tab. */}
					<DropdownMenuItem className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] font-medium text-ink focus:bg-surface-2 focus:text-ink">
						Fork to new tab
					</DropdownMenuItem>
					{/* TODO: Wire this to fork the turn into a new workspace. */}
					<DropdownMenuItem className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] font-medium text-ink focus:bg-surface-2 focus:text-ink">
						Fork to new workspace
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{visible.map((file) => (
				<ChangedFileChip
					key={file.path}
					file={file}
					sourceSessionId={sessionId}
					workspaceId={workspaceId}
					workspaceRoot={workspaceRoot}
				/>
			))}
			{overflow.length > 0 ? (
				<ChangedFileChip
					file={{
						path: '__overflow',
						name: `+${overflow.length} more`,
						additions: overflowAdditions,
						deletions: overflowDeletions,
						before: '',
						after: '',
					}}
					workspaceRoot={workspaceRoot}
				/>
			) : null}
		</div>
	);
}
