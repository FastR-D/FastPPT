# @captainsafia/slidev-theme-sketchdeck

A whimsical-but-technical [Slidev](https://sli.dev) theme. Whiteboard paper, wobbly
hand-drawn borders, handwritten type, and Excalidraw's small red/blue/green/yellow
accent palette. Light mode only, on purpose.

## Use

```yaml
---
theme: '@captainsafia/slidev-theme-sketchdeck'
---
```

Slidev installs it on first run. Fonts (Caveat, Shantell Sans, JetBrains Mono) come
from Slidev's font provider via `slidev.defaults.fonts` — no manual link tag needed.

## Layouts

| Layout       | For                               | Frontmatter / slots                         |
| ------------ | --------------------------------- | ------------------------------------------- |
| `cover`      | Title slide                       | `eyebrow:`, `#sketch` slot                  |
| `section`    | Dark divider                      | `part:`, `accent: red\|blue\|green\|yellow` |
| `default`    | Heading + bullets                 | —                                           |
| `two-cols`   | Text beside a diagram             | `::left::` / `::right::`                    |
| `whiteboard` | Full-bleed diagram on graph paper | `#title`, `#board` slots                    |
| `code`       | Code with line focus              | `file:`, `#title` slot                      |
| `table`      | Comparison matrix                 | cell classes `{.good} {.meh} {.bad} {.pick}`|
| `stats`      | Metric cards                      | wrap cards in `<div class="sk-stat-row">`   |
| `quote`      | Pull quote on warm paper          | `source:`                                   |
| `end`        | Thanks / contact                  | `#notes` slot                               |
| `center`     | Anything, centred                 | —                                           |

## Components

- `<SketchBox color wobble tilt flat>` — wobbly bordered card. `color`: paper, warm, shaded, red, blue, green. `wobble`: a–d.
- `<StickyNote color tilt>` — small mono chip / taped label.
- `<Scribble color tilt top left right bottom>` — handwritten margin annotation; positions absolutely when given an offset.
- `<SketchPlaceholder label wobble tilt hatch>` — hatched box standing in for a real diagram. Swap these for images.
- `<StatCard value color wobble tilt>` — big handwritten number + caption.
- `<Underline color width tilt>` — highlighter stroke rule.

## Per-slide classes

- `class: grid-paper` — graph paper instead of dots
- `class: plain-paper` — no background texture
- `class: sk-dark` — ink background, paper text

## Tokens

All colours and the four wobble radii are CSS variables on `:root` (`--sk-ink`,
`--sk-red`, `--sk-wobble-a` …). Override them in your own `style.css` to rebrand
without touching the layouts.

## Develop

```bash
pnpm i
pnpm dev
```

MIT.
