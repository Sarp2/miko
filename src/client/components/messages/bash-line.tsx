import { Terminal, WarningCircle } from '@phosphor-icons/react';
import type { HydratedTranscriptMessage } from '../../../shared/types';
import { Icons } from '../../lib/icons';
import { cn } from '../../lib/utils';

type BashMessage = Extract<HydratedTranscriptMessage, { kind: 'tool'; toolKind: 'bash' }>;

// Providers wrap commands in a shell invocation (`/bin/zsh -lc '…'`). That prefix
// is machine noise in the transcript: strip it for display and surface the inner
// command; the raw command stays available via the title tooltip.
const SHELL_WRAPPER_PATTERN =
	/^(?:\/(?:usr\/)?bin\/)?(?:zsh|bash|sh)\s+(?:-[a-z]+\s+)*(['"])([\s\S]+)\1$/;

export function displayBashCommand(command: string): string {
	const match = SHELL_WRAPPER_PATTERN.exec(command.trim());
	return match ? match[2] : command.trim();
}

function BashStatusIcon({ tool }: { tool: BashMessage }) {
	if (!tool.hasResult)
		return Icons.activeIcon({ ariaLabel: 'running', className: 'size-3.5 text-ink-subtle' });
	if (tool.isError) return <WarningCircle className="size-3.5 text-ink-subtle" weight="fill" />;
	return <Terminal className="size-3.5 text-ink-subtle" weight="bold" />;
}

/**
 * BashLine renders a bash tool call as one compact row: a terminal status
 * icon, the "Bash" label, and the command in a monospace code pill. The
 * command is single-line and truncated; full payload is opened on demand.
 */
export function BashLine({ tool, className }: { tool: BashMessage; className?: string }) {
	const command = tool.input.command?.trim();

	return (
		<div className={cn('flex items-center gap-2 py-1 text-body-sm leading-5', className)}>
			<span className="shrink-0">
				<BashStatusIcon tool={tool} />
			</span>
			<span className="shrink-0 font-medium text-ink">Bash</span>
			{command ? (
				<code
					className="min-w-0 truncate font-mono text-[12px] leading-5 text-ink-subtle"
					title={command}
				>
					{displayBashCommand(command)}
				</code>
			) : (
				<span className="min-w-0 truncate text-ink-muted">Run terminal command</span>
			)}
		</div>
	);
}
