# Miko Glossary

## Directory

A top-level user-added source directory. It can contain multiple Miko workspaces/worktrees. Directory management lives mostly in settings/history/sidebar flows.

## Workspace

A Miko-managed working copy/worktree connected to a branch, sessions, git snapshot, PR metadata, scratchpad, right sidebar state, terminals, and uploaded app data. A workspace is not the same as the user's original repository.

## Session

A chat/agent conversation inside a workspace. Sessions have transcripts, runtime provider/model/options, queued messages, active turns, pending tools, and read/unread state.

## Turn

One user send and its resulting assistant/tool activity. Turns can stream, call tools, produce changed files, fail, or wait for user input.

## Transcript

The durable message/tool-call history rendered in chat. `TranscriptItemView` owns layout; helper components render content.

## Composer

The input surface for sending messages. It is tokenized contenteditable, not a plain textarea. It supports text, file mentions, pasted text, and attachments.

## Prompt part

Structured piece of composer content: text, mention, attachment, pasted text, etc. Prompt parts should be converted carefully to submitted plain text plus attachment metadata.

## Workspace file

A repo/workspace-relative file that belongs to the current workspace root and can be read/diffed through workspace file commands.

## External file

An absolute file outside the workspace root. It must not be silently treated as a workspace file. Access needs explicit/scoped permission/identity.

## Generated attachment

A durable app-managed file, usually from uploads, pasted text, screenshots, or generated instruction files. Stored under Miko app data, not in the worktree.

## Pasted text

Text pasted into the composer that is stored/displayed as a tokenized attachment-like object and can be opened in the file viewer.

## Diff patch

Unified diff content for a changed file. Only valid when the file is actually changed in the relevant local/PR context.

## PR stage

The workspace's GitHub pull request state: draft, open/ready, checks pending/failing/passing, merge conflicts, merged, closed, etc. Stage drives badges, actions, and sidebar content.

## Checks

GitHub check runs/status plus local git/review/todo context shown in the right sidebar Checks section.

## Queue

Durable FIFO of submitted messages waiting for the current session to become available. The composer may allow sending while busy, but server ordering must remain correct.
