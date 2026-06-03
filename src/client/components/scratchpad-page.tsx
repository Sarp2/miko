import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/utils';
import { useScratchpadStore } from '../stores/scratchpad-store';
import { Button } from './ui/button';

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
		<div className="inline-flex items-center gap-1">
			<Button
				type="button"
				variant={mode === 'edit' ? 'secondary' : 'ghost'}
				size="xs"
				className={cn(
					'h-6 rounded-md px-2.5 text-[12px] font-medium',
					mode === 'edit'
						? 'bg-surface-3 text-ink hover:bg-surface-3'
						: 'bg-transparent text-ink-tertiary hover:bg-transparent hover:text-ink-subtle',
				)}
				onClick={() => onModeChange('edit')}
			>
				Markdown
			</Button>
			<Button
				type="button"
				variant={mode === 'preview' ? 'secondary' : 'ghost'}
				size="xs"
				className={cn(
					'h-6 rounded-md px-2.5 text-[12px] font-medium',
					mode === 'preview'
						? 'bg-surface-3 text-ink hover:bg-surface-3'
						: 'bg-transparent text-ink-tertiary hover:bg-transparent hover:text-ink-subtle',
				)}
				onClick={() => onModeChange('preview')}
			>
				Preview
			</Button>
		</div>
	);
}

function ScratchpadPreview({ content }: { content: string }) {
	if (!content.trim()) {
		return (
			<div className="flex h-full items-center justify-center text-center text-body-sm text-ink-tertiary">
				Write notes in Edit mode, then switch to Preview to read them as Markdown.
			</div>
		);
	}

	return (
		<div className="scrollbar-miko h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-5xl px-2 pt-3 pb-6 text-ink">
				<ReactMarkdown
					remarkPlugins={[remarkGfm]}
					components={{
						h1: ({ children }) => (
							<h1 className="mb-5 text-headline text-ink first:mt-0">{children}</h1>
						),
						h2: ({ children }) => (
							<h2 className="mt-7 mb-3 text-card-title text-ink">{children}</h2>
						),
						h3: ({ children }) => (
							<h3 className="mt-6 mb-2 text-body-lg font-medium text-ink">{children}</h3>
						),
						p: ({ children }) => (
							<p className="mb-4 text-body leading-7 text-ink-muted">{children}</p>
						),
						ul: ({ children }) => (
							<ul className="mb-4 ml-5 list-disc space-y-2 text-ink-muted">{children}</ul>
						),
						ol: ({ children }) => (
							<ol className="mb-4 ml-5 list-decimal space-y-2 text-ink-muted">{children}</ol>
						),
						li: ({ children }) => <li className="pl-1 text-body leading-7">{children}</li>,
						strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
						em: ({ children }) => <em className="text-ink">{children}</em>,
						blockquote: ({ children }) => (
							<blockquote className="my-5 border-l border-hairline-strong pl-4 text-ink-subtle">
								{children}
							</blockquote>
						),
						code: ({ children }) => (
							<code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[13px] text-ink">
								{children}
							</code>
						),
						pre: ({ children }) => (
							<pre className="scrollbar-miko my-5 overflow-x-auto rounded-lg border border-hairline bg-surface-1 p-4 font-mono text-[13px] leading-6 text-ink">
								{children}
							</pre>
						),
						a: ({ children, href }) => (
							<a className="text-primary underline-offset-4 hover:underline" href={href}>
								{children}
							</a>
						),
						hr: () => <hr className="my-6 border-hairline" />,
					}}
				>
					{content}
				</ReactMarkdown>
			</div>
		</div>
	);
}

export function ScratchpadPage({ workspaceId }: ScratchpadPageProps) {
	const snapshot = useScratchpadStore((state) => state.getScratchpadSnapshot(workspaceId));
	const updateScratchpad = useScratchpadStore((state) => state.updateScratchpad);
	const loaded = snapshot !== null;
	const [mode, setMode] = useState<ScratchpadMode>('edit');
	const [draft, setDraft] = useState(snapshot?.content ?? '');
	const lastSavedContentRef = useRef(snapshot?.content ?? '');
	const draftRef = useRef(draft);
	const dirtyRef = useRef(false);

	useEffect(() => {
		draftRef.current = draft;
	}, [draft]);

	useEffect(() => {
		if (!snapshot || dirtyRef.current) return;
		const nextContent = snapshot.content;
		if (nextContent === lastSavedContentRef.current) return;
		lastSavedContentRef.current = nextContent;
		setDraft(nextContent);
	}, [snapshot]);

	useEffect(() => {
		if (!loaded || draft === lastSavedContentRef.current) return;

		const contentToSave = draft;
		const timeoutId = window.setTimeout(() => {
			void updateScratchpad(workspaceId, contentToSave)
				.then((updated) => {
					lastSavedContentRef.current = updated.content;
					if (draftRef.current === updated.content) dirtyRef.current = false;
				})
				.catch(() => undefined);
		}, 600);

		return () => window.clearTimeout(timeoutId);
	}, [draft, loaded, updateScratchpad, workspaceId]);

	useEffect(() => {
		return () => {
			const latestDraft = draftRef.current;
			if (!useScratchpadStore.getState().getScratchpadSnapshot(workspaceId)) return;
			if (latestDraft === lastSavedContentRef.current) return;
			void useScratchpadStore.getState().updateScratchpad(workspaceId, latestDraft);
		};
	}, [workspaceId]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-canvas">
			<header className="flex h-10 shrink-0 items-center justify-end px-4">
				<ScratchpadModeToggle mode={mode} onModeChange={setMode} />
			</header>

			<div className="min-h-0 flex-1">
				{!loaded ? (
					<div className="flex h-full items-center justify-center text-caption text-ink-tertiary">
						Loading scratchpad…
					</div>
				) : mode === 'edit' ? (
					<textarea
						className="h-full w-full resize-none overflow-y-auto bg-transparent px-6 pt-3 pb-6 font-mono text-[14px] leading-7 text-ink outline-none placeholder:text-ink-tertiary [scrollbar-gutter:auto] [scrollbar-width:auto]"
						value={draft}
						placeholder="Write Markdown notes for this workspace…"
						spellCheck={false}
						onChange={(event) => {
							dirtyRef.current = true;
							setDraft(event.target.value);
						}}
					/>
				) : (
					<ScratchpadPreview content={draft} />
				)}
			</div>
		</div>
	);
}
