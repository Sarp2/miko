import { useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useScratchpadAutosave } from '../hooks/use-scratchpad-autosave';
import { Icons } from '../lib/icons';
import { cn } from '../lib/utils';
import { useScratchpadStore } from '../stores/scratchpad-store';

type ScratchpadMode = 'edit' | 'preview';

interface ScratchpadPageProps {
	workspaceId: string;
}
function ScratchpadModeToggle({
	mode,
	onModeChange,
}: {
	mode: ScratchpadMode;
	onModeChange: (mode: ScratchpadMode) => void;
}) {
	return (
		<div className="inline-flex items-center gap-0.5 rounded-md border border-hairline bg-surface-1 p-0.5">
			<button
				type="button"
				className={cn(
					'h-5 rounded-[5px] px-2 text-[11px] font-medium leading-none transition-colors',
					mode === 'edit'
						? 'bg-surface-2 text-ink'
						: 'text-ink-tertiary hover:bg-surface-2/70 hover:text-ink-subtle',
				)}
				onClick={() => onModeChange('edit')}
			>
				Write
			</button>
			<button
				type="button"
				className={cn(
					'h-5 rounded-[5px] px-2 text-[11px] font-medium leading-none transition-colors',
					mode === 'preview'
						? 'bg-surface-2 text-ink'
						: 'text-ink-tertiary hover:bg-surface-2/70 hover:text-ink-subtle',
				)}
				onClick={() => onModeChange('preview')}
			>
				Preview
			</button>
		</div>
	);
}

function resizeScratchpadTextarea(
	textarea: HTMLTextAreaElement | null,
	scrollContainer: HTMLElement | null,
) {
	if (!textarea) return;
	const distanceFromBottom = scrollContainer
		? scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight
		: null;

	textarea.style.height = 'auto';
	textarea.style.height = `${textarea.scrollHeight}px`;

	if (scrollContainer && distanceFromBottom !== null) {
		scrollContainer.scrollTop =
			scrollContainer.scrollHeight - scrollContainer.clientHeight - distanceFromBottom;
	}
}

function ScratchpadEditor({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	useLayoutEffect(() => {
		resizeScratchpadTextarea(
			textareaRef.current,
			containerRef.current?.closest('[data-scratchpad-scroll]') ?? null,
		);
	});

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let animationFrame = 0;
		const scheduleResize = () => {
			cancelAnimationFrame(animationFrame);
			animationFrame = requestAnimationFrame(() =>
				resizeScratchpadTextarea(
					textareaRef.current,
					container.closest('[data-scratchpad-scroll]'),
				),
			);
		};
		const resizeObserver = new ResizeObserver(scheduleResize);
		resizeObserver.observe(container);
		window.addEventListener('resize', scheduleResize);

		return () => {
			cancelAnimationFrame(animationFrame);
			resizeObserver.disconnect();
			window.removeEventListener('resize', scheduleResize);
		};
	}, []);

	return (
		<div ref={containerRef} className="px-8 py-7">
			<textarea
				ref={textareaRef}
				className="block min-h-[520px] w-full resize-none overflow-hidden bg-transparent p-0 text-[14px] leading-7 text-ink outline-none placeholder:text-ink-tertiary"
				value={value}
				placeholder="Write a note, paste an idea, sketch the next step…"
				spellCheck
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}

