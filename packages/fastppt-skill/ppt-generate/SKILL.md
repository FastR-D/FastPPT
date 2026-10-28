---
name: fastppt-ppt-generate
description: Generate, revise, validate and export a FastPPT presentation using the CLI and registered theme Skills. Use for end-to-end PPT creation, AI deck generation, or editable PPTX delivery from a FastPPT workspace.
---

# Generate a presentation

Pair this Skill with `$fastppt` and the selected theme-specific Skill. The base
Skill owns slide quality, evidence, image production and editable visuals.
Use `fastppt tools list --json` for the authoritative schemas and
the installed base Skill’s `references/cli.md` for command examples.

1. Inspect the workspace with `fastppt tools call get_workspace --json` and
   registered themes with `fastppt theme list --json`. Use the explicit theme
   from the user's brief or session profile. Read its manifest, rules and Skill.
2. Run `fastppt skills install --json` if the required Skills are missing.
   Report installation conflicts and preserve modified Skills.
3. Convert the brief into a communication goal, argument spine, evidence needs
   and slide jobs. Reuse supplied audience, language and review preferences.
4. For local authoring, write Slidev Markdown using
   `fastppt deck write --path slides.md --content-file draft.md --json`.
   When revising, read the current revision and supply `--revision` to prevent
   overwriting concurrent edits. Never silently replace existing content.
5. For generation by a managed Agent, start the Gateway and prepare JSON with
   `harness` (`codex` or `claude`), `prompt`, optional `title`, and a complete
   `profile` matching `SessionDeckProfileSchema`. Use the generation example in
   the CLI reference; include the chosen theme and target Markdown path.
   Run `fastppt deck generate --input-file generation.json --json`.
   The command dispatches a background run. Retain its session/run IDs and
   inspect with `fastppt session status --harness codex --session <id> --json`.
   A dispatch receipt is not evidence of a completed deck. Handle approvals,
   failures and requested user input through the managed session.
6. Run `deck format` and `deck validate` for the target path. Resolve errors.
   Start `preview start --path <path>` and open that deck in FastPPT Preview.
   Use `deck quality` and `deck overflow` with `--slide` for every affected page.
   Inspect actual rendered pages, line wrapping and internal collisions.
7. When the user requests PPTX delivery, run
   `fastppt deck export --path slides.md --output-name presentation.pptx --json`.
   Keep the FastPPT browser connected for capture. The command waits for export
   and returns the downloaded local artifact path. Report that exact path.
   Never substitute a queued job ID or a screenshot deck for editable delivery.
8. Report edited files, validation and quality results, and remaining limitations.
   If preview or capture is unavailable, report the unverified stage clearly.
