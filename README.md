<p align="center">
  <img src="public/logo.svg" alt="Miko" width="96" />
</p>

<h1 align="center"><b>Miko</b></h1>

<p align="center">
  A fast Conductor-like web UI for running Claude Code, Codex, and AI coding agents across workspaces.
  <br />
  <br />
  <a href="#install">Install</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-1.3+-000000?style=for-the-badge&logo=bun&logoColor=white" alt="Bun 1.3+" />
  <img src="https://img.shields.io/badge/Claude_Code-supported-111111?style=for-the-badge" alt="Claude Code supported" />
  <img src="https://img.shields.io/badge/Codex-supported-111111?style=for-the-badge" alt="Codex supported" />
</p>

<p align="center">
  <video src="public/videos/product-demo.mp4" controls muted playsinline width="900" aria-label="Miko product demo"></video>
</p>

<p align="center">
  <a href="public/videos/product-demo.mp4">Watch the product demo</a>
</p>

## What is Miko?

Miko is a local web UI for orchestrating AI coding agents across isolated git workspaces. It gives Claude Code, Codex, and future agents a shared product surface: chat, files, diffs, checks, terminals, pull requests, and workspace history — without juggling a pile of terminal windows.

Miko is local-first. Your workspace state, transcripts, uploads, terminals, and event history live on your machine under `~/.miko` in production and `~/.miko-dev` in development.

> **Status:** Miko is in production and publicly available as `miko-code`. The project is still pre-1.0, so breaking storage or protocol changes will be released through explicit version updates and documented migrations.

## Features

- **Claude Code and Codex in one UI** — run agent sessions from the same workspace-oriented interface.
- **Isolated workspaces** — create local git worktrees for agent runs, then continue merged work on a fresh branch when needed.
- **Conductor-like chat** — persistent transcripts, real-time tool calls, attachments, mentions, pasted-text tokens, and smooth scroll behavior.
- **Right sidebar for review** — browse files, changed files, checks, comments, todos, and terminals beside the active chat.
- **Diff and file views** — inspect workspace files, generated attachments, pasted text, transcript files, and PR diffs.
- **Pull request awareness** — refresh PR metadata, checks, comments, files, and stage so merged/closed/open workspaces remain readable.
- **Embedded terminals** — persistent workspace terminals with restored scrollback and terminal tabs.
- **Local event store** — durable event-sourced persistence with typed read models and a typed WebSocket protocol.

## Install

Miko ships as a Bun-powered CLI package.

```bash
bun install -g miko-code
miko
```

Then open the local web UI printed by the CLI. By default Miko listens on port `3210` and opens your browser automatically.

Useful CLI flags:

```bash
miko --no-open                 # start without opening a browser
miko --port 53921              # choose a port
miko --strict-port             # fail instead of trying another port
miko --remote                  # bind to 0.0.0.0
miko --share                   # create a temporary Cloudflare share URL
miko --help                    # show all options
```

### Requirements

- [Bun](https://bun.com) `>=1.3.5`
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated for pull request and GitHub metadata workflows
- macOS or Linux
- A local git repository connected to GitHub
- Claude Code and/or Codex installed and authenticated, depending on which agent you want to run

## Quickstart

1. Start Miko:

   ```bash
   miko
   ```

2. Add a local GitHub repository from the home screen.
3. Create or open a workspace.
4. Start a chat with Claude Code or Codex.
5. Review files, diffs, checks, terminals, and PR state from the workspace sidebars.

## Development

This project uses Bun exclusively. Do not use `npm`, `yarn`, or `pnpm` against this repo.

```bash
bun install
bun run dev
```

`bun run dev` starts the Vite client and Bun server together:

- Client: <http://localhost:5173>
- Server: <http://localhost:3210> HTTP + `/ws` WebSocket

You can also run each side separately:

```bash
bun run dev:client
bun run dev:server
```

### Scripts

| Command | What it does |
| --- | --- |
| `bun install` | Install dependencies. |
| `bun run dev` | Start the client and server together for local development. |
| `bun run dev:client` | Start only the Vite dev server. |
| `bun run dev:server` | Start only the Bun server. |
| `bun test` | Run tests with `bun test`. |
| `bun run lint` | Lint with Biome. |
| `bun run lint:fix` | Lint and auto-fix with Biome. |
| `bun run format` | Format with Biome. |
| `bun run check` | Typecheck and build the client. |
| `bun run build` | Build the production client bundle. |
| `bun run pack:dry` | Preview the npm package contents. |

Before handing off production-facing changes, run:

```bash
bun test
bun run lint
bun run check
```

### Releases

Releases are explicit and tag-driven. Pull requests and pushes to `main` only run CI; they never publish packages.

1. Update `package.json` to the next version and merge that change to `main`.
2. Create and push the matching tag, such as `v0.2.0`.
3. The release workflow validates, tests, packs, and smoke-tests the CLI.
4. After every gate passes, it publishes `miko-code` to npm and creates the matching GitHub release.

The npm Trusted Publisher must be configured for the `Sarp2/miko` repository and `.github/workflows/release.yml`. The workflow intentionally contains no long-lived npm token.

## Architecture

```txt
src/
  client/   React UI, routes, components, browser-side stores
  server/   Bun server, WebSocket router, event store, git/PR/terminal orchestration
  shared/   Shared protocol, provider/tool types, ports, branding constants
scripts/    Development orchestration scripts
public/     Static assets served by Vite
```

Notable modules:

- `src/shared/protocol.ts` — typed WebSocket commands, snapshots, and subscription topics.
- `src/shared/types.ts` — shared workspace, transcript, provider, tool, and PR types.
- `src/server/event-store.ts` — durable event log, replay, sessions, workspaces, and PR persistence.
- `src/server/ws-router.ts` — command routing, subscriptions, validation, and server-side orchestration.
- `src/server/agent.ts` — provider-agnostic agent orchestration for Claude Code and Codex.
- `src/client/routes/workspace-route.tsx` — route-based workspace/chat/file/diff rendering.
- `src/client/components/right-sidebar.tsx` — workspace file tree, changes, checks, review, and terminal surface.

## Data and storage

Miko stores durable app data under your home directory:

- Production: `~/.miko/data`
- Development: `~/.miko-dev/data`

Workspace uploads and generated attachments are stored in app data, not inside the git worktree. Workspace source files stay in their own repositories/worktrees.

## Contributing

The codebase favors explicit boundaries over magic:

- Keep shared contracts typed and validate unknown input at trust boundaries.
- Treat paths, uploads, terminals, shell commands, git operations, WebSocket payloads, and external-open behavior as security boundaries.
- Keep provider-specific behavior behind shared agent/session abstractions.
- Write tests next to the code they cover as `*.test.ts` / `*.test.tsx`.
- Follow the existing Biome style: tabs, single quotes, semicolons.


## License

Miko is available under the [MIT License](LICENSE).

Copyright © 2026 Sarp Pehlivan.
