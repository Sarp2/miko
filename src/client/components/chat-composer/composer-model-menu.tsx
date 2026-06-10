import { CaretDown, Check } from '@phosphor-icons/react';

import type {
	AgentProvider,
	ProviderCatalogEntry,
	ProviderModelOption,
} from '../../../shared/types';
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

export function ComposerModelMenu({
	providers,
	provider,
	model,
	disabled,
	onProviderChange,
	onModelChange,
}: {
	providers: ProviderCatalogEntry[];
	provider: AgentProvider;
	model: ProviderModelOption | null;
	disabled?: boolean;
	onProviderChange: (provider: AgentProvider) => void;
	onModelChange: (provider: AgentProvider, modelId: string) => void;
}) {
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
					<span>{model?.label ?? 'Model'}</span>
					<CaretDown className="size-3" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-60 rounded-[10px] border-hairline bg-surface-1 p-1 shadow-none">
				{providers.map((entry, index) => (
					<DropdownMenuGroup key={entry.id}>
						{index > 0 ? <DropdownMenuSeparator className="bg-hairline" /> : null}
						<DropdownMenuLabel className="px-2 py-1 text-[11px] text-ink-subtle">
							{entry.label}
						</DropdownMenuLabel>
						{entry.models.map((candidate) => {
							const selected = provider === entry.id && candidate.id === model?.id;
							return (
								<DropdownMenuItem
									key={`${entry.id}:${candidate.id}`}
									className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] text-ink focus:bg-surface-2 focus:text-ink"
									onSelect={() => {
										onProviderChange(entry.id);
										onModelChange(entry.id, candidate.id);
									}}
								>
									<span className="min-w-0 flex-1 truncate">{candidate.label}</span>
									{selected ? <Check className="size-3.5 text-ink-muted" /> : null}
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuGroup>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
