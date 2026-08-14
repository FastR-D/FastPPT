/**
 * Materialize a harness-designed set of characteristic Slidev layouts and
 * components into a theme package. The harness (agent) submits a structured list
 * (`kind` + `hint` per item); this module generates token-based Vue SFCs and
 * updates the theme manifest's layout roster. All styling uses the theme's
 * `--ext-*` design tokens so the result stays on-palette.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface ThemeLayoutDesign {
  id: string
  label: string
  kind: string
  hint?: string | undefined
}

export interface ThemeComponentDesign {
  name: string
  kind: string
  hint?: string | undefined
}

export interface DesignThemeLayoutsInput {
  themeDir: string
  layouts: ThemeLayoutDesign[]
  components: ThemeComponentDesign[]
}

export interface DesignThemeLayoutsResult {
  layouts: Array<{ id: string; label: string }>
  components: string[]
}

const LAYOUT_KINDS = new Set([
  'cover', 'section', 'two-col', 'data', 'statement', 'image-right',
  'quote', 'grid', 'metrics', 'agenda', 'ending',
])

const COMPONENT_KINDS = new Set([
  'stat', 'callout', 'badge', 'pill', 'chip',
])

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/
const SAFE_NAME = /^[A-Z][A-Za-z0-9]*$/

/** Layout SFC template per kind; `id` is used for the scoped class. */
function layoutSfc(design: ThemeLayoutDesign): string {
  const { id, kind, hint } = design
  const cls = `ext-${id}`
  const hintComment = hint ? `<!-- ${hint.replaceAll('-->', '')} -->\n` : ''
  const base = `<div class="slidev-layout ${cls}">\n    <slot />\n  </div>`

  const bodies: Record<string, string> = {
    cover: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-inner">\n      <span class="ext-pill">${labelEscape(design.label)}</span>\n      <slot />\n    </div>\n  </div>`,
    section: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-inner"><slot /></div>\n  </div>`,
    'two-col': `<div class="slidev-layout ${cls}">\n    <div class="col"><slot name="default" /></div>\n    <div class="col"><slot name="right" /></div>\n  </div>`,
    data: `<div class="slidev-layout ${cls}">\n    <div class="ext-rule" />\n    <div class="${cls}-body"><slot /></div>\n  </div>`,
    statement: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-inner"><slot /></div>\n  </div>`,
    'image-right': `<div class="slidev-layout ${cls}">\n    <div class="text"><slot /></div>\n    <div class="media"><slot name="image" /></div>\n  </div>`,
    quote: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-inner"><slot /></div>\n  </div>`,
    grid: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-cell"><slot name="default" /></div>\n    <div class="${cls}-cell"><slot name="cell-2" /></div>\n    <div class="${cls}-cell"><slot name="cell-3" /></div>\n  </div>`,
    metrics: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-inner"><slot /></div>\n  </div>`,
    agenda: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-inner"><slot /></div>\n  </div>`,
    ending: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-inner"><slot /></div>\n  </div>`,
  }

  const styles: Record<string, string> = {
    cover: `.${cls} { display: flex; align-items: center; }\n.${cls}-inner { max-width: 76%; }\n.${cls}-inner :deep(h1) { font-size: 3rem; margin: 0.4rem 0 0; }\n.${cls}-inner :deep(p) { color: var(--ext-muted); font-size: 1.1rem; }`,
    section: `.${cls} { display: flex; align-items: center; justify-content: center; }\n.${cls}-inner :deep(h1) { font-size: 2.8rem; margin: 0; }\n.${cls}-inner :deep(p) { color: var(--ext-muted); }`,
    'two-col': `.${cls} { display: grid; grid-template-columns: 1fr 1fr; gap: 1.8rem; align-content: start; }\n.${cls} :deep(h1) { font-size: 1.8rem; }`,
    data: `.${cls} { display: flex; flex-direction: column; }\n.ext-rule { flex: 0 0 auto; border-bottom: 2px solid var(--ext-primary); margin-bottom: 1.2rem; }\n.${cls}-body { flex: 1; }`,
    statement: `.${cls} { display: flex; align-items: center; justify-content: center; text-align: center; }\n.${cls}-inner { max-width: 82%; }\n.${cls}-inner :deep(h1) { font-size: 2.6rem; line-height: 1.3; margin: 0; }\n.${cls}-inner :deep(strong) { color: var(--ext-primary); }`,
    'image-right': `.${cls} { display: grid; grid-template-columns: 1.2fr 1fr; gap: 2rem; align-items: center; }\n.media { height: 100%; background-size: cover; background-position: center; border-left: 3px solid var(--ext-primary); }`,
    quote: `.${cls} { display: flex; align-items: center; justify-content: center; }\n.${cls}-inner { max-width: 72%; }\n.${cls}-inner :deep(blockquote), .${cls}-inner :deep(h1) { font-family: var(--font-serif, 'Noto Serif SC', serif); font-style: italic; font-weight: 400; font-size: 2rem; color: var(--ext-text); margin: 0; }`,
    grid: `.${cls} { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.2rem; align-content: start; }\n.${cls}-cell :deep(*) { border-top: 2px solid var(--ext-accent); padding-top: 0.6rem; }`,
    metrics: `.${cls} { display: flex; flex-direction: column; justify-content: center; }\n.${cls}-inner :deep(h1) { color: var(--ext-primary); }`,
    agenda: `.${cls} { display: flex; align-items: center; }\n.${cls}-inner :deep(ol) { font-size: 1.4rem; line-height: 2; }\n.${cls}-inner :deep(li::marker) { color: var(--ext-primary); font-weight: 700; }`,
    ending: `.${cls} { display: flex; align-items: center; justify-content: center; text-align: center; }\n.${cls}-inner :deep(h1) { font-size: 2.4rem; margin: 0; }\n.${cls}-inner :deep(p) { color: var(--ext-muted); }`,
  }

  return `<template>
  ${hintComment}${bodies[kind] ?? base}
</template>

<style scoped>
${styles[kind] ?? `.${cls} { padding: 2.4rem 3rem; }`}
</style>
`
}

