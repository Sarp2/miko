export function workspaceIdFromPath(pathname: string) {
	const match = pathname.match(/^\/workspaces\/([^/]+)/);
	return match ? decodeURIComponent(match[1]) : null;
}
