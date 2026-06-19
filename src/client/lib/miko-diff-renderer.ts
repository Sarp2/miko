import { registerCustomTheme } from '@pierre/diffs';
import type { CSSProperties } from 'react';

// Custom Shiki theme built from the app design tokens (src/index.css) so code
// and diff views match the surrounding Miko UI instead of Pierre's default palette.
const MIKO_DIFF_THEME = {
	name: 'miko-dark',
	type: 'dark' as const,
	colors: {
		'editor.background': '#070707',
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

export function ensureMikoDiffTheme() {
	if (themeRegistered) return;
	themeRegistered = true;
	registerCustomTheme('miko-dark', async () => MIKO_DIFF_THEME);
}

export const MIKO_CODE_FONT_VARS = {
	'--diffs-font-family': 'var(--font-mono)',
	'--diffs-font-size': '13px',
	'--diffs-line-height': '1.55',
	'--diffs-header-font-family': 'var(--font-sans)',
	'--diffs-font-features': 'normal',
} as CSSProperties;

export const MIKO_FILE_OPTIONS = {
	theme: 'miko-dark',
	themeType: 'dark',
	disableFileHeader: true,
} as const;

export const MIKO_DIFF_OPTIONS = {
	...MIKO_FILE_OPTIONS,
	diffStyle: 'unified',
} as const;
