# Miko Product Memory

Miko is a fast Conductor-like web UI for running Claude Code, Codex, and other AI coding agents across local workspaces.

The product is a local-first developer tool. The user runs the CLI, opens the web UI, creates or selects a workspace, chats with an agent, reviews changes, opens files/diffs, manages terminals, and ships pull requests. Miko should feel like a serious coding cockpit, not a generic chatbot.

## Product principles

- Speed is part of the product. Chat switching, workspace switching, sidebar updates, and file/diff opening should feel immediate.
- The UI must be calm, compact, and elegant. Avoid oversized cards, noisy hover effects, and generic dashboard aesthetics.
- The app should make agent work visible: transcript, tool calls, changed files, terminal output, checks, PR state, and review context should all be understandable.
- Miko is not trying to delete or own the user's source files. Workspace data, upload previews, transcripts, and app metadata are separate concerns.
- Prefer durable, restart-safe behavior for anything the user has already submitted.
- Prefer explicit architecture over clever local patches. If routing, file identity, or state ownership gets ambiguous, centralize it in a lib/helper and test it.

## Current positioning

Package name: `miko-code`.

GitHub/npm description:

> A fast Conductor-like web UI for running Claude Code, Codex, and AI coding agents across workspaces.

Miko is in production. Treat release, package, data migration, and startup behavior as production concerns.
