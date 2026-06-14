import type { SelectedLineRange } from '@pierre/diffs';
import type { SessionSnapshot } from '../../shared/types';
import {
	DEFAULT_COMPOSER_MODEL_OPTIONS,
	defaultProviderForRuntime,
	modelOptionsForSubmit,
	providerCatalogs,
} from './chat-composer/chat-composer-utils';
import { Button } from './ui/button';

export interface DiffCommentMetadata {
	type: 'comment-draft';
	range: SelectedLineRange;
}

export interface DiffCommentDraft {
	range: SelectedLineRange;
	content: string;
}

function diffRangeSideLabel(range: SelectedLineRange) {
	const startSide = range.side;
	const endSide = range.endSide ?? range.side;
	if (!startSide) return 'diff';
	if (startSide !== endSide && endSide) return `${startSide} to ${endSide}`;
	return startSide;
}

function diffRangeLineLabel(range: SelectedLineRange) {
	return range.start === range.end ? `line ${range.start}` : `lines ${range.start}-${range.end}`;
}

export function formatDiffCommentMessage(path: string, range: SelectedLineRange, comment: string) {
	const side = diffRangeSideLabel(range);
	return `Comment on \`${path}\` ${side} ${diffRangeLineLabel(range)}:\n\n${comment.trim()}`;
}

export function buildInlineCommentSendDefaults(sessionSnapshot: SessionSnapshot | null) {
	const providers = providerCatalogs(sessionSnapshot);
	const provider = defaultProviderForRuntime(sessionSnapshot?.runtime.provider, providers);
	const providerCatalog = providers.find((entry) => entry.id === provider) ?? providers[0];
	const model =
		providerCatalog?.models.find((entry) => entry.id === providerCatalog.defaultModel) ??
		providerCatalog?.models[0] ??
		null;

	if (!model) return null;

	return {
		provider,
		model: model.id,
		modelOptions: modelOptionsForSubmit({
			provider,
			claudeReasoningEffort: DEFAULT_COMPOSER_MODEL_OPTIONS.claudeReasoningEffort,
			claudeContextWindow: DEFAULT_COMPOSER_MODEL_OPTIONS.claudeContextWindow,
			codexReasoningEffort: DEFAULT_COMPOSER_MODEL_OPTIONS.codexReasoningEffort,
			codexFastMode: DEFAULT_COMPOSER_MODEL_OPTIONS.codexFastMode,
		}),
		planMode: sessionSnapshot?.runtime.planMode ?? false,
	};
}

export function sessionIsBusy(sessionSnapshot: SessionSnapshot | null) {
	const status = sessionSnapshot?.runtime.status;
	return status === 'starting' || status === 'running' || status === 'waiting_for_user';
}

export function DiffInlineCommentComposer({
	content,
	disabled,
	onCancel,
	onChange,
	onSubmit,
	submitting,
}: {
	content: string;
	disabled: boolean;
	onCancel: () => void;
	onChange: (content: string) => void;
	onSubmit: () => void;
	submitting: boolean;
}) {
	return (
		<div className="border-l border-hairline bg-surface-1 px-3 py-3">
			<textarea
				value={content}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.nativeEvent.isComposing) return;
					if (event.key === 'Escape') {
						event.preventDefault();
						onCancel();
						return;
					}
					if (event.key === 'Enter' && !event.shiftKey) {
						event.preventDefault();
						onSubmit();
					}
				}}
				disabled={disabled || submitting}
				placeholder="Add a comment for the AI"
				rows={3}
				className="scrollbar-miko block min-h-20 w-full resize-none rounded-md border border-hairline bg-canvas px-3 py-2 text-[13px] leading-5 text-ink outline-none placeholder:text-ink-tertiary focus:border-hairline-tertiary disabled:cursor-not-allowed disabled:opacity-60"
			/>
			<div className="mt-2 flex items-center justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 rounded-md px-2 text-[12px] text-ink-subtle hover:text-ink"
					disabled={submitting}
					onClick={onCancel}
				>
					Cancel
				</Button>
				<Button
					type="button"
					size="sm"
					className="h-7 rounded-md px-2.5 text-[12px]"
					disabled={disabled || submitting || content.trim().length === 0}
					onClick={onSubmit}
				>
					{submitting ? 'Commenting…' : 'Comment ↵'}
				</Button>
			</div>
		</div>
	);
}
