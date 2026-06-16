import { NoteBlankIcon, Plus, X } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionSummary } from '../../shared/types';
import { middleTabTitle, workspacePagePath } from '../lib/middle-tabs';
import { cn } from '../lib/utils';
import { useSessionStore } from '../stores/session-store';
import { type MiddleTabDescriptor, useUiStore, withScratchpadFirst } from '../stores/ui-store';
import { SessionHistoryMenu } from './session-history-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

interface MiddleTabsProps {
	workspaceId: string;
	sessions: SessionSummary[];
}

function nextTabAfterClose(tabs: MiddleTabDescriptor[], tabId: string) {
	const closedIndex = tabs.findIndex((tab) => tab.id === tabId);
	const nextTabs = tabs.filter((tab) => tab.id !== tabId);
	return nextTabs[closedIndex] ?? nextTabs[closedIndex - 1] ?? nextTabs[0] ?? null;
}

function isScratchpadTab(tab: MiddleTabDescriptor) {
	return tab.page.type === 'file' && tab.page.source === 'scratchpad';
}

function MiddleTabIcon({ tab }: { tab: MiddleTabDescriptor }) {
	if (isScratchpadTab(tab)) return <NoteBlankIcon className="size-3.5 shrink-0" />;
	return null;
}

export function MiddleTabs({ workspaceId, sessions }: MiddleTabsProps) {
	const navigate = useNavigate();
	const storedTabs = useUiStore((state) => state.middleTabsByWorkspaceId[workspaceId]);
	const activeTabId = useUiStore((state) => state.activeTabIdByWorkspaceId[workspaceId]);
	const closeMiddleTab = useUiStore((state) => state.closeMiddleTab);
	const setActiveMiddleTab = useUiStore((state) => state.setActiveMiddleTab);
	const createSession = useSessionStore((state) => state.createSession);
	const [creatingSession, setCreatingSession] = useState(false);

	const tabs = useMemo(
		() => withScratchpadFirst(workspaceId, storedTabs ?? []),
		[workspaceId, storedTabs],
	);

	const titleByTabId = useMemo(() => {
		return new Map(tabs.map((tab) => [tab.id, middleTabTitle(tab, sessions)]));
	}, [tabs, sessions]);

	const openTab = (tab: MiddleTabDescriptor) => {
		setActiveMiddleTab(workspaceId, tab.id);
		navigate(workspacePagePath(workspaceId, tab.page));
	};

	const closeTab = (tab: MiddleTabDescriptor) => {
		const nextTab = activeTabId === tab.id ? nextTabAfterClose(tabs, tab.id) : null;
		closeMiddleTab(workspaceId, tab.id);
		if (nextTab) navigate(workspacePagePath(workspaceId, nextTab.page));
	};

	const addChat = async () => {
		if (creatingSession) return;
		setCreatingSession(true);
		try {
			const result = await createSession(workspaceId);
			navigate(
				`/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(result.sessionId)}`,
			);
		} finally {
			setCreatingSession(false);
		}
	};

	return (
		<div className="flex h-10 shrink-0 items-center border-b border-hairline bg-surface-1">
			<div
				className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				role="tablist"
				aria-label="Workspace pages"
			>
				{tabs.map((tab) => {
					const active = tab.id === activeTabId;
					const title = titleByTabId.get(tab.id) ?? tab.fallbackTitle ?? 'Untitled';
					const scratchpad = isScratchpadTab(tab);

					return (
						<div key={tab.id} className="relative flex h-10 shrink-0 items-center px-0.5">
							<div
								className={cn(
									'group flex h-9 items-center rounded-md px-2 text-[12px] font-medium leading-5 transition-colors',
									scratchpad ? 'w-8 justify-center' : 'w-[96px]',
									active ? 'text-ink' : 'text-ink-subtle',
								)}
							>
								<button
									type="button"
									role="tab"
									aria-selected={active}
									className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 truncate text-left outline-none focus-visible:ring-1 focus-visible:ring-primary"
									title={title}
									onClick={() => openTab(tab)}
								>
									<MiddleTabIcon tab={tab} />
									{scratchpad ? null : <span className="min-w-0 flex-1 truncate">{title}</span>}
								</button>
								{tab.closable ? (
									<button
										type="button"
										className="ml-1 flex size-4 shrink-0 items-center justify-center rounded-sm text-ink-subtle opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
										aria-label={`Close ${title}`}
										onClick={(event) => {
											event.stopPropagation();
											closeTab(tab);
										}}
									>
										<X className="size-3" />
									</button>
								) : null}
							</div>
							{active ? (
								<span className="absolute right-2 bottom-0 left-2 h-px rounded-full bg-ink" />
							) : null}
						</div>
					);
				})}

				<div className="flex h-10 shrink-0 items-center px-1">
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								className="flex size-6 cursor-pointer items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-2/70 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
								aria-label="New chat"
								disabled={creatingSession}
								onClick={() => void addChat()}
							>
								<Plus className="size-3" />
							</button>
						</TooltipTrigger>
						<TooltipContent>New chat</TooltipContent>
					</Tooltip>
				</div>
			</div>

			<div className="flex h-10 shrink-0 items-center px-2">
				<SessionHistoryMenu workspaceId={workspaceId} sessions={sessions} />
			</div>
		</div>
	);
}
