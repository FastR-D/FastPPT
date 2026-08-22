---
name: fastppt-theme-landing
description: Create, edit, review, and validate Landing Slidev decks using the registered FastPPT layouts, components, palette, citations, tabs, and plugin conventions.
metadata:
  id: fastppt-theme-landing
  version: 0.0.5-fastppt.1
---

# FastPPT Landing theme

Use this skill to author and maintain slides that match this repository’s visual and interaction conventions.

## Core goal

Produce Slidev pages that fit the Landing theme, use the custom components correctly, and stay compatible with the repo’s plugins, layouts, and styling system.

## Project structure to respect

- Theme examples are in this Skill's `example.md` resource.
- Global setup lives in `setup/main.ts`.
- Layouts are in `layouts/`.
- Reusable slide components are in `components/`.
- Plugins live in `plugins/` and provide citations, scroll behavior, and tabs.
- Theme styling is driven by `uno.config.ts` and `styles/layout.css`.

## When to use which layout

- `cover`: title or closing slides.
- `content-flex`: chapter/section slides with text + components.
- `content-grid`: image-heavy or centered content slides.
- `my-image`: single image or figure-focused slides.
- `paper-summary`: paper review / research summary slides with `up`, `summary`, `details`, and `bottom` slots.
- `toc`: agenda or outline slides.

## Component conventions

- Use `Hint` for callouts, notes, warnings, and source labels.
- Use `Block` for compact highlighted statements.
- Use `Chevron` for step or process cards.
- Use `ColBlock` for boxed content columns.
- Use `Mark` for emphasized inline text.
- Use `MyTab` and `MyTabPane` for click-aware tabbed content.
- Use `MyCite` for DOI-based inline references.
- Use `References` in the footer area when citations are present.
- Block components include restrained vertical spacing by default; avoid stacking extra `my-*`, `mt-*`, or `mb-*` utilities unless the slide needs a deliberate exception.

## Authoring rules

1. Keep slides in 16:9 unless the user explicitly requests otherwise.
2. Prefer Markdown-first slides; use Vue components only when they add structure or interaction.
3. Keep chapter and section metadata aligned with the current slide topic.
4. Use `clicks` in slide frontmatter when tab content or staged reveals depend on click count.
5. For `MyTabPane`, set `:click` values in ascending order and make sure all panes are nested under a single `MyTab`.
6. For `paper-summary`, provide `chapter`, `section`, `paperABBR`, and `paperDOI`, then fill the named slots instead of placing everything in the default slot.
7. When using citations, prefer DOI values and let the references plugin format the bibliography automatically.
8. Keep image paths relative to the slide file so exported decks stay portable.
9. Use theme colors and utility classes such as `bg-primary`, `text-whu-blue`, `text-whu-green`, and UnoCSS spacing/layout utilities.
10. Use native Markdown tables for tabular data and let the theme's academic default table format style them (blue header row and first column with white bold text, black body cells, width-adaptive font size); do not restyle tables with ad hoc cell backgrounds.
11. Avoid adding layout logic that fights the base layout’s scroll handling or page numbering.

## Common patterns from this repo

### Simple content slide

- Start with `layout: content-flex`.
- Put the chapter title in `chapter` and subsection title in `section`.
- Use `Hint`, `ColBlock`, `Block`, or `Chevron` for structured content.

### Paper summary slide

- Use `layout: paper-summary`.
- Put the key takeaway in `::summary::`.
- Put supporting visuals and deeper explanation in `::details::`.
- Use `::up::` and `::bottom::` only when needed.

### Tabbed reveal slide

- Use `MyTab` for the tab header.
- Register each `MyTabPane` with a unique `name` and a matching human-readable `tab` label.
- Bind `:click` to the intended reveal step.
- Keep each pane self-contained so content does not depend on hidden side effects.

### Citation slide

- Write inline citations with `MyCite`.
- Let `References` render the bibliography automatically.
- Use concise citation text in the slot content so the displayed label reads naturally.

## Implementation reminders

- `setup/main.ts` already registers one Pinia instance plus the references, scroll, and tab plugins globally. This fork intentionally does not register Naive UI.
- Do not re-register global components unless the user is changing app setup intentionally.
- For per-slide logic, rely on Slidev context rather than custom global state when possible.
- Avoid calling slot functions during setup or computed initialization unless the component already does so safely.

## Quality checklist before finishing

- Layout matches the intended slide type.
- Components are used with the correct props and slots.
- Citations resolve and the bibliography is visible when needed.
- Click-based reveals behave correctly in presentation mode.
- Images and assets resolve in both preview and export.
- Styling stays consistent with the Landing theme palette and spacing.

## Good response style

When helping with this repo, propose the smallest slide or component change that solves the problem, preserve existing visual conventions, and explain any layout tradeoffs only if they matter for the slide outcome.
