# Miko Fragile Areas Memory

Read this before touching core systems.

## Agent queue and startup

Files: `src/server/agent.ts`, `event-store.ts`, `session-store.ts`, `use-chat-composer.ts`.

Risks:
- FIFO violation when sends arrive during startup/settle/drain windows.
- Startup failure can leave queued messages stuck unless drain/recovery is explicit.
- `startingSessions` affects derived session status and needs broadcasts when cleared.
- Stop/cancel during startup needs careful semantics.
- Queued messages must survive restart. EventStore is the durable ledger.
- Codex rate-limit/auth failures must be recorded as visible assistant/errors, not silent loading.

## Composer and tokenized prompt editor

Files: `use-inline-prompt-editor.ts`, `use-chat-composer.ts`, `prompt-parts.ts`, `prompt-token.tsx`, `user-prompt.tsx`.

Risks:
- contenteditable DOM can contain invisible nodes after delete; placeholder may not return unless visibly-empty DOM is normalized.
- IME composition must not accidentally submit.
- Mention query/search must not let Enter submit raw partial mentions while loading.
- Attachments removed from visible tokens must not still upload/send.
- Pre-submit uploads can become orphaned; cleanup must not delete submitted attachments during active send.

## File, diff, upload, attachment identity

Files: `diff-store.ts`, `uploads.ts`, `workspace-file-store.ts`, `workspace-file-open-target.ts`, `workspace-file-previews.ts`, `workspace-file-page.tsx`, `workspace-diff-page.tsx`.

Risks:
- `.gitignore`, `.gitkeep`, extensionless files, SVG, binary files, images, pasted text, generated attachments, external files all need correct preview behavior.
- Diff view should not call workspace `readPatch` for files that are not currently changed workspace files.
- External absolute file access needs a scoped/allowed path mechanism, not arbitrary remote file reads.
- Browser caching can keep stale image previews unless URLs include a cache key.
- Copy actions should only be available for text content actually loaded/displayed.

## PR/Git polling and persistence

Files: `workspace-manager.ts`, `pr-refresh-poller.ts`, `git-refresh-poller.ts`, `github-rest-client.ts`, `event-store.ts`.

Risks:
- GitHub rate limits and bad credentials should not spam logs or hide real errors.
- PR refresh should not double-run git refresh if git poller already handles it.
- Working-tree changes should not bypass GitHub PR cooldown unless they affect PR state.
- Closed/merged PRs still need persisted title/stage/files/comments/checks for review surfaces.
- Private repos should work when the GitHub token has access.

## Right sidebar

Files: `right-sidebar.tsx`, `right-sidebar-all-files.tsx`, `right-sidebar-changes.tsx`, `right-sidebar-checks.tsx`, `right-sidebar-terminal-*`, right-sidebar libs.

Risks:
- All Files should handle workspace-not-ready startup with loading/retry, not immediate fatal error.
- Changes must choose local changed files vs persisted PR files correctly by workspace condition.
- Viewed state should reset when diff content changes.
- Terminal snapshots can duplicate prompt/output if pre-restore events are replayed incorrectly.
- UI can easily become too large/noisy. Keep compact.

## Scratchpad

File: `scratchpad-page.tsx`.

Risks:
- Markdown preview needs GFM table support and good typography.
- Write mode uses page-level scroll; textarea height recalculation must preserve scroll position and respond to width changes.
- Editing at the end of a long note must not jump to top.

## Release/package/startup

Files: `cli-runtime.ts`, `update-manager.ts`, `data-dir-lock.ts`, release workflow.

Risks:
- Auto-update/restart can collide with data-dir lock if old instance stays alive.
- Startup overlays should not flicker during normal initial connect.
- Release workflow should publish only after trusted tag/version flow.
