import {
	Archive,
	ArrowLeft,
	Database,
	Folder,
	GearSix,
	GitBranch,
	Keyboard,
	Robot,
	Trash,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
	type AgentProvider,
	CLAUDE_CONTEXT_WINDOW_OPTIONS,
	CLAUDE_REASONING_OPTIONS,
	type ClaudeContextWindow,
	type ClaudeReasoningEffort,
	CODEX_REASONING_OPTIONS,
	type CodexReasoningEffort,
	DEFAULT_CLAUDE_MODEL_OPTIONS,
	DEFAULT_CODEX_MODEL_OPTIONS,
	DEFAULT_KEYBINDINGS,
	type DirectorySummary,
	type KeybindingAction,
	type KeybindingsSnapshot,
	PROVIDERS,
	type WorkspaceSummary,
} from '../../shared/types';
import { Button } from '../components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '../components/ui/dialog';
import { Switch } from '../components/ui/switch';
import { ProviderIcon } from '../lib/icons';
import {
	formatShortcutLabel,
	KEYBINDING_ACTION_DESCRIPTIONS,
	KEYBINDING_ACTION_LABELS,
	KEYBINDING_ACTIONS,
	normalizeShortcut,
	shortcutFromKeyboardEvent,
} from '../lib/keybindings';
import { cn } from '../lib/utils';
import { useComposerPreferencesStore } from '../stores/composer-preferences-store';
import { useDirectoryListStore } from '../stores/directory-list-store';
import { useKeybindingsStore } from '../stores/keybindings-store';
import { useUiStore } from '../stores/ui-store';

const SECTIONS = [
	{ id: 'general', label: 'General', icon: GearSix },
	{ id: 'models', label: 'Models', icon: Robot },
	{ id: 'keybindings', label: 'Keybindings', icon: Keyboard },
	{ id: 'workspaces', label: 'Workspaces', icon: Folder },
	{ id: 'data', label: 'Data', icon: Database },
] as const;

type SettingsSectionId = (typeof SECTIONS)[number]['id'];

function providerLabel(provider: AgentProvider | null) {
	if (!provider) return 'System default';
	return PROVIDERS.find((entry) => entry.id === provider)?.label ?? provider;
}

function SettingRow({
	title,
	description,
	children,
	accent = false,
}: {
	title: string;
	description?: string;
	children: React.ReactNode;
	accent?: boolean;
}) {
	return (
		<div
			className={cn(
				'grid grid-cols-[minmax(0,1fr)_minmax(180px,260px)] items-center gap-8 border-b border-hairline py-5',
				accent && 'border-l-2 border-l-ink-muted pl-3',
			)}
		>
			<div className="min-w-0">
				<div className="text-[13px] font-semibold leading-5 text-ink">{title}</div>
				{description ? (
					<div className="mt-1 text-[12px] leading-5 text-ink-subtle">{description}</div>
				) : null}
			</div>
			<div className="flex justify-end">{children}</div>
		</div>
	);
}

function SettingsSelect({
	value,
	onChange,
	children,
	ariaLabel,
}: {
	value: string;
	onChange: (value: string) => void;
	children: React.ReactNode;
	ariaLabel: string;
}) {
	return (
		<select
			aria-label={ariaLabel}
			value={value}
			onChange={(event) => onChange(event.target.value)}
			className="h-8 w-full rounded-md border border-hairline bg-surface-1 px-2 text-[12px] font-medium text-ink outline-none focus:border-hairline-tertiary"
		>
			{children}
		</select>
	);
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
	return (
		<div className="mb-8">
			<h1 className="text-[22px] font-semibold leading-8 text-ink">{title}</h1>
			{description ? (
				<p className="mt-1 max-w-2xl text-[13px] leading-5 text-ink-subtle">{description}</p>
			) : null}
		</div>
	);
}

