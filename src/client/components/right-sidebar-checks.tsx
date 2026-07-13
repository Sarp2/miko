import { Check, Circle, Plus, X } from '@phosphor-icons/react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import type { PullRequestCommentSnapshot, WorkspaceSnapshot } from '../../shared/types';
import { deriveChecksGitStatusRows } from '../lib/right-sidebar-checks-status';
import { cn } from '../lib/utils';
import { useComposerDraftStore } from '../stores/composer-draft-store';
import { useUiStore } from '../stores/ui-store';
import { useWorkspaceStore } from '../stores/workspace-store';

interface RightSidebarChecksProps {
	workspaceId: string;
	snapshot: WorkspaceSnapshot;
	actionSessionId: string | null;
}

function hasPullRequest(snapshot: WorkspaceSnapshot) {
	const status = snapshot.github?.status;
	return status === 'open' || status === 'merged' || status === 'closed';
}

function commentPreview(body: string) {
	return body.replace(/\s+/g, ' ').trim();
}

function commentAuthor(comment: PullRequestCommentSnapshot) {
	return comment.author?.trim() || 'unknown';
}

function githubLogin(author: string) {
	return author.replace(/\[bot\]$/i, '').trim();
}

function CommentAvatar({ author }: { author: string }) {
	const login = githubLogin(author);
	const [failed, setFailed] = useState(false);

	if (!login || failed) {
		return (
			<span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[9px] font-semibold uppercase text-ink-subtle">
				{login.charAt(0) || '?'}
			</span>
		);
	}

	return (
		<img
			src={`https://github.com/${encodeURIComponent(login)}.png?size=48`}
			alt=""
			loading="lazy"
			draggable={false}
			onError={() => setFailed(true)}
			className="size-4 shrink-0 rounded-full bg-surface-3 object-cover"
		/>
	);
}

function commentChatText(comment: PullRequestCommentSnapshot) {
	const author = commentAuthor(comment);
	const location = comment.path
		? ` (${comment.path}${comment.line ? `:${comment.line}` : ''})`
		: '';
	return `Comment from ${author}${location}:\n${comment.body.trim()}`;
}

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
	return (
		<div className="flex h-7 items-center justify-between px-1">
			<span className="text-label-mono text-ink-tertiary">{title}</span>
			{action}
		</div>
	);
}

function InlineAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
	return (
		<button
			type="button"
			className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
			onClick={onClick}
		>
			{children}
		</button>
	);
}

