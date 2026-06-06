import {
	CheckCircle,
	CircleNotch,
	MagnifyingGlass,
	TerminalWindow,
	User,
	WarningCircle,
	Wrench,
} from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import { FileContentView } from './file-content-view';
import { ToolEventRow } from './tool-event-card';

export interface ToolCallData {
	toolKind: string;
	toolName: string;
	toolId: string;
	input: unknown;
	result?: unknown;
	isError?: boolean;
}

export interface ToolCallProps {
	tool: ToolCallData;
	isLoading?: boolean;
	className?: string;
}

interface ReadImageBlock {
	type: 'image';
	data: string;
	mimeType?: string;
}

function getStringRecord(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const entries = Object.entries(value as Record<string, unknown>).map(([key, current]) => {
		if (typeof current === 'string') return [key, current];
		if (typeof current === 'number' || typeof current === 'boolean') return [key, String(current)];
		return [key, ''];
	});
	return Object.fromEntries(entries.filter(([, current]) => current !== ''));
}

function getSummary(tool: ToolCallData): string {
	const input = getStringRecord(tool.input);

	switch (tool.toolKind) {
		case 'bash':
			return input.command || input.cmd || 'Command';
		case 'read_file':
			return input.filePath || 'File';
		case 'grep':
			return input.pattern || 'Pattern';
		case 'glob':
			return input.pattern || 'Pattern';
		default:
			return tool.toolKind;
	}
}

function truncateMiddle(value: string, max = 88): string {
	if (value.length <= max) return value;
	if (max <= 3) return '.'.repeat(Math.max(0, max));

	const keep = max - 3;
	const startLength = Math.ceil(keep / 2);
	const endLength = Math.floor(keep / 2);
	return `${value.slice(0, startLength)}...${value.slice(-endLength)}`;
}

function formatResultPreview(result: unknown): string {
	if (typeof result === 'string') return result;
	if (typeof result === 'number' || typeof result === 'boolean') return String(result);
	if (result == null) return 'Empty result';
	if (Array.isArray(result)) return `Array(${result.length})`;
	if (typeof result === 'object') {
		const keys = Object.keys(result as Record<string, unknown>);
		return keys.length === 0 ? 'Object' : `Object(${keys.slice(0, 3).join(', ')})`;
	}
	return 'Result';
}

function formatResultDetail(result: unknown): string {
	if (typeof result === 'string') return result;
	if (typeof result === 'number' || typeof result === 'boolean') return String(result);
	if (result == null) return '';
	try {
		return JSON.stringify(result, null, 2);
	} catch {
		return String(result);
	}
}

function formatToolInput(input: unknown): string {
	if (typeof input === 'string') return input;
	try {
		return JSON.stringify(input, null, 2);
	} catch {
		return String(input);
	}
}

function getObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function extractReadFileText(result: unknown): string {
	if (typeof result === 'string') return result;
	const record = getObject(result);
	if (!record) return '';

	if (typeof record.content === 'string') return record.content;
	if (Array.isArray(record.content)) {
		const textBlocks = record.content
			.map((block) => {
				const b = getObject(block);
				if (!b) return '';
				if (b.type === 'text' && typeof b.text === 'string') return b.text;
				return '';
			})
			.filter(Boolean);
		return textBlocks.join('\n\n');
	}
	return '';
}

function extractReadImageBlocks(result: unknown): ReadImageBlock[] {
	const sourceRecord = getObject(result);
	const blocks =
		sourceRecord && Array.isArray(sourceRecord.blocks)
			? sourceRecord.blocks
			: sourceRecord && Array.isArray(sourceRecord.content)
				? sourceRecord.content
				: [];

	return blocks.flatMap((block) => {
		const b = getObject(block);
		if (!b) return [];

		if (b.type === 'image' && typeof b.data === 'string') {
			return [
				{
					type: 'image' as const,
					data: b.data,
					mimeType: typeof b.mimeType === 'string' ? b.mimeType : undefined,
				},
			];
		}

		const source = getObject(b.source);
		if (
			b.type === 'image' &&
			source &&
			source.type === 'base64' &&
			typeof source.data === 'string'
		) {
			return [
				{
					type: 'image' as const,
					data: source.data,
					mimeType: typeof source.media_type === 'string' ? source.media_type : undefined,
				},
			];
		}

		return [];
	});
}

function renderDefaultOutput(result: unknown, isError?: boolean) {
	const detail = formatResultDetail(result);
	return (
		<div className="space-y-2">
			<span className="text-ink-subtle">{isError ? 'Error Output' : 'Result Output'}</span>
			<pre className="mt-1 max-h-[240px] overflow-x-auto rounded-md border border-hairline bg-surface-2 p-2.5 font-mono text-caption leading-relaxed text-ink-muted">
				{detail || '(empty)'}
			</pre>
		</div>
	);
}

