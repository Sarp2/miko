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
		<div className="whitespace-pre-wrap break-words text-[14px] font-normal leading-[1.55] text-ink">
			{value}
		</div>
	);

	const renderMarkdown = (value: string) => (
		<div className="break-words text-[14px] font-normal leading-[1.65] text-ink">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					p: ({ children }) => <p className="mb-3 last:mb-0 whitespace-pre-wrap">{children}</p>,
					h1: ({ children }) => (
						<h1 className="mt-5 mb-2 text-[15px] font-semibold leading-6 text-ink first:mt-0">
							{children}
						</h1>
					),
					h2: ({ children }) => (
						<h2 className="mt-4 mb-2 text-[14px] font-semibold leading-5 text-ink first:mt-0">
							{children}
						</h2>
					),
					h3: ({ children }) => (
						<h3 className="mt-3.5 mb-1.5 text-[14px] font-semibold leading-5 text-ink first:mt-0">
							{children}
						</h3>
					),
					hr: () => <div className="my-3 h-px bg-hairline" />,
					ul: ({ children }) => (
						<ul className="mb-3 flex list-disc flex-col gap-1 pl-5 marker:text-ink-tertiary last:mb-0">
							{children}
						</ul>
					),
					ol: ({ children }) => (
						<ol className="mb-3 flex list-decimal flex-col gap-1 pl-5 marker:text-ink-tertiary last:mb-0">
							{children}
						</ol>
					),
					li: ({ children }) => <li className="pl-1 text-ink">{children}</li>,
					strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
					em: ({ children }) => <em className="italic text-ink-muted">{children}</em>,
					del: ({ children }) => (
						<del className="text-ink-muted decoration-ink-muted">{children}</del>
					),
					code: ({ children, className: codeClassName }) => (
						<code
							className={cn(
								'rounded-md border border-hairline bg-surface-1 px-1.5 py-0.5 font-mono text-[13px] leading-none text-ink-muted',
								codeClassName,
							)}
						>
							{children}
						</code>
					),
					pre: ({ children }) => (
						<div className="mb-3 rounded-lg border border-hairline bg-surface-1 p-2 last:mb-0">
							<pre className="scrollbar-miko overflow-x-auto rounded-md bg-surface-2/80 px-3 py-2.5 font-mono text-[13px] leading-6 text-ink-muted [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
								{children}
							</pre>
						</div>
					),
					table: ({ children }) => (
						<div className="mb-3 overflow-hidden rounded-lg border border-hairline bg-surface-1 last:mb-0">
							<div className="overflow-x-auto">
								<table className="w-full text-left text-[13px] leading-5 [&_tr:last-child_td]:border-b-0">
									{children}
								</table>
							</div>
						</div>
					),
					thead: ({ children }) => <thead className="bg-surface-2/80 text-ink">{children}</thead>,
					th: ({ children }) => (
						<th className="border-b border-hairline px-3 py-2 text-left text-[12px] font-medium text-ink-muted">
							{children}
						</th>
					),
					td: ({ children }) => (
						<td className="border-b border-hairline px-3 py-2 text-[13px] text-ink-muted">
							{children}
						</td>
					),
					a: ({ children, href }) => (
						<a
							href={href}
							className="text-ink underline decoration-hairline-strong underline-offset-3 hover:text-ink-muted"
							target="_blank"
							rel="noreferrer"
						>
							{children}
						</a>
					),
					blockquote: ({ children }) => (
						<blockquote className="mb-3 border-l-2 border-hairline-strong pl-3 text-ink-muted last:mb-0">
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
		<div className={cn('min-w-0', className)}>
			{mode === 'markdown' ? renderMarkdown(text) : renderPlainText(text)}
		</div>
	);
}