function PrSummary({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const pr = hasPullRequest(snapshot) ? snapshot.github : null;
	const title = pr?.title?.trim();
	const body = pr?.body?.trim();

	return (
		<div className="space-y-1 px-1 pb-1">
			<div
				className={cn(
					'text-[13px] font-semibold leading-5',
					title ? 'text-ink' : 'text-ink-tertiary',
				)}
			>
				{title || 'PR title'}
			</div>
			<div
				className={cn(
					'scrollbar-miko max-h-[180px] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-[12px] leading-5',
					body ? 'text-ink-muted' : 'text-ink-tertiary',
				)}
			>
				{body || 'PR description'}
			</div>
		</div>
	);
}

function GitStatusSection({ snapshot, actionSessionId, workspaceId }: RightSidebarChecksProps) {
	const createPr = useWorkspaceStore((state) => state.createPr);
	const commitAndPush = useWorkspaceStore((state) => state.commitAndPush);
	const pullLatestMain = useWorkspaceStore((state) => state.pullLatestMain);

	const rows = deriveChecksGitStatusRows(snapshot);
	if (rows.length === 0) return null;

	const runAction = async (kind: 'create_pr' | 'commit_and_push' | 'pull') => {
		if (!actionSessionId) {
			toast.error('No session available for this action');
			return;
		}
		try {
			if (kind === 'create_pr') await createPr(workspaceId, actionSessionId);
			else if (kind === 'commit_and_push') await commitAndPush(workspaceId, actionSessionId);
			else await pullLatestMain(workspaceId, actionSessionId);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not run action');
		}
	};

	return (
		<div>
			<SectionHeader title="Git status" />
			<div className="space-y-0.5">
				{rows.map((row) => {
					const action = row.action;
					return (
						<div key={row.id} className="flex h-7 items-center gap-2 px-1">
							<Circle className="size-3.5 shrink-0 text-ink-tertiary" />
							<span className="min-w-0 flex-1 truncate text-[12px] leading-5 text-ink">
								{row.label}
							</span>
							{action ? (
								<InlineAction onClick={() => void runAction(action.kind)}>
									{action.label}
								</InlineAction>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function CommentRow({
	comment,
	onHide,
	onAddToChat,
}: {
	comment: PullRequestCommentSnapshot;
	onHide: () => void;
	onAddToChat: () => void;
}) {
	const author = commentAuthor(comment);

	return (
		<div className="group flex h-7 items-center gap-2 rounded-md px-1 hover:bg-surface-2">
			<CommentAvatar author={author} />
			<div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] leading-5">
				<span className="shrink-0 font-medium text-ink">{author}</span>
				<span className="min-w-0 truncate text-ink-tertiary">{commentPreview(comment.body)}</span>
			</div>
			<div className="hidden shrink-0 items-center gap-1 group-hover:flex">
				<InlineAction onClick={onHide}>Hide</InlineAction>
				<InlineAction onClick={onAddToChat}>Add to chat</InlineAction>
			</div>
		</div>
	);
}

function CommentsSection({ snapshot, actionSessionId, workspaceId }: RightSidebarChecksProps) {
	const setCommentHidden = useUiStore((state) => state.setCommentHidden);
	const hiddenCommentIds = useUiStore((state) => state.hiddenCommentIdsByWorkspaceId[workspaceId]);
	const appendToComposer = useComposerDraftStore((state) => state.appendToComposer);

	if (!hasPullRequest(snapshot)) return null;

	const hidden = new Set(hiddenCommentIds ?? []);
	const comments = snapshot.github?.comments ?? [];
	const visible = comments.filter((comment) => !hidden.has(comment.id));

	const addToChat = (toAdd: PullRequestCommentSnapshot[]) => {
		if (!actionSessionId) {
			toast.error('No session available to add to');
			return;
		}
		if (toAdd.length === 0) return;
		const text = toAdd.map(commentChatText).join('\n\n');
		appendToComposer(actionSessionId, [{ type: 'text', text }]);
		toast.success(toAdd.length === 1 ? 'Comment added to chat' : 'Comments added to chat');
	};

	return (
		<div>
			<SectionHeader
				title="Comments"
				action={
					visible.length > 0 ? (
						<InlineAction onClick={() => addToChat(visible)}>Add all to chat</InlineAction>
					) : null
				}
			/>
			{visible.length === 0 ? (
				<div className="px-1 py-1 text-[12px] leading-5 text-ink-tertiary">
					{comments.length > 0 ? 'All comments hidden' : 'No comments yet'}
				</div>
			) : (
				<div className="space-y-0.5">
					{visible.map((comment) => (
						<CommentRow
							key={comment.id}
							comment={comment}
							onHide={() => setCommentHidden(workspaceId, comment.id, true)}
							onAddToChat={() => addToChat([comment])}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function TodosSection({ workspaceId }: { workspaceId: string }) {
	const todos = useUiStore((state) => state.getChecksTodos(workspaceId));
	const addTodo = useUiStore((state) => state.addChecksTodo);
	const toggleTodo = useUiStore((state) => state.toggleChecksTodo);
	const removeTodo = useUiStore((state) => state.removeChecksTodo);
	const [adding, setAdding] = useState(false);
	const [text, setText] = useState('');

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const trimmed = text.trim();
		if (trimmed) addTodo(workspaceId, trimmed);
		setText('');
		setAdding(false);
	};

	return (
		<div>
			<SectionHeader
				title="Your todos"
				action={
					<InlineAction onClick={() => setAdding(true)}>
						<span className="flex items-center gap-1">
							<Plus className="size-3" />
							Add
						</span>
					</InlineAction>
				}
			/>
			{adding ? (
				<form onSubmit={submit} className="px-1 pb-1">
					<input
						ref={(el) => el?.focus()}
						value={text}
						onChange={(event) => setText(event.target.value)}
						onBlur={submit}
						onKeyDown={(event) => {
							if (event.key === 'Escape') {
								setText('');
								setAdding(false);
							}
						}}
						placeholder="Add a todo..."
						className="h-7 w-full rounded-md border border-hairline bg-surface-2 px-2 text-[12px] leading-5 text-ink outline-none placeholder:text-ink-tertiary"
					/>
				</form>
			) : null}
			{todos.length === 0 && !adding ? (
				<div className="px-1 py-1 text-[12px] leading-5 text-ink-tertiary">No todos yet</div>
			) : (
				<div className="space-y-0.5">
					{todos.map((todo) => (
						<div
							key={todo.id}
							className="group flex h-7 items-center gap-2 rounded-md px-1 hover:bg-surface-2"
						>
							<button
								type="button"
								className={cn(
									'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
									todo.done
										? 'border-success bg-success text-white'
										: 'border-hairline-strong text-transparent hover:border-ink-subtle',
								)}
								aria-label={todo.done ? 'Mark todo as not done' : 'Mark todo as done'}
								onClick={() => toggleTodo(workspaceId, todo.id)}
							>
								<Check className="size-3" weight="bold" />
							</button>
							<span
								className={cn(
									'min-w-0 flex-1 truncate text-[12px] leading-5',
									todo.done ? 'text-ink-tertiary line-through' : 'text-ink',
								)}
								title={todo.text}
							>
								{todo.text}
							</span>
							<button
								type="button"
								className="hidden shrink-0 text-ink-tertiary transition-colors hover:text-ink group-hover:block"
								aria-label={`Remove todo: ${todo.text}`}
								onClick={() => removeTodo(workspaceId, todo.id)}
							>
								<X className="size-3.5" />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

export function RightSidebarChecks(props: RightSidebarChecksProps) {
	return (
		<div className="flex flex-col gap-3 px-2 py-2">
			<PrSummary snapshot={props.snapshot} />
			<GitStatusSection {...props} />
			<CommentsSection {...props} />
			<TodosSection workspaceId={props.workspaceId} />
		</div>
	);
}