function DestructiveActionButton({
	children,
	title,
	description,
	confirmLabel,
	disabled,
	onConfirm,
	className,
}: {
	children: React.ReactNode;
	title: string;
	description: string;
	confirmLabel: string;
	disabled?: boolean;
	onConfirm: () => Promise<void>;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button type="button" variant="ghost" size="sm" disabled={disabled} className={className}>
					{children}
				</Button>
			</DialogTrigger>
			<DialogContent className="p-4" showCloseButton={!pending}>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={pending}
						className="h-7 rounded-md px-2 text-[12px] text-ink-muted hover:bg-surface-2 hover:text-ink"
						onClick={() => setOpen(false)}
					>
						Cancel
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={pending}
						className="h-7 rounded-md px-2 text-[12px] text-destructive hover:bg-destructive/10 hover:text-destructive"
						onClick={async () => {
							setPending(true);
							try {
								await onConfirm();
								setOpen(false);
							} finally {
								setPending(false);
							}
						}}
					>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function GeneralSettings() {
	const preferences = useComposerPreferencesStore();
	const provider = preferences.provider ?? PROVIDERS[0]?.id ?? 'claude';
	const providerCatalog = PROVIDERS.find((entry) => entry.id === provider) ?? PROVIDERS[0];
	const selectedModel =
		preferences.selectedModelByProvider[provider] ?? providerCatalog?.defaultModel ?? '';

	return (
		<div>
			<SectionTitle
				title="General"
				description="Choose the defaults new chats should start with. Existing sessions keep their own runtime provider."
			/>
			<div className="max-w-4xl">
				<SettingRow
					title="Default provider"
					description="Composer starts with this provider for new sessions."
				>
					<SettingsSelect
						ariaLabel="Default provider"
						value={provider}
						onChange={(value) => preferences.setProviderPreference(value as AgentProvider)}
					>
						{PROVIDERS.map((entry) => (
							<option key={entry.id} value={entry.id}>
								{entry.label}
							</option>
						))}
					</SettingsSelect>
				</SettingRow>
				<SettingRow
					title="Default model"
					description={`Used when ${providerLabel(provider)} starts a new chat.`}
				>
					<SettingsSelect
						ariaLabel="Default model"
						value={selectedModel}
						onChange={(value) => preferences.setModelPreference(provider, value)}
					>
						{providerCatalog?.models.map((model) => (
							<option key={model.id} value={model.id}>
								{model.label}
							</option>
						))}
					</SettingsSelect>
				</SettingRow>
				<SettingRow
					title="Plan mode"
					description="Start new sessions in plan mode by default."
					accent
				>
					<Switch
						aria-label="Default plan mode"
						size="sm"
						checked={preferences.planMode ?? false}
						onCheckedChange={preferences.setPlanModePreference}
					/>
				</SettingRow>
			</div>
		</div>
	);
}

function ModelSettings() {
	const preferences = useComposerPreferencesStore();
	return (
		<div>
			<SectionTitle
				title="Models"
				description="Tune provider-specific defaults. These values are applied before a session has its own runtime choices."
			/>
			<div className="max-w-4xl">
				<div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
					<ProviderIcon provider="claude" className="size-3" /> Claude
				</div>
				<SettingRow title="Reasoning effort" description="Default Claude thinking budget.">
					<SettingsSelect
						ariaLabel="Claude reasoning effort"
						value={
							preferences.claudeReasoningEffort ?? DEFAULT_CLAUDE_MODEL_OPTIONS.reasoningEffort
						}
						onChange={(value) =>
							preferences.setClaudeReasoningEffortPreference(value as ClaudeReasoningEffort)
						}
					>
						{CLAUDE_REASONING_OPTIONS.map((option) => (
							<option key={option.id} value={option.id}>
								{option.label}
							</option>
						))}
					</SettingsSelect>
				</SettingRow>
				<SettingRow
					title="Context window"
					description="Default Claude context size when the model supports it."
				>
					<SettingsSelect
						ariaLabel="Claude context window"
						value={preferences.claudeContextWindow ?? DEFAULT_CLAUDE_MODEL_OPTIONS.contextWindow}
						onChange={(value) =>
							preferences.setClaudeContextWindowPreference(value as ClaudeContextWindow)
						}
					>
						{CLAUDE_CONTEXT_WINDOW_OPTIONS.map((option) => (
							<option key={option.id} value={option.id}>
								{option.label}
							</option>
						))}
					</SettingsSelect>
				</SettingRow>

				<div className="mt-8 mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
					<ProviderIcon provider="codex" className="size-3" /> Codex
				</div>
				<SettingRow title="Reasoning effort" description="Default Codex reasoning effort.">
					<SettingsSelect
						ariaLabel="Codex reasoning effort"
						value={preferences.codexReasoningEffort ?? DEFAULT_CODEX_MODEL_OPTIONS.reasoningEffort}
						onChange={(value) =>
							preferences.setCodexReasoningEffortPreference(value as CodexReasoningEffort)
						}
					>
						{CODEX_REASONING_OPTIONS.map((option) => (
							<option key={option.id} value={option.id}>
								{option.label}
							</option>
						))}
					</SettingsSelect>
				</SettingRow>
				<SettingRow
					title="Fast mode"
					description="Prefer the fast Codex service tier when available."
					accent
				>
					<Switch
						aria-label="Codex fast mode"
						size="sm"
						checked={preferences.codexFastMode ?? DEFAULT_CODEX_MODEL_OPTIONS.fastMode}
						onCheckedChange={preferences.setCodexFastModePreference}
					/>
				</SettingRow>
			</div>
		</div>
	);
}

function cloneBindings(bindings: KeybindingsSnapshot['bindings']) {
	return Object.fromEntries(
		KEYBINDING_ACTIONS.map((action) => [action, [...bindings[action]]]),
	) as KeybindingsSnapshot['bindings'];
}

function bindingsEqual(
	left: KeybindingsSnapshot['bindings'],
	right: KeybindingsSnapshot['bindings'],
) {
	return KEYBINDING_ACTIONS.every(
		(action) =>
			left[action].length === right[action].length &&
			left[action].every((shortcut, index) => shortcut === right[action][index]),
	);
}

function KeybindingRecorder({
	onRecord,
	disabled,
}: {
	onRecord: (shortcut: string) => void;
	disabled?: boolean;
}) {
	const [recording, setRecording] = useState(false);

	useEffect(() => {
		if (!recording) return;

		const shouldRecordShortcut = (event: KeyboardEvent) => {
			const key = event.key.toLowerCase();
			return (
				key !== 'meta' && key !== 'control' && key !== 'ctrl' && key !== 'alt' && key !== 'shift'
			);
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === 'Escape') {
				setRecording(false);
				return;
			}

			const shortcut = shortcutFromKeyboardEvent(event);
			if (!shortcut) return;
			if (!shouldRecordShortcut(event)) return;
			onRecord(shortcut);
			setRecording(false);
		};

		window.addEventListener('keydown', handleKeyDown, { capture: true });
		return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
	}, [onRecord, recording]);

	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			disabled={disabled}
			className={cn(
				'h-7 rounded-md px-2 text-[12px] text-ink-muted hover:bg-surface-2 hover:text-ink',
				recording && 'bg-surface-3 text-ink',
			)}
			onClick={() => setRecording(true)}
		>
			{recording ? 'Press keys' : 'Record'}
		</Button>
	);
}

