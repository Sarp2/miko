import { basename } from '../../routes/workspace-route-state';

export type FileIconKey =
	| 'astro'
	| 'babel'
	| 'bash'
	| 'biome'
	| 'bootstrap'
	| 'braces'
	| 'browserslist'
	| 'bun'
	| 'claude'
	| 'css'
	| 'docker'
	| 'eslint'
	| 'file'
	| 'fileTable'
	| 'fileText'
	| 'fileZip'
	| 'font'
	| 'git'
	| 'go'
	| 'graphql'
	| 'html'
	| 'image'
	| 'javascript'
	| 'markdown'
	| 'nextjs'
	| 'npm'
	| 'oxc'
	| 'postcss'
	| 'prettier'
	| 'python'
	| 'react'
	| 'ruby'
	| 'rust'
	| 'sass'
	| 'server'
	| 'stylelint'
	| 'svelte'
	| 'svg'
	| 'svgo'
	| 'swift'
	| 'tailwind'
	| 'terraform'
	| 'typescript'
	| 'vite'
	| 'vscode'
	| 'vue'
	| 'wasm'
	| 'webpack'
	| 'yml'
	| 'zig';

// Extension (and compound-extension) → icon key. Longer suffixes win at lookup time.
const EXTENSION_KEYS: Array<[FileIconKey, string[]]> = [
	[
		'fileText',
		[
			'txt',
			'rst',
			'rtf',
			'log',
			'ini',
			'cfg',
			'conf',
			'env',
			'env.local',
			'env.development',
			'env.production',
			'editorconfig',
			'license',
			'authors',
			'contributors',
			'changelog',
		],
	],
	['image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'icns', 'bmp', 'tiff', 'tif']],
	['javascript', ['js', 'cjs', 'mjs']],
	['typescript', ['ts', 'cts', 'mts']],
	['react', ['jsx', 'tsx']],
	['css', ['css', 'less', 'postcss', 'styl']],
	['sass', ['scss', 'sass']],
	['html', ['html', 'htm', 'xhtml']],
	['markdown', ['md', 'mdx', 'markdown']],
	['swift', ['swift']],
	['rust', ['rs']],
	['go', ['go']],
	['vscode', ['code-workspace']],
	['python', ['py', 'pyw', 'pyi', 'pyx']],
	['ruby', ['rb', 'erb', 'gemspec', 'rake']],
	['server', ['db', 'sql', 'sqlite', 'sqlite3']],
	['fileTable', ['csv', 'tsv', 'xls', 'xlsx', 'ods']],
	['fileZip', ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war']],
	['font', ['ttf', 'otf', 'woff', 'woff2', 'eot']],
	['bash', ['sh', 'bash', 'zsh', 'fish', 'ksh', 'csh']],
	['svg', ['svg']],
	['braces', ['json', 'jsonc', 'json5', 'jsonl']],
	['astro', ['astro']],
	['svelte', ['svelte']],
	['vue', ['vue']],
	['graphql', ['graphql', 'gql']],
	['terraform', ['tf', 'tfvars', 'tfstate']],
	['wasm', ['wasm', 'wat', 'wast']],
	['yml', ['yml', 'yaml']],
	['zig', ['zig']],
];

// Exact filename → icon key.
const FILE_NAME_KEYS: Array<[FileIconKey, string[]]> = [
	['ruby', ['Gemfile', 'Rakefile']],
	['bash', ['.bashrc', '.bash_profile', '.zshrc', '.zshenv', '.zprofile']],
	['git', ['.gitignore', '.gitattributes', '.gitmodules', '.gitkeep']],
	[
		'bootstrap',
		[
			'bootstrap.min.css',
			'bootstrap.css',
			'bootstrap.min.js',
			'bootstrap.js',
			'bootstrap.bundle.min.js',
			'bootstrap.bundle.js',
		],
	],
	['terraform', ['.terraform.lock.hcl']],
	['npm', ['package.json', 'package-lock.json', '.npmrc', '.npmignore']],
	[
		'eslint',
		[
			'.eslintrc',
			'.eslintrc.json',
			'.eslintrc.yml',
			'.eslintrc.yaml',
			'.eslintrc.js',
			'.eslintrc.cjs',
			'eslint.config.js',
			'eslint.config.mjs',
			'eslint.config.cjs',
			'eslint.config.ts',
			'eslint.config.mts',
			'.eslintignore',
		],
	],
	[
		'prettier',
		[
			'.prettierrc',
			'.prettierrc.json',
			'.prettierrc.yml',
			'.prettierrc.yaml',
			'.prettierrc.js',
			'.prettierrc.cjs',
			'.prettierrc.mjs',
			'.prettierrc.toml',
			'prettier.config.js',
			'prettier.config.cjs',
			'prettier.config.mjs',
			'.prettierignore',
		],
	],
	[
		'stylelint',
		[
			'.stylelintrc',
			'.stylelintrc.json',
			'.stylelintrc.yml',
			'.stylelintrc.yaml',
			'.stylelintrc.js',
			'.stylelintrc.cjs',
			'.stylelintrc.mjs',
			'stylelint.config.js',
			'stylelint.config.cjs',
			'stylelint.config.mjs',
			'.stylelintignore',
		],
	],
	['vite', ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.mts']],
	['svgo', ['svgo.config.js', 'svgo.config.mjs', 'svgo.config.cjs', 'svgo.config.ts']],
	[
		'babel',
		[
			'.babelrc',
			'.babelrc.json',
			'babel.config.js',
			'babel.config.json',
			'babel.config.cjs',
			'babel.config.mjs',
		],
	],
	[
		'docker',
		[
			'Dockerfile',
			'.dockerignore',
			'docker-compose.yml',
			'docker-compose.yaml',
			'docker-compose.override.yml',
			'compose.yml',
			'compose.yaml',
		],
	],
	[
		'tailwind',
		['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs', 'tailwind.config.cjs'],
	],
	['nextjs', ['next.config.js', 'next.config.ts', 'next.config.mjs', 'next.config.mts']],
	[
		'webpack',
		[
			'webpack.config.js',
			'webpack.config.ts',
			'webpack.config.mjs',
			'webpack.config.cjs',
			'webpack.config.babel.js',
		],
	],
	[
		'postcss',
		[
			'postcss.config.js',
			'postcss.config.cjs',
			'postcss.config.mjs',
			'postcss.config.ts',
			'.postcssrc',
			'.postcssrc.json',
			'.postcssrc.yml',
			'.postcssrc.yaml',
		],
	],
	['biome', ['biome.json', 'biome.jsonc']],
	['bun', ['bunfig.toml', 'bun.lockb', 'bun.lock']],
	['oxc', ['.oxlintrc.json']],
	['browserslist', ['.browserslistrc']],
	['claude', ['CLAUDE.md']],
];

function buildLookup(entries: Array<[FileIconKey, string[]]>): Map<string, FileIconKey> {
	const lookup = new Map<string, FileIconKey>();
	for (const [key, names] of entries) {
		for (const name of names) lookup.set(name.toLowerCase(), key);
	}
	return lookup;
}

const extensionLookup = buildLookup(EXTENSION_KEYS);
const fileNameLookup = buildLookup(FILE_NAME_KEYS);

/** Resolves a filename to its icon key by exact name, then by longest matching extension. */
export function resolveFileIconKey(fileName: string): FileIconKey {
	const name = basename(fileName).toLowerCase();

	const exact = fileNameLookup.get(name);
	if (exact) return exact;

	// Try the whole name, then each suffix after a dot, longest first
	// (`a.env.local` → `env.local` before `local`; bare `license` matches too).
	for (let candidate = name; ; ) {
		const icon = extensionLookup.get(candidate);
		if (icon) return icon;
		const dot = candidate.indexOf('.');
		if (dot === -1) return 'file';
		candidate = candidate.slice(dot + 1);
	}
}
