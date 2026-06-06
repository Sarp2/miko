import { CaretDown } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

export interface AccountInfoData {
	email?: string;
	organization?: string;
	subscriptionType?: string;
	tokenSource?: string;
	apiKeySource?: string;
}

export interface AccountInfoProps {
	accountInfo: AccountInfoData;
	className?: string;
}

/**
 * AccountInfo displays account metadata entries in the transcript.
 * Collapsed by default, expandable when any field is present.
 */
export function AccountInfo({ accountInfo, className }: AccountInfoProps) {
	const details = [
		{ label: 'Email', value: accountInfo.email },
		{ label: 'Organization', value: accountInfo.organization },
		{ label: 'Subscription', value: accountInfo.subscriptionType },
		{ label: 'Token Source', value: accountInfo.tokenSource },
		{ label: 'API Key Source', value: accountInfo.apiKeySource },
	].filter((item) => Boolean(item.value));

	const hasDetails = details.length > 0;

	return (
		<div className={cn('flex justify-center', className)}>
			<Collapsible>
				<CollapsibleTrigger
					className={cn(
						'group inline-flex items-center gap-1.5 text-xs text-ink-subtle',
						hasDetails && 'hover:text-ink-muted',
					)}
					disabled={!hasDetails}
				>
					<span>Account info</span>
					{hasDetails && (
						<CaretDown
							className="size-3 transition-transform group-data-[state=open]:rotate-180"
							weight="bold"
						/>
					)}
				</CollapsibleTrigger>

				{hasDetails && (
					<CollapsibleContent className="mt-2">
						<div className="space-y-2 text-xs text-ink-muted">
							{details.map((item) => (
								<div key={item.label} className="flex gap-2">
									<span className="text-ink-subtle">{item.label}:</span>
									<span className="font-mono text-ink">{item.value}</span>
								</div>
							))}
						</div>
					</CollapsibleContent>
				)}
			</Collapsible>
		</div>
	);
}
