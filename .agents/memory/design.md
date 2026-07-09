# Miko Design Memory

Miko's visual design system. Concrete values live in `src/index.css` (`@theme` maps Tailwind names to CSS vars; `:root` holds the raw values). **Never hardcode hexes in components — always use the token.** This file is the human-readable index of those tokens plus the taste decisions behind them.

## Design language

Achromatic, precise, terminal-native — instrument-grade precision with its own identity, not a clone. One rule governs everything: **color only encodes state; chrome stays monochrome.** White is the accent (primary action, focus, live-agent loader). Type carries a human/machine split: sans for prose, mono for machine text (branch names, paths, timestamps, commands, section labels, tooltips). Aligned with the brand mark — white mascot on a near-black tile; the logo is built from token values.

## Fonts

- **Sans (`--font-sans`, prose/UI):** `Instrument Sans Variable` → `Instrument Sans` → `-apple-system, system-ui, "Segoe UI", Roboto, sans-serif`.
- **Mono (`--font-mono`, machine text + code + terminal):** `IBM Plex Mono` → `ui-monospace, "SF Mono", Menlo, monospace`.
- Packages: `@fontsource-variable/instrument-sans`, `@fontsource/ibm-plex-mono` (400/500/600). The old `inter` / `jetbrains-mono` are removed — do not reintroduce.

## Type scale

Utility classes in `src/index.css` `@layer utilities`. Format: size / weight / line-height / tracking.

| Class | Size | Wt | LH | Tracking | Use |
|---|---|---|---|---|---|
| `.text-display-xl` | 80px | 600 | 1.05 | -3px | hero only |
| `.text-display-lg` | 56px | 600 | 1.1 | -1.8px | |
| `.text-display-md` | 40px | 600 | 1.15 | -1px | |
| `.text-headline` | 28px | 600 | 1.2 | -0.6px | section titles |
| `.text-card-title` | 22px | 500 | 1.25 | -0.4px | settings H1, nameplate branch |
| `.text-subhead` | 20px | 400 | 1.4 | -0.2px | |
| `.text-body-lg` | 18px | 400 | 1.5 | -0.1px | |
| `.text-body` | 16px | 400 | 1.5 | -0.05px | |
| `.text-body-sm` | 14px | 400 | 1.5 | 0 | tool rows |
| `.text-caption` | 12px | 400 | 1.4 | 0 | |
| `.text-button` | 14px | 500 | 1.2 | 0 | |
| `.text-eyebrow` | mono 11px | 500 | 1.3 | 0.08em, upper | |
| `.text-label-mono` | mono 10.5px | 500 | 1.4 | 0.09em, upper | section labels (`PROJECTS`, `TERMINAL`, git-status headers) |
| `.text-mono` | mono 13px | 400 | 1.5 | 0 | inline code/paths |

- **Transcript workhorse is 14px** (user prompt, assistant text, tool rows) — set inline, not via a utility. User prompt is `text-ink-muted`; assistant text is `text-ink`.
- Display sizes shrink under `max-width: 768px` (see the media query at the bottom of `index.css`).

## Color

Achromatic ramp — pure black/gray, no temperature.

| Token | Hex | Role |
|---|---|---|
| `--canvas` | `#0a0a0a` | app background |
| `--surface-1` | `#131313` | cards, sidebar, input, composer |
| `--surface-2` | `#1b1b1b` | popovers, muted, hover, inline chips |
| `--surface-3` | `#242424` | active/pressed |
| `--surface-4` | `#2e2e2e` | highest raised |
| `--hairline` | `#262626` | default border (global `border-hairline` on `*`) |
| `--hairline-strong` | `#333333` | emphasized border |
| `--hairline-tertiary` | `#414141` | scrollbars, strongest hairline |
| `--ink` | `#f2f2f2` | primary text |
| `--ink-muted` | `#b5b5b5` | secondary text |
| `--ink-subtle` | `#8a8a8a` | tertiary / captions |
| `--ink-tertiary` | `#646464` | faint / disabled |
| `--primary` | `#f2f2f2` | **accent = white**: primary buttons, focus |
| `--primary-hover` | `#ffffff` | |
| `--on-primary` | `#0a0a0a` | text on primary (black) |

**State color only** (never in chrome): `--diff-addition #4ec77e`, `--diff-deletion #f07681`, `--merged #a985f0`, `--vcs-modified #d3a43e`, `--vcs-renamed #6fa5f5`, `--semantic-success #3fbe63`, `--destructive #ef4444`, `--semantic-overlay rgba(0,0,0,0.75)`.

**shadcn aliases** (in `:root`, don't set new components off these directly — prefer the semantic tokens above): `--background→canvas`, `--card/--sidebar/--input→surface-1`, `--popover/--muted/--accent→surface-2`, `--border→hairline`, `--ring→primary-focus`.

## Radius, spacing, elevation

- **Radius:** `xs 4 · sm 6 · md 8 · lg 12 · xl 16 · xxl 24 · pill/full 9999`. Default (`--radius`) is `lg` (12px).
- **Spacing:** `xxs 4 · xs 8 · sm 12 · md 16 · lg 24 · xl 32 · xxl 48 · section 96` (px).
- **Elevation (use these, not Tailwind `shadow-sm/md/lg` or ad-hoc `shadow-[...]`):**
  - `shadow-raised` — cards/tiles: `0 1px 2px rgba(0,0,0,.3), 0 8px 28px rgba(0,0,0,.26)`
  - `shadow-popover` — menus/tooltips/hover cards: `0 4px 14px rgba(0,0,0,.38), 0 14px 40px rgba(0,0,0,.3)`
  - `shadow-dialog` — modals/overlays: `0 8px 24px rgba(0,0,0,.42), 0 32px 90px rgba(0,0,0,.45)`

## Signature components

- **Loader** (`Icons.activeIcon`): the **scanner** — a 5px white segment sweeping a faint 3px track (`.animate-agent-scan`, keyframes `agent-scan`, 1.3s). White in timer/sidebar; `text-ink-subtle` in tool rows.
- **Workspace stage icons** (`Icons.idleIcon/prIcon/mergedIcon/errorIcon`): custom 1.3px node-and-curve git-graph SVGs, one silhouette; state told by color + small variation (open vs filled node, flipped for merged, × for errors).
- **User prompt** (transcript): right-aligned, `text-ink-muted`, anchored by a `border-r-2` right-edge rule. Not a bubble. Mentions render as quiet inline refs (soft `surface-2`, mono filename) via `PromptToken` read-only branch.
- **Dropdowns:** one style — Radix Select, hairline trigger + `shadow-popover` menu. No native `<select>`.
- **Icons:** Phosphor only (library is locked). Sidebar chrome (filter, add-directory, settings) at regular weight.

## Working method

Taste calls are the user's; iterate against screenshots, not prose. Apply a change, screenshot the real running app (dev server + Playwright), let the user react to the image. Settled preferences are recorded here so they are not re-opened.
