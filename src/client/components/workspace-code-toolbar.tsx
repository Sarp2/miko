import {
	ArrowCounterClockwise,
	Check,
	Copy,
	FileCode,
	GitDiff,
	Rows,
	SidebarSimple,
} from '@phosphor-icons/react';
import { type ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import type { DiffViewMode } from '../stores/ui-store';
import { FileNameIcon } from './icons/file-name-icon';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

interface ToolbarIconButtonProps {
	active?: boolean;
	ariaLabel: string;
	disabled?: boolean;
	onClick?: () => void;
	tooltip: string;
	children: ReactNode;
}

function ToolbarIconButton({
	active = false,
	ariaLabel,
	disabled = false,
	onClick,
	tooltip,
	children,
}: ToolbarIconButtonProps) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label={ariaLabel}
					aria-pressed={active || undefined}
					disabled={disabled}
					onClick={onClick}
					className={cn(
						'inline-flex size-7 items-center justify-center rounded-md border border-transparent text-ink-subtle transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-45',
						active && 'border-hairline bg-surface-2 text-ink',
					)}
				>
					{children}
				</button>
			</TooltipTrigger>
			<TooltipContent>{tooltip}</TooltipContent>
		</Tooltip>
	);
}

function ToolbarGroup({ children }: { children: ReactNode }) {
	return (
		<div className="inline-flex items-center gap-0.5 rounded-md border border-transparent bg-surface-1 p-0.5">
			{children}
		</div>
	);
}

function ToolbarSegment({
	active,
	children,
	onClick,
}: {
	active: boolean;
	children: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={cn(
				'h-7 rounded-md px-2 text-[12px] font-semibold text-ink-subtle transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
				active && 'bg-surface-2 text-ink',
			)}
		>
			{children}
		</button>
	);
}

export function WorkspaceCodeToolbar({ actions, path }: { actions?: ReactNode; path: string }) {
	return (
		<div className="flex min-w-0 items-center justify-between gap-2 border-b border-hairline px-3 py-1.5">
			<div className="flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] text-ink-subtle">
				<FileNameIcon name={path} className="size-3 shrink-0 text-ink-subtle" />
				<span className="truncate">{path}</span>
			</div>
			{actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
		</div>
	);
}

export function CopyFileButton({
	disabled,
	onCopy,
}: {
	disabled?: boolean;
	onCopy: () => Promise<void> | void;
}) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timeoutId = window.setTimeout(() => setCopied(false), 1200);
		return () => window.clearTimeout(timeoutId);
	}, [copied]);

	const copy = async () => {
		try {
			await onCopy();
			setCopied(true);
		} catch {
			setCopied(false);
		}
	};

	return (
		<ToolbarIconButton
			ariaLabel={copied ? 'Copied file content' : 'Copy file content'}
			disabled={disabled}
			onClick={() => void copy()}
			tooltip={copied ? 'Copied' : 'Copy file content'}
		>
			{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
		</ToolbarIconButton>
	);
}

export function ViewedDiffButton({
	disabled,
	viewed,
	onToggle,
}: {
	disabled?: boolean;
	viewed: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={viewed}
			disabled={disabled}
			onClick={onToggle}
			className="inline-flex h-7 items-center gap-1.5 rounded-md px-0.5 pr-1.5 text-[12px] font-medium text-ink-subtle transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-45"
		>
			<span
				className={cn(
					'inline-flex size-5 items-center justify-center rounded-md border border-hairline bg-transparent',
					viewed && 'bg-surface-2 text-ink',
				)}
			>
				{viewed ? <Check className="size-3" /> : null}
			</span>
			<span>Viewed</span>
		</button>
	);
}

export function DiffRefreshButton({ onClick }: { onClick: () => void }) {
	return (
		<ToolbarIconButton ariaLabel="Refresh diff" onClick={onClick} tooltip="Refresh diff">
			<ArrowCounterClockwise className="size-3.5" />
		</ToolbarIconButton>
	);
}

export function DiffViewModeToggle({
	mode,
	onChange,
}: {
	mode: DiffViewMode;
	onChange: (mode: DiffViewMode) => void;
}) {
	return (
		<ToolbarGroup>
			<ToolbarIconButton
				active={mode === 'unified'}
				ariaLabel="Unified diff view"
				onClick={() => onChange('unified')}
				tooltip="Unified view"
			>
				<Rows className="size-3.5" />
			</ToolbarIconButton>
			<ToolbarIconButton
				active={mode === 'split'}
				ariaLabel="Split diff view"
				onClick={() => onChange('split')}
				tooltip="Split view"
			>
				<SidebarSimple className="size-3.5" />
			</ToolbarIconButton>
		</ToolbarGroup>
	);
}

export function DiffFileSegmentedControl({
	filePath,
	mode,
	sourceSessionId,
	workspaceId,
}: {
	filePath: string;
	mode: 'diff' | 'file';
	sourceSessionId?: string;
	workspaceId: string;
}) {
	const navigate = useNavigate();
	const open = (nextMode: 'diff' | 'file') => {
		const params = new URLSearchParams({ path: filePath });
		if (sourceSessionId) params.set('sessionId', sourceSessionId);
		navigate(`/workspaces/${encodeURIComponent(workspaceId)}/${nextMode}?${params.toString()}`);
	};

	return (
		<div className="inline-flex items-center gap-0.5 rounded-md border border-transparent bg-surface-1 p-0.5">
			<ToolbarSegment active={mode === 'diff'} onClick={() => open('diff')}>
				<span className="inline-flex items-center gap-1.5">
					<GitDiff className="size-3" />
					Diff
				</span>
			</ToolbarSegment>
			<ToolbarSegment active={mode === 'file'} onClick={() => open('file')}>
				<span className="inline-flex items-center gap-1.5">
					<FileCode className="size-3" />
					File
				</span>
			</ToolbarSegment>
		</div>
	);
}
