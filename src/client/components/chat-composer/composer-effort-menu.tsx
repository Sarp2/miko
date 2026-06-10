import { CaretDown, Check } from '@phosphor-icons/react';

import type { ClaudeReasoningEffort, ProviderEffortOption } from '../../../shared/types';
import { Button } from '../ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export function ComposerEffortMenu({
	efforts,
	value,
	disabled,
	onChange,
}: {
	efforts: ProviderEffortOption[];
	value: ClaudeReasoningEffort;
	disabled?: boolean;
	onChange: (value: ClaudeReasoningEffort) => void;
}) {
	const current = efforts.find((effort) => effort.id === value);

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
					<span className="text-ink-subtle">Effort</span>
					<span>{current?.label ?? value}</span>
					<CaretDown className="size-3 text-ink-subtle" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-44 rounded-[10px] border-hairline bg-surface-1 p-1 shadow-none">
				{efforts.map((effort) => (
					<DropdownMenuItem
						key={effort.id}
						className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] font-medium text-ink focus:bg-surface-2 focus:text-ink"
						onSelect={() => onChange(effort.id as ClaudeReasoningEffort)}
					>
						<span className="flex-1">{effort.label}</span>
						{effort.id === value ? <Check className="size-3.5 text-ink-muted" /> : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
