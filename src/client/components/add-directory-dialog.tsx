import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { useSidebarStore } from '../stores/sidebar-store';
import { useUiStore } from '../stores/ui-store';
import { Button } from './ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from './ui/dialog';
import { Input } from './ui/input';

interface AddDirectoryDialogProps {
	children?: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : 'Could not add this directory.';
}

export function AddDirectoryDialog({
	children,
	open: controlledOpen,
	onOpenChange,
}: AddDirectoryDialogProps) {
	const inputId = useId();
	const addDirectory = useSidebarStore((state) => state.addDirectory);
	const setDirectoryExpanded = useUiStore((state) => state.setDirectoryExpanded);
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const open = controlledOpen ?? uncontrolledOpen;
	const setOpen = onOpenChange ?? setUncontrolledOpen;
	const [localPath, setLocalPath] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const trimmedPath = localPath.trim();
	const examplePaths = ['~/Projects/miko', '/Users/your-name/code/my-app', '/home/your-name/code/my-app'];

	useEffect(() => {
		if (open) return;
		setLocalPath('');
		setError(null);
		setIsSubmitting(false);
	}, [open]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!trimmedPath || isSubmitting) return;

		setError(null);
		setIsSubmitting(true);
		try {
			const result = await addDirectory(trimmedPath);
			setDirectoryExpanded(result.directoryId, true);
			setOpen(false);
		} catch (submitError) {
			setError(getErrorMessage(submitError));
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			{children && <DialogTrigger asChild>{children}</DialogTrigger>}
			<DialogContent className="p-0">
				<form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
					<DialogHeader className="pr-8">
						<DialogTitle>Add directory</DialogTitle>
						<DialogDescription>
							Paste the absolute path to a local repository connected to GitHub.
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-2">
						<label htmlFor={inputId} className="text-[12px] font-medium leading-4 text-ink-muted">
							Directory path
						</label>
						<Input
							id={inputId}
							value={localPath}
							onChange={(event) => {
								setLocalPath(event.target.value);
								setError(null);
							}}
							placeholder="/Users/your-name/code/my-app"
							disabled={isSubmitting}
							aria-invalid={Boolean(error)}
							className="font-mono text-[12px]"
						/>
						{error && <p className="text-[12px] leading-5 text-destructive">{error}</p>}
					</div>

					<div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
						<p className="text-[11px] leading-4 text-ink-subtle">
							Example paths on this computer:
						</p>
						{examplePaths.map((examplePath) => (
							<code key={examplePath} className="font-mono text-[11px] leading-4 text-ink-muted">
								{examplePath}
							</code>
						))}
						<p className="pt-1 text-[11px] leading-4 text-ink-subtle">
							Tip: drag a folder into Terminal to reveal its full path.
						</p>
					</div>

					<DialogFooter>
						<Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="submit" size="sm" disabled={!trimmedPath || isSubmitting}>
							{isSubmitting ? 'Checking…' : 'Add directory'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