function renderEditFileOutput(input: unknown) {
	const record = getObject(input);
	const oldString = typeof record?.oldString === 'string' ? record.oldString : '';
	const newString = typeof record?.newString === 'string' ? record.newString : '';

	return (
		<div className="space-y-2">
			<span className="text-ink-subtle">Edit Diff</span>
			<FileContentView
				content=""
				isDiff
				oldString={oldString}
				newString={newString}
				className="bg-surface-1"
			/>
		</div>
	);
}

function renderReadFileOutput(result: unknown) {
	const text = extractReadFileText(result);
	const images = extractReadImageBlocks(result);
	const fallback = !text && images.length === 0 ? formatResultDetail(result) || '(empty)' : '';

	return (
		<div className="space-y-3">
			{text || fallback ? (
				<div className="space-y-2">
					<span className="text-ink-subtle">Read Output</span>
					<FileContentView content={text || fallback} />
				</div>
			) : null}

			{images.length > 0 ? (
				<div className="space-y-2">
					<span className="text-ink-subtle">Read Images</span>
					<div className="space-y-2">
						{images.map((image) => {
							const mimeType = image.mimeType || 'image/png';
							return (
								<div
									key={`${mimeType}:${image.data}`}
									className="overflow-hidden rounded-md border border-hairline bg-surface-2"
								>
									<img
										src={`data:${mimeType};base64,${image.data}`}
										alt="Read result"
										className="max-h-[50vh] w-full object-contain bg-canvas"
									/>
								</div>
							);
						})}
					</div>
				</div>
			) : null}
		</div>
	);
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

function getDisplayName(tool: ToolCallData): string {
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
		case 'subagent_task':
			return input.subagentType || 'Run subagent task';
		default:
			return toTitleCase(tool.toolName || tool.toolKind);
	}
}

function getToolIcon(tool: ToolCallData) {
	if (tool.isError) return <WarningCircle className="size-3 text-ink-subtle" weight="fill" />;
	if (tool.result !== undefined)
		return <CheckCircle className="size-3 text-success" weight="fill" />;

	switch (tool.toolKind) {
		case 'bash':
			return <TerminalWindow className="size-3" weight="bold" />;
		case 'grep':
		case 'glob':
		case 'web_search':
			return <MagnifyingGlass className="size-3" weight="bold" />;
		case 'subagent_task':
			return <User className="size-3" weight="bold" />;
		default:
			return <Wrench className="size-3" weight="bold" />;
	}
}

/**
 * ToolCall renders a transcript row for an outbound tool invocation.
 * Shows a compact summary with expandable payload details.
 */
export function ToolCall({ tool, isLoading = false, className }: ToolCallProps) {
	const hasResult = tool.result !== undefined;
	const summary = hasResult
		? truncateMiddle(formatResultPreview(tool.result), 64)
		: truncateMiddle(getSummary(tool), 64);
	const title = truncateMiddle(getDisplayName(tool), 72);
	const resolvedIcon = isLoading ? (
		<CircleNotch className="size-3 animate-spin" weight="bold" />
	) : (
		getToolIcon(tool)
	);
	const inputDetail = formatToolInput(tool.input);

	return (
		<ToolEventRow className={cn(className)} icon={resolvedIcon} title={title} subtitle={summary}>
			<div className="space-y-3 text-xs text-ink-muted rounded-md border border-hairline bg-surface-2 p-3 max-w-xl">
				<div className="flex items-center justify-between gap-3">
					<span className="text-ink-subtle">Tool Kind</span>
					<span className="max-w-80 truncate font-mono text-ink" title={tool.toolKind}>
						{tool.toolKind}
					</span>
				</div>
				<div className="flex items-center justify-between gap-3">
					<span className="text-ink-subtle">Tool ID</span>
					<span className="max-w-80 truncate font-mono text-ink" title={tool.toolId}>
						{tool.toolId}
					</span>
				</div>
				<div className="space-y-2">
					<span className="text-ink-subtle">Input</span>
					<pre className="max-h-[240px] overflow-x-auto rounded-md border border-hairline bg-surface-1 p-2.5 font-mono text-caption leading-relaxed text-ink-muted">
						{inputDetail || '(empty)'}
					</pre>
				</div>
				{hasResult &&
					(tool.toolKind === 'edit_file' && !tool.isError
						? renderEditFileOutput(tool.input)
						: tool.toolKind === 'read_file' && !tool.isError
							? renderReadFileOutput(tool.result)
							: renderDefaultOutput(tool.result, tool.isError))}
			</div>
		</ToolEventRow>
	);
}
