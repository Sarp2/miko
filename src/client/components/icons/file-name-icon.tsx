import astroIcon from '@pierre/vscode-icons/svgs/astro.svg?raw';
import babelIcon from '@pierre/vscode-icons/svgs/babel.svg?raw';
import bashIcon from '@pierre/vscode-icons/svgs/bash-duo.svg?raw';
import biomeIcon from '@pierre/vscode-icons/svgs/biome.svg?raw';
import bootstrapIcon from '@pierre/vscode-icons/svgs/bootstrap-duo.svg?raw';
import bracesIcon from '@pierre/vscode-icons/svgs/braces.svg?raw';
import browserslistIcon from '@pierre/vscode-icons/svgs/browserslist-duo.svg?raw';
import bunIcon from '@pierre/vscode-icons/svgs/bun-duo.svg?raw';
import claudeIcon from '@pierre/vscode-icons/svgs/claude.svg?raw';
import dockerIcon from '@pierre/vscode-icons/svgs/docker.svg?raw';
import eslintIcon from '@pierre/vscode-icons/svgs/eslint.svg?raw';
import fileIcon from '@pierre/vscode-icons/svgs/file-duo.svg?raw';
import fileTableIcon from '@pierre/vscode-icons/svgs/file-table-duo.svg?raw';
import fileTextIcon from '@pierre/vscode-icons/svgs/file-text-duo.svg?raw';
import fileZipIcon from '@pierre/vscode-icons/svgs/file-zip-duo.svg?raw';
import fontIcon from '@pierre/vscode-icons/svgs/font.svg?raw';
import gitIcon from '@pierre/vscode-icons/svgs/git.svg?raw';
import graphqlIcon from '@pierre/vscode-icons/svgs/graphql.svg?raw';
import imageIcon from '@pierre/vscode-icons/svgs/image-duo.svg?raw';
import cssIcon from '@pierre/vscode-icons/svgs/lang-css-duo.svg?raw';
import goIcon from '@pierre/vscode-icons/svgs/lang-go.svg?raw';
import htmlIcon from '@pierre/vscode-icons/svgs/lang-html-duo.svg?raw';
import javascriptIcon from '@pierre/vscode-icons/svgs/lang-javascript-duo.svg?raw';
import markdownIcon from '@pierre/vscode-icons/svgs/lang-markdown.svg?raw';
import pythonIcon from '@pierre/vscode-icons/svgs/lang-python.svg?raw';
import rubyIcon from '@pierre/vscode-icons/svgs/lang-ruby.svg?raw';
import rustIcon from '@pierre/vscode-icons/svgs/lang-rust.svg?raw';
import swiftIcon from '@pierre/vscode-icons/svgs/lang-swift.svg?raw';
import typescriptIcon from '@pierre/vscode-icons/svgs/lang-typescript-duo.svg?raw';
import nextjsIcon from '@pierre/vscode-icons/svgs/nextjs.svg?raw';
import npmIcon from '@pierre/vscode-icons/svgs/npm.svg?raw';
import oxcIcon from '@pierre/vscode-icons/svgs/oxc.svg?raw';
import postcssIcon from '@pierre/vscode-icons/svgs/postcss.svg?raw';
import prettierIcon from '@pierre/vscode-icons/svgs/prettier.svg?raw';
import reactIcon from '@pierre/vscode-icons/svgs/react.svg?raw';
import sassIcon from '@pierre/vscode-icons/svgs/sass.svg?raw';
import serverIcon from '@pierre/vscode-icons/svgs/server-duo.svg?raw';
import stylelintIcon from '@pierre/vscode-icons/svgs/stylelint.svg?raw';
import svelteIcon from '@pierre/vscode-icons/svgs/svelte.svg?raw';
import svgIcon from '@pierre/vscode-icons/svgs/svg-2.svg?raw';
import svgoIcon from '@pierre/vscode-icons/svgs/svgo.svg?raw';
import tailwindIcon from '@pierre/vscode-icons/svgs/tailwind.svg?raw';
import terraformIcon from '@pierre/vscode-icons/svgs/terraform.svg?raw';
import viteIcon from '@pierre/vscode-icons/svgs/vite.svg?raw';
import vscodeIcon from '@pierre/vscode-icons/svgs/vscode.svg?raw';
import vueIcon from '@pierre/vscode-icons/svgs/vue.svg?raw';
import wasmIcon from '@pierre/vscode-icons/svgs/wasm-duo.svg?raw';
import webpackIcon from '@pierre/vscode-icons/svgs/webpack.svg?raw';
import ymlIcon from '@pierre/vscode-icons/svgs/yml.svg?raw';
import zigIcon from '@pierre/vscode-icons/svgs/zig.svg?raw';
import { type FileIconKey, resolveFileIconKey } from './file-icon-map';

