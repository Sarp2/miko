# CLAUDE.md

Durable project docs live in `.agents/memory/` (architecture, fragile-areas,
decisions, design, glossary, workflows) — read them on demand, and put new
durable facts there, not in NOTES.md, unless they must be always-loaded.

<!-- confable:start -->
## Confable memory
@.claude/memory/NOTES.md
@.claude/memory/INDEX.md

Core rules — durable codebase facts (gotchas, fragile areas, patterns) go
in `.claude/memory/NOTES.md` immediately when discovered, one verified line
each. Session events (decisions, dead ends, files touched, next step) go in
`.claude/memory/sessions/<branch-or-topic>.md`. On finishing a task or
before /compact: update the session file and append one line to INDEX.md.
Full rules: the `confable` skill.
<!-- confable:end -->
