import { parseDiffFromFile, registerCustomTheme } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { type CSSProperties, useMemo } from 'react';

// Custom Shiki theme built from the app design tokens (src/index.css) so the
// diff matches the surrounding UI instead of pierre-dark's own palette.
// Background = surface-1 (blends into the hover popover), foreground = ink.
const MIKO_DIFF_THEME = {
	name: 'miko-dark',
	type: 'dark' as const,
	colors: {
		'editor.background': '#111112',
		'editor.foreground': '#f4f4f5',
	},
	tokenColors: [
		{
			scope: ['comment', 'punctuation.definition.comment'],
			settings: { foreground: '#67686e', fontStyle: 'italic' },
		},
		{
			scope: ['keyword', 'storage', 'storage.type', 'keyword.control', 'modifier'],
			settings: { foreground: '#828fff' },
		},
		{
			scope: ['string', 'string.quoted', 'punctuation.definition.string'],
			settings: { foreground: '#7fc99a' },
		},
		{
			scope: ['constant.numeric', 'constant.language', 'constant.character'],
			settings: { foreground: '#d6a87a' },
		},
		{
			scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'],
			settings: { foreground: '#9aa6ff' },
		},
		{
			scope: ['entity.name.type', 'support.type', 'support.class', 'entity.name.class'],
			settings: { foreground: '#7ec7d9' },
		},
		{
			scope: ['entity.other.attribute-name', 'entity.name.tag'],
			settings: { foreground: '#828fff' },
		},
		{
			scope: ['variable', 'variable.other', 'meta.definition.variable'],
			settings: { foreground: '#f4f4f5' },
		},
		{ scope: ['variable.parameter'], settings: { foreground: '#d8d8dd' } },
		{
			scope: ['keyword.operator', 'punctuation', 'meta.brace'],
			settings: { foreground: '#8f9095' },
		},
	],
};

let themeRegistered = false;
function ensureMikoTheme() {
	if (themeRegistered) return;
	themeRegistered = true;
	registerCustomTheme('miko-dark', async () => MIKO_DIFF_THEME);
}
ensureMikoTheme();

// CSS custom properties pierce the shadow DOM, so the renderer picks up our
// design-system fonts. Code = mono, header/separators = sans.
const DIFF_FONT_VARS = {
	'--diffs-font-family': 'var(--font-mono)',
	'--diffs-font-size': '12px',
	'--diffs-line-height': '1.6',
	'--diffs-header-font-family': 'var(--font-sans)',
	'--diffs-font-features': 'normal',
} as CSSProperties;

const DIFF_OPTIONS = {
	theme: 'miko-dark',
	themeType: 'dark',
	diffStyle: 'unified',
	disableFileHeader: true,
} as const;

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
					style={DIFF_FONT_VARS}
					options={DIFF_OPTIONS}
				/>
			</div>
		</div>
	);
}
