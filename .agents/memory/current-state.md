# Miko Current State

Last updated: 2026-07-09.

## Production status

Miko is in production as npm package `miko-code`.

Current package version in `package.json`: `0.1.7`.

Recent release chain:
- `v0.1.2`: fixed diff view hang on plaintext files.
- `v0.1.3` / `v0.1.4`: release/package follow-up fixes.
- `v0.1.5`: scratchpad scroll/design polish, right sidebar file tree and terminal polish.
- `v0.1.6`: composer placeholder recovery and write/edit tool row file icons.
- `v0.1.7`: app visual-system refresh, safer git status parsing, transcript copy feedback, and curated agent memory docs.

## Near-term priorities

1. Full codebase audit for production/mobile readiness.
2. Focused architecture cleanup, not a giant rewrite.
3. Stabilize fragile systems: queue, uploads/file identity, diff reading, websocket snapshots, polling.
4. Prepare mobile later by clarifying server API/state boundaries first.
5. Keep release process reliable and professional.
