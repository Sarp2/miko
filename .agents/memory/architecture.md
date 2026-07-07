# Miko Architecture Memory

This is the source map agents should read before changing core behavior.

## Runtime shape

- CLI entry: `bin/miko` -> `src/server/cli.ts` / `src/server/cli-runtime.ts`.
- Server: `src/server/server.ts` starts the HTTP/WebSocket server, serves the built client, exposes file/content endpoints, starts background refresh/polling, and owns shutdown ordering.
- WebSocket router: `src/server/ws-router.ts` is the typed command boundary between client stores and server managers.
- Shared protocol/types: `src/shared/protocol.ts`, `src/shared/types.ts`. Prefer shared types over redefining client-only copies.

## Backend source map

- `src/server/event-store.ts`: durable ledger for directories, workspaces, sessions, transcripts, queued messages, PR state, checks/comments/files, scratchpad metadata, and workspace-owned app data. Memory should be a cache; the event store is the source of truth.
- `src/server/agent.ts`: orchestrates Claude/Codex sessions, active turns, startup status, queue draining, failure recording, cancellation, and pending tool prompts. This file is fragile; preserve FIFO and restart semantics.
- `src/server/workspace-manager.ts`: workspace creation, git snapshots, branch rename/sync, PR refresh orchestration, turn-settled intents, archive/delete behavior.
- `src/server/diff-store.ts`: workspace file/diff reads, preview classification, patch generation, external/attachment file preview contracts. Do not special-case file types here without tests.
- `src/server/uploads.ts`: durable upload storage under app data, not inside worktrees.
- `src/server/pr-manager.ts` + `src/server/github-rest-client.ts`: GitHub PR metadata, checks, comments, files, rate-limit handling.
- `src/server/pr-refresh-poller.ts` and `src/server/git-refresh-poller.ts`: periodic refresh for active workspaces. Avoid duplicate git/GitHub polling.
- `src/server/terminal-manager.ts`: PTY/xterm lifecycle and serialized terminal snapshots.
- `src/server/scratchpad-manager.ts`: scratchpad persistence.
- `src/server/paths.ts`: data directory paths. Be careful with dev vs prod data dirs.

## Client source map

- `src/client/app.tsx`: top-level app, connection overlay, shell routing.
- `src/client/routes/app-shell.tsx`: left sidebar + route layout.
- `src/client/routes/workspace-route.tsx`: workspace page composition, chat/file/diff/scratchpad tabs, right sidebar presence.
- `src/client/routes/home-route.tsx`, `history-route.tsx`, `settings-route.tsx`: non-workspace pages. Right sidebar should not appear here.
- `src/client/components/chat-page.tsx`: transcript window + composer surface.
- `src/client/components/chat-composer/chat-composer.tsx`: contenteditable composer UI.
- `src/client/hooks/use-chat-composer.ts`: composer state, submit, queue behavior, uploads, provider/model preferences.
- `src/client/hooks/use-inline-prompt-editor.ts`: tokenized contenteditable parser/renderer for text, mentions, pasted text, and attachments. This is fragile; DOM cleanup and placeholder behavior need careful tests.
- `src/client/components/transcript-message-view.tsx`: owns transcript item layout. Helper components should not fight its layout.
- `src/client/components/right-sidebar*.tsx`: all-files tree, changes, checks/review, terminal panel.
- `src/client/components/workspace-file-page.tsx` and `workspace-diff-page.tsx`: file/diff viewers, copy/comment/open behavior.
- `src/client/components/scratchpad-page.tsx`: markdown note editor/preview.

## Client stores

- `ws-store.ts`: websocket connection and command plumbing.
- `workspace-store.ts`: workspace snapshot subscriptions and workspace commands.
- `session-store.ts`: session snapshot subscriptions and send/cancel commands.
- `workspace-file-store.ts`: file/diff/attachment/external preview cache.
- `ui-store.ts`: local UI state that is intentionally client-local.
- `composer-preferences-store.ts`: localStorage-backed provider/model/effort/plan/fast-mode preferences.
- `composer-draft-store.ts`: session-scoped composer drafts.
- `right-sidebar-file-store.ts`: right sidebar file list cache.
- `terminal-store.ts`: terminal session/client state.

## Architecture rule

If a change touches identity or ownership — workspace file vs external file vs generated attachment vs pasted text vs transcript file — do not patch in the component. Add or use a tested helper in `src/client/lib` / server equivalent.
