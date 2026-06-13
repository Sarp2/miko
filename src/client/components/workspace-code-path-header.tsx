import { FileNameIcon } from './icons/file-name-icon';

export function WorkspaceCodePathHeader({ path }: { path: string }) {
	return (
		<div className="flex min-w-0 items-center gap-1.5 truncate border-b border-hairline px-3 py-2 font-mono text-[11px] text-ink-subtle">
			<FileNameIcon name={path} className="size-3 shrink-0" />
			<span className="truncate">{path}</span>
		</div>
	);
}
