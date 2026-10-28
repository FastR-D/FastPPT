# FastPPT CLI core

The CLI and MCP invoke the same services, schemas, path policies and browser
capture delegates. Discover the current schema with `fastppt tools list --json`.
Every tool is callable as `fastppt tools call <tool_name> --input-file args.json`.
No source-tree scripts or guessed filesystem paths are needed.

```bash
fastppt theme list --json
fastppt theme manifest --theme slidev-theme-academy --json
fastppt theme rules --theme slidev-theme-academy --json
fastppt theme skill --theme slidev-theme-academy --harness codex --json
fastppt skills install --json
fastppt deck read --path slides.md --json
fastppt deck write --path slides.md --content-file draft.md --revision <revision>
fastppt deck format --path slides.md
fastppt deck validate --path slides.md --json
fastppt start --dir ./workspace
fastppt preview start --path slides.md
fastppt deck quality --path slides.md --slide 1 --json
fastppt deck overflow --path slides.md --slide 1 --json
fastppt deck export --path slides.md --output-name presentation.pptx --json
```

`--dir` scopes core operations to an existing workspace. Input/content files are
local staging inputs resolved relative to the shell's current directory; actual
core writes still use workspace-relative paths and the WorkspaceService policy.
JSON input must be an object. Named flags override JSON fields. `--json` returns
structured errors, and unsuccessful validation or inspection exits nonzero.
The default/max core tool timeout is 900000 ms; `--timeout` can shorten it.

Theme create/import/design, deck reads/writes/format/validation, assets and icons
work without the Gateway. AI sessions, preview, rendered checks, image-production
state and PPTX exports use the workspace's running Gateway. Browser inspection
and capture require an active FastPPT Web preview; the CLI does not launch a
headless browser. After changing theme sources with a running Gateway, rescan
its theme registry with `fastppt theme rescan --json` or restart it before opening the new theme.

## AI generation input

Save the following JSON as `generation.json`, adjusting the user's brief:

```json
{
  "harness": "codex",
  "title": "Product update",
  "prompt": "Create a presentation in product-update.md using the supplied profile.",
  "profile": {
    "version": 1,
    "conversationMode": "create-slide",
    "target": { "markdownPath": "product-update.md" },
    "artifactRoute": "generate",
    "audience": "Product team",
    "communicationIntent": "briefing",
    "narrativeMode": "briefing",
    "language": "en-US",
    "theme": { "mode": "registered", "themeId": "slidev-theme-academy" },
    "preservation": {},
    "reviewPolicy": "standard"
  }
}
```

Run `fastppt deck generate --input-file generation.json --json`. It returns a
session ID and generation run receipt. Follow with
`fastppt session status --harness codex --session <id> --json`. Review the actual
run outcome, files and quality before declaring generation complete.

## Theme design input

`theme create` takes `{themeId, displayName, design}`; `theme design` takes
`{themeId, design}`. `design` is a versioned contract containing `foundation`
(colors, typography, geometry), `layouts`, `components`, and `rules`. Use the
schemas returned by `tools list`, and read the theme-creation Skill for review.
New themes are created exclusively; an existing theme ID causes an error.
