# Miko

Miko is a local app for running and managing coding-agent sessions on your own machine — built especially for **Claude Code** and **Codex**. It pairs a Bun-powered server with a Vite + React client to give you a chat-driven workspace for projects, agent runs, terminals, and diffs — all backed by an event-sourced store under `~/.miko`.

> **Status:** Miko is in active development. Expect breaking changes to event schemas, the WebSocket protocol, on-disk layout, and the UI. Pin a commit if you depend on it, and don't point it at data you can't afford to lose.

## Features

- First-class support for **Claude Code** and **Codex** sessions — drive them from a single local UI instead of juggling separate terminal windows.
- Local-first project and chat workspace, with durable state stored under `~/.miko` (or `~/.miko-dev` when running in dev mode).
- Event-sourced persistence for projects, chats, and turns, with replay-driven read models.
- Typed WebSocket protocol between the client and the Bun server for snapshots, subscriptions, and commands.
- Provider-agnostic agent layer with a shared catalog of models and tools, so adding more agents alongside Claude Code and Codex stays straightforward.
- Embedded terminal panes (xterm.js) and diff views for inspecting agent work.
- React UI built with Tailwind, Radix/shadcn primitives, and Zustand stores.

## Requirements

- [Bun](https://bun.com) `>=1.3.5` (used for both the package manager and the server runtime).
- A recent version of macOS or Linux. Windows is untested.

This project uses Bun exclusively. Do not use `npm`, `yarn`, or `pnpm` against this repo.

## Getting Started

```bash
bun install
bun run dev
```

`bun run dev` starts the Vite client and the Bun server together. By default:

- Client: <http://localhost:5173>
- Server: <http://localhost:3210> (HTTP + `/ws` WebSocket)

You can also run the two halves separately:

```bash
bun run dev:client   # Vite dev server only
bun run dev:server   # Bun server only
```

## Scripts

| Command | What it does |
| --- | --- |
| `bun install` | Install dependencies. |
| `bun run dev` | Start the client and server together for local development. |
| `bun run dev:client` | Start only the Vite dev server. |
| `bun run dev:server` | Start only the Bun server. |
| `bun test` | Run the test suite with `bun test`. |
| `bun run lint` | Lint with Biome. |
| `bun run lint:fix` | Lint and auto-fix with Biome. |
| `bun run format` | Format with Biome. |
| `bun run check` | Typecheck with `tsc --noEmit` and build the client. |
| `bun run build` | Build the production client bundle through Vite. |

Before handing off production-facing changes, run `bun test`, `bun run lint`, and `bun run check`.

## Project Layout

```
src/
  client/   React UI, app shell, client helpers, browser-side state
  server/   Bun server, WebSocket router, event store, paths, orchestration
  shared/   Shared protocol, provider/tool types, ports, branding constants
scripts/    Dev orchestration scripts
public/     Static assets served by Vite
```

Notable modules:

- `src/shared/branding.ts` — app name, CLI name, package name, and data-root paths.
- `src/shared/protocol.ts` — typed WebSocket commands, snapshots, and subscription topics.
- `src/server/event.ts` and `src/server/event-store.ts` — durable event log and replay.
- `src/server/read-models.ts` — read-model derivation from the event log.
- `src/server/provider-catalog.ts` — provider/model catalog.

## Data and Storage

Miko stores durable data under your home directory:

- Production: `~/.miko/data`
- Development (`MIKO_RUNTIME_PROFILE=dev`): `~/.miko-dev/data`

State is event-oriented. Read models are derived from replayed events rather than persisted directly. If you change event shapes, update replay behavior and tests together.

## Contributing

The repo aims to stay small and explicit:

- TypeScript is strict. Keep shared contracts typed and validate unknown input at trust boundaries.
- Follow the existing Biome-formatted style: tabs, single quotes, semicolons.
- Tests live next to the code they cover as `*.test.ts` / `*.test.tsx`.
- Treat paths, uploads, shell commands, git actions, terminal input, and external-open behavior as trust boundaries — and test the unsafe inputs.

See [`CLAUDE.md`](./CLAUDE.md) for the full set of guidelines used by humans and coding agents working in this repo.

## License

Not yet specified. Until a license is added, treat the code as all rights reserved.
