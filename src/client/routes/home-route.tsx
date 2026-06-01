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
				<div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
					{actions.map((action) => {
						const Icon = action.icon;
						const tile = (
							<button
								type="button"
								disabled={action.disabled}
								className="group flex h-[148px] w-full flex-col items-start justify-between rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-left shadow-[0_18px_60px_rgba(0,0,0,0.22)] transition-colors enabled:hover:border-hairline-tertiary enabled:hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45"
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

				<div className="mt-6 max-w-[420px] text-center text-[12px] leading-5 text-ink-tertiary">
					<span>
						Choose a local repository that’s already connected to GitHub. Miko will use its main
						branch to create isolated workspaces.
					</span>
				</div>
			</div>
		</section>
	);
}
