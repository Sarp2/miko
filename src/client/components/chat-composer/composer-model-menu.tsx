import { CaretDown, Check } from '@phosphor-icons/react';

import type {
	AgentProvider,
	ClaudeContextWindow,
	ProviderCatalogEntry,
	ProviderModelOption,
} from '../../../shared/types';
import { ProviderIcon } from '../../lib/icons';
import { Button } from '../ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface ModelRow {
	modelId: string;
	label: string;
	contextWindow: ClaudeContextWindow | null;
}

function modelRows(model: ProviderModelOption): ModelRow[] {
	const options = model.contextWindowOptions ?? [];
	if (options.length === 0) {
		return [{ modelId: model.id, label: model.label, contextWindow: null }];
	}
	return options.map((option) => ({
		modelId: model.id,
		label: option.id === '200k' ? model.label : `${model.label} ${option.label}`,
		contextWindow: option.id,
	}));
}

function triggerLabel(model: ProviderModelOption | null, contextWindow: ClaudeContextWindow) {
	if (!model) return 'Model';
	const option = model.contextWindowOptions?.find((entry) => entry.id === contextWindow);
	return option && option.id !== '200k' ? `${model.label} ${option.label}` : model.label;
}

export function ComposerModelMenu({
	providers,
	provider,
	model,
	contextWindow,
	disabled,
	onProviderChange,
	onModelChange,
	onContextWindowChange,
}: {
	providers: ProviderCatalogEntry[];
	provider: AgentProvider;
	model: ProviderModelOption | null;
	contextWindow: ClaudeContextWindow;
	disabled?: boolean;
	onProviderChange: (provider: AgentProvider) => void;
	onModelChange: (provider: AgentProvider, modelId: string) => void;
	onContextWindowChange: (contextWindow: ClaudeContextWindow) => void;
}) {
	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					className="h-7 gap-1.5 rounded-md px-2 text-caption font-medium text-ink-muted hover:bg-surface-3 hover:text-ink"
				>
					<ProviderIcon provider={provider} className="size-3.5" />
					<span>{triggerLabel(model, contextWindow)}</span>
					<CaretDown className="size-3 text-ink-subtle" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-60 rounded-[10px] border-hairline bg-surface-1 p-1 shadow-none">
				{providers.map((entry, index) => (
					<DropdownMenuGroup key={entry.id}>
						{index > 0 ? <DropdownMenuSeparator className="bg-hairline" /> : null}
						<DropdownMenuLabel className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-ink-subtle">
							<ProviderIcon provider={entry.id} className="size-3" />
							{entry.label}
						</DropdownMenuLabel>
						{entry.models.flatMap((candidate) =>
							modelRows(candidate).map((row) => {
								const selected =
									provider === entry.id &&
									row.modelId === model?.id &&
									(row.contextWindow === null || row.contextWindow === contextWindow);
								return (
									<DropdownMenuItem
										key={`${entry.id}:${row.modelId}:${row.contextWindow ?? 'default'}`}
										className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] font-medium text-ink focus:bg-surface-2 focus:text-ink"
										onSelect={() => {
											onProviderChange(entry.id);
											onModelChange(entry.id, row.modelId);
											if (row.contextWindow) onContextWindowChange(row.contextWindow);
											else if (entry.id === 'claude') onContextWindowChange('200k');
										}}
									>
										<span className="min-w-0 flex-1 truncate">{row.label}</span>
										{selected ? <Check className="size-3.5 text-ink-muted" /> : null}
									</DropdownMenuItem>
								);
							}),
						)}
					</DropdownMenuGroup>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