function ScratchpadPreview({ content }: { content: string }) {
	if (!content.trim()) {
		return (
			<div className="flex min-h-[520px] items-center justify-center px-8 text-center text-[13px] leading-6 text-ink-tertiary">
				Write a few notes, then switch to Preview when you want to read them back.
			</div>
		);
	}

	return (
		<div className="min-h-[520px] px-8 py-7 text-ink">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					h1: ({ children }) => (
						<h1 className="mb-5 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink first:mt-0">
							{children}
						</h1>
					),
					h2: ({ children }) => (
						<h2 className="mt-8 mb-3 text-[17px] font-semibold leading-6 tracking-[-0.01em] text-ink">
							{children}
						</h2>
					),
					h3: ({ children }) => (
						<h3 className="mt-6 mb-2 text-[14px] font-semibold leading-5 text-ink">{children}</h3>
					),
					p: ({ children }) => (
						<p className="mb-4 text-[14px] leading-7 text-ink-muted">{children}</p>
					),
					ul: ({ children }) => (
						<ul className="mb-4 ml-5 list-disc space-y-1.5 text-[14px] leading-7 text-ink-muted">
							{children}
						</ul>
					),
					ol: ({ children }) => (
						<ol className="mb-4 ml-5 list-decimal space-y-1.5 text-[14px] leading-7 text-ink-muted">
							{children}
						</ol>
					),
					li: ({ children }) => <li className="pl-1">{children}</li>,
					strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
					em: ({ children }) => <em className="text-ink">{children}</em>,
					blockquote: ({ children }) => (
						<blockquote className="my-5 border-l border-hairline-strong pl-4 text-[14px] leading-7 text-ink-subtle">
							{children}
						</blockquote>
					),
					code: ({ children }) => (
						<code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[12.5px] text-ink">
							{children}
						</code>
					),
					pre: ({ children }) => (
						<pre className="scrollbar-miko my-5 overflow-x-auto rounded-md border border-hairline bg-surface-2 p-3 font-mono text-[12.5px] leading-6 text-ink">
							{children}
						</pre>
					),
					table: ({ children }) => (
						<div className="scrollbar-miko my-5 overflow-x-auto rounded-lg border border-hairline bg-surface-1">
							<table className="w-full min-w-max border-collapse text-left text-[13px] leading-5">
								{children}
							</table>
						</div>
					),
					thead: ({ children }) => <thead className="bg-surface-2">{children}</thead>,
					tbody: ({ children }) => <tbody className="divide-y divide-hairline">{children}</tbody>,
					tr: ({ children }) => <tr className="divide-x divide-hairline align-top">{children}</tr>,
					th: ({ children, className, ...props }) => (
						<th {...props} scope="col" className={cn('px-3 py-2 font-medium text-ink', className)}>
							{children}
						</th>
					),
					td: ({ children, className, ...props }) => (
						<td
							{...props}
							className={cn('px-3 py-2 text-ink-muted [&_code]:text-[12px]', className)}
						>
							{children}
						</td>
					),
					a: ({ children, href }) => (
						<a className="text-primary underline-offset-4 hover:underline" href={href}>
							{children}
						</a>
					),
					hr: () => <hr className="my-7 border-hairline" />,
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}

export function ScratchpadPage({ workspaceId }: ScratchpadPageProps) {
	const snapshot = useScratchpadStore((state) => state.getScratchpadSnapshot(workspaceId));
	const { draft, loaded, setDraft } = useScratchpadAutosave({ workspaceId, snapshot });
	const [mode, setMode] = useState<ScratchpadMode>('edit');

	return (
		<div
			data-scratchpad-scroll="true"
			className="scrollbar-miko h-full min-h-0 overflow-y-auto bg-canvas"
		>
			<div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-6 pb-10">
				<header className="sticky top-0 z-10 -mx-6 mb-3 flex shrink-0 items-center justify-between gap-3 bg-canvas px-6 pt-6 pb-3">
					<div className="min-w-0">
						<div className="text-[13px] font-medium leading-5 text-ink">Scratchpad</div>
						<div className="text-[11px] leading-4 text-ink-tertiary">
							Private notes for this workspace
						</div>
					</div>
					<ScratchpadModeToggle mode={mode} onModeChange={setMode} />
				</header>

				<div className="min-h-[520px] flex-1 rounded-xl border border-hairline bg-surface-1 shadow-raised">
					{!loaded ? (
						<div className="flex min-h-[520px] items-center justify-center px-6">
							<div className="inline-flex items-center gap-2 text-[12px] text-ink-subtle">
								{Icons.activeIcon({
									ariaLabel: 'Loading scratchpad',
									className: 'size-3.5 text-ink-subtle',
								})}
								<span>Loading scratchpad</span>
							</div>
						</div>
					) : mode === 'edit' ? (
						<ScratchpadEditor value={draft} onChange={setDraft} />
					) : (
						<ScratchpadPreview content={draft} />
					)}
				</div>
			</div>
		</div>
	);
}
