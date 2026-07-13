import { CaretUpDown, Check } from '@phosphor-icons/react';

import type { SessionSummary } from '../../../shared/types';
import { Button } from '../ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '../ui/dropdown-menu';

function sessionLabel(session: SessionSummary | undefined): string {
	return session?.title?.trim() || 'Untitled';
}

/**
 * Lets the user choose which session a message routes to from the diff/file
 * composer, where the target is otherwise inferred (source session or most
 * recently active). Only meaningful with more than one session.
 */
export function ComposerSessionPicker({
	sessions,
	selectedSessionId,
	onSelect,
	disabled,
}: {
	sessions: SessionSummary[];
	selectedSessionId: string;
	onSelect: (sessionId: string) => void;
	disabled?: boolean;
}) {
	const selected = sessions.find((session) => session.id === selectedSessionId);

	return (
		<div className="flex items-center gap-1.5 px-2 py-1 text-caption text-ink-muted">
			<span className="shrink-0 text-ink-subtle">Sending to:</span>
			<DropdownMenu modal={false}>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={disabled}
						className="h-6 min-w-0 gap-1 rounded-md px-1.5 text-caption font-medium text-ink hover:bg-surface-3 hover:text-ink"
					>
						<span className="min-w-0 max-w-[220px] truncate">{sessionLabel(selected)}</span>
						<CaretUpDown className="size-3 shrink-0 text-ink-subtle" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					className="max-h-72 min-w-56 overflow-y-auto rounded-[10px] border-hairline bg-surface-1 p-1 shadow-popover"
				>
					{sessions.map((session) => (
						<DropdownMenuItem
							key={session.id}
							className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium text-ink focus:bg-surface-2 focus:text-ink"
							onSelect={() => onSelect(session.id)}
						>
							<span className="min-w-0 flex-1 truncate">{sessionLabel(session)}</span>
							{session.id === selectedSessionId ? (
								<Check className="size-3.5 shrink-0 text-ink-muted" />
							) : null}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
