/** Returns `path` relative to `root`, or the original path when it is not under `root`. */
export function toRelativePath(path: string, root: string): string {
	if (root && path.startsWith(root)) {
		const rest = path.slice(root.length).replace(/^\/+/, '');
		if (rest) return rest;
	}
	return path;
}
