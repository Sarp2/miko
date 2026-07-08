import { ArrowCounterClockwise, ChatCircle, ClockCounterClockwise } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AgentProvider, SessionSummary } from '../../shared/types';
import { ProviderIcon } from '../lib/icons';
import { formatRelativeTime } from '../lib/relative-time';

function sessionRecency(session: SessionSummary) {
	return session.lastMessageAt ?? session.updatedAt;
}

/** All sessions ordered most-recently-active first, for the history list. */
export function sortSessionsByRecency(sessions: SessionSummary[]): SessionSummary[] {
	return sessions.toSorted((a, b) => sessionRecency(b) - sessionRecency(a));
}

function SessionProviderIcon({ provider }: { provider: AgentProvider | null }) {
	if (!provider) return <ChatCircle className="size-3.5 shrink-0 text-ink-subtle" />;
	return <ProviderIcon provider={provider} className="size-3.5 shrink-0" />;
}

/**
 * History menu pinned to the right of the tab strip. Lists every session in the
 * workspace; selecting one navigates to its session route, which re-creates and
 * activates its middle tab even after the tab was closed.
 */
export function SessionHistoryMenu({
	workspaceId,
	sessions,
}: {
	workspaceId: string;
	sessions: SessionSummary[];
}) {
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const ordered = sortSessionsByRecency(sessions);

	const openSession = (sessionId: string) => {
		setOpen(false);
		navigate(
			`/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`,
		);
	};

	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger asChild>
				<button
					type="button"
					aria-label="Chat history"
					className="flex size-6 cursor-pointer items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-2/70 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
				>
					<ClockCounterClockwise className="size-4" />
				</button>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					align="end"
					sideOffset={6}
					className="z-50 w-72 rounded-lg border border-hairline bg-surface-1 p-1 shadow-popover outline-none"
				>
					{ordered.length === 0 ? (
						<div className="px-3 py-6 text-center text-[12px] text-ink-subtle">No chats yet</div>
					) : (
						<div className="scrollbar-miko max-h-80 overflow-y-auto">
							{ordered.map((session) => (
								<button
									key={session.id}
									type="button"
									className="group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-2/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
									onClick={() => openSession(session.id)}
								>
									<SessionProviderIcon provider={session.provider} />
									<span className="min-w-0 flex-1 truncate text-ink">
										{session.title || 'Untitled'}
									</span>
									<span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">
										{formatRelativeTime(sessionRecency(session))}
									</span>
									<ArrowCounterClockwise className="size-3.5 shrink-0 text-ink-subtle transition-colors group-hover:text-ink" />
								</button>
							))}
						</div>
					)}
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
