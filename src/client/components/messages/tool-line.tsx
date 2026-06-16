import {
	FileText,
	MagnifyingGlass,
	PencilSimple,
	TerminalWindow,
	Trash,
	User,
	WarningCircle,
	Wrench,
} from '@phosphor-icons/react';
import type { HydratedTranscriptMessage } from '../../../shared/types';
import { Icons } from '../../lib/icons';
import { cn } from '../../lib/utils';
import { BashLine } from './bash-line';
import { ChangedFileLine, type ChangedFileLineContext } from './changed-file-line';
import { ReadLine } from './read-line';

/** Transcript context threaded into tool rows that can open a file diff. */
export type ToolLineContext = ChangedFileLineContext;

type ToolMessage = Extract<HydratedTranscriptMessage, { kind: 'tool' }>;
type ToolKind = ToolMessage['toolKind'];

function getStringRecord(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const entries = Object.entries(value as Record<string, unknown>).map(([key, current]) => {
		if (typeof current === 'string') return [key, current];
		if (typeof current === 'number' || typeof current === 'boolean') return [key, String(current)];
		return [key, ''];
	});
	return Object.fromEntries(entries.filter(([, current]) => current !== ''));
}

function toTitleCase(value: string): string {
	return value
		.replace(/[_-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

/**
 * Intent-level label split into the weightier tool name and a muted detail
 * (no raw payload). Bash/edit/write are rendered by their own components.
 */
export function toolParts(tool: ToolMessage): { name: string; detail?: string } {
	const input = getStringRecord(tool.input);

	switch (tool.toolKind) {
		case 'glob':
			return {
				name: 'Search',
				detail: input.pattern === '**/*' ? 'all directories' : input.pattern || 'files',
			};
		case 'grep':
			return { name: 'Find', detail: input.pattern || 'in files' };
		case 'delete_file':
			return { name: 'Delete', detail: input.filePath || 'file' };
		case 'subagent_task':
			return { name: 'Task', detail: input.subagentType };
		default:
			return { name: toTitleCase(tool.toolName || tool.toolKind) };
	}
}

export function ToolKindIcon({ kind, className }: { kind: ToolKind; className?: string }) {
	const cls = cn('size-3.5', className);
	switch (kind) {
		case 'bash':
			return <TerminalWindow className={cls} weight="bold" />;
		case 'grep':
		case 'glob':
		case 'web_search':
			return <MagnifyingGlass className={cls} weight="bold" />;
		case 'read_file':
			return <FileText className={cls} weight="bold" />;
		case 'edit_file':
		case 'write_file':
			return <PencilSimple className={cls} weight="bold" />;
		case 'delete_file':
			return <Trash className={cls} weight="bold" />;
		case 'subagent_task':
			return <User className={cls} weight="bold" />;
		default:
			return <Wrench className={cls} weight="bold" />;
	}
}

function ToolStatusIcon({ tool }: { tool: ToolMessage }) {
	if (!tool.hasResult)
		return Icons.activeIcon({ ariaLabel: 'running', className: 'size-3.5 text-ink-subtle' });
	if (tool.isError) return <WarningCircle className="size-3.5 text-ink-subtle" weight="fill" />;
	return <ToolKindIcon kind={tool.toolKind} className="text-ink-subtle" />;
}

/**
 * ToolLine renders a single tool call as one compact, intent-level row.
 * Payload detail is intentionally omitted (opened elsewhere on demand).
 */
export function ToolLine({
	tool,
	context,
	className,
}: {
	tool: ToolMessage;
	context?: ToolLineContext;
	className?: string;
}) {
	if (tool.toolKind === 'bash') return <BashLine tool={tool} className={className} />;

	if (tool.toolKind === 'edit_file' || tool.toolKind === 'write_file')
		return <ChangedFileLine tool={tool} context={context} className={className} />;

	if (tool.toolKind === 'read_file')
		return <ReadLine tool={tool} context={context} className={className} />;

	const { name, detail } = toolParts(tool);

	return (
		<div className={cn('flex items-center gap-2 py-1 text-body-sm', className)}>
			<span className="shrink-0">
				<ToolStatusIcon tool={tool} />
			</span>
			<span className="shrink-0 font-medium text-ink">{name}</span>
			{detail ? <span className="min-w-0 truncate text-ink-muted">{detail}</span> : null}
		</div>
	);
}
