import { CaretDown, SquaresFour } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { EditorOpenSettings } from '../../../shared/protocol';
import { cn } from '../../lib/utils';
import { type ExternalOpenApp, useUiStore } from '../../stores/ui-store';
import { type OpenExternalArgs, useWorkspaceStore } from '../../stores/workspace-store';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

interface ExternalOpenOption {
	value: ExternalOpenApp;
	label: string;
	iconSrc: string;
}

const EXTERNAL_OPEN_APPS: ExternalOpenOption[] = [
	{ value: 'finder', label: 'Finder', iconSrc: '/finder.png' },
	{ value: 'cursor', label: 'Cursor', iconSrc: '/cursor.png' },
	{ value: 'warp', label: 'Warp', iconSrc: '/warp.png' },
	{ value: 'terminal', label: 'Terminal', iconSrc: '/terminal.png' },
	{ value: 'antigravity', label: 'Antigravity', iconSrc: '/antigravity.webp' },
];

const EDITOR_OPEN_SETTINGS: Record<'cursor' | 'warp' | 'antigravity', EditorOpenSettings> = {
	cursor: { preset: 'cursor' },
	warp: { preset: 'warp' },
	antigravity: { preset: 'antigravity' },
};

function externalOpenArgs(app: ExternalOpenApp, localPath: string): OpenExternalArgs | null {
	if (app === 'finder') return { localPath, action: 'open_finder' };
	if (app === 'terminal') return { localPath, action: 'open_terminal' };
	if (app === 'cursor' || app === 'warp' || app === 'antigravity') {
		return { localPath, action: 'open_editor', editor: EDITOR_OPEN_SETTINGS[app] };
	}
	return null;
}

function toErrorMessage(error: unknown, fallback: string) {
	return error instanceof Error && error.message ? error.message : fallback;
}

function ExternalAppIcon({
	option,
	className,
}: {
	option: ExternalOpenOption;
	className?: string;
}) {
	return (
		<span
			className={cn(
				'flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-4',
				className,
			)}
		>
			<img src={option.iconSrc} alt="" className="size-full object-cover" draggable={false} />
		</span>
	);
}

export function ExternalOpenMenu({ localPath }: { localPath: string }) {
	const externalOpenApp = useUiStore((state) => state.externalOpenApp);
	const setExternalOpenApp = useUiStore((state) => state.setExternalOpenApp);
	const openExternal = useWorkspaceStore((state) => state.openExternal);

	const selectedOption =
		EXTERNAL_OPEN_APPS.find((app) => app.value === externalOpenApp) ?? EXTERNAL_OPEN_APPS[0];

	const open = async (app: ExternalOpenApp) => {
		const option = EXTERNAL_OPEN_APPS.find((item) => item.value === app) ?? selectedOption;
		const args = externalOpenArgs(app, localPath);

		if (!args) {
			toast.error(`Could not open in ${option.label}`);
			return;
		}

		try {
			await openExternal(args);
		} catch (error) {
			toast.error(toErrorMessage(error, `Could not open in ${option.label}`));
		}
	};

	const copyPath = async () => {
		try {
			await navigator.clipboard.writeText(localPath);
			toast.success('Workspace path copied');
		} catch (error) {
			toast.error(toErrorMessage(error, 'Could not copy workspace path'));
		}
	};

	return (
		<div className="flex h-6 shrink-0 overflow-hidden rounded-md border border-hairline-strong bg-surface-1">
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						className="flex w-6 items-center justify-center text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
						aria-label={`Open workspace in ${selectedOption.label}`}
						onClick={() => void open(selectedOption.value)}
					>
						<ExternalAppIcon option={selectedOption} className="size-3.5 rounded-[3px]" />
					</button>
				</TooltipTrigger>
				<TooltipContent>Open in {selectedOption.label}</TooltipContent>
			</Tooltip>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						className="flex w-6 items-center justify-center border-l border-hairline-strong text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
						aria-label="Choose external app"
					>
						<CaretDown className="size-3" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					className="min-w-[190px] rounded-xl border-hairline bg-surface-2 p-1 shadow-xl"
				>
					<DropdownMenuGroup>
						{EXTERNAL_OPEN_APPS.map((app) => (
							<DropdownMenuItem
								key={app.value}
								className={cn(
									'flex h-9 cursor-default items-center gap-2 rounded-lg px-2 text-[13px] text-ink focus:bg-surface-3 focus:text-ink',
									app.value === externalOpenApp && 'bg-surface-3',
								)}
								onSelect={() => setExternalOpenApp(app.value)}
							>
								<ExternalAppIcon option={app} className="size-5 rounded-[5px]" />
								<span className="min-w-0 flex-1 truncate">{app.label}</span>
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
					<DropdownMenuSeparator className="bg-hairline" />
					<DropdownMenuGroup>
						<DropdownMenuItem
							className="flex h-9 cursor-default items-center gap-2 rounded-lg px-2 text-[13px] text-ink focus:bg-surface-3 focus:text-ink"
							onSelect={() => void copyPath()}
						>
							<span className="flex size-5 items-center justify-center text-ink-subtle">
								<SquaresFour className="size-4" />
							</span>
							<span className="min-w-0 flex-1 truncate">Copy path</span>
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
