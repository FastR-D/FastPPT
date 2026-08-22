# Landing theme rules

- Keep decks at 16:9 and use the Landing blue/green palette with restrained accent colors.
- Use `cover` for title or closing pages, `content-flex` for structured text, `content-grid` for visual matrices, and `my-image` for figure-led slides.
- Use `paper-summary` with its named slots for research reviews instead of recreating its layout manually.
- Prefer Markdown; use `Hint`, `Block`, `Chevron`, `ColBlock`, `Mark`, tabs, and citation components only when they add semantic structure.
- Let `Hint`, `Block`, `MyCard`, `Chevron`, and `ColBlock` use the theme's built-in vertical rhythm; add custom margin utilities only for intentional exceptions.
- Use native Markdown tables for tabular data; the theme's academic default format renders the header row and first column on the theme blue with white bold text, other cells in black, and a width-adaptive font size.
- Keep click-indexed tab panes ordered and self-contained.
- Use DOI citations where available and show the generated references when citation components are present.
- Keep images portable and verify assets, scroll behavior, page numbers, overflow, and export rendering.
- Do not fight the base layout with ad hoc absolute positioning or re-register the theme's global plugins.

The theme-specific Skill documents component and layout conventions. Workspace safety, MCP usage, Harness invocation, and export workflow belong to the common FastPPT Skill.
