import { ArrowUp, Lightning, MapTrifold, Plus, StopCircle } from '@phosphor-icons/react';
import { useLayoutEffect, useRef } from 'react';

import type { SessionSnapshot, WorkspaceSnapshot } from '../../../shared/types';
import { useChatComposer } from '../../hooks/use-chat-composer';
import { useFileMentions } from '../../hooks/use-file-mentions';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { AttachmentPill } from './composer-attachments';
import { ComposerEffortMenu } from './composer-effort-menu';
import { ComposerModelMenu } from './composer-model-menu';
import { ComposerToggle } from './composer-toggle';
import { FileMentionPopover } from './file-mention-popover';

const MAX_INPUT_HEIGHT = 220;

interface ChatComposerProps {
	workspaceId: string;
	sessionId: string;
	workspaceSnapshot: WorkspaceSnapshot;
	sessionSnapshot: SessionSnapshot | null;
}

export function ChatComposer({
	workspaceId,
	sessionId,
	workspaceSnapshot,
	sessionSnapshot,
}: ChatComposerProps) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const composer = useChatComposer({ workspaceId, sessionId, workspaceSnapshot, sessionSnapshot });
	const mentions = useFileMentions({
		workspaceId,
		content: composer.content,
		files: workspaceSnapshot.git?.files ?? [],
		onContentChange: composer.setContent,
	});

	useLayoutEffect(() => {
		const textarea = mentions.textareaRef.current;
		if (!textarea) return;
		textarea.style.height = '0px';
		const nextHeight = Math.min(textarea.scrollHeight, MAX_INPUT_HEIGHT);
		textarea.style.height = `${nextHeight}px`;
		textarea.style.overflowY = textarea.scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden';
	});

	return (
		<div className="bg-canvas px-4 py-3">
			<div className="mx-auto w-full max-w-4xl">
				<FileMentionPopover
					open={mentions.mentionRange !== null}
					query={mentions.mentionRange?.query ?? ''}
					options={mentions.mentionOptions}
					isLoading={mentions.isLoading}
					onOpenChange={(open) => {
						if (!open) mentions.closeMentions();
					}}
					onSelect={mentions.insertMention}
					anchor={
						<div
							className={cn(
								'overflow-hidden rounded-lg border border-hairline bg-surface-1 text-ink transition-colors',
								'data-[disabled=true]:opacity-60',
							)}
							data-disabled={composer.disabled || composer.isStreaming}
						>
							{composer.attachments.length > 0 ? (
								<div className="flex flex-wrap gap-1.5 border-b border-hairline px-3 py-2">
									{composer.attachments.map((attachment) => (
										<AttachmentPill
											key={attachment.id}
											attachment={attachment}
											onRemove={() => composer.removeAttachment(attachment.id)}
										/>
									))}
								</div>
							) : null}
							<textarea
								ref={mentions.textareaRef}
								value={composer.content}
								onChange={(event) => mentions.updateContent(event.target.value)}
								onClick={() => mentions.refreshMentionRange(composer.content)}
								onKeyUp={() => mentions.refreshMentionRange(composer.content)}
								onKeyDown={(event) => {
									if (event.nativeEvent.isComposing) return;

									if (event.key === 'Escape' && mentions.mentionRange) {
										event.preventDefault();
										mentions.closeMentions();
										return;
									}

									const firstMentionOption = mentions.mentionOptions[0];
									if (event.key === 'Enter' && mentions.mentionRange && firstMentionOption) {
										event.preventDefault();
										mentions.insertMention(firstMentionOption);
										return;
									}

									if (event.key === 'Enter' && !event.shiftKey) {
										event.preventDefault();
										void composer.submit();
									}
								}}
								disabled={composer.disabled || composer.isStreaming}
								placeholder="Ask to make changes, @mention files"
								rows={1}
								className="scrollbar-miko block min-h-20 w-full resize-none bg-transparent px-3 py-3 text-[13px] leading-5 text-ink outline-none placeholder:text-ink-tertiary disabled:cursor-not-allowed"
							/>
							<div className="flex items-center justify-between px-2 py-1.5">
								<div className="flex min-w-0 items-center gap-1">
									<ComposerModelMenu
										providers={composer.providers}
										provider={composer.provider}
										model={composer.model}
										contextWindow={composer.claudeContextWindow}
										disabled={composer.disabled || composer.isStreaming}
										onProviderChange={composer.setProvider}
										onModelChange={composer.changeModel}
										onContextWindowChange={composer.setClaudeContextWindow}
									/>
									{composer.provider === 'claude' && composer.providerCatalog.efforts.length > 0 ? (
										<ComposerEffortMenu
											efforts={composer.providerCatalog.efforts}
											value={composer.claudeReasoningEffort}
											disabled={composer.disabled || composer.isStreaming}
											onChange={composer.setClaudeReasoningEffort}
										/>
									) : null}
									{composer.providerCatalog.supportsPlanMode ? (
										<ComposerToggle
											label="Plan"
											icon={MapTrifold}
											active={composer.planMode}
											disabled={composer.disabled || composer.isStreaming}
											onToggle={() => composer.setPlanMode(!composer.planMode)}
										/>
									) : null}
									{composer.provider === 'codex' ? (
										<ComposerToggle
											label="Fast"
											icon={Lightning}
											active={composer.codexFastMode}
											disabled={composer.disabled || composer.isStreaming}
											onToggle={() => composer.setCodexFastMode(!composer.codexFastMode)}
										/>
									) : null}
								</div>

								<div className="flex items-center gap-1">
									<input
										ref={fileInputRef}
										type="file"
										multiple
										className="hidden"
										onChange={(event) => {
											composer.addFiles(Array.from(event.target.files ?? []));
											event.target.value = '';
										}}
									/>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												disabled={composer.disabled || composer.isStreaming}
												className="size-7 text-ink-subtle hover:text-ink"
												onClick={() => fileInputRef.current?.click()}
											>
												<Plus className="size-4" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Attach files</TooltipContent>
									</Tooltip>

									{composer.isStreaming ? (
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											className="size-7 text-ink-subtle hover:text-ink"
											onClick={composer.stop}
										>
											<StopCircle className="size-4" />
										</Button>
									) : (
										<Button
											type="button"
											size="icon-sm"
											disabled={!composer.canSubmit}
											className="size-7 rounded-md bg-ink text-canvas hover:bg-ink/90 disabled:bg-surface-3 disabled:text-ink-tertiary disabled:opacity-100"
											onClick={() => void composer.submit()}
										>
											<ArrowUp className="size-4" weight="bold" />
										</Button>
									)}
								</div>
							</div>
						</div>
					}
				/>
			</div>
		</div>
	);
}