function KeybindingsSettings() {
	const snapshot = useKeybindingsStore((state) => state.snapshot);
	const writeKeybindings = useKeybindingsStore((state) => state.writeKeybindings);
	const [draft, setDraft] = useState<KeybindingsSnapshot['bindings']>(() =>
		cloneBindings(DEFAULT_KEYBINDINGS),
	);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (snapshot) setDraft(cloneBindings(snapshot.bindings));
	}, [snapshot]);

	if (!snapshot) {
		return (
			<div>
				<SectionTitle
					title="Keybindings"
					description="Customize shortcuts stored in the Miko keybindings file."
				/>
				<div className="text-[12px] leading-5 text-ink-tertiary">Loading keybindings…</div>
			</div>
		);
	}

	const dirty = !bindingsEqual(draft, snapshot.bindings);

	const updateAction = (action: KeybindingAction, shortcuts: string[]) => {
		setDraft((current) => ({ ...current, [action]: shortcuts }));
	};

	const save = async () => {
		if (!dirty || saving) return;
		setSaving(true);
		try {
			const saved = await writeKeybindings(draft);
			setDraft(cloneBindings(saved.bindings));
			toast.success('Keybindings saved');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not save keybindings');
		} finally {
			setSaving(false);
		}
	};

	return (
		<div>
			<SectionTitle
				title="Keybindings"
				description={`Customize application shortcuts. Stored in ${snapshot.filePathDisplay}.`}
			/>
			<div className="max-w-5xl">
				{snapshot.warning ? (
					<div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] leading-5 text-warning">
						{snapshot.warning}
					</div>
				) : null}
				<div className="divide-y divide-hairline border-y border-hairline">
					{KEYBINDING_ACTIONS.map((action) => {
						const shortcuts = draft[action].map(normalizeShortcut).filter(Boolean);
						return (
							<div
								key={action}
								className="grid grid-cols-[minmax(0,1fr)_minmax(280px,420px)] items-center gap-8 py-4"
							>
								<div className="min-w-0">
									<div className="text-[13px] font-semibold leading-5 text-ink">
										{KEYBINDING_ACTION_LABELS[action]}
									</div>
									<div className="mt-1 text-[12px] leading-5 text-ink-subtle">
										{KEYBINDING_ACTION_DESCRIPTIONS[action]}
									</div>
								</div>
								<div className="flex min-w-0 items-center justify-end gap-2">
									<div className="flex min-w-0 flex-1 flex-wrap justify-end gap-1.5">
										{shortcuts.map((shortcut) => (
											<button
												key={shortcut}
												type="button"
												className="inline-flex h-7 items-center rounded-md border border-hairline bg-surface-1 px-2 font-mono text-[11px] text-ink hover:bg-surface-2"
												title="Remove shortcut"
												onClick={() =>
													updateAction(
														action,
														shortcuts.filter((candidate) => candidate !== shortcut),
													)
												}
											>
												{formatShortcutLabel(shortcut)}
											</button>
										))}
									</div>
									<KeybindingRecorder
										disabled={saving}
										onRecord={(shortcut) => {
											const normalized = normalizeShortcut(shortcut);
											if (!normalized) return;
											updateAction(action, [...new Set([...shortcuts, normalized])]);
										}}
									/>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={saving}
										className="h-7 rounded-md px-2 text-[12px] text-ink-muted hover:bg-surface-2 hover:text-ink"
										onClick={() => updateAction(action, [...DEFAULT_KEYBINDINGS[action]])}
									>
										Reset
									</Button>
								</div>
							</div>
						);
					})}
				</div>
				<div className="mt-5 flex items-center justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={!dirty || saving}
						className="h-8 rounded-md px-3 text-[12px] text-ink-muted hover:bg-surface-2 hover:text-ink"
						onClick={() => setDraft(cloneBindings(snapshot.bindings))}
					>
						Discard
					</Button>
					<Button type="button" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
						{saving ? 'Saving…' : 'Save'}
					</Button>
				</div>
			</div>
		</div>
	);
}

