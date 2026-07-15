# Codebase notes (Confable)
<!-- One line per durable fact. Prefix with a file path when the fact
     is about specific code. Verified facts only — never speculation.
     Deep durable docs belong in .agents/memory/ — only always-loaded
     essentials go here. -->
- ~/.local/bin/cursor is Cursor's agent shim (exits 1 without real IDE CLI); src/server/external-open.ts must use `open -a` on darwin for plain opens, CLI only for --goto
- src/shared/tools.ts normalizeToolCall is Claude-path only (agent.ts); Codex path never calls it — becomes Claude-adapter code in future provider abstraction
- src/client instruction-attachment unwrap keeps legacy `file://` branch — old persisted events depend on it, don't remove
- --share exposes unauthenticated WS (terminal.create = remote shell) — known, deferred until mobile work
- workspace-manager + diff-store git tests fail on clean origin/main (~5s timeouts) — pre-existing, not regressions
- src/shared/workspace-file-previews.ts hardcodes '.miko'/'.miko-dev' instead of branding constants (fix on client pass)
- Perf watchlist: event-store deep-clones transcript on reads; snapshots rewrite full file
