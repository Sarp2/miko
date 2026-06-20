import { type ReactNode, useEffect, useMemo } from 'react';
import type { ChatAttachment, MikoStatus, PromptPart, WorkspaceSnapshot } from '../../shared/types';
import { useChatScroll } from '../hooks/use-chat-scroll';
import { useWorkspacePageOpeners } from '../hooks/use-workspace-page-openers';
import { composeTranscriptWindow } from '../lib/compose-transcript-window';
import { groupTranscriptTurns } from '../lib/group-transcript-turns';
import { hydrateTranscriptMessages } from '../lib/hydrate-transcript-messages';
import { basename } from '../lib/relative-path';
import { selectFirstSessionId } from '../routes/workspace-route-state';
import { type ChatWindow, useChatWindowStore } from '../stores/chat-window-store';
import { useSessionStore } from '../stores/session-store';
import { useWorkspaceStore } from '../stores/workspace-store';
import { ChatComposer } from './chat-composer/chat-composer';
import { EmptyChatIntro } from './chat-empty-state';
import { PendingToolPrompt } from './pending-tool-prompt';
import { TranscriptActivityIndicator, TranscriptItemView } from './transcript-message-view';
import { Button } from './ui/button';

interface ChatPageProps {
	workspaceId: string;
	sessionId: string;
	workspaceSnapshot: WorkspaceSnapshot;
}

export interface ChatPageViewProps extends ChatPageProps {
	chatWindow: ChatWindow | null;
	onLoadOlder?: () => void;
	composer?: ReactNode;
	pendingToolPrompt?: ReactNode;
	sessionStatus?: MikoStatus | null;
	onOpenFile?: (path: string) => void;
	onOpenPastedText?: (part: Extract<PromptPart, { type: 'pasted_text' }>) => void;
	onOpenAttachment?: (attachment: ChatAttachment) => void;
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
	composer,
	pendingToolPrompt,
	sessionStatus,
	onOpenFile,
	onOpenPastedText,
	onOpenAttachment,
}: ChatPageViewProps) {
	const messages = useMemo(() => {
		return composeTranscriptWindow(hydrateTranscriptMessages(chatWindow?.messages ?? []));
	}, [chatWindow?.messages]);
	const visibleMessages = useMemo(() => {
		return messages.filter((message) => !message.hidden);
	}, [messages]);
	const items = useMemo(() => groupTranscriptTurns(visibleMessages), [visibleMessages]);
	const hasOpenTurn = useMemo(() => {
		const last = items.at(-1);
		return last?.type === 'turn' && !last.turn.isComplete;
	}, [items]);
	const initialized = chatWindow?.initialized === true;
	const hasOlderMessages = chatWindow?.hasOlder === true;
	const loadingOlder = chatWindow?.loadingOlder === true;
	const firstSessionId = useMemo(
		() => selectFirstSessionId(workspaceSnapshot.sessions),
		[workspaceSnapshot.sessions],
	);
	const isFirstSession = sessionId === firstSessionId;
	const showActivityIndicator = sessionStatus === 'starting' || sessionStatus === 'running';
	const chatScroll = useChatScroll({
		sessionId,
		items,
		initialized,
		hasOlder: hasOlderMessages,
		loadingOlder,
		onLoadOlder,
	});

	return (
		<div data-testid="chat-page" className="flex h-full min-h-0 flex-col bg-canvas text-ink">
			<div
				ref={chatScroll.scrollRef}
				onScroll={chatScroll.handleScroll}
				className="scrollbar-miko min-h-0 flex-1 overflow-y-auto"
			>
				{!initialized ? (
					<div className="flex h-full items-center justify-center text-caption text-ink-tertiary">
						Loading chat…
					</div>
				) : visibleMessages.length === 0 && !hasOlderMessages && isFirstSession ? (
					<EmptyChatIntro workspaceSnapshot={workspaceSnapshot} />
				) : visibleMessages.length === 0 && !hasOlderMessages ? (
					<EmptyChatSessionState localPath={workspaceSnapshot.workspace.localPath} />
				) : (
					<div
						ref={chatScroll.contentRef}
						className="mx-auto flex w-full max-w-4xl flex-col px-5 py-5"
					>
						{hasOlderMessages ? (
							<LoadOlderMessagesButton loading={loadingOlder} onLoadOlder={chatScroll.loadOlder} />
						) : null}
						{items.map((item) => (
							<TranscriptItemView
								key={item.id}
								item={item}
								sessionId={sessionId}
								workspaceId={workspaceId}
								workspaceRoot={workspaceSnapshot.workspace.localPath}
								onOpenFile={onOpenFile}
								onOpenPastedText={onOpenPastedText}
								onOpenAttachment={onOpenAttachment}
							/>
						))}
						{showActivityIndicator && !hasOpenTurn ? <TranscriptActivityIndicator /> : null}
					</div>
				)}
			</div>
			{pendingToolPrompt}
			{composer}
			<span className="sr-only">Chat page for workspace {workspaceId}</span>
		</div>
	);
}

export function ChatPage({ workspaceId, sessionId, workspaceSnapshot }: ChatPageProps) {
	const chatWindow = useChatWindowStore((state) => state.windowBySessionId.get(sessionId) ?? null);
	const sessionSnapshot = useSessionStore(
		(state) => state.snapshotBySessionId.get(sessionId) ?? null,
	);
	const { openWorkspaceFile, openPastedText, openAttachment } = useWorkspacePageOpeners(
		workspaceId,
		sessionId,
		workspaceSnapshot.workspace.localPath,
	);

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
			sessionStatus={sessionSnapshot?.runtime.status ?? null}
			onOpenFile={openWorkspaceFile}
			onOpenPastedText={(part) => openPastedText(part.id, part.text)}
			onOpenAttachment={openAttachment}
			pendingToolPrompt={
				sessionSnapshot?.runtime.status === 'waiting_for_user' &&
				sessionSnapshot.runtime.pendingTool ? (
					<PendingToolPrompt sessionId={sessionId} pending={sessionSnapshot.runtime.pendingTool} />
				) : null
			}
			composer={
				<ChatComposer
					key={sessionId}
					workspaceId={workspaceId}
					sessionId={sessionId}
					workspaceSnapshot={workspaceSnapshot}
					sessionSnapshot={sessionSnapshot}
				/>
			}
		/>
	);
}
