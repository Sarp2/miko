import { X } from '@phosphor-icons/react';
import type { ChatAttachment, PromptPart } from '../../shared/types';
import { promptPartKey, promptPartLabel, promptPartTooltip } from '../lib/prompt-parts';
import { cn } from '../lib/utils';
import { FileNameIcon, fileNameIconSrc } from './icons/file-name-icon';

// Shared styling for prompt tokens. The composer's contenteditable surface rebuilds
// the same chip as an HTML string (see use-inline-prompt-editor), so both render paths
// import these class names to stay visually identical.
export const PROMPT_TOKEN_CHIP_CLASS =
	'group/token inline-flex h-[21px] max-w-[180px] cursor-pointer items-center overflow-hidden rounded-[5px] border border-hairline bg-surface-1 align-baseline text-[12px] leading-[17px] text-ink';
export const PROMPT_TOKEN_ICON_WRAP_CLASS =
	'inline-flex h-full w-[22px] shrink-0 items-center justify-center border-r border-hairline bg-surface-2/60';
export const PROMPT_TOKEN_NAME_CLASS = 'min-w-0 truncate px-1';
export const PROMPT_TOKEN_REMOVE_CLASS =
	'mr-0.5 inline-flex size-2.5 shrink-0 items-center justify-center rounded-sm text-ink-tertiary opacity-0 transition-opacity hover:text-ink group-hover/token:opacity-100';

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

export function promptTokenEditorHtml(
	part: Exclude<PromptPart, { type: 'text' }>,
	attachments: ChatAttachment[] = [],
) {
	const key = promptPartKey(part);
	const label = promptPartLabel(part, attachments);
	const tooltip = promptPartTooltip(part, attachments);
	const iconSrc = fileNameIconSrc(tooltip);

	return `<span contenteditable="false" data-token-key="${escapeHtml(key)}" class="${PROMPT_TOKEN_CHIP_CLASS}" title="${escapeHtml(tooltip)}"><span class="${PROMPT_TOKEN_ICON_WRAP_CLASS}"><img alt="" aria-hidden="true" draggable="false" src="${escapeHtml(iconSrc)}" class="size-3" /></span><span class="${PROMPT_TOKEN_NAME_CLASS}">${escapeHtml(label)}</span><button type="button" data-remove-token-key="${escapeHtml(key)}" class="${PROMPT_TOKEN_REMOVE_CLASS}" aria-label="Remove ${escapeHtml(label)}">×</button></span>`;
}

interface PromptTokenProps {
	part: Exclude<PromptPart, { type: 'text' }>;
	attachments?: ChatAttachment[];
	readOnly?: boolean;
	onRemove?: () => void;
	onOpen?: () => void;
	className?: string;
}

export function PromptToken({
	part,
	attachments = [],
	readOnly = false,
	onRemove,
	onOpen,
	className,
}: PromptTokenProps) {
	const tooltip = promptPartTooltip(part, attachments);
	const name = promptPartLabel(part, attachments);
	const tokenClassName = cn(PROMPT_TOKEN_CHIP_CLASS, !readOnly && 'select-none', className);
	const tokenContent = (
		<>
			<span className={PROMPT_TOKEN_ICON_WRAP_CLASS}>
				<FileNameIcon name={tooltip} className="size-3" />
			</span>
			<span className={PROMPT_TOKEN_NAME_CLASS}>{name}</span>
		</>
	);

	if (onOpen) {
		return (
			<button
				type="button"
				className={tokenClassName}
				data-prompt-token="true"
				title={tooltip}
				onClick={(event) => {
					event.preventDefault();
					onOpen();
				}}
			>
				{tokenContent}
			</button>
		);
	}

	return (
		<span className={tokenClassName} data-prompt-token="true" title={tooltip}>
			{tokenContent}
			{!readOnly && onRemove ? (
				<button
					type="button"
					className={PROMPT_TOKEN_REMOVE_CLASS}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onRemove();
					}}
					aria-label={`Remove ${name}`}
				>
					<X className="size-2.5" />
				</button>
			) : null}
		</span>
	);
}
