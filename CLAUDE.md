# CLAUDE.md

Guidance for Claude Code and other coding agents working in this repository.

## Project

Miko is a Bun + Vite + React app for running and managing local coding-agent sessions. It is being rewritten from Kanna, so avoid reintroducing Kanna names unless a task is explicitly about migration or compatibility.

Main areas:

- `src/client/` - React UI, app shell, client helpers, and browser-side state.
- `src/server/` - Bun server, WebSocket routing, event store, filesystem paths, and agent/session orchestration.
- `src/shared/` - shared protocol, provider types, ports, tools, and branding constants.

Durable app state is event-oriented. Add typed events and replay/read behavior deliberately instead of saving derived state as a shortcut.

## Commands

Use Bun for package management and scripts. Do not use npm, yarn, or pnpm in this repo.

```bash
bun install
bun run dev
bun run dev:client
bun run dev:server
bun test
bun run lint
bun run check
bun run build
```

This project intentionally uses Vite for the browser app. Do not remove Vite or replace it with Bun HTML imports unless the task specifically asks for a build-system migration.

Before handing off production-facing changes, run:

```bash
bun test
bun run lint
bun run check
```

For narrow changes, run the related test file first, then the broader checks when practical.

## Code Style

- TypeScript is strict; keep shared contracts explicit and validate unknown input at boundaries.
- Follow the existing Biome-formatted style: tabs for indentation, single quotes, and semicolons.
- Prefer small pure helpers for parsing, normalization, and read-model derivation.
- Keep imports consistent with the existing `baseUrl` setup, including `src/...` imports where already used.
- Do not add dependencies for simple utilities. If a dependency is necessary, update `package.json` and `bun.lock` together.
- Keep comments sparse and useful. Explain protocol, persistence, security, or process behavior when it is not obvious.

## Architecture Rules

- WebSocket messages must use the typed protocol in `src/shared/protocol.ts`.
- Branding, CLI names, package names, and data-root names belong in `src/shared/branding.ts`.
- Provider behavior should stay provider-agnostic where possible. Put provider-specific details behind shared provider types or adapter boundaries.
- Persist durable project/chat/session changes through `src/server/event.ts` and `src/server/event-store.ts`; update replay and tests when event shapes change.
- Preserve compatibility with existing local data under `~/.miko` and `~/.miko-dev`. If storage shape changes, make migration/replay behavior explicit and tested.
- Keep server-only APIs out of client code. Browser code must not depend on Bun-only APIs, filesystem access, shell execution, or process management.
- Treat paths, uploads, shell commands, git actions, terminal input, share tunnels, and external-open behavior as trust boundaries.

## UI Rules

- Match the existing React, Tailwind, Radix/shadcn, and Zustand patterns before adding abstractions.
- Build the actual app surface, not marketing pages, unless explicitly requested.
- Keep transcript rendering resilient. Unknown, partial, or malformed entries should degrade gracefully instead of crashing the chat.
- Preserve keyboard focus behavior in chat input, dialogs, sidebars, and terminal panes.
- Avoid layout shifts in dense UI such as sidebars, message rows, terminal panes, tool calls, and diff views.
- Tokenized composer content uses `PromptPart[]` as the durable UI/prompt shape. Keep contenteditable/caret logic isolated in `use-inline-prompt-editor.ts`, and reuse `PromptToken` / `promptTokenEditorHtml` instead of duplicating token markup.
- File/diff middle pages are route-driven. Dirty workspace diffs use the backend `workspace.readDiffPatch` path; transcript footer changed-file diffs use `source=transcript` + `sessionId` + `turnId` and resolve from the chat window through `src/client/lib/transcript-diff.ts`.
- `workspace-file-store.ts` owns file/diff cache and request state. Preview classification/conversion belongs in `src/client/lib/workspace-file-previews.ts`.

## Tests

Tests live next to code as `*.test.ts` or `*.test.tsx` and run with `bun test`.

Add or update tests when changing:

- event schemas, replay, snapshots, or storage paths
- WebSocket command or subscription behavior
- provider/model normalization
- transcript/tool parsing or rendering
- path handling, uploads, terminal management, share links, git/diff behavior
- stores or UI behavior that already has test coverage

Avoid live external services in normal tests. Prefer deterministic unit coverage.

## Release And Packaging

- `bun run build` creates the production client bundle through Vite.
- `bun run check` typechecks and builds.
- Keep CLI/package/data-root rename work coordinated through `src/shared/branding.ts`, `package.json`, scripts, docs, and tests.

## Working Safely

- Inspect existing code before editing and keep changes scoped to the request.
- Do not delete or rewrite user data, local history, or unrelated untracked work unless explicitly asked.
- Do not commit secrets, local absolute paths, or machine-specific config.
- When modifying command execution, terminal, sharing, uploads, git, or external-open behavior, consider abuse cases and add tests for unsafe inputs.
