import { toRelativePath } from '../lib/relative-path';
import type { TurnChangedFile } from '../lib/turn-changed-files';
import { FileNameIcon } from './icons/file-name-icon';
import { ChangedFileDiff } from './messages/changed-file-diff';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';

/**
 * A changed-file pill in the turn footer: file icon, name, and line deltas.
 * When edit fragments exist, hovering reveals the fragment diff.
 */
export function ChangedFileChip({
	file,
	workspaceRoot,
}: {
	file: TurnChangedFile;
	workspaceRoot: string;
}) {
	const chip = (
		<button
			type="button"
			className="inline-flex cursor-default appearance-none items-center gap-1 rounded-md border border-hairline bg-transparent px-1.5 py-0.5 text-[11px] font-[inherit] focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-none"
		>
			<FileNameIcon name={file.name} className="size-3" />
			<span className="max-w-40 truncate text-ink-muted">{file.name}</span>
			{file.additions > 0 ? (
				<span className="font-mono tabular-nums text-success">+{file.additions}</span>
			) : null}
			{file.deletions > 0 ? (
				<span className="font-mono tabular-nums text-destructive">-{file.deletions}</span>
			) : null}
		</button>
	);

	if (!file.before && !file.after) return chip;

	return (
		<HoverCard openDelay={150} closeDelay={100}>
			<HoverCardTrigger asChild>{chip}</HoverCardTrigger>
			<HoverCardContent
				side="top"
				align="start"
				className="w-[560px] max-w-[90vw] overflow-hidden rounded-lg border-hairline bg-surface-1 p-0"
			>
				<ChangedFileDiff
					path={toRelativePath(file.path, workspaceRoot)}
					name={file.name}
					before={file.before}
					after={file.after}
				/>
			</HoverCardContent>
		</HoverCard>
	);
}
