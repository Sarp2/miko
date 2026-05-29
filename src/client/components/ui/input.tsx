import type * as React from 'react';

import { cn } from '../../lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				'flex h-9 w-full min-w-0 rounded-lg border border-hairline bg-canvas/70 px-3 py-1 text-[13px] text-ink shadow-none outline-none transition-colors placeholder:text-ink-tertiary focus-visible:border-hairline-tertiary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
