# Miko Decisions Memory

This file records accepted decisions and rejected paths so future agents do not revive old mistakes.

## Accepted decisions

- Miko is production now. Treat package/release/data changes as production work.
- Workspace file/diff routing must distinguish workspace files, external absolute files, generated attachments, pasted text, and transcript files.
- Uploads are stored in app data, outside worktrees. Upload artifacts must not appear as workspace git changes.
- Submitted messages/queue state should be durable. Memory-only queued work is not acceptable for production behavior.
- The composer should allow queueing follow-up messages while a session is busy, without breaking FIFO.
- First prompt UX should show the user prompt and loader immediately after submit.
- Existing sessions are provider-fixed. The UI should not lie about provider/model behavior for sessions whose runtime is already established.
- PR metadata should persist enough detail for title, description, checks, comments, and files to survive restart/merge/close cases.
- Git and PR refresh are both needed, but avoid duplicate polling and avoid GitHub calls for purely local working-tree noise.
- Right sidebar appears only on workspace pages, not home/history/settings.
- History page replaces the older archive route naming.
- Settings page owns directory/workspace management. Deleting a workspace must not delete the user's source repository.
- Scratchpad is a real product surface and should feel pleasant, not like a raw textarea.
- Release notes should be professional, curated, and feature/fix oriented.