interface FileIconDefinition {
	svg: string;
	color: string;
	opacity?: number;
}

const palette = {
	gray: '#adadb1',
	red: '#ff6762',
	vermilion: '#ff8c5b',
	orange: '#ffa359',
	yellow: '#ffd452',
	green: '#5ecc71',
	teal: '#64d1db',
	cyan: '#68cdf2',
	blue: '#69b1ff',
	indigo: '#9d6afb',
	purple: '#d568ea',
	pink: '#ff678d',
	brown: '#c3987b',
} as const;

const ICON_DEFS: Record<FileIconKey, FileIconDefinition> = {
	astro: { svg: astroIcon, color: palette.purple },
	babel: { svg: babelIcon, color: palette.yellow },
	bash: { svg: bashIcon, color: palette.green },
	biome: { svg: biomeIcon, color: palette.blue },
	bootstrap: { svg: bootstrapIcon, color: palette.indigo },
	braces: { svg: bracesIcon, color: palette.gray },
	browserslist: { svg: browserslistIcon, color: palette.yellow },
	bun: { svg: bunIcon, color: palette.brown },
	claude: { svg: claudeIcon, color: palette.orange },
	css: { svg: cssIcon, color: palette.indigo },
	docker: { svg: dockerIcon, color: palette.blue },
	eslint: { svg: eslintIcon, color: palette.indigo },
	file: { svg: fileIcon, color: palette.gray },
	fileTable: { svg: fileTableIcon, color: palette.gray },
	fileText: { svg: fileTextIcon, color: palette.gray },
	fileZip: { svg: fileZipIcon, color: palette.gray },
	font: { svg: fontIcon, color: palette.gray },
	git: { svg: gitIcon, color: palette.vermilion },
	go: { svg: goIcon, color: palette.cyan },
	graphql: { svg: graphqlIcon, color: palette.pink },
	html: { svg: htmlIcon, color: palette.orange },
	image: { svg: imageIcon, color: palette.gray },
	javascript: { svg: javascriptIcon, color: palette.yellow },
	markdown: { svg: markdownIcon, color: palette.gray },
	nextjs: { svg: nextjsIcon, color: palette.gray },
	npm: { svg: npmIcon, color: palette.red, opacity: 0.75 },
	oxc: { svg: oxcIcon, color: palette.cyan },
	postcss: { svg: postcssIcon, color: palette.red },
	prettier: { svg: prettierIcon, color: palette.teal },
	python: { svg: pythonIcon, color: palette.blue },
	react: { svg: reactIcon, color: palette.cyan },
	ruby: { svg: rubyIcon, color: palette.red, opacity: 0.75 },
	rust: { svg: rustIcon, color: palette.orange },
	sass: { svg: sassIcon, color: palette.pink },
	server: { svg: serverIcon, color: palette.gray },
	stylelint: { svg: stylelintIcon, color: palette.gray },
	svelte: { svg: svelteIcon, color: palette.red },
	svg: { svg: svgIcon, color: palette.orange, opacity: 0.75 },
	svgo: { svg: svgoIcon, color: palette.green },
	swift: { svg: swiftIcon, color: palette.orange },
	tailwind: { svg: tailwindIcon, color: palette.cyan },
	terraform: { svg: terraformIcon, color: palette.indigo },
	typescript: { svg: typescriptIcon, color: palette.cyan },
	vite: { svg: viteIcon, color: palette.purple, opacity: 0.75 },
	vscode: { svg: vscodeIcon, color: palette.blue },
	vue: { svg: vueIcon, color: palette.green },
	wasm: { svg: wasmIcon, color: palette.indigo },
	webpack: { svg: webpackIcon, color: palette.blue },
	yml: { svg: ymlIcon, color: palette.red },
	zig: { svg: zigIcon, color: palette.orange },
};

function svgDataUri(icon: FileIconDefinition): string {
	const svg = icon.svg.replaceAll('currentColor', icon.color);
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function FileNameIcon({
	name,
	className = 'size-3.5',
}: {
	name: string;
	className?: string;
}) {
	const icon = ICON_DEFS[resolveFileIconKey(name)];

	return (
		<img
			alt=""
			aria-hidden="true"
			className={`inline-block shrink-0 ${className}`}
			draggable={false}
			src={svgDataUri(icon)}
			style={{ opacity: icon.opacity }}
		/>
	);
}