function labelEscape(label: string): string {
  return label.replaceAll('</', '<\\/').slice(0, 60)
}

/** Component SFC template per kind. */
function componentSfc(design: ThemeComponentDesign): string {
  const { name, kind, hint } = design
  const hintComment = hint ? `<!-- ${hint.replaceAll('-->', '')} -->\n` : ''
  const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^-/, '')
  const cls = `ext-${kebab}`

  const templates: Record<string, string> = {
    stat: `<span class="${cls}"><strong class="${cls}-value"><slot name="value" /></strong><small class="${cls}-label"><slot /></small></span>`,
    callout: `<div class="${cls}"><strong class="${cls}-tag"><slot name="tag" /></strong><div><slot /></div></div>`,
    badge: `<span class="${cls}"><slot /></span>`,
    pill: `<span class="${cls}"><slot /></span>`,
    chip: `<span class="${cls}"><slot /></span>`,
  }

  const styles: Record<string, string> = {
    stat: `.${cls} { display: inline-grid; gap: 2px; }\n.${cls}-value { color: var(--ext-primary); font-size: 2rem; line-height: 1; }\n.${cls}-label { color: var(--ext-muted); font-size: 0.8rem; }`,
    callout: `.${cls} { display: block; border-left: 4px solid var(--ext-accent); background: var(--ext-surface); padding: 0.8rem 1rem; }\n.${cls}-tag { display: block; color: var(--ext-primary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.2rem; }`,
    badge: `.${cls} { display: inline-flex; align-items: center; padding: 0.15rem 0.8rem; border-radius: 999px; background: var(--ext-primary); color: var(--ext-bg); font-size: 0.8rem; }`,
    pill: `.${cls} { display: inline-flex; align-items: center; padding: 0.1rem 0.7rem; border: 1px solid var(--ext-accent); border-radius: 999px; color: var(--ext-text); font-size: 0.75rem; }`,
    chip: `.${cls} { display: inline-flex; align-items: center; padding: 0.05rem 0.5rem; border-radius: 6px; background: var(--ext-surface); color: var(--ext-muted); font-size: 0.7rem; }`,
  }

  return `<script setup lang="ts">
</script>

<template>
  ${hintComment}${templates[kind] ?? `<span class="${cls}"><slot /></span>`}
</template>

<style scoped>
${styles[kind] ?? `.${cls} { display: inline-block; }`}
</style>
`
}