function workspaceStatusLabel(workspace: WorkspaceSummary) {
	if (workspace.visibilityState === 'archived') return 'Archived';
	if (workspace.setupState === 'creating') return 'Creating';
	if (workspace.setupState === 'failed') return 'Failed';
	return 'Active';
}

function WorkspacesSettings() {
	const snapshot = useDirectoryListStore((state) => state.snapshot);
	const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
	const workspacesByDirectory = useMemo(() => {
		const groups = new Map<string, WorkspaceSummary[]>();
		for (const workspace of snapshot?.workspaces ?? []) {
			const list = groups.get(workspace.directoryId) ?? [];
			list.push(workspace);
			groups.set(workspace.directoryId, list);
		}
		return groups;
	}, [snapshot]);

	const removeWorkspaceUi = useUiStore((state) => state.removeWorkspaceUi);

	const directoryBusyIds = (directoryId: string) => [
		`directory:${directoryId}`,
		...(workspacesByDirectory.get(directoryId) ?? []).map(
			(workspace) => `workspace:${workspace.id}`,
		),
	];
	const workspaceBusyIds = (workspace: WorkspaceSummary) => [
		`directory:${workspace.directoryId}`,
		`workspace:${workspace.id}`,
	];
	const hasBusyId = (ids: string[]) => ids.some((id) => busyIds.has(id));

	const runAction = async (ids: string[], action: () => Promise<void>, success: string) => {
		if (hasBusyId(ids)) return;
		setBusyIds((current) => {
			const next = new Set(current);
			for (const id of ids) next.add(id);
			return next;
		});
		try {
			await action();
			toast.success(success);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Action failed');
		} finally {
			setBusyIds((current) => {
				const next = new Set(current);
				for (const id of ids) next.delete(id);
				return next;
			});
		}
	};

	const removeDirectory = (directory: DirectorySummary) => {
		const workspaces = workspacesByDirectory.get(directory.id) ?? [];
		return runAction(
			directoryBusyIds(directory.id),
			async () => {
				await useDirectoryListStore.getState().removeDirectory(directory.id);
				for (const workspace of workspaces) removeWorkspaceUi(workspace.id);
			},
			'Removed directory from Miko',
		);
	};

	const removeWorkspace = (workspace: WorkspaceSummary) => {
		return runAction(
			workspaceBusyIds(workspace),
			async () => {
				await useDirectoryListStore.getState().removeWorkspace(workspace.id);
				removeWorkspaceUi(workspace.id);
			},
			'Deleted workspace from Miko',
		);
	};

	return (
		<div>
			<SectionTitle
				title="Workspaces"
				description="Manage connected repositories and worktrees. Destructive actions remove app records only; files stay on disk."
			/>
			{snapshot === null ? (
				<div className="text-[12px] leading-5 text-ink-tertiary">Loading workspaces…</div>
			) : snapshot.directories.length === 0 ? (
				<div className="border-y border-hairline py-4 text-[13px] text-ink-subtle">
					No directories connected yet.
				</div>
			) : (
				<div className="max-w-5xl divide-y divide-hairline border-y border-hairline">
					{snapshot.directories.map((directory) => {
						const workspaces = workspacesByDirectory.get(directory.id) ?? [];
						return (
							<section key={directory.id} className="py-4">
								<header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-1">
									<div className="min-w-0">
										<div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
											<Folder className="size-3.5 text-ink-subtle" />
											<span className="truncate">{directory.title}</span>
										</div>
										<div className="mt-0.5 truncate font-mono text-[11px] text-ink-subtle">
											{directory.localPath}
										</div>
									</div>
									<DestructiveActionButton
										title={`Remove ${directory.title} from Miko?`}
										description={`This removes the directory from Miko and deletes Miko-owned data for ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}: sessions, transcripts, scratchpads, uploads, and generated attachments. Repository files and worktrees stay on disk.`}
										confirmLabel="Remove"
										disabled={hasBusyId(directoryBusyIds(directory.id))}
										className="h-7 rounded-md px-2 text-[12px] text-destructive hover:bg-destructive/10 hover:text-destructive"
										onConfirm={() => removeDirectory(directory)}
									>
										Remove
									</DestructiveActionButton>
								</header>
								<div className="mt-3 divide-y divide-hairline border-t border-hairline">
									{workspaces.length === 0 ? (
										<div className="px-1 py-3 text-[12px] text-ink-tertiary">No workspaces.</div>
									) : (
										workspaces.map((workspace) => (
											<div
												key={workspace.id}
												className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-1 py-3"
											>
												<div className="min-w-0">
													<div className="flex items-center gap-2 text-[12px] font-medium text-ink">
														<GitBranch className="size-3.5 text-ink-subtle" />
														<span className="truncate">{workspace.branchName}</span>
														<span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-subtle">
															{workspaceStatusLabel(workspace)}
														</span>
													</div>
													<div className="mt-0.5 truncate font-mono text-[11px] text-ink-subtle">
														{workspace.localPath}
													</div>
												</div>
												<div className="flex items-center gap-1.5">
													<Button
														type="button"
														variant="ghost"
														size="sm"
														disabled={hasBusyId(workspaceBusyIds(workspace))}
														className="h-7 rounded-md px-2 text-[12px] text-ink-muted hover:bg-surface-2 hover:text-ink"
														onClick={() => {
															const next =
																workspace.visibilityState === 'archived' ? 'active' : 'archived';
															void runAction(
																workspaceBusyIds(workspace),
																async () => {
																	await useDirectoryListStore
																		.getState()
																		.setWorkspaceVisibility(workspace.id, next);
																	if (next === 'archived') removeWorkspaceUi(workspace.id);
																},
																next === 'active' ? 'Restored workspace' : 'Archived workspace',
															);
														}}
													>
														<Archive className="size-3" />
														{workspace.visibilityState === 'archived' ? 'Restore' : 'Archive'}
													</Button>
													<DestructiveActionButton
														title={`Delete ${workspace.branchName} from Miko?`}
														description="This deletes Miko-owned data for this workspace: sessions, transcripts, scratchpad, uploads, pasted text, and generated attachments. The repository/worktree folder stays on disk."
														confirmLabel="Delete"
														disabled={hasBusyId(workspaceBusyIds(workspace))}
														className="h-7 rounded-md px-2 text-[12px] text-destructive hover:bg-destructive/10 hover:text-destructive"
														onConfirm={() => removeWorkspace(workspace)}
													>
														<Trash className="size-3" />
														Delete
													</DestructiveActionButton>
												</div>
											</div>
										))
									)}
								</div>
							</section>
						);
					})}
				</div>
			)}
		</div>
	);
}

