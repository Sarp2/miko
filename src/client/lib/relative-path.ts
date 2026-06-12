/** Returns `path` relative to `root`, or the original path when it is not under `root`. */
export function toRelativePath(path: string, root: string): string {
	const normalizedRoot = root.replace(/\/+$/, '');
	if (normalizedRoot === '/') {
		const rest = path.replace(/^\/+/, '');
		if (rest) return rest;
	}
	if (normalizedRoot && path.startsWith(`${normalizedRoot}/`)) {
		const rest = path.slice(normalizedRoot.length).replace(/^\/+/, '');
		if (rest) return rest;
	}
	return path;
}
