import { Check, Copy } from '@phosphor-icons/react';
import { File as DiffsFile, type FileContents, MultiFileDiff } from '@pierre/diffs/react';
import * as React from 'react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

export interface FileContentViewProps {
	content: string;
	isDiff?: boolean;
	oldString?: string;
	newString?: string;
	title?: string;
	fileName?: string;
	diffStyle?: 'split' | 'unified';
	showCopy?: boolean;
	className?: string;
}

function stripLineNumberPrefix(text: string): string {
	return text
		.split('\n')
		.map((line) => line.replace(/^\s*\d+→/, ''))
		.join('\n');
}

/**
 * FileContentView renders plain code files and diffs via @pierre/diffs/react.
 * Keeps a compact wrapper API for transcript/tool views.
 */
export function FileContentView({
	content,
	isDiff = false,
	oldString,
	newString,
	title,
	fileName,
	diffStyle = 'unified',
	showCopy = false,
	className,
}: FileContentViewProps) {
	const [copied, setCopied] = React.useState(false);
	const renderDiff = isDiff && oldString !== undefined && newString !== undefined;
	const resolvedFileName = fileName || title || 'untitled.txt';

	const normalizedContent = React.useMemo(() => stripLineNumberPrefix(content), [content]);

	const oldFile = React.useMemo<FileContents>(
		() => ({
			name: resolvedFileName,
			contents: oldString ?? '',
		}),
		[oldString, resolvedFileName],
	);

	const newFile = React.useMemo<FileContents>(
		() => ({
			name: resolvedFileName,
			contents: newString ?? '',
		}),
		[newString, resolvedFileName],
	);

	const file = React.useMemo<FileContents>(
		() => ({
			name: resolvedFileName,
			contents: normalizedContent,
		}),
		[normalizedContent, resolvedFileName],
	);

	const copyText = React.useMemo(
		() => (renderDiff ? `${oldFile.contents}\n\n${newFile.contents}` : file.contents),
		[file.contents, newFile.contents, oldFile.contents, renderDiff],
	);

	const handleCopy = React.useCallback(async () => {
		try {
			await navigator.clipboard.writeText(copyText);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1800);
		} catch {
			setCopied(false);
		}
	}, [copyText]);

	const showHeader = Boolean(title) || showCopy;

	return (
		<div
			className={cn(
				'my-1 overflow-hidden rounded-lg border border-hairline bg-surface-1',
				className,
			)}
		>
			{showHeader ? (
				<div className="flex items-center justify-between gap-2 border-b border-hairline bg-surface-2 px-3 py-1.5">
					<span className="text-caption font-medium text-ink-subtle">
						{title || (renderDiff ? 'Diff' : 'Content')}
					</span>
					{showCopy ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={handleCopy}
							className="h-6 w-6 rounded-sm p-0 text-ink-tertiary hover:bg-surface-3 hover:text-ink-subtle"
							aria-label="Copy content"
						>
							{copied ? (
								<Check className="size-3.5 text-success" weight="bold" />
							) : (
								<Copy className="size-3.5" weight="regular" />
							)}
						</Button>
					) : null}
				</div>
			) : null}
			<div className="max-h-64 overflow-auto md:max-h-[50vh]">
				{renderDiff ? (
					<MultiFileDiff
						oldFile={oldFile}
						newFile={newFile}
						options={{
							theme: { dark: 'pierre-dark', light: 'pierre-light' },
							diffStyle,
							hunkSeparators: 'line-info-basic',
							overflow: 'scroll',
							disableFileHeader: true,
						}}
						className="text-caption"
					/>
				) : (
					<DiffsFile
						file={file}
						options={{
							theme: { dark: 'pierre-dark', light: 'pierre-light' },
							overflow: 'scroll',
							disableFileHeader: true,
						}}
						className="text-caption"
					/>
				)}
			</div>
		</div>
	);
}
