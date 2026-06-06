import { CaretDown } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

export interface SystemInitProps {
	/** AI model name */
	model: string;
	/** Provider name (e.g., "anthropic", "openai") */
	provider: string;
	/** Available tools */
	tools?: string[];
	/** Available agents */
	agents?: string[];
	/** Available slash commands */
	slashCommands?: string[];
	/** MCP server information */
	mcpServers?: Array<{ name: string; status?: string }>;
	/** Optional CSS class */
	className?: string;
}

/**
 * SystemInit displays session initialization in the transcript.
 * Shows which model is being used at the start of a conversation.
 */
export function SystemInit({
	model,
	provider,
	tools = [],
	agents = [],
	slashCommands = [],
	mcpServers = [],
	className,
}: SystemInitProps) {
	const hasDetails =
		Boolean(provider) ||
		tools.length > 0 ||
		agents.length > 0 ||
		slashCommands.length > 0 ||
		mcpServers.length > 0;

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
					<span>Started session</span>
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
							<div className="flex gap-2">
								<span className="text-ink-subtle">Model:</span>
								<span className="font-mono text-ink">{model}</span>
							</div>

							{provider && (
								<div className="flex gap-2">
									<span className="text-ink-subtle">Provider:</span>
									<span className="font-mono text-ink-muted">{provider}</span>
								</div>
							)}

							{tools.length > 0 && (
								<div className="flex gap-2">
									<span className="text-ink-subtle">Tools:</span>
									<span className="font-mono text-ink-muted">{tools.join(', ')}</span>
								</div>
							)}

							{agents.length > 0 && (
								<div className="flex gap-2">
									<span className="text-ink-subtle">Agents:</span>
									<span className="font-mono text-ink-muted">{agents.join(', ')}</span>
								</div>
							)}

							{slashCommands.length > 0 && (
								<div className="flex gap-2">
									<span className="text-ink-subtle">Commands:</span>
									<span className="font-mono text-ink-muted">
										{slashCommands.map((cmd) => `/${cmd}`).join(', ')}
									</span>
								</div>
							)}

							{mcpServers.length > 0 && (
								<div className="flex gap-2">
									<span className="text-ink-subtle">MCP Servers:</span>
									<span className="font-mono text-ink-muted">
										{mcpServers.map((s) => s.name).join(', ')}
									</span>
								</div>
							)}
						</div>
					</CollapsibleContent>
				)}
			</Collapsible>
		</div>
	);
}
