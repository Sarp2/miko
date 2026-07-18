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
- Perf watchlist: session broadcasts use the clone-light paginated path (read-models injects getRecentSessionHistory — fixed); full-clone getMessages remains only on on-demand paths (ws-router:115 file-access check, agent.ts); snapshots rewrite full file; git+pr pollers hit every active workspace every 2s in parallel — diff-store refreshWorkspaceGitSnapshot spawns ~15-20 git procs/cycle (+2 per changed file, ~8 sequential); snapshotsEqual gates downstream churn
- src/server/uploads.ts contentUrl shape (/api/workspaces/:id/uploads/:name/content) is parsed by client chat-composer-utils.ts to recover storedName for deletion — changing the URL shape silently breaks upload delete
- src/server/uploads.ts maps .svg to text/plain on purpose (stored-XSS guard: inline image/svg+xml can execute scripts) — don't "fix" it
- scratchpad file layout (dataDir/scratchpads/{id}.md) is duplicated in scratchpad-manager.ts and event-store.ts:~667 (removal path) — change one, orphan the other
- src/server/pr-manager.ts: production PR refresh always uses the REST client; the gh-CLI branches of findPrForBranch/viewPr are production-dead but serve as the mock seam for most tests (REST path has few tests) — migrate tests to GitHubApiClient mocks before deleting those branches; gh CLI IS production-real for merge/ready/check-logs actions
- persisted events + snapshot.json have NO schema version field (src/server/event.ts) — evolve additively only: new optional fields / new event types + tolerant readers; never rename or retype existing fields
