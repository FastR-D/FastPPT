# slidev-theme-db

A [Slidev](https://sli.dev) theme for the **TU Dresden Database Research Group**:
branding, Noto Sans, the DB colour palette, syntax-highlighted code, and
template-styled tables — out of the box.

## Install

Set up a Slidev deck as usual, then add this theme and the gsap addon as
dependencies:

```bash
pnpm create slidev # the standard Slidev scaffolder (skip if you have a deck)
pnpm add -D slidev-theme-tud-db slidev-addon-gsap
```

Then point the deck at the theme in `slides.md`:

```yaml
---
theme: tud-db
---
```

```bash
# live preview at localhost:3030
pnpm dev
```

No `addons:` line needed — the theme enables `slidev-addon-gsap` via its
defaults, so `import { useTl } from 'slidev-addon-gsap'` works in any slide. The
theme also sets `canvasWidth: 960` (1px == 1pt), Noto Sans, light scheme, and
Comark on; override any in your own headmatter.

## Example

See [`examples/slides.md`](./examples/slides.md) for a small deck using the cover,
two-column, and content layouts.

## Authoring reference

The repo ships a [`slidev-theme-db` skill](./skills/slidev-theme-db/SKILL.md) — an
[Agent Skill](https://sli.dev) documenting every layout, the table/code helpers,
and the gotchas. Claude Code applies it automatically when you write `theme: db`
slides. To add it to a deck:

```bash
cp -r node_modules/slidev-theme-db/skills/slidev-theme-db .claude/skills/
```

## Maintaining the theme

- `components/DbFrame.vue` — shared chrome (logo, footer, padding).
- `layouts/` — `cover`, `default`, `two-cols-header`, `two-cols-grid` (wrap `DbFrame`).
- `styles/db-theme.css` — tokens, typography, lists, tables (keyed on `.db-default`).
- `setup/shiki.ts` (fenced) and the `THEME` in `vite.config.ts` (inline `{lang}`) —
  the **two** highlighters; keep them in sync (both `catppuccin-latte`).
- Link the theme with `link:` (not `file:`), and **restart** the dev server after
  editing theme files (Vite doesn't hot-reload `node_modules`).
