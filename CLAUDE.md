# CLAUDE.md

Durable project docs live in `.agents/memory/` (architecture, fragile-areas,
decisions, design, glossary, workflows) — read them on demand, and put new
durable facts there, not in NOTES.md, unless they must be always-loaded.

<!-- confable:start -->
## Confable rules

@.claude/memory/NOTES.md
@.claude/memory/INDEX.md

**Route knowledge as it appears:**
- Durable codebase fact (gotcha, fragile area, pattern) → one verified
  line in `.claude/memory/NOTES.md`, immediately when discovered.
- Session event (decision, dead end, files touched, next step) →
  `.claude/memory/sessions/<branch-or-topic>.md`.
- On finishing a task or before /compact → update the session file and
  this stream's line in INDEX.md.

**Context watch:** every turn, estimate your context usage. Past ~200K
tokens: checkpoint to memory NOW, then tell the user: "Context ~200K —
everything is saved to disk, run /compact." If usage is already past 200K
when you read this, act on it this turn — not "going forward." If they
keep working without compacting, repeat every ~50K.

Full rules: the `confable` skill.
<!-- confable:end -->
