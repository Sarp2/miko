import { Folder, Globe, Sparkle } from '@phosphor-icons/react';
import { AddDirectoryDialog } from '../components/add-directory-dialog';

const actions = [
	{
		id: 'add-directory',
		label: 'Add directory',
		description: 'Use a local GitHub repository',
		icon: Folder,
		disabled: false,
	},
	{
		id: 'clone-url',
		label: 'Clone from URL',
		description: 'Coming soon',
		icon: Globe,
		disabled: true,
	},
	{
		id: 'quick-start',
		label: 'Quick start',
		description: 'Coming soon',
		icon: Sparkle,
		disabled: true,
	},
];

export function HomeRoute() {
	return (
		<section
			data-testid="home-route"
			className="flex h-full min-h-0 items-center justify-center overflow-hidden bg-canvas px-8 py-10"
		>
			<div className="flex w-full max-w-[560px] flex-col items-center">
				<div className="mb-8 flex flex-col items-center gap-3">
					<div className="flex size-14 items-center justify-center rounded-[18px] border border-hairline bg-surface-1 shadow-[0_16px_48px_rgba(0,0,0,0.2)]">
						<img src="/logo.svg" alt="Miko" className="size-11 rounded-[14px]" />
					</div>
					<div className="text-[15px] font-medium leading-5 text-ink">Miko</div>
				</div>

				<div className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-3">
					{actions.map((action) => {
						const Icon = action.icon;
						const tile = (
							<button
								type="button"
								disabled={action.disabled}
								className={
									action.disabled
										? 'group flex h-[136px] w-full flex-col items-start justify-between rounded-lg border border-hairline/70 bg-surface-1/55 px-3.5 py-3 text-left opacity-55 transition-colors disabled:cursor-not-allowed'
										: 'group flex h-[136px] w-full flex-col items-start justify-between rounded-lg border border-hairline-strong bg-surface-1 px-3.5 py-3 text-left shadow-[0_18px_54px_rgba(0,0,0,0.24)] transition-colors hover:border-hairline-tertiary hover:bg-surface-2'
								}
							>
								<Icon className="size-4 text-ink-muted transition-colors group-enabled:group-hover:text-ink" />
								<div className="min-w-0">
									<div className="text-[13px] font-medium leading-5 text-ink">{action.label}</div>
									<div className="mt-0.5 text-[11px] leading-4 text-ink-tertiary">
										{action.description}
									</div>
								</div>
							</button>
						);

						if (action.id === 'add-directory') {
							return <AddDirectoryDialog key={action.id}>{tile}</AddDirectoryDialog>;
						}

						return <div key={action.id}>{tile}</div>;
					})}
				</div>

				<div className="mt-5 text-center text-[11px] leading-4 text-ink-tertiary">
					Choose a local GitHub repository to create isolated workspaces.
				</div>
			</div>
		</section>
	);
}
