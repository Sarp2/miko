import path from 'node:path';
import type { ClientState } from './ws/ws-router';

const distDir = path.join(import.meta.dir, '..', '..', 'dist', 'client');

export async function startServer(options: { port?: number; host?: string } = {}) {
	const port = options.port ?? 3210;
	const hostname = options.host ?? '127.0.0.1';

	const server = Bun.serve<ClientState>({
		port,
		hostname,
		fetch(req, serverInstance) {
			const url = new URL(req.url);

			if (url.pathname === '/ws') {
				const upgraded = serverInstance.upgrade(req, {
					data: {
						// Client state
						subscriptions: new Map(),
						snapshotSignatures: new Map(),
					},
				});
				return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
			}

			if (url.pathname === '/health') {
				return Response.json({ ok: true, port });
			}

			return serveStatic(distDir, url.pathname);
		},

		websocket: {
			open(ws) {
				console.log('client connected');
			},
			message(ws, message) {
				// Echo for now — replace with router later
				ws.send(message);
			},
			close(ws) {
				console.log('client disconnected');
			},
		},
	});

	console.log(`Server running at http://${hostname}:${port}`);

	return { port, stop: () => server.stop(true) };
}

startServer();

async function serveStatic(distDir: string, pathname: string) {
	const requestedPath = pathname === '/' ? 'index.html' : pathname;
	const filePath = path.join(distDir, requestedPath);
	const indexPath = path.join(distDir, 'index.html');

	const file = Bun.file(filePath);
	if (await file.exists()) {
		return new Response(file);
	}

	// Fallback for Client-Side routing
	const indexFile = Bun.file(indexPath);
	if (await indexFile.exists()) {
		return new Response(indexFile, {
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
			},
		});
	}

	return new Response(`Client bundle not found. Run \`bun run build\` inside workbench/ first.`, {
		status: 503,
	});
}
