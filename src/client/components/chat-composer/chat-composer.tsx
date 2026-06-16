import { ArrowUp, Lightning, MapTrifold, Plus, StopCircle } from '@phosphor-icons/react';
import { useRef } from 'react';

import type { PromptPart, SessionSnapshot, WorkspaceSnapshot } from '../../../shared/types';
import { useChatComposer } from '../../hooks/use-chat-composer';
import { useInlinePromptEditor } from '../../hooks/use-inline-prompt-editor';
import { useWorkspacePageOpeners } from '../../hooks/use-workspace-page-openers';
import { promptPartKey } from '../../lib/prompt-parts';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { ComposerEffortMenu } from './composer-effort-menu';
import { ComposerModelMenu } from './composer-model-menu';
import { ComposerToggle } from './composer-toggle';
import { FileMentionPopover } from './file-mention-popover';

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
	const promptEditor = useInlinePromptEditor({
		attachments: composer.attachments,
		parts: composer.parts,
		setParts: composer.setParts,
		workspaceId,
		workspaceSnapshot,
	});
	const { openWorkspaceFile, openPastedText, openLocalAttachment } =
		useWorkspacePageOpeners(workspaceId);

	const findTokenPart = (tokenKey?: string): Exclude<PromptPart, { type: 'text' }> | null => {
		if (!tokenKey) return null;
		const part = composer.parts.find(
			(candidate) => candidate.type !== 'text' && promptPartKey(candidate) === tokenKey,
		);
		return part && part.type !== 'text' ? part : null;
	};

	const openTokenPart = (part: Exclude<PromptPart, { type: 'text' }>) => {
		if (part.type === 'mention') openWorkspaceFile(part.path);
		else if (part.type === 'pasted_text') openPastedText(part.id, part.text);
		else {
			const attachment = composer.attachments.find((item) => item.id === part.attachmentId);
			if (attachment) openLocalAttachment(attachment);
		}
	};

	const handleEditorClick = (event: React.MouseEvent<HTMLDivElement>) => {
		const target = event.target instanceof Element ? event.target : null;

		const removeButton = target?.closest<HTMLElement>('[data-remove-token-key]');
		if (removeButton) {
			event.preventDefault();
			event.stopPropagation();
			const part = findTokenPart(removeButton.dataset.removeTokenKey);
			if (!part) return;
			if (part.type === 'attachment') composer.removeAttachment(part.attachmentId);
			else composer.setParts(composer.parts.filter((candidate) => candidate !== part));
			return;
		}

		const tokenPart = findTokenPart(
			target?.closest<HTMLElement>('[data-token-key]')?.dataset.tokenKey,
		);
		if (!tokenPart) {
			promptEditor.refreshMentionRange();
			return;
		}
		event.preventDefault();
		openTokenPart(tokenPart);
	};

	return (
		<div className="bg-canvas px-4 py-3">
			<div className="mx-auto w-full max-w-4xl">
				<FileMentionPopover
					open={promptEditor.mentionRange !== null}
					query={promptEditor.mentionRange?.query ?? ''}
					options={promptEditor.mentionOptions}
					isLoading={promptEditor.isMentionLoading}
					onOpenChange={(open) => {
						if (!open) promptEditor.setMentionRange(null);
					}}
					onSelect={promptEditor.insertMention}
					anchor={
						<div
							className={cn(
								'overflow-hidden rounded-lg border border-hairline bg-surface-1 text-ink transition-colors',
								'data-[disabled=true]:opacity-60',
							)}
							data-disabled={composer.disabled || composer.isStreaming}
						>
							{/* biome-ignore lint/a11y/useSemanticElements: contentEditable is required for inline file and mention tokens. */}
							<div
								ref={promptEditor.editorRef}
								contentEditable={!composer.disabled && !composer.isStreaming}
								role="textbox"
								tabIndex={composer.disabled || composer.isStreaming ? -1 : 0}
								aria-multiline="true"
								suppressContentEditableWarning
								onInput={promptEditor.syncPartsFromDom}
								onClick={handleEditorClick}
								onKeyUp={promptEditor.refreshMentionRange}
								onPaste={(event) => {
									event.preventDefault();
									promptEditor.insertPastedText(event.clipboardData.getData('text/plain'));
								}}
								onKeyDown={(event) => {
									if (event.nativeEvent.isComposing) return;

									if (event.key === 'Escape' && promptEditor.mentionRange) {
										event.preventDefault();
										promptEditor.setMentionRange(null);
										return;
									}

									const firstMentionOption = promptEditor.mentionOptions[0];
									if (event.key === 'Enter' && promptEditor.mentionRange) {
										event.preventDefault();
										if (firstMentionOption) promptEditor.insertMention(firstMentionOption);
										return;
									}

									if (event.key === 'Enter' && !event.shiftKey) {
										event.preventDefault();
										void composer.submit();
									}
								}}
								data-placeholder={
									composer.parts.length === 0 ? 'Ask to make changes, @mention files' : undefined
								}
								className="scrollbar-miko block min-h-20 w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-3 py-3 text-[13px] leading-5 text-ink outline-none empty:before:pointer-events-none empty:before:text-ink-tertiary empty:before:content-[attr(data-placeholder)] disabled:cursor-not-allowed"
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
