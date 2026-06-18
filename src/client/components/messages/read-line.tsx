import { FileText, WarningCircle } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import type { HydratedTranscriptMessage } from '../../../shared/types';
import { Icons } from '../../lib/icons';
import { workspacePagePath } from '../../lib/middle-tabs';
import { basename } from '../../lib/relative-path';
import { cn } from '../../lib/utils';
import { resolveTranscriptReadFileOpenTarget } from '../../lib/workspace-file-open-target';
import { FileNameIcon } from '../icons/file-name-icon';
import type { ChangedFileLineContext } from './changed-file-line';

type ReadMessage = Extract<HydratedTranscriptMessage, { kind: 'tool'; toolKind: 'read_file' }>;

function ReadStatusIcon({ tool }: { tool: ReadMessage }) {
	if (!tool.hasResult)
		return Icons.activeIcon({ ariaLabel: 'running', className: 'size-3.5 text-ink-subtle' });
	if (tool.isError) return <WarningCircle className="size-3.5 text-ink-subtle" weight="fill" />;
	return <FileText className="size-3.5 text-ink-subtle" weight="bold" />;
}

/** Number of lines in the read result, or 0 if no readable content is present. */
export function readLineCount(tool: ReadMessage): number {
	const result = tool.result;
	const content = typeof result === 'string' ? result : (result?.content ?? '');
	if (!content) return 0;
	return content.replace(/\n+$/, '').split('\n').length;
}

/**
 * ReadLine renders a read_file tool call as one compact row: a status icon, the
 * "Read N lines" label, and a file-name card. Clicking the card opens the file
 * in the workspace file viewer — mirroring ChangedFileLine, minus the hover
 * diff since a read makes no changes.
 */
export function ReadLine({
	tool,
	context,
	className,
}: {
	tool: ReadMessage;
	context?: ChangedFileLineContext;
	className?: string;
}) {
	const navigate = useNavigate();
	const filePath = tool.input.filePath ?? '';
	const name = basename(filePath);
	const lineCount = readLineCount(tool);

	const label = (
		<span className="shrink-0 text-ink-muted">
			<span className="font-medium text-ink">Read</span>
			{lineCount > 0 ? ` ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}` : ''}
		</span>
	);

	if (!name)
		return (
			<div className={cn('flex items-center gap-2 py-1 text-body-sm leading-5', className)}>
				<span className="shrink-0">
					<ReadStatusIcon tool={tool} />
				</span>
				{label}
			</div>
		);

	const workspaceId = context?.workspaceId ?? '';
	const target = resolveTranscriptReadFileOpenTarget({
		path: filePath,
		workspaceRoot: context?.workspaceRoot,
		sourceSessionId: context?.sessionId,
	});
	const canOpenFile = workspaceId.length > 0 && target.kind !== 'unavailable';

	const openFile = () => {
		if (!canOpenFile) return;
		if (target.kind === 'page') navigate(workspacePagePath(workspaceId, target.page));
	};

	return (
		<div className={cn('flex items-center gap-2 py-1 text-body-sm leading-5', className)}>
			<span className="shrink-0">
				<ReadStatusIcon tool={tool} />
			</span>
			{label}
			<button
				type="button"
				className={cn(
					'inline-flex min-w-0 items-center gap-1 appearance-none rounded-md border border-hairline bg-transparent px-1.5 py-0.5 font-[inherit] text-[11px] text-ink-muted focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-none',
					canOpenFile ? 'cursor-pointer' : 'cursor-default',
				)}
				onClick={openFile}
			>
				<FileNameIcon name={name} className="size-3 shrink-0" />
				<span className="truncate">{name}</span>
			</button>
		</div>
	);
}
