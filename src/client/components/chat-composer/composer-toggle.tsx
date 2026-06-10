import type { Icon } from '@phosphor-icons/react';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

export function ComposerToggle({
	label,
	icon: IconComponent,
	active,
	disabled,
	onToggle,
}: {
	label: string;
	icon?: Icon;
	active: boolean;
	disabled?: boolean;
	onToggle: () => void;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			disabled={disabled}
			aria-pressed={active}
			onClick={onToggle}
			className={cn(
				'h-7 gap-1.5 rounded-md px-2 text-caption font-medium transition-colors',
				active
					? 'text-ink hover:bg-surface-3'
					: 'text-ink-subtle hover:bg-surface-3 hover:text-ink',
			)}
		>
			{IconComponent ? <IconComponent className="size-3.5" /> : null}
			{label}
		</Button>
	);
}