function DataSettings() {
	const resetComposerPreferences = useComposerPreferencesStore(
		(state) => state.resetComposerPreferences,
	);
	const resetLocalUiState = useUiStore((state) => state.resetLocalUiState);

	return (
		<div>
			<SectionTitle
				title="Data"
				description="Reset local client preferences. This does not delete repositories, worktrees, or transcripts."
			/>
			<div className="max-w-4xl">
				<SettingRow
					title="Composer defaults"
					description="Clear saved provider, model, effort, fast mode, and plan mode defaults."
				>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 rounded-md px-2 text-[12px] text-ink-muted hover:bg-surface-2 hover:text-ink"
						onClick={() => {
							resetComposerPreferences();
							toast.success('Composer defaults reset');
						}}
					>
						Reset
					</Button>
				</SettingRow>
				<SettingRow
					title="Local UI state"
					description="Clear tabs, viewed diff markers, pinned workspaces, and panel preferences."
					accent
				>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 rounded-md px-2 text-[12px] text-destructive hover:bg-destructive/10 hover:text-destructive"
						onClick={() => {
							if (
								!window.confirm(
									'Reset local UI state? This clears local tabs and view preferences.',
								)
							)
								return;
							resetLocalUiState();
							toast.success('Local UI state reset');
						}}
					>
						Reset
					</Button>
				</SettingRow>
			</div>
		</div>
	);
}

