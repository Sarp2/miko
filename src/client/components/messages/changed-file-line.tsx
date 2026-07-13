import { NotePencil, WarningCircle } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import type { HydratedTranscriptMessage } from '../../../shared/types';
import { Icons } from '../../lib/icons';
import { workspacePagePath } from '../../lib/middle-tabs';
import { toRelativePath } from '../../lib/relative-path';
import { turnChangedFiles } from '../../lib/turn-changed-files';
import { cn } from '../../lib/utils';
import { resolveChangedFileDiffOpenTarget } from '../../lib/workspace-file-open-target';
import { FileNameIcon } from '../icons/file-name-icon';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card';
import { ChangedFileDiff } from './changed-file-diff';

/** Transcript context needed to open a changed file's diff from a tool row. */
export type ChangedFileLineContext = {
	sessionId?: string;
	workspaceId?: string;
	workspaceRoot?: string;
	turnId?: string;
};

type ChangedFileMessage = Extract<
	HydratedTranscriptMessage,
	{ kind: 'tool'; toolKind: 'edit_file' | 'write_file' }
>;

function ChangedFileStatusIcon({ tool }: { tool: ChangedFileMessage }) {
	if (!tool.hasResult)
		return Icons.activeIcon({ ariaLabel: 'running', className: 'size-3.5 text-ink-subtle' });
	if (tool.isError) return <WarningCircle className="size-3.5 text-ink-subtle" weight="fill" />;
	return <NotePencil className="size-3.5 text-ink-subtle" weight="bold" />;
}

/**
 * ChangedFileLine renders an edit/write tool call as one compact row: a status
 * icon, the "Edit"/"Write" label, a file-name card, and approximate line
 * deltas. Hovering the card reveals the fragment diff and clicking it opens the
 * full file diff — mirroring ChangedFileChip. Counts and diff fragments come
 * from the tool input, not a real git diff.
 */
export function ChangedFileLine({
	tool,
	context,
	className,
}: {
	tool: ChangedFileMessage;
	context?: ChangedFileLineContext;
	className?: string;
}) {
	const navigate = useNavigate();
	const [file] = turnChangedFiles([tool]);
	const label = tool.toolKind === 'write_file' ? 'Write' : 'Edit';

	if (!file)
		return (
			<div className={cn('flex items-center gap-2 py-1 text-body-sm leading-5', className)}>
				<span className="shrink-0">
					<ChangedFileStatusIcon tool={tool} />
				</span>
				<span className="min-w-0 truncate text-ink-muted">{label}</span>
			</div>
		);

	const workspaceId = context?.workspaceId ?? '';
	const relativePath = toRelativePath(file.path, context?.workspaceRoot ?? '');
	const target = resolveChangedFileDiffOpenTarget({
		path: file.path,
		workspaceRoot: context?.workspaceRoot,
		sourceSessionId: context?.sessionId,
		turnId: context?.turnId,
	});
	const canOpenDiff = workspaceId.length > 0 && target.kind === 'page';

	const openDiff = () => {
		if (!canOpenDiff || target.kind !== 'page') return;
		navigate(workspacePagePath(workspaceId, target.page));
	};

	const card = (
		<button
			type="button"
			className={cn(
				'inline-flex min-w-0 appearance-none items-center gap-1.5 rounded-md border border-hairline bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-ink-muted focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-none',
				canOpenDiff ? 'cursor-pointer' : 'cursor-default',
			)}
			onClick={openDiff}
		>
			<FileNameIcon name={file.name} className="size-3.5 shrink-0" />
			<span className="min-w-0 truncate">{file.name}</span>
		</button>
	);

	return (
		<div className={cn('flex items-center gap-2 py-1 text-body-sm leading-5', className)}>
			<span className="shrink-0">
				<ChangedFileStatusIcon tool={tool} />
			</span>
			<span className="shrink-0 font-medium text-ink">{label}</span>
			{file.before || file.after ? (
				<HoverCard openDelay={150} closeDelay={100}>
					<HoverCardTrigger asChild>{card}</HoverCardTrigger>
					<HoverCardContent
						side="top"
						align="start"
						className="w-[560px] max-w-[90vw] overflow-hidden rounded-lg border-hairline bg-surface-1 p-0"
					>
						<ChangedFileDiff
							path={relativePath}
							name={file.name}
							before={file.before}
							after={file.after}
						/>
					</HoverCardContent>
				</HoverCard>
			) : (
				card
			)}
			{file.additions > 0 ? (
				<span className="shrink-0 font-mono text-[11px] tabular-nums text-success">
					+{file.additions}
				</span>
			) : null}
			{file.deletions > 0 ? (
				<span className="shrink-0 font-mono text-[11px] tabular-nums text-destructive">
					-{file.deletions}
				</span>
			) : null}
		</div>
	);
}
