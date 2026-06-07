import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils';

export interface AssistantTextProps {
	/** Assistant/model response text */
	text: string;
	/** Render mode for assistant output */
	mode?: 'plain' | 'markdown';
	/** Optional CSS class */
	className?: string;
}

/**
 * AssistantText displays AI responses in transcript flow.
 * Renders full response text directly (plain or markdown).
 */
export function AssistantText({ text, mode = 'plain', className }: AssistantTextProps) {
	const renderPlainText = (value: string) => (
		<div className="text-body text-ink whitespace-pre-wrap">{value}</div>
	);

	const renderMarkdown = (value: string) => (
		<div className="text-body text-ink">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					p: ({ children }) => <p className="mb-3 last:mb-0 whitespace-pre-wrap">{children}</p>,
					ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
					ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
					li: ({ children }) => <li className="text-ink">{children}</li>,
					strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
					em: ({ children }) => <em className="italic text-ink-muted">{children}</em>,
					code: ({ children, className: codeClassName }) => (
						<code
							className={cn(
								'rounded border border-hairline bg-surface-2 px-1 py-0.5 font-mono text-caption text-ink-muted',
								codeClassName,
							)}
						>
							{children}
						</code>
					),
					pre: ({ children }) => (
						<pre className="mb-3 overflow-x-auto rounded-lg border border-hairline bg-surface-2 p-3 font-mono text-caption leading-relaxed text-ink-muted [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
							{children}
						</pre>
					),
					table: ({ children }) => (
						<div className="mb-3 overflow-x-auto rounded-lg border border-hairline">
							<table className="w-full text-left text-caption [&_tr:last-child_td]:border-b-0">
								{children}
							</table>
						</div>
					),
					thead: ({ children }) => <thead className="bg-surface-2">{children}</thead>,
					th: ({ children }) => (
						<th className="px-3 py-2 text-ink font-medium border-b border-hairline">{children}</th>
					),
					td: ({ children }) => (
						<td className="border-b border-hairline px-3 py-2 text-ink-muted">{children}</td>
					),
					a: ({ children, href }) => (
						<a
							href={href}
							className="text-primary hover:text-primary-hover underline"
							target="_blank"
							rel="noreferrer"
						>
							{children}
						</a>
					),
					blockquote: ({ children }) => (
						<blockquote className="mb-3 border-l-2 border-hairline-strong pl-3 text-ink-muted">
							{children}
						</blockquote>
					),
				}}
			>
				{value}
			</ReactMarkdown>
		</div>
	);

	return (
		<div className={cn('flex', className)}>
			<div className="inline-block w-fit max-w-[68ch]">
				{mode === 'markdown' ? renderMarkdown(text) : renderPlainText(text)}
			</div>
		</div>
	);
}
