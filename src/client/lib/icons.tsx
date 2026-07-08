import { cn } from '@/client/lib/utils';
import type { AgentProvider } from '@/shared/types';

type IconProps = {
	className?: string;
};

const PROVIDER_ICON_SRC: Record<AgentProvider, string> = {
	claude: '/icons/claude.svg',
	codex: '/icons/openai.svg',
};

export function ProviderIcon({
	provider,
	className,
}: {
	provider: AgentProvider;
	className?: string;
}) {
	return (
		<img
			src={PROVIDER_ICON_SRC[provider]}
			alt=""
			aria-hidden
			draggable={false}
			className={cn('size-3.5 shrink-0 select-none', className)}
		/>
	);
}

type ActiveIconProps = IconProps & {
	ariaLabel?: string;
};

type IdleIconProps = IconProps & {
	muted?: boolean;
};

export const Icons = {
	activeIcon: ({ ariaLabel = 'streaming', className }: ActiveIconProps = {}) => (
		<span
			role="img"
			aria-label={ariaLabel}
			className={cn('flex size-3.5 shrink-0 items-center justify-center text-ink', className)}
		>
			<span className="relative h-[3px] w-full overflow-hidden rounded-full">
				<span className="absolute inset-0 rounded-full bg-current opacity-25" />
				<span className="animate-agent-scan absolute top-0 left-0 h-full w-[5px] rounded-full bg-current" />
			</span>
		</span>
	),

	/* Stage glyphs share one compact node-and-curve motif (a git-graph branch):
	   state is told by color and small variations, never by a different silhouette. */

	idleIcon: ({ className, muted = false }: IdleIconProps = {}) => (
		<svg
			viewBox="0 0 16 16"
			aria-hidden="true"
			className={cn('size-3.5', muted ? 'opacity-45' : 'opacity-85', className)}
		>
			<circle cx="4" cy="12" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.15" />
			<path
				d="M4 9.3 C4 6.4 6.4 4 9.3 4"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.15"
				strokeLinecap="round"
			/>
			<circle cx="12" cy="4" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.15" />
		</svg>
	),

	prIcon: ({ className }: IconProps = {}) => (
		<svg viewBox="0 0 16 16" aria-hidden="true" className={cn('size-3.5', className)}>
			<circle cx="4" cy="12" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.15" />
			<path
				d="M4 9.3 C4 6.4 6.4 4 9.3 4"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.15"
				strokeLinecap="round"
			/>
			<circle cx="12" cy="4" r="2.1" fill="currentColor" stroke="none" />
		</svg>
	),

	mergedIcon: ({ className }: IconProps = {}) => (
		<svg viewBox="0 0 16 16" aria-hidden="true" className={cn('size-3.5', className)}>
			<circle cx="4" cy="4" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.15" />
			<path
				d="M4 6.7 C4 9.6 6.4 12 9.3 12"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.15"
				strokeLinecap="round"
			/>
			<circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
		</svg>
	),

	errorIcon: ({ className }: IconProps = {}) => (
		<svg viewBox="0 0 16 16" aria-hidden="true" className={cn('size-3.5', className)}>
			<circle cx="4" cy="12" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.15" />
			<path
				d="M4 9.3 C4 6.4 6.4 4 9.3 4"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.15"
				strokeLinecap="round"
			/>
			<path
				d="M10.4 2.4 13.6 5.6 M13.6 2.4 10.4 5.6"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.25"
				strokeLinecap="round"
			/>
		</svg>
	),
};
