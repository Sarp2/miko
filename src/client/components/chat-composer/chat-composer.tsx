import { ArrowUp, Lightning, MapTrifold, Plus, StopCircle } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import type { PromptPart, SessionSnapshot, WorkspaceSnapshot } from '../../../shared/types';
import { useChatComposer } from '../../hooks/use-chat-composer';
import { useInlinePromptEditor } from '../../hooks/use-inline-prompt-editor';
import { useWorkspacePageOpeners } from '../../hooks/use-workspace-page-openers';
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
	const dragDepthRef = useRef(0);
	const [isFileDragActive, setIsFileDragActive] = useState(false);
	const composer = useChatComposer({ workspaceId, sessionId, workspaceSnapshot, sessionSnapshot });
	const promptEditor = useInlinePromptEditor({
		attachments: composer.attachments,
		parts: composer.parts,
		setParts: composer.setParts,
		workspaceId,
		workspaceSnapshot,
	});
	const { openWorkspaceFile, openPastedText, openAttachment } = useWorkspacePageOpeners(
		workspaceId,
		sessionId,
		workspaceSnapshot.workspace.localPath,
	);
	const composerReadonly = composer.disabled || composer.isStreaming;

	const hasDraggedFiles = (dataTransfer: DataTransfer) =>
		Array.from(dataTransfer.types).includes('Files');

	const findTokenPart = (tokenIndex?: string): Exclude<PromptPart, { type: 'text' }> | null => {
		if (!tokenIndex) return null;
		const index = Number(tokenIndex);
		if (!Number.isSafeInteger(index) || index < 0) return null;
		const part = composer.parts[index];
		return part && part.type !== 'text' ? part : null;
	};

	const openTokenPart = (part: Exclude<PromptPart, { type: 'text' }>) => {
		if (part.type === 'mention') {
			openWorkspaceFile(part.path);
			return;
		}

		if (part.type === 'pasted_text') {
			void openPastedText(part.id, part.text);
			return;
		}

		void composer
			.ensureAttachmentUploaded(part.attachmentId)
			.then((attachment) => {
				if (attachment) openAttachment(attachment);
			})
			.catch((error) => {
				console.warn('[chat-composer] failed to persist attachment before preview', error);
				toast.error('Could not open attachment');
			});
	};

	const handleEditorClick = (event: React.MouseEvent<HTMLDivElement>) => {
		const target = event.target instanceof Element ? event.target : null;
		if (composerReadonly) return;

		const removeButton = target?.closest<HTMLElement>('[data-remove-token-key]');
		if (removeButton) {
			event.preventDefault();
			event.stopPropagation();
			const part = findTokenPart(removeButton.dataset.removeTokenIndex);
			if (!part) return;
			if (part.type === 'attachment') composer.removeAttachment(part.attachmentId);
			else {
				const index = Number(removeButton.dataset.removeTokenIndex);
				composer.setParts(composer.parts.filter((_, candidateIndex) => candidateIndex !== index));
			}
			return;
		}

		const tokenPart = findTokenPart(
			target?.closest<HTMLElement>('[data-token-key]')?.dataset.tokenIndex,
		);
		if (!tokenPart) {
			promptEditor.refreshMentionRange();
			return;
		}
		event.preventDefault();
		openTokenPart(tokenPart);
	};

	const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
		if (!hasDraggedFiles(event.dataTransfer)) return;
		event.preventDefault();
		event.stopPropagation();
		if (composerReadonly) return;

		dragDepthRef.current += 1;
		setIsFileDragActive(true);
	};

	const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
		if (!hasDraggedFiles(event.dataTransfer)) return;
		event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = composerReadonly ? 'none' : 'copy';
	};

	const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
		if (!hasDraggedFiles(event.dataTransfer) && dragDepthRef.current === 0) return;
		event.preventDefault();
		event.stopPropagation();

		dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
		if (dragDepthRef.current === 0) setIsFileDragActive(false);
	};

	const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
		if (!hasDraggedFiles(event.dataTransfer)) return;
		event.preventDefault();
		event.stopPropagation();
		dragDepthRef.current = 0;
		setIsFileDragActive(false);
		if (composerReadonly) return;

		const files = Array.from(event.dataTransfer.files);
		if (files.length === 0) return;
		promptEditor.setMentionRange(null);
		composer.addFiles(files);
		requestAnimationFrame(() => promptEditor.editorRef.current?.focus());
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
						// biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop is scoped to the composer shell while keyboard input remains on the textbox.
						<div
							className={cn(
								'overflow-hidden rounded-lg border border-hairline bg-surface-1 text-ink transition-colors',
								'data-[disabled=true]:opacity-60',
								isFileDragActive && 'border-accent ring-2 ring-accent/20',
							)}
							data-disabled={composerReadonly}
							onDragEnter={handleDragEnter}
							onDragOver={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
						>
							{/* biome-ignore lint/a11y/useSemanticElements: contentEditable is required for inline file and mention tokens. */}
							<div
								ref={promptEditor.editorRef}
								contentEditable={!composerReadonly}
								role="textbox"
								tabIndex={composerReadonly ? -1 : 0}
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
								className="scrollbar-miko block max-h-[220px] min-h-20 w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-3 py-3 text-[13px] leading-5 text-ink outline-none empty:before:pointer-events-none empty:before:text-ink-tertiary empty:before:content-[attr(data-placeholder)] disabled:cursor-not-allowed"
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