interface ThemeManifest {
  layouts?: Array<{ id: string; label: string }>
  [key: string]: unknown
}

function replaceSection(source: string, heading: string, body: string): string {
  const marker = `## ${heading}`
  const start = source.indexOf(marker)
  if (start === -1) return `${source.trimEnd()}\n\n${marker}\n\n${body}\n`
  const next = source.indexOf('\n## ', start + marker.length)
  const end = next === -1 ? source.length : next
  return `${source.slice(0, start)}${marker}\n\n${body}\n${source.slice(end).replace(/^\n+/, '\n')}`
}

async function manifestPath(themeDir: string): Promise<{ path: string; manifest: ThemeManifest }> {
  const path = join(themeDir, 'agent', 'theme-manifest.json')
  const manifest = JSON.parse(await readFile(path, 'utf8')) as ThemeManifest
  return { path, manifest }
}

export async function designThemeLayouts(
  input: DesignThemeLayoutsInput,
): Promise<DesignThemeLayoutsResult> {
  const { themeDir } = input

  for (const layout of input.layouts) {
    if (!SAFE_ID.test(layout.id)) throw new Error(`Invalid layout id: ${layout.id}`)
    if (!LAYOUT_KINDS.has(layout.kind))
      throw new Error(`Unknown layout kind: ${layout.kind}`)
  }
  const seenLayouts = new Set<string>()
  for (const layout of input.layouts) {
    if (seenLayouts.has(layout.id)) throw new Error(`Duplicate layout id: ${layout.id}`)
    seenLayouts.add(layout.id)
  }
  for (const component of input.components) {
    if (!SAFE_NAME.test(component.name))
      throw new Error(`Invalid component name: ${component.name}`)
    if (!COMPONENT_KINDS.has(component.kind))
      throw new Error(`Unknown component kind: ${component.kind}`)
  }

  const { path, manifest } = await manifestPath(themeDir)
  const layoutsDir = join(themeDir, 'layouts')
  const componentsDir = join(themeDir, 'components')
  await mkdir(layoutsDir, { recursive: true })
  await mkdir(componentsDir, { recursive: true })

  for (const layout of input.layouts) {
    await writeFile(
      join(layoutsDir, `${layout.id}.vue`),
      layoutSfc(layout),
    )
  }
  for (const component of input.components) {
    await writeFile(
      join(componentsDir, `${component.name}.vue`),
      componentSfc(component),
    )
  }

  const existing = (manifest.layouts ?? []) as Array<{ id: string; label: string }>
  const byId = new Map(existing.map((layout) => [layout.id, layout]))
  const added: Array<{ id: string; label: string }> = []
  for (const design of input.layouts) {
    const entry = { id: design.id, label: design.label }
    if (!byId.has(design.id)) added.push(entry)
    byId.set(design.id, entry)
  }
  manifest.layouts = [...byId.values()]
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)

  const skillPath = join(themeDir, 'agent', 'SKILL.md')
  let skill = await readFile(skillPath, 'utf8')
  const layoutGuide = manifest.layouts
    .map((layout) => {
      const design = input.layouts.find((candidate) => candidate.id === layout.id)
      return `- \`${layout.id}\`${design?.hint ? `: ${design.hint}` : ''}`
    })
    .join('\n')
  skill = replaceSection(skill, 'Registered layouts', layoutGuide)
  if (input.components.length > 0) {
    const componentGuide = input.components
      .map((component) => `- \`<${component.name}>\`${component.hint ? `: ${component.hint}` : ''}`)
      .join('\n')
    skill = replaceSection(skill, 'Registered components', componentGuide)
  }
  await writeFile(skillPath, skill)

  return {
    layouts: added,
    components: input.components.map((component) => component.name),
  }
}
