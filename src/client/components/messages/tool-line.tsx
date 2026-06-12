import {
	CircleNotch,
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
import { cn } from '../../lib/utils';

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

/** Intent-level, human-readable label for a tool call (no raw payload). */
export function toolLabel(tool: ToolMessage): string {
	const input = getStringRecord(tool.input);

	switch (tool.toolKind) {
		case 'glob':
			return input.pattern === '**/*'
				? 'Search files in all directories'
				: `Search files matching ${input.pattern || 'pattern'}`;
		case 'grep':
			return input.pattern ? `Find ${input.pattern} in files` : 'Find in files';
		case 'bash':
			return input.description || 'Run terminal command';
		case 'read_file':
			return input.filePath ? `Read ${input.filePath}` : 'Read file';
		case 'write_file':
			return input.filePath ? `Write ${input.filePath}` : 'Write file';
		case 'edit_file':
			return input.filePath ? `Edit ${input.filePath}` : 'Edit file';
		case 'delete_file':
			return input.filePath ? `Delete ${input.filePath}` : 'Delete file';
		case 'subagent_task':
			return input.subagentType || 'Run subagent task';
		default:
			return toTitleCase(tool.toolName || tool.toolKind);
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
		return <CircleNotch className="size-3.5 animate-spin text-ink-subtle" weight="bold" />;
	if (tool.isError) return <WarningCircle className="size-3.5 text-ink-subtle" weight="fill" />;
	return <ToolKindIcon kind={tool.toolKind} className="text-ink-subtle" />;
}

/**
 * ToolLine renders a single tool call as one compact, intent-level row.
 * Payload detail is intentionally omitted (opened elsewhere on demand).
 */
export function ToolLine({ tool, className }: { tool: ToolMessage; className?: string }) {
	return (
		<div className={cn('flex items-center gap-2 py-1 text-body-sm', className)}>
			<span className="shrink-0">
				<ToolStatusIcon tool={tool} />
			</span>
			<span className="min-w-0 truncate text-ink-muted">{toolLabel(tool)}</span>
		</div>
	);
}
