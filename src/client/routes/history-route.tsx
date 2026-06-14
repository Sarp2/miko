import { Archive, ClockCounterClockwise, GitBranch, MagnifyingGlass } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DirectoryListSnapshot, DirectorySummary, WorkspaceSummary } from '../../shared/types';
import { cn } from '../lib/utils';
import { useDirectoryListStore } from '../stores/directory-list-store';
import { useSidebarStore } from '../stores/sidebar-store';

interface HistoryWorkspaceRow {
	workspace: WorkspaceSummary;
	directory: DirectorySummary;
	label: string;
	activityAt: number;
}

interface HistoryGroup {
	key: string;
	label: string;
	rows: HistoryWorkspaceRow[];
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
	month: 'short',
	day: 'numeric',
});

function normalizeSearch(value: string) {
	return value.trim().toLowerCase();
}

function workspaceLabel(workspace: WorkspaceSummary) {
	return workspace.pullRequest?.title?.trim() || workspace.branchName;
}

function workspaceActivityAt(workspace: WorkspaceSummary) {
	return workspace.updatedAt || workspace.createdAt;
}

function startOfDay(time: number) {
	const date = new Date(time);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

function groupLabel(time: number, now = Date.now()) {
	const daysAgo = Math.max(0, Math.floor((startOfDay(now) - startOfDay(time)) / 86_400_000));
	if (daysAgo === 0) return 'Today';
	if (daysAgo === 1) return 'Yesterday';
	if (daysAgo < 7) return `${daysAgo} days ago`;
	const weeksAgo = Math.floor(daysAgo / 7);
	if (weeksAgo <= 4) return weeksAgo === 1 ? '1 week ago' : `${weeksAgo} weeks ago`;
	return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
		new Date(time),
	);
}

function rowMatchesQuery(row: HistoryWorkspaceRow, query: string) {
	if (!query) return true;
	return [
		row.label,
		row.workspace.branchName,
		row.workspace.pullRequest?.number ? `#${row.workspace.pullRequest.number}` : '',
		row.directory.title,
		row.directory.githubOwner,
		row.directory.githubRepo,
		row.directory.localPath,
		row.workspace.localPath,
	]
		.join(' ')
		.toLowerCase()
		.includes(query);
}

function rowsFromSnapshot(snapshot: DirectoryListSnapshot | null) {
	if (!snapshot) return [];
	const directoryById = new Map(snapshot.directories.map((directory) => [directory.id, directory]));

	return snapshot.workspaces
		.map((workspace) => {
			const directory = directoryById.get(workspace.directoryId);
			if (!directory) return null;
			return {
				workspace,
				directory,
				label: workspaceLabel(workspace),
				activityAt: workspaceActivityAt(workspace),
			};
		})
		.filter((row): row is HistoryWorkspaceRow => Boolean(row))
		.toSorted((a, b) => b.activityAt - a.activityAt);
}

function groupedRows(rows: HistoryWorkspaceRow[]) {
	const groups: HistoryGroup[] = [];
	for (const row of rows) {
		const label = groupLabel(row.activityAt);
		const key = label;
		const last = groups.at(-1);
		if (last?.key === key) {
			last.rows.push(row);
			continue;
		}
		groups.push({ key, label, rows: [row] });
	}
	return groups;
}

