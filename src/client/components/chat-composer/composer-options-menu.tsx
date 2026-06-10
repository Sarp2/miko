import { CaretDown, Check } from '@phosphor-icons/react';

import type {
	AgentProvider,
	ClaudeContextWindow,
	ClaudeReasoningEffort,
	ProviderCatalogEntry,
	ProviderModelOption,
} from '../../../shared/types';
import { Button } from '../ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export function ComposerOptionsMenu({
	provider,
	providerCatalog,
	model,
	planMode,
	claudeReasoningEffort,
	claudeContextWindow,
	codexFastMode,
	disabled,
	onPlanModeChange,
	onClaudeReasoningEffortChange,
	onClaudeContextWindowChange,
	onCodexFastModeChange,
}: {
	provider: AgentProvider;
	providerCatalog: ProviderCatalogEntry;
	model: ProviderModelOption | null;
	planMode: boolean;
	claudeReasoningEffort: ClaudeReasoningEffort;
	claudeContextWindow: ClaudeContextWindow;
	codexFastMode: boolean;
	disabled?: boolean;
	onPlanModeChange: (value: boolean) => void;
	onClaudeReasoningEffortChange: (value: ClaudeReasoningEffort) => void;
	onClaudeContextWindowChange: (value: ClaudeContextWindow) => void;
	onCodexFastModeChange: (value: boolean) => void;
}) {
	const claudeContextOptions = model?.contextWindowOptions ?? [];

	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					className="h-7 rounded-md px-2 text-caption font-medium text-ink-subtle hover:text-ink"
				>
					Options
					<CaretDown className="size-3" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-56 rounded-[10px] border-hairline bg-surface-1 p-1 shadow-none">
				{providerCatalog.supportsPlanMode ? (
					<DropdownMenuItem
						className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] text-ink focus:bg-surface-2 focus:text-ink"
						onSelect={(event) => {
							event.preventDefault();
							onPlanModeChange(!planMode);
						}}
					>
						<span className="flex-1">Plan mode</span>
						{planMode ? <Check className="size-3.5" /> : null}
					</DropdownMenuItem>
				) : null}

				{provider === 'claude' ? (
					<>
						<DropdownMenuSeparator className="bg-hairline" />
						<DropdownMenuLabel className="px-2 py-1 text-[11px] text-ink-subtle">
							Effort
						</DropdownMenuLabel>
						{providerCatalog.efforts.map((effort) => (
							<DropdownMenuItem
								key={effort.id}
								className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] text-ink focus:bg-surface-2 focus:text-ink"
								onSelect={() => onClaudeReasoningEffortChange(effort.id as ClaudeReasoningEffort)}
							>
								<span className="flex-1">{effort.label}</span>
								{effort.id === claudeReasoningEffort ? <Check className="size-3.5" /> : null}
							</DropdownMenuItem>
						))}
						{claudeContextOptions.length > 0 ? (
							<>
								<DropdownMenuSeparator className="bg-hairline" />
								<DropdownMenuLabel className="px-2 py-1 text-[11px] text-ink-subtle">
									Context
								</DropdownMenuLabel>
								{claudeContextOptions.map((option) => (
									<DropdownMenuItem
										key={option.id}
										className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] text-ink focus:bg-surface-2 focus:text-ink"
										onSelect={() => onClaudeContextWindowChange(option.id)}
									>
										<span className="flex-1">{option.label}</span>
										{option.id === claudeContextWindow ? <Check className="size-3.5" /> : null}
									</DropdownMenuItem>
								))}
							</>
						) : null}
					</>
				) : null}

				{provider === 'codex' ? (
					<>
						<DropdownMenuSeparator className="bg-hairline" />
						<DropdownMenuItem
							className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] text-ink focus:bg-surface-2 focus:text-ink"
							onSelect={(event) => {
								event.preventDefault();
								onCodexFastModeChange(!codexFastMode);
							}}
						>
							<span className="flex-1">Fast mode</span>
							{codexFastMode ? <Check className="size-3.5" /> : null}
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
