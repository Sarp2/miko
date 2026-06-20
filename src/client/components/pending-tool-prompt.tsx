import { useState } from 'react';
import type { AskUserQuestionItem, PendingToolSnapshot } from '../../shared/types';
import { useSessionStore } from '../stores/session-store';
import { AssistantText } from './messages/assistant-text';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';

/**
 * Interactive surface for a turn parked on a user response (`waiting_for_user`).
 * Driven by `runtime.pendingTool` rather than the transcript so it always has the
 * `toolUseId` needed to answer through `session.respondTool`. Rendered next to the
 * composer; the composer itself stays disabled while a request is pending.
 */
export function PendingToolPrompt({
	sessionId,
	pending,
}: {
	sessionId: string;
	pending: PendingToolSnapshot;
}) {
	if (pending.toolKind === 'exit_plan_mode') {
		return <ExitPlanModePrompt sessionId={sessionId} pending={pending} />;
	}
	return <AskUserQuestionPrompt sessionId={sessionId} pending={pending} />;
}

function PromptCard({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="mx-auto w-full max-w-4xl px-5 pb-3">
			<div className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface-2 p-4">
				<div className="text-body-sm font-semibold text-ink">{title}</div>
				{children}
			</div>
		</div>
	);
}

function ExitPlanModePrompt({
	sessionId,
	pending,
}: {
	sessionId: string;
	pending: Extract<PendingToolSnapshot, { toolKind: 'exit_plan_mode' }>;
}) {
	const [message, setMessage] = useState('');
	const [clearContext, setClearContext] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	const respond = async (confirmed: boolean) => {
		if (submitting) return;
		setSubmitting(true);
		try {
			await useSessionStore.getState().respondTool(sessionId, pending.toolUseId, {
				confirmed,
				clearContext: confirmed ? clearContext : false,
				message: message.trim() || undefined,
			});
		} catch (error) {
			console.warn('[pending-tool] failed to respond to plan', error);
			setSubmitting(false);
		}
	};

	return (
		<PromptCard title="Plan ready for review">
			{pending.plan ? (
				<div className="max-h-72 overflow-y-auto scrollbar-miko rounded-lg border border-hairline bg-canvas px-3 py-2">
					<AssistantText text={pending.plan} mode="markdown" />
				</div>
			) : null}
			{pending.summary ? (
				<div className="text-body-sm text-ink-muted">{pending.summary}</div>
			) : null}

			<textarea
				value={message}
				onChange={(event) => setMessage(event.target.value)}
				disabled={submitting}
				placeholder="Optional feedback or changes to the plan…"
				className="min-h-[60px] w-full resize-y rounded-lg border border-hairline bg-canvas/70 px-3 py-2 text-[13px] text-ink shadow-none outline-none transition-colors placeholder:text-ink-tertiary focus-visible:border-hairline-tertiary disabled:cursor-not-allowed disabled:opacity-50"
			/>

			<div className="flex items-center justify-between gap-3">
				<label
					htmlFor="pending-plan-clear-context"
					className="flex items-center gap-2 text-body-sm text-ink-muted"
				>
					<Switch
						id="pending-plan-clear-context"
						size="sm"
						checked={clearContext}
						onCheckedChange={setClearContext}
						disabled={submitting}
					/>
					Start fresh (clear context)
				</label>

				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={submitting}
						onClick={() => void respond(false)}
					>
						Keep planning
					</Button>
					<Button type="button" size="sm" disabled={submitting} onClick={() => void respond(true)}>
						Approve &amp; run
					</Button>
				</div>
			</div>
		</PromptCard>
	);
}

function questionKey(question: AskUserQuestionItem, index: number): string {
	return question.id ?? String(index);
}

function AskUserQuestionPrompt({
	sessionId,
	pending,
}: {
	sessionId: string;
	pending: Extract<PendingToolSnapshot, { toolKind: 'ask_user_question' }>;
}) {
	const [answers, setAnswers] = useState<Record<string, string[]>>({});
	const [submitting, setSubmitting] = useState(false);

	const setSelection = (key: string, value: string, multiSelect: boolean) => {
		setAnswers((current) => {
			if (!multiSelect) return { ...current, [key]: [value] };
			const existing = current[key] ?? [];
			const next = existing.includes(value)
				? existing.filter((item) => item !== value)
				: [...existing, value];
			return { ...current, [key]: next };
		});
	};

	const answered = pending.questions.every((question, index) =>
		(answers[questionKey(question, index)] ?? []).some((value) => value.trim().length > 0),
	);

	const respond = async () => {
		if (submitting || !answered) return;
		setSubmitting(true);
		try {
			await useSessionStore.getState().respondTool(sessionId, pending.toolUseId, { answers });
		} catch (error) {
			console.warn('[pending-tool] failed to respond to question', error);
			setSubmitting(false);
		}
	};

	return (
		<PromptCard title={pending.questions.length > 1 ? 'A few questions' : 'A question for you'}>
			{pending.questions.map((question, index) => {
				const key = questionKey(question, index);
				const selected = answers[key] ?? [];
				const multiSelect = question.multiSelect === true;
				return (
					<div key={key} className="flex flex-col gap-2">
						{question.header ? (
							<div className="text-caption font-medium text-ink-subtle">{question.header}</div>
						) : null}
						<div className="text-body-sm text-ink">{question.question}</div>
						{question.options && question.options.length > 0 ? (
							<div className="flex flex-wrap gap-2">
								{question.options.map((option) => (
									<Button
										key={option.label}
										type="button"
										variant={selected.includes(option.label) ? 'default' : 'outline'}
										size="sm"
										disabled={submitting}
										onClick={() => setSelection(key, option.label, multiSelect)}
									>
										{option.label}
									</Button>
								))}
							</div>
						) : (
							<Input
								value={selected[0] ?? ''}
								onChange={(event) =>
									setAnswers((current) => ({ ...current, [key]: [event.target.value] }))
								}
								disabled={submitting}
								placeholder="Type your answer…"
							/>
						)}
					</div>
				);
			})}

			<div className="flex justify-end">
				<Button
					type="button"
					size="sm"
					disabled={submitting || !answered}
					onClick={() => void respond()}
				>
					Submit
				</Button>
			</div>
		</PromptCard>
	);
}