function HistoryWorkspaceRowView({
	row,
	onOpen,
}: {
	row: HistoryWorkspaceRow;
	onOpen: (workspaceId: string) => void;
}) {
	const prNumber = row.workspace.pullRequest?.number;
	const isArchived = row.workspace.visibilityState === 'archived';
	const showBranchName = row.label !== row.workspace.branchName;

	return (
		<button
			type="button"
			className="group grid h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-md px-2 text-left text-[13px] leading-5 text-ink-muted outline-none transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-primary"
			onClick={() => onOpen(row.workspace.id)}
		>
			<span className="grid min-w-0 grid-cols-[16px_minmax(0,0.32fr)_10px_minmax(0,1fr)] items-center gap-2">
				{isArchived ? (
					<Archive className="size-3.5 justify-self-center text-ink-subtle" />
				) : (
					<GitBranch className="size-3.5 justify-self-center text-ink-subtle" />
				)}
				<span className="truncate font-medium text-ink group-hover:text-ink">
					{row.directory.title}
				</span>
				<span className="text-[16px] leading-none text-ink-tertiary">›</span>
				<span className="min-w-0 truncate">
					<span className="font-medium text-ink group-hover:text-ink">{row.label}</span>
					{showBranchName ? (
						<span className="ml-1.5 font-mono text-[11px] font-normal text-ink-subtle">
							{row.workspace.branchName}
						</span>
					) : null}
				</span>
			</span>

			<span className="flex min-w-[76px] items-center justify-end gap-2 text-[12px] text-ink-subtle">
				{prNumber ? <span className="font-mono">#{prNumber}</span> : null}
				<span className="tabular-nums group-hover:hidden">
					{dateFormatter.format(row.activityAt)}
				</span>
				<span className="hidden text-[12px] text-ink-muted group-hover:inline">Go to →</span>
			</span>
		</button>
	);
}

function EmptyHistoryState({ hasQuery }: { hasQuery: boolean }) {
	return (
		<div className="flex h-full items-center justify-center px-6 text-center">
			<div className="flex max-w-sm flex-col items-center gap-2">
				<ClockCounterClockwise className="size-5 text-ink-tertiary" />
				<p className="text-[13px] font-medium leading-5 text-ink">
					{hasQuery ? 'No matching workspaces' : 'No workspace activity yet'}
				</p>
				<p className="text-[12px] leading-5 text-ink-subtle">
					{hasQuery
						? 'Try a branch, repository, or PR number.'
						: 'Workspace activity will appear here as branches are created and updated.'}
				</p>
			</div>
		</div>
	);
}

export function HistoryRoute() {
	const navigate = useNavigate();
	const snapshot = useDirectoryListStore((state) => state.snapshot);
	const [query, setQuery] = useState('');
	const [restoreError, setRestoreError] = useState<string | null>(null);

	useEffect(() => {
		useDirectoryListStore.getState().connectDirectoryList();
		return () => useDirectoryListStore.getState().disconnectDirectoryList();
	}, []);

	const rows = useMemo(() => rowsFromSnapshot(snapshot), [snapshot]);
	const normalizedQuery = normalizeSearch(query);
	const filteredRows = useMemo(
		() => rows.filter((row) => rowMatchesQuery(row, normalizedQuery)),
		[normalizedQuery, rows],
	);
	const groups = useMemo(() => groupedRows(filteredRows), [filteredRows]);

	const openWorkspace = async (workspaceId: string) => {
		setRestoreError(null);
		const workspace = rows.find((row) => row.workspace.id === workspaceId)?.workspace;
		try {
			if (workspace?.visibilityState === 'archived') {
				await useSidebarStore.getState().setWorkspaceVisibility(workspaceId, 'active');
			}
			navigate(`/workspaces/${encodeURIComponent(workspaceId)}`);
		} catch (error) {
			setRestoreError(error instanceof Error ? error.message : 'Failed to open workspace');
		}
	};

	return (
		<section
			data-testid="history-route"
			className="flex h-full min-h-0 flex-col bg-canvas text-ink"
		>
			<header className="flex h-12 shrink-0 items-center border-b border-hairline px-8">
				<label className="flex h-full w-full items-center gap-2.5 text-ink">
					<MagnifyingGlass className="size-4.5 shrink-0 text-ink-tertiary" />
					<input
						type="search"
						aria-label="Filter workspaces"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Filter workspaces…"
						className="h-full min-w-0 flex-1 bg-transparent text-[15px] font-normal leading-6 text-ink outline-none placeholder:text-ink-tertiary"
					/>
				</label>
			</header>

			{restoreError ? (
				<div className="mx-4 mt-3 rounded-md border border-destructive/30 bg-surface-1 px-3 py-2 text-[12px] leading-5 text-destructive">
					{restoreError}
				</div>
			) : null}

			<div
				className={cn(
					'scrollbar-miko min-h-0 flex-1 overflow-y-auto px-8 py-6',
					groups.length === 0 && 'overflow-hidden',
				)}
			>
				{snapshot === null ? (
					<div className="flex h-full items-center justify-center text-[12px] leading-5 text-ink-tertiary">
						Loading history…
					</div>
				) : groups.length === 0 ? (
					<EmptyHistoryState hasQuery={normalizedQuery.length > 0} />
				) : (
					<div className="flex w-full flex-col gap-6">
						{groups.map((group) => (
							<section key={group.key} className="flex flex-col gap-2.5">
								<div className="flex items-center gap-2 px-2 text-[13px] font-semibold leading-5 text-ink-subtle">
									<span>{group.label}</span>
									<span className="text-ink-tertiary">{group.rows.length}</span>
								</div>
								<div className="flex flex-col gap-0.5">
									{group.rows.map((row) => (
										<HistoryWorkspaceRowView
											key={row.workspace.id}
											row={row}
											onOpen={openWorkspace}
										/>
									))}
								</div>
							</section>
						))}
					</div>
				)}
			</div>
		</section>
	);
}
