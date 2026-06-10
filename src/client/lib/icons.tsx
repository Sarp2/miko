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
		<svg
			viewBox="0 0 16 16"
			aria-label={ariaLabel}
			className={cn('size-3.5 animate-pulse text-ink-muted', className)}
		>
			<path
				d="M3 10.5 6 7.5"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.6"
			/>
			<path
				d="M7 10.5 10 7.5"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.6"
				opacity="0.72"
			/>
			<path
				d="M11 10.5 14 7.5"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.6"
				opacity="0.44"
			/>
		</svg>
	),

	mergedIcon: ({ className }: IconProps = {}) => (
		<svg viewBox="0 0 16 16" aria-hidden="true" className={cn('size-3.5', className)}>
			<path
				d="M4 10.5 8 6.5"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.55"
				opacity="0.86"
			/>
			<path
				d="M7.25 9.75 9.25 11.75 12.5 5.25"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.55"
				opacity="0.8"
			/>
		</svg>
	),

	prIcon: ({ className }: IconProps = {}) => (
		<svg viewBox="0 0 16 16" aria-hidden="true" className={cn('size-3.5', className)}>
			<path
				d="M4 10.5 8 6.5"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.55"
				opacity="0.86"
			/>
			<path
				d="M8 10.5 12 6.5"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.55"
				opacity="0.62"
			/>
		</svg>
	),

	errorIcon: ({ className }: IconProps = {}) => (
		<svg viewBox="0 0 16 16" aria-hidden="true" className={cn('size-3.5', className)}>
			<path
				d="M5 5 11 11"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.55"
			/>
			<path
				d="M11 5 5 11"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.55"
			/>
		</svg>
	),

	idleIcon: ({ className, muted = false }: IdleIconProps = {}) => (
		<svg viewBox="0 0 16 16" aria-hidden="true" className={cn('size-3.5', className)}>
			<path
				d="M5 10.5 11 4.5"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.55"
				opacity={muted ? '0.38' : '0.9'}
			/>
		</svg>
	),
};
