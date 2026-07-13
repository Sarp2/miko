import {
	getFiletypeFromFileName,
	registerCustomLanguage,
	registerCustomTheme,
} from '@pierre/diffs';
import type { CSSProperties } from 'react';

// Custom Shiki theme built from the app design tokens (src/index.css) so code
// and diff views match the surrounding Miko UI instead of Pierre's default palette.
const MIKO_DIFF_THEME = {
	name: 'miko-dark',
	type: 'dark' as const,
	colors: {
		'editor.background': '#0a0a0a',
		'editor.foreground': '#f2f2f2',
	},
	tokenColors: [
		{
			scope: ['comment', 'punctuation.definition.comment'],
			settings: { foreground: '#6e6e6e', fontStyle: 'italic' },
		},
		{
			scope: ['keyword', 'storage', 'storage.type', 'keyword.control', 'modifier'],
			settings: { foreground: '#7cb3e8' },
		},
		{
			scope: ['string', 'string.quoted', 'punctuation.definition.string'],
			settings: { foreground: '#86c793' },
		},
		{
			scope: ['constant.numeric', 'constant.language', 'constant.character'],
			settings: { foreground: '#d0b183' },
		},
		{
			scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'],
			settings: { foreground: '#9ccbef' },
		},
		{
			scope: ['entity.name.type', 'support.type', 'support.class', 'entity.name.class'],
			settings: { foreground: '#7ec7d9' },
		},
		{
			scope: ['entity.other.attribute-name', 'entity.name.tag'],
			settings: { foreground: '#7cb3e8' },
		},
		{
			scope: ['variable', 'variable.other', 'meta.definition.variable'],
			settings: { foreground: '#f2f2f2' },
		},
		{ scope: ['variable.parameter'], settings: { foreground: '#d6d6d6' } },
		{
			scope: ['keyword.operator', 'punctuation', 'meta.brace'],
			settings: { foreground: '#8a8a8a' },
		},
	],
};

let themeRegistered = false;

export function ensureMikoDiffTheme() {
	if (themeRegistered) return;
	themeRegistered = true;
	registerCustomTheme('miko-dark', async () => MIKO_DIFF_THEME);
}

// Pierre resolves an unknown/extensionless file's language to Shiki's built-in
// "text", which it deliberately never adds to its AttachedLanguages set. In the
// non-worker render path that leaves `areLanguagesAttached` permanently false, so
// the renderer re-fires async highlighting forever and freezes the tab. We sidestep
// it by registering a real (empty-grammar) language and forcing plaintext diffs onto
// it, so highlighting attaches once and the loop terminates.
export const MIKO_PLAINTEXT_LANG = 'miko-plaintext';

const MIKO_PLAINTEXT_GRAMMAR = {
	name: MIKO_PLAINTEXT_LANG,
	scopeName: 'source.miko-plaintext',
	patterns: [],
	repository: {},
};

let plainTextLanguageRegistered = false;

export function ensureMikoPlainTextLanguage() {
	if (plainTextLanguageRegistered) return;
	plainTextLanguageRegistered = true;
	registerCustomLanguage(MIKO_PLAINTEXT_LANG, async () => ({ default: [MIKO_PLAINTEXT_GRAMMAR] }));
}

/** Diffs whose file resolves to Shiki "text" must not be handed to Pierre as-is. */
export function isPlainTextDiffFileName(fileName: string) {
	return getFiletypeFromFileName(fileName) === 'text';
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
