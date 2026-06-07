import { useEffect, useMemo } from 'react';
import type { WorkspaceSnapshot } from '../../shared/types';
import { composeTranscriptWindow } from '../lib/compose-transcript-window';
import { hydrateTranscriptMessages } from '../lib/hydrate-transcript-messages';
import { basename, selectFirstSessionId } from '../routes/workspace-route-state';
import { type ChatWindow, useChatWindowStore } from '../stores/chat-window-store';
import { useSessionStore } from '../stores/session-store';
import { useWorkspaceStore } from '../stores/workspace-store';
import { EmptyChatIntro } from './chat-empty-state';
import { TranscriptMessageView } from './transcript-message-view';
import { Button } from './ui/button';

interface ChatPageProps {
	workspaceId: string;
	sessionId: string;
	workspaceSnapshot: WorkspaceSnapshot;
}

export interface ChatPageViewProps extends ChatPageProps {
	chatWindow: ChatWindow | null;
	onLoadOlder?: () => void;
}

function EmptyChatSessionState({ localPath }: { localPath: string }) {
	return (
		<div className="px-8 pt-10 text-caption text-ink-subtle md:px-12 md:pt-14">
			<span>New Chat in </span>
			<span className="font-mono text-ink-muted">/{basename(localPath)}</span>.
		</div>
	);
}

function LoadOlderMessagesButton({
	loading,
	onLoadOlder,
}: {
	loading: boolean;
	onLoadOlder?: () => void;
}) {
	return (
		<div className="flex justify-center pb-1">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-7 rounded-md px-2 text-caption font-medium text-ink-subtle hover:text-ink"
				disabled={loading}
				onClick={onLoadOlder}
			>
				{loading ? 'Loading older messages…' : 'Load older messages'}
			</Button>
		</div>
	);
}

export function ChatPageView({
	workspaceId,
	sessionId,
	workspaceSnapshot,
	chatWindow,
	onLoadOlder,
}: ChatPageViewProps) {
	const messages = useMemo(() => {
		return composeTranscriptWindow(hydrateTranscriptMessages(chatWindow?.messages ?? []));
	}, [chatWindow?.messages]);
	const visibleMessages = useMemo(() => {
		return messages.filter((message) => !message.hidden);
	}, [messages]);
	const initialized = chatWindow?.initialized === true;
	const hasOlderMessages = chatWindow?.hasOlder === true;
	const loadingOlder = chatWindow?.loadingOlder === true;
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
				) : visibleMessages.length === 0 && !hasOlderMessages && isFirstSession ? (
					<EmptyChatIntro workspaceSnapshot={workspaceSnapshot} />
				) : visibleMessages.length === 0 && !hasOlderMessages ? (
					<EmptyChatSessionState localPath={workspaceSnapshot.workspace.localPath} />
				) : (
					<div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-5 py-6">
						{hasOlderMessages ? (
							<LoadOlderMessagesButton loading={loadingOlder} onLoadOlder={onLoadOlder} />
						) : null}
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
	const loadOlder = () => {
		void useSessionStore
			.getState()
			.loadOlderChatWindow(sessionId)
			.catch((error) => console.warn('[chat-page] failed to load older messages', error));
	};

	useEffect(() => {
		if (!workspaceSnapshot.hasUnreadAgentResult) return;

		let cancelled = false;
		let retryTimeoutId: number | null = null;
		let attempt = 0;

		const markRead = async () => {
			try {
				await useWorkspaceStore.getState().markRead(workspaceId);
			} catch (error) {
				if (cancelled) return;
				console.warn('[chat-page] failed to mark workspace read', error);
				const delayMs = Math.min(1000 * 2 ** attempt, 8000);
				attempt += 1;
				retryTimeoutId = window.setTimeout(() => {
					void markRead();
				}, delayMs);
			}
		};

		void markRead();

		return () => {
			cancelled = true;
			if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId);
		};
	}, [workspaceId, workspaceSnapshot.hasUnreadAgentResult]);

	return (
		<ChatPageView
			workspaceId={workspaceId}
			sessionId={sessionId}
			workspaceSnapshot={workspaceSnapshot}
			chatWindow={chatWindow}
			onLoadOlder={loadOlder}
		/>
	);
}
