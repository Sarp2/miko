import { parseDiffFromFile } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { useMemo } from 'react';
import {
	ensureMikoDiffTheme,
	MIKO_CODE_FONT_VARS,
	MIKO_DIFF_OPTIONS,
} from '../../lib/miko-diff-renderer';

ensureMikoDiffTheme();

/**
 * Fragment-level diff for a file changed during a turn. Built from the edit/write
 * tool fragments (old/new strings), not a real git diff — so line numbers and
 * context are synthetic.
 */
export function ChangedFileDiff({
	path,
	name,
	before,
	after,
}: {
	path: string;
	name: string;
	before: string;
	after: string;
}) {
	const fileDiff = useMemo(
		() => parseDiffFromFile({ name, contents: before }, { name, contents: after }),
		[name, before, after],
	);

	return (
		<div className="flex flex-col">
			<div className="truncate border-b border-hairline px-3 py-2 font-mono text-[11px] text-ink-subtle">
				{path}
			</div>
			<div className="scrollbar-miko max-h-[420px] overflow-auto">
				<FileDiff
					fileDiff={fileDiff}
					disableWorkerPool
					style={MIKO_CODE_FONT_VARS}
					options={MIKO_DIFF_OPTIONS}
				/>
			</div>
		</div>
	);
}
