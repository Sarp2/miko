import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { validateBranchName } from '../../lib/validate-branch-name';

function toErrorMessage(error: unknown, fallback: string) {
	return error instanceof Error && error.message ? error.message : fallback;
}

export function BranchNameEditor({
	branchName,
	onRename,
}: {
	branchName: string;
	onRename: (next: string) => Promise<void>;
}) {
	const [draft, setDraft] = useState(branchName);
	const [editing, setEditing] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const submittingRef = useRef(false);

	// Follow snapshot updates while idle; never clobber an in-progress edit.
	useEffect(() => {
		if (!editing) setDraft(branchName);
	}, [branchName, editing]);

	const commit = async ({ resetOnInvalid = false }: { resetOnInvalid?: boolean } = {}) => {
		if (submittingRef.current) return;
		if (draft === branchName) {
			setEditing(false);
			return;
		}

		const validation = validateBranchName(draft);
		if (!validation.ok) {
			toast.error(validation.message);
			if (resetOnInvalid) {
				setDraft(branchName);
				setEditing(false);
			}
			return;
		}

		submittingRef.current = true;
		setSubmitting(true);
		try {
			await onRename(validation.value);
			setEditing(false);
		} catch (error) {
			toast.error(toErrorMessage(error, 'Failed to rename branch'));
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	};

	const cancel = () => {
		setDraft(branchName);
		setEditing(false);
		inputRef.current?.blur();
	};

	return (
		<span className="relative inline-flex min-w-[48px] max-w-[360px] items-center">
			{/* Invisible sizer keeps the row width stable as the draft grows. */}
			<span
				aria-hidden="true"
				className="pointer-events-none invisible whitespace-pre px-1.5 text-[13px] font-medium leading-5"
			>
				{draft || branchName || 'branch'}
			</span>
			<input
				ref={inputRef}
				value={draft}
				spellCheck={false}
				disabled={submitting}
				aria-label="Branch name"
				onChange={(event) => setDraft(event.target.value)}
				onFocus={() => setEditing(true)}
				onBlur={() => void commit({ resetOnInvalid: true })}
				onKeyDown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						void commit();
					} else if (event.key === 'Escape') {
						event.preventDefault();
						cancel();
					}
				}}
				className={cn(
					'absolute inset-0 w-full truncate rounded-sm bg-transparent px-1.5 text-[13px] font-medium leading-5 text-ink outline-none transition-colors',
					'hover:bg-surface-2/60 focus-visible:bg-surface-2 focus-visible:ring-1 focus-visible:ring-hairline-strong',
					submitting && 'opacity-60',
				)}
			/>
		</span>
	);
}
