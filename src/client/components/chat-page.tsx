import { useEffect, useMemo } from 'react';
import type { WorkspaceSnapshot } from '../../shared/types';
import { composeTranscriptWindow } from '../lib/compose-transcript-window';
import { hydrateTranscriptMessages } from '../lib/hydrate-transcript-messages';
import { selectFirstSessionId } from '../routes/workspace-route-state';
import { type ChatWindow, useChatWindowStore } from '../stores/chat-window-store';
import { useWorkspaceStore } from '../stores/workspace-store';
import { EmptyChatIntro } from './chat-empty-state';
import { TranscriptMessageView } from './transcript-message-view';

interface ChatPageProps {
	workspaceId: string;
	sessionId: string;
	workspaceSnapshot: WorkspaceSnapshot;
}

export interface ChatPageViewProps extends ChatPageProps {
	chatWindow: ChatWindow | null;
}

function basename(path: string) {
	return path.split('/').filter(Boolean).at(-1) ?? path;
}

function EmptyChatSessionState({ localPath }: { localPath: string }) {
	return (
		<div className="px-8 pt-10 text-caption text-ink-subtle md:px-12 md:pt-14">
			<span>New Chat in </span>
			<span className="font-mono text-ink-muted">/{basename(localPath)}</span>.
		</div>
	);
}

export function ChatPageView({
	workspaceId,
	sessionId,
	workspaceSnapshot,
	chatWindow,
}: ChatPageViewProps) {
	const messages = useMemo(() => {
		return composeTranscriptWindow(hydrateTranscriptMessages(chatWindow?.messages ?? []));
	}, [chatWindow?.messages]);
	const visibleMessages = useMemo(() => {
		return messages.filter((message) => !message.hidden);
	}, [messages]);
	const initialized = chatWindow?.initialized === true;
	const firstSessionId = useMemo(
		() => selectFirstSessionId(workspaceSnapshot.sessions),
		[workspaceSnapshot.sessions],
	);
	const isFirstSession = sessionId === firstSessionId;

	return (
		<div data-testid="chat-page" className="flex h-full min-h-0 flex-col bg-canvas text-ink">
			<div className="scrollbar-miko min-h-0 flex-1 overflow-y-auto">
				{!initialized ? (
					<div className="flex h-full items-center justify-center text-caption text-ink-tertiary">
						Loading chat…
					</div>
				) : visibleMessages.length === 0 && isFirstSession ? (
					<EmptyChatIntro workspaceSnapshot={workspaceSnapshot} />
				) : visibleMessages.length === 0 ? (
					<EmptyChatSessionState localPath={workspaceSnapshot.workspace.localPath} />
				) : (
					<div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-5 py-6">
						{visibleMessages.map((message) => (
							<TranscriptMessageView key={message.id} message={message} />
						))}
					</div>
				)}
			</div>
			<span className="sr-only">Chat page for workspace {workspaceId}</span>
		</div>
	);
}

export function ChatPage({ workspaceId, sessionId, workspaceSnapshot }: ChatPageProps) {
	const chatWindow = useChatWindowStore((state) => state.windowBySessionId.get(sessionId) ?? null);

	useEffect(() => {
		if (!workspaceSnapshot.hasUnreadAgentResult) return;
		void useWorkspaceStore
			.getState()
			.markRead(workspaceId)
			.catch(() => undefined);
	}, [workspaceId, workspaceSnapshot.hasUnreadAgentResult]);

	return (
		<ChatPageView
			workspaceId={workspaceId}
			sessionId={sessionId}
			workspaceSnapshot={workspaceSnapshot}
			chatWindow={chatWindow}
		/>
	);
}
