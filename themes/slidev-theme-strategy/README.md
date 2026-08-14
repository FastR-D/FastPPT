# slidev-theme-raft

A neo-brutalism [Slidev](https://sli.dev) theme in the visual language of Raft:
Raft Ink (`#141111`) borders and hard shadows, Cotton Core cream canvas,
Soft Signal yellow accents, Space Grotesk / Space Mono type.

Tokens come from Raft's production design system.

Published on npm: [`slidev-theme-raft`](https://www.npmjs.com/package/slidev-theme-raft)

## Screenshots

| cover | cards |
| --- | --- |
| ![cover](https://cdn.jsdelivr.net/npm/slidev-theme-raft/docs/screenshots/cover.png) | ![cards](https://cdn.jsdelivr.net/npm/slidev-theme-raft/docs/screenshots/cards.png) |
| **callouts** | **end** |
| ![callouts](https://cdn.jsdelivr.net/npm/slidev-theme-raft/docs/screenshots/callouts.png) | ![end](https://cdn.jsdelivr.net/npm/slidev-theme-raft/docs/screenshots/end.png) |

## Usage

Install the theme and the Slidev CLI in your deck directory:

```bash
pnpm add -D slidev-theme-raft @slidev/cli
```

Point your `slides.md` at the theme and run Slidev:

```md
---
theme: raft
---

# Your slides
```

```bash
pnpm exec slidev slides.md
```

## Layouts

`cover` · `default` · `section` (`color:` prop) · `two-cols` · `image-right` (`image:` prop) · `quote` · `statement` · `end`

## Components

- `<Callout title="..." color="yellow|pink|lavender|cyan|orange|lime|red">`

## Development (working on the theme itself)

```bash
pnpm install
pnpm dev        # serves the workspace demo at http://localhost:3083
pnpm build      # builds the demo against the local theme package
```

This repository is a pnpm workspace:

- `/` is the publishable `slidev-theme-raft` package.
- `/demo` is a private Slidev deck that depends on the theme through
  `workspace:*` and uses the same `theme: raft` entry point as npm consumers.

The demo, its slides, and its image assets are deliberately excluded from the
published package by the root `files` whitelist.

## Using a local checkout instead of npm

Point an existing deck at this checkout with a relative or absolute path:

```md
---
theme: /path/to/slidev-theme-raft
---

# Your slides
```

Or add the checkout as a local dependency from your deck directory:

```bash
pnpm add -D ../slidev-theme-raft
```

```md
---
theme: raft
---
```

## License

MIT
