import type { HydratedTranscriptMessage } from '../../shared/types';
import {
	AccountInfo,
	AssistantText,
	CompactBoundaryMessage,
	CompactSummaryMessage,
	ContextClearedMessage,
	ContextWindowUpdatedMessage,
	InterruptedMessage,
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
			return (
				<UserPrompt
					content={message.content}
					attachments={message.attachments}
					className={className}
				/>
			);
		case 'assistant_text':
			return <AssistantText text={message.text} mode="markdown" className={className} />;
		case 'tool':
			return <ToolCall tool={message} isLoading={!message.hasResult} className={className} />;
		case 'tool_result':
			return (
				<UnknownMessage
					label="Tool Result"
					json={stringifyToolResult(message)}
					className={className}
				/>
			);
		case 'system_init':
			return (
				<SystemInit
					model={message.model}
					provider={message.provider}
					tools={message.tools}
					agents={message.agents}
					slashCommands={message.slashCommands}
					mcpServers={message.mcpServers}
					className={className}
				/>
			);
		case 'account_info':
			return <AccountInfo accountInfo={message.accountInfo} className={className} />;
		case 'result':
			return (
				<ResultMessage
					success={message.success}
					cancelled={message.cancelled}
					result={message.result}
					durationMs={message.durationMs}
					costUsd={message.costUsd}
					className={className}
				/>
			);
		case 'status':
			return <StatusMessage status={message.status} className={className} />;
		case 'context_window_updated':
			return <ContextWindowUpdatedMessage usage={message.usage} className={className} />;
		case 'compact_boundary':
			return <CompactBoundaryMessage className={className} />;
		case 'compact_summary':
			return <CompactSummaryMessage summary={message.summary} className={className} />;
		case 'context_cleared':
			return <ContextClearedMessage className={className} />;
		case 'interrupted':
			return <InterruptedMessage className={className} />;
		case 'unknown':
			return <UnknownMessage json={message.json} className={className} />;
		default: {
			const exhaustive: never = message;
			return <UnknownMessage json={exhaustive} className={className} />;
		}
	}
}
