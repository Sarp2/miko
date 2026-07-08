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

// Quiet inline reference used in the read-only transcript. Unlike the composer's
// input chip, this blends into the surrounding muted prompt text: no hard border
// or icon divider, monospace filename, tone-matched to the quote.
const PROMPT_TOKEN_READONLY_CLASS =
	'inline-flex max-w-[220px] cursor-pointer items-center gap-1 rounded-[5px] bg-surface-2 px-1.5 py-[1px] align-baseline text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink';
const PROMPT_TOKEN_READONLY_NAME_CLASS = 'min-w-0 truncate font-mono text-[12px] leading-[1.4]';

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
	tokenKey = promptPartKey(part),
	tokenIndex?: number,
) {
	const label = promptPartLabel(part, attachments);
	const tooltip = promptPartTooltip(part, attachments);
	const iconSrc = fileNameIconSrc(tooltip);
	const indexAttribute =
		tokenIndex === undefined ? '' : ` data-token-index="${escapeHtml(String(tokenIndex))}"`;
	const removeIndexAttribute =
		tokenIndex === undefined ? '' : ` data-remove-token-index="${escapeHtml(String(tokenIndex))}"`;

	return `<span contenteditable="false" data-token-key="${escapeHtml(tokenKey)}"${indexAttribute} class="${PROMPT_TOKEN_CHIP_CLASS}" title="${escapeHtml(tooltip)}"><span class="${PROMPT_TOKEN_ICON_WRAP_CLASS}"><img alt="" aria-hidden="true" draggable="false" src="${escapeHtml(iconSrc)}" class="size-3" /></span><span class="${PROMPT_TOKEN_NAME_CLASS}">${escapeHtml(label)}</span><button type="button" data-remove-token-key="${escapeHtml(tokenKey)}"${removeIndexAttribute} class="${PROMPT_TOKEN_REMOVE_CLASS}" aria-label="Remove ${escapeHtml(label)}">×</button></span>`;
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
	const tokenClassName = readOnly
		? cn(PROMPT_TOKEN_READONLY_CLASS, className)
		: cn(PROMPT_TOKEN_CHIP_CLASS, 'select-none', className);
	const tokenContent = readOnly ? (
		<>
			<FileNameIcon name={tooltip} className="size-3 shrink-0 opacity-80" />
			<span className={PROMPT_TOKEN_READONLY_NAME_CLASS}>{name}</span>
		</>
	) : (
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
