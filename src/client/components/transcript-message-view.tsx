import type { ReactNode } from 'react';
import type { HydratedTranscriptMessage } from '../../shared/types';
import { cn } from '../lib/utils';
import {
	AccountInfo,
	AssistantText,
	CompactBoundaryMessage,
	CompactSummaryMessage,
	ContextClearedMessage,
	ContextWindowUpdatedMessage,
	InterruptedMessage,
	ProcessingMessage,
	ResultMessage,
	StatusMessage,
	SystemInit,
	ToolCall,
	UnknownMessage,
	UserPrompt,
} from './messages';

export interface TranscriptMessageViewProps {
	message: HydratedTranscriptMessage;
	className?: string;
}

type TranscriptShell = 'user' | 'prose' | 'event' | 'system';

const ROW_SPACING: Record<TranscriptShell, string> = {
	user: 'mb-2',
	prose: 'mb-3',
	event: 'mb-1.5',
	system: 'mb-1.5',
};

function TranscriptRow({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn('flex w-full justify-start', className)}>{children}</div>;
}

function TranscriptBubble({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div
			className={cn(
				'inline-flex max-w-[68ch] flex-col rounded-lg border border-hairline bg-surface-1 px-[15px] py-[11px] shadow-sm',
				className,
			)}
		>
			{children}
		</div>
	);
}

function TranscriptProse({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div
			className={cn('inline-flex max-w-[68ch] flex-col rounded-lg px-[15px] py-[11px]', className)}
		>
			{children}
		</div>
	);
}

function TranscriptSystem({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn('w-full max-w-[68ch] px-[15px]', className)}>{children}</div>;
}

function renderInShell(shell: TranscriptShell, content: ReactNode, className?: string) {
	const rowClassName = cn(ROW_SPACING[shell], className);
	if (shell === 'user') {
		return (
			<TranscriptRow className={cn(rowClassName, 'justify-end')}>
				<TranscriptBubble>{content}</TranscriptBubble>
			</TranscriptRow>
		);
	}

	if (shell === 'prose') {
		return (
			<TranscriptRow className={rowClassName}>
				<TranscriptProse>{content}</TranscriptProse>
			</TranscriptRow>
		);
	}

	if (shell === 'event') {
		return (
			<TranscriptRow className={rowClassName}>
				<TranscriptSystem>{content}</TranscriptSystem>
			</TranscriptRow>
		);
	}

	return (
		<TranscriptRow className={rowClassName}>
			<TranscriptSystem>{content}</TranscriptSystem>
		</TranscriptRow>
	);
}

export function TranscriptActivityIndicator({ status }: { status?: string }) {
	return renderInShell('system', <ProcessingMessage status={status} />);
}

function stringifyToolResult(message: Extract<HydratedTranscriptMessage, { kind: 'tool_result' }>) {
	try {
		return JSON.stringify(
			{
				toolId: message.toolId,
				isError: message.isError === true,
				result: message.rawResult,
			},
			null,
			2,
		);
	} catch {
		return String(message.rawResult);
	}
}

export function TranscriptMessageView({ message, className }: TranscriptMessageViewProps) {
	if (message.hidden) return null;

	switch (message.kind) {
		case 'user_prompt':
			return renderInShell(
				'user',
				<UserPrompt content={message.content} attachments={message.attachments} />,
				className,
			);
		case 'assistant_text':
			return renderInShell(
				'prose',
				<AssistantText text={message.text} mode="markdown" />,
				className,
			);
		case 'tool':
			return renderInShell(
				'event',
				<ToolCall tool={message} isLoading={!message.hasResult} />,
				className,
			);
		case 'tool_result':
			return renderInShell(
				'system',
				<UnknownMessage label="Tool Result" json={stringifyToolResult(message)} />,
				className,
			);
		case 'system_init':
			return renderInShell(
				'system',
				<SystemInit
					model={message.model}
					provider={message.provider}
					tools={message.tools}
					agents={message.agents}
					slashCommands={message.slashCommands}
					mcpServers={message.mcpServers}
				/>,
				className,
			);
		case 'account_info':
			return renderInShell('system', <AccountInfo accountInfo={message.accountInfo} />, className);
		case 'result':
			return renderInShell(
				'system',
				<ResultMessage
					success={message.success}
					cancelled={message.cancelled}
					result={message.result}
					durationMs={message.durationMs}
					costUsd={message.costUsd}
				/>,
				className,
			);
		case 'status':
			return renderInShell('system', <StatusMessage status={message.status} />, className);
		case 'context_window_updated':
			return renderInShell(
				'system',
				<ContextWindowUpdatedMessage usage={message.usage} />,
				className,
			);
		case 'compact_boundary':
			return renderInShell('system', <CompactBoundaryMessage />, className);
		case 'compact_summary':
			return renderInShell(
				'system',
				<CompactSummaryMessage summary={message.summary} />,
				className,
			);
		case 'context_cleared':
			return renderInShell('system', <ContextClearedMessage />, className);
		case 'interrupted':
			return renderInShell('system', <InterruptedMessage />, className);
		case 'unknown':
			return renderInShell('system', <UnknownMessage json={message.json} />, className);
		default: {
			const exhaustive: never = message;
			return renderInShell('system', <UnknownMessage json={exhaustive} />, className);
		}
	}
}