function ActiveSection({ section }: { section: SettingsSectionId }) {
	if (section === 'general') return <GeneralSettings />;
	if (section === 'models') return <ModelSettings />;
	if (section === 'keybindings') return <KeybindingsSettings />;
	if (section === 'workspaces') return <WorkspacesSettings />;
	return <DataSettings />;
}

export function SettingsRoute() {
	const navigate = useNavigate();
	const [activeSection, setActiveSection] = useState<SettingsSectionId>('general');

	useEffect(() => {
		useDirectoryListStore.getState().connectDirectoryList();
		useKeybindingsStore.getState().connectKeybindings();
		return () => {
			useDirectoryListStore.getState().disconnectDirectoryList();
			useKeybindingsStore.getState().disconnectKeybindings();
		};
	}, []);

	return (
		<section
			data-testid="settings-route"
			className="flex h-screen w-screen flex-col bg-canvas text-ink"
		>
			<header className="flex h-[52px] shrink-0 items-center border-b border-hairline px-6">
				<button
					type="button"
					className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-ink-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
					onClick={() => navigate(-1)}
				>
					<ArrowLeft className="size-4" />
					Back
				</button>
			</header>

			<div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
				<aside className="border-r border-hairline px-2 py-3">
					<nav className="flex flex-col gap-1">
						{SECTIONS.map((section) => {
							const Icon = section.icon;
							const active = activeSection === section.id;
							return (
								<button
									key={section.id}
									type="button"
									className={cn(
										'flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium text-ink-muted outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-primary',
										active && 'bg-surface-2 text-ink',
									)}
									onClick={() => setActiveSection(section.id)}
								>
									<Icon className="size-4 text-ink-subtle" />
									{section.label}
								</button>
							);
						})}
					</nav>
				</aside>

				<main className="scrollbar-miko min-h-0 overflow-y-auto px-10 py-9">
					<ActiveSection section={activeSection} />
				</main>
			</div>
		</section>
	);
}
