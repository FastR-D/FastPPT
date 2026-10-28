---
name: fastppt-theme-create
description: Create a FastPPT Slidev theme from a design brief or reference PPTX, compile its design contract, generate a theme-specific Skill, and review sample slides. Use when the user requests a new theme, PPTX theme extraction, or theme design changes.
---

# Create and review a theme

Use the FastPPT CLI core, or the equivalent MCP tools. Read the command and
schema reference with `fastppt --help` and `fastppt tools list --json`.
Always use an explicit `--dir` when working outside the current workspace.

1. Inspect registered themes with `fastppt theme list --json`. Choose a new
   `slidev-theme-<slug>` identifier. Preserve existing user themes.
2. For a source PPTX inside the workspace, run
   `fastppt theme import --file references/source.pptx --name MyTheme --json`.
   Retain the returned theme ID. Extraction preserves source evidence; review
   that evidence before changing any inferred rules.
3. For a new theme without a PPTX, author a JSON object with `themeId`,
   `displayName`, and `design`, following the `create_theme` schema returned by
   `tools list`. Run `fastppt theme create --input-file theme-create.json --json`.
   The design contract owns palette, typography, geometry, semantic layouts,
   signature components and density. Do not invent unsupported schema fields.
4. For an imported or existing theme, compile `{themeId, design}` with
   `fastppt theme design --input-file theme-design.json --json`. Use
   `theme layouts` only for the legacy fixed layout/component archetypes.
5. Run `fastppt skills install --json` to install the common and theme Skills
   for Codex and Claude. Conflicts must be reported; never overwrite modified
   or unmanaged Skills. When a Gateway is already running, rescan its registry
   with `fastppt theme rescan --json` or restart the Gateway before use.
6. Read `theme manifest`, `theme rules`, and `theme skill --harness codex` for
   the returned ID. Check that layout identifiers, machine rules, human rules
   and theme-specific Skill agree. Empty machine rules do not establish quality.
7. Run `fastppt theme samples --theme <id> --json`. Use the returned sample path.
   Start the Gateway, open the sample deck in FastPPT Preview, then run
   `fastppt theme review --theme <id> --json`. Inspect all five pages visually,
   correct text fit, collisions and overflow, and repeat the affected checks.
8. Report the theme directory, registered layouts, generated Skill and review
   status. Do not declare a theme visually verified without browser evidence.

Theme source changes are authorized only during theme maintenance. During deck
creation, use the theme-specific Skill and keep custom CSS local to the deck.
