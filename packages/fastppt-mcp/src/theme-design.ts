import { sourceKerningSetup } from '@fastppt/slidewave/text-kerning'
/**
 * Materialize harness-designed Slidev systems into a theme package. The legacy
 * layout helper accepts a fixed set of templates; the design-system compiler
 * below accepts a versioned visual contract and generates the safe Vue/CSS
 * sources, manifest metadata, and authoring Skill from that contract.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { NativeMasterLayoutSchema } from '@fastppt/protocol'

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
  'cover',
  'section',
  'two-col',
  'data',
  'statement',
  'image-right',
  'quote',
  'grid',
  'metrics',
  'agenda',
  'ending',
])

const COMPONENT_KINDS = new Set(['stat', 'callout', 'badge', 'pill', 'chip'])

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
  const kebab = name
    .replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
    .replace(/^-/, '')
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

async function manifestPath(
  themeDir: string,
): Promise<{ path: string; manifest: ThemeManifest }> {
  const path = join(themeDir, 'agent', 'theme-manifest.json')
  const manifest = JSON.parse(await readFile(path, 'utf8')) as ThemeManifest
  return { path, manifest }
}

export async function designThemeLayouts(
  input: DesignThemeLayoutsInput,
): Promise<DesignThemeLayoutsResult> {
  const { themeDir } = input

  for (const layout of input.layouts) {
    if (!SAFE_ID.test(layout.id))
      throw new Error(`Invalid layout id: ${layout.id}`)
    if (!LAYOUT_KINDS.has(layout.kind))
      throw new Error(`Unknown layout kind: ${layout.kind}`)
  }
  const seenLayouts = new Set<string>()
  for (const layout of input.layouts) {
    if (seenLayouts.has(layout.id))
      throw new Error(`Duplicate layout id: ${layout.id}`)
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
    await writeFile(join(layoutsDir, `${layout.id}.vue`), layoutSfc(layout))
  }
  for (const component of input.components) {
    await writeFile(
      join(componentsDir, `${component.name}.vue`),
      componentSfc(component),
    )
  }

  const existing = (manifest.layouts ?? []) as Array<{
    id: string
    label: string
  }>
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
      const design = input.layouts.find(
        (candidate) => candidate.id === layout.id,
      )
      return `- \`${layout.id}\`${design?.hint ? `: ${design.hint}` : ''}`
    })
    .join('\n')
  skill = replaceSection(skill, 'Registered layouts', layoutGuide)
  if (input.components.length > 0) {
    const componentGuide = input.components
      .map(
        (component) =>
          `- \`<${component.name}>\`${component.hint ? `: ${component.hint}` : ''}`,
      )
      .join('\n')
    skill = replaceSection(skill, 'Registered components', componentGuide)
  }
  await writeFile(skillPath, skill)

  return {
    layouts: added,
    components: input.components.map((component) => component.name),
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const CSS_SIZE = /^(?:0|[0-9]+(?:\.[0-9]+)?(?:px|rem|em|%|vh|vw))$/
const SAFE_FONT = /^[\p{L}\p{N} ,.'"-]{1,120}$/u
const SAFE_REGION = /^[a-z][a-z0-9-]*$/

/**
 * A design contract is the agent-facing source of truth.  The agent can make
 * real visual choices, but it supplies data rather than executable CSS/Vue.
 * This keeps a generated theme portable and makes every choice inspectable.
 */
export const ThemeDesignSpecSchema = z
  .object({
    version: z.literal(1),
    motionPreset: z
      .enum(['static', 'business', 'teaching', 'reveal'])
      .optional(),
    foundation: z.object({
      colors: z.object({
        canvas: z.string().regex(HEX_COLOR),
        ink: z.string().regex(HEX_COLOR),
        muted: z.string().regex(HEX_COLOR),
        primary: z.string().regex(HEX_COLOR),
        accent: z.string().regex(HEX_COLOR),
        surface: z.string().regex(HEX_COLOR),
        border: z.string().regex(HEX_COLOR),
      }),
      typography: z.object({
        heading: z.string().regex(SAFE_FONT),
        body: z.string().regex(SAFE_FONT),
        headingSize: z.string().regex(CSS_SIZE).default('2.6rem'),
        bodySize: z.string().regex(CSS_SIZE).default('1.1rem'),
      }),
      geometry: z.object({
        margin: z.string().regex(CSS_SIZE).default('2.8rem'),
        gap: z.string().regex(CSS_SIZE).default('1.4rem'),
        radius: z.string().regex(CSS_SIZE).default('0.8rem'),
        ruleWidth: z.string().regex(CSS_SIZE).default('3px'),
      }),
    }),
    components: z
      .array(
        z.object({
          name: z.string().regex(SAFE_NAME),
          purpose: z.string().min(1).max(240),
          archetype: z.enum([
            'metric',
            'callout',
            'badge',
            'panel',
            'timeline',
          ]),
          variants: z.array(z.string().regex(SAFE_ID)).max(6).default([]),
        }),
      )
      .max(8)
      .default([]),
    layouts: z
      .array(
        z
          .object({
            id: z.string().regex(SAFE_ID),
            label: z.string().min(1).max(80),
            purpose: z.string().min(1).max(240),
            composition: z.enum([
              'cover',
              'centered',
              'split',
              'media-right',
              'grid',
              'metrics',
              'statement',
            ]),
            regions: z.array(z.string().regex(SAFE_REGION)).min(1).max(6),
            nativePlaceholders:
              NativeMasterLayoutSchema.shape.placeholders.optional(),
            nativeFixedObjects: NativeMasterLayoutSchema.shape.fixedObjects,
            nativeMasterObjects: NativeMasterLayoutSchema.shape.masterObjects,
            nativeCanvas: NativeMasterLayoutSchema.shape.canvas,
            nativeMasterId: NativeMasterLayoutSchema.shape.masterId,
            nativeMasterTheme: NativeMasterLayoutSchema.shape.masterTheme,
          })
          .refine(
            (layout) =>
              !layout.nativeMasterObjects?.objects.length ||
              layout.nativeMasterObjects.canvas !== undefined,
            {
              message: 'Master browser objects require a reference canvas.',
              path: ['nativeMasterObjects', 'canvas'],
            },
          )
          .refine(
            (layout) =>
              !layout.nativeFixedObjects?.length ||
              layout.nativeCanvas !== undefined,
            {
              message: 'Fixed browser objects require nativeCanvas.',
              path: ['nativeCanvas'],
            },
          ),
      )
      .min(1)
      .max(8),
    rules: z.object({
      density: z.enum(['airy', 'balanced', 'dense']),
      imageTreatment: z.string().min(1).max(160),
      maxColorsPerSlide: z.number().int().min(1).max(6).default(3),
      requiredFirstLayout: z.string().regex(SAFE_ID).optional(),
      requiredLastLayout: z.string().regex(SAFE_ID).optional(),
      requiredLayouts: z.array(z.string().regex(SAFE_ID)).max(8).default([]),
      forbiddenLayouts: z.array(z.string().regex(SAFE_ID)).max(8).default([]),
    }),
  })
  .superRefine((spec, context) => {
    const layoutIds = new Set<string>()
    for (const layout of spec.layouts) {
      if (layoutIds.has(layout.id))
        context.addIssue({
          code: 'custom',
          path: ['layouts'],
          message: `Duplicate layout id: ${layout.id}`,
        })
      layoutIds.add(layout.id)
    }
    const names = new Set<string>()
    for (const component of spec.components) {
      if (names.has(component.name))
        context.addIssue({
          code: 'custom',
          path: ['components'],
          message: `Duplicate component name: ${component.name}`,
        })
      names.add(component.name)
    }
  })

export type ThemeDesignSpec = z.infer<typeof ThemeDesignSpecSchema>

export interface DesignThemeSystemInput {
  themeDir: string
  design: z.input<typeof ThemeDesignSpecSchema>
}

export interface DesignThemeSystemResult {
  specFile: string
  tokensFile: string
  layouts: Array<{ id: string; label: string }>
  components: string[]
}

/** The stable workspace location for the five-slide visual-review fixture. */
export function themeDesignSamplePath(themeId: string): string {
  return `theme-samples/${themeId}.md`
}

/**
 * Produce a small, content-realistic deck that exercises the design system's
 * cover, narrative, data, media, and closing treatments.
 */
export function themeDesignSampleDeck(
  themeId: string,
  spec: ThemeDesignSpec,
): string {
  const choose = (
    composition: ThemeDesignSpec['layouts'][number]['composition'],
  ) => spec.layouts.find((layout) => layout.composition === composition)?.id
  const fallback = spec.layouts[0]?.id ?? 'default'
  const cover = choose('cover') ?? fallback
  const narrative = choose('split') ?? choose('centered') ?? fallback
  const data = choose('metrics') ?? choose('grid') ?? fallback
  const media = choose('media-right') ?? choose('split') ?? fallback
  const closing = choose('statement') ?? choose('centered') ?? fallback
  const metric = spec.components.find(
    (component) => component.archetype === 'metric',
  )?.name
  const callout = spec.components.find(
    (component) => component.archetype === 'callout',
  )?.name
  const panel = spec.components.find(
    (component) => component.archetype === 'panel',
  )?.name
  const metricMarkup = metric
    ? `<${metric}><template #value>42%</template>Decision confidence</${metric}>`
    : `## 42%\n\nDecision confidence`
  const calloutMarkup = callout
    ? `<${callout}><template #title>Key implication</template>Design primitives preserve hierarchy even as content length changes.</${callout}>`
    : `> **Key implication** — Design primitives preserve hierarchy even as content length changes.`
  const panelMarkup = panel
    ? `<${panel}><template #title>Review prompt</template>Check hierarchy, whitespace, contrast, and whether the composition fits its intended message.</${panel}>`
    : `Check hierarchy, whitespace, contrast, and whether the composition fits its intended message.`

  return `---
theme: ${themeId}
aspectRatio: 16/9
title: ${spec.foundation.typography.heading} design-system review
layout: ${cover}
---

<!-- Generated from ${themeId}/agent/theme-design.json. Edit the design contract, not this fixture. -->

# Design system review

${spec.rules.imageTreatment}

---
layout: ${narrative}
---

# Narrative hierarchy

## A layout should make the intended relationship obvious before the audience reads every word.

${calloutMarkup}

---
layout: ${data}
---

# Metrics and evidence

${metricMarkup}

- Baseline: 24%
- Target: 42%
- Window: Q3 review

---
layout: ${media}
---

# Media-led explanation

Use this page to verify that supporting copy remains readable beside a dominant visual.

::media::

<div style="height: 100%; min-height: 12rem; display: grid; place-items: center; background: var(--ext-surface); border: 1px solid var(--fastppt-design-border);">Media treatment preview</div>

---
layout: ${closing}
---

# Does the system feel coherent?

${panelMarkup}
`
}

function designTokensCss(spec: ThemeDesignSpec): string {
  const { colors, typography, geometry } = spec.foundation
  return `/* Generated from agent/theme-design.json. Do not hand-edit. */
:root {
  --fastppt-design-canvas: ${colors.canvas};
  --fastppt-design-ink: ${colors.ink};
  --fastppt-design-muted: ${colors.muted};
  --fastppt-design-primary: ${colors.primary};
  --fastppt-design-accent: ${colors.accent};
  --fastppt-design-surface: ${colors.surface};
  --fastppt-design-border: ${colors.border};
  --fastppt-design-heading-font: ${typography.heading};
  --fastppt-design-body-font: ${typography.body};
  --fastppt-design-heading-size: ${typography.headingSize};
  --fastppt-design-body-size: ${typography.bodySize};
  --fastppt-design-margin: ${geometry.margin};
  --fastppt-design-gap: ${geometry.gap};
  --fastppt-design-radius: ${geometry.radius};
  --fastppt-design-rule-width: ${geometry.ruleWidth};
  --ext-bg: var(--fastppt-design-canvas);
  --ext-text: var(--fastppt-design-ink);
  --ext-muted: var(--fastppt-design-muted);
  --ext-primary: var(--fastppt-design-primary);
  --ext-accent: var(--fastppt-design-accent);
  --ext-surface: var(--fastppt-design-surface);
}

.slidev-layout {
  box-sizing: border-box;
  min-height: 100%;
  padding: var(--fastppt-design-margin);
  background: var(--fastppt-design-canvas);
  color: var(--fastppt-design-ink);
  font-family: var(--fastppt-design-body-font), sans-serif;
  font-size: var(--fastppt-design-body-size);
}

.slidev-layout h1, .slidev-layout h2, .slidev-layout h3 {
  font-family: var(--fastppt-design-heading-font), sans-serif;
  color: var(--fastppt-design-ink);
}
`
}

export function layoutSystemSfc(
  layout: ThemeDesignSpec['layouts'][number],
): string {
  const cls = `fastppt-layout-${layout.id}`
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character]!,
    )
  const groupTheme = layout.nativeMasterTheme
  const family = groupTheme?.fontFamily
    ? JSON.stringify(groupTheme.fontFamily)
        .replace(/</g, '\\3c ')
        .replace(/>/g, '\\3e ')
    : undefined
  const groupProperties = [
    ...(family
      ? [
          `--fastppt-design-heading-font:${family}`,
          `--fastppt-design-body-font:${family}`,
          `font-family:${family}`,
        ]
      : []),
    ...(groupTheme?.colors ?? []).map(
      (color, index) => `--fastppt-master-accent-${index + 1}:#${color}`,
    ),
    ...(groupTheme?.colors?.[0]
      ? [
          `--fastppt-design-primary:#${groupTheme.colors[0]}`,
          `--ext-primary:#${groupTheme.colors[0]}`,
        ]
      : []),
    ...(groupTheme?.colors?.[1]
      ? [
          `--fastppt-design-accent:#${groupTheme.colors[1]}`,
          `--ext-accent:#${groupTheme.colors[1]}`,
        ]
      : []),
  ].join(';')
  const groupStyles = groupProperties
    ? `.${cls} { ${groupProperties} }${family ? `\n.${cls} :deep(h1), .${cls} :deep(h2), .${cls} :deep(h3) { font-family:${family}; }` : ''}`
    : ''
  const entries = [
    ...(layout.nativeMasterObjects?.objects ?? []).map((object) => ({
      object,
      canvas: layout.nativeMasterObjects?.canvas,
      scope: 'master',
    })),
    ...(layout.nativeFixedObjects ?? []).map((object) => ({
      object,
      canvas: layout.nativeCanvas,
      scope: 'layout',
    })),
  ]
  const fixedObjects = entries
    .map(({ object, canvas, scope }) => {
      if (!canvas) return ''
      const style = [
        'position:absolute',
        `left:${(object.x / canvas.width) * 100}%`,
        `top:${(object.y / canvas.height) * 100}%`,
        `width:${(object.width / canvas.width) * 100}%`,
        `height:${(object.height / canvas.height) * 100}%`,
        'box-sizing:border-box',
        'padding:0',
        'margin:0',
        'border:0',
        'white-space:pre-wrap',
        'overflow:hidden',
        'line-height:1.2',
        'font-kerning:normal',
        'font-weight:400',
        'font-style:normal',
        `letter-spacing:${((object.letterSpacing ?? 0) * 12700 / canvas.width) * 100}cqw`,
        'text-align:left',
        `direction:${object.direction ?? 'ltr'}`,
        `text-decoration-line:${object.baselinePercent === undefined && object.kerningThreshold === undefined && object.capitalization === undefined ? ([object.underline ? 'underline' : '', object.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none') : 'none'}`,
        'text-decoration-style:solid;text-decoration-color:currentColor;text-decoration-skip-ink:none',
        object.fill ? `background:#${object.fill}` : 'background:transparent',
        object.color ? `color:#${object.color}` : '',
        object.fontFamily
          ? `font-family:${JSON.stringify(object.fontFamily)}`
          : '',
        object.fontSize === undefined
          ? ''
          : `font-size:${((object.fontSize * 12700) / canvas.width) * 100}cqw`,
      ]
        .filter(Boolean)
        .join(';')
      return `<div v-pre${object.direction === undefined ? '' : ` dir="${object.direction}"`}${object.language === undefined ? '' : ` lang="${escape(object.language)}"`}${object.alternativeLanguage === undefined ? '' : ` data-fastppt-alt-lang="${escape(object.alternativeLanguage)}"`}${object.anchor ? ` data-fastppt-group="${escape(object.anchor)}"` : ''} data-fastppt-layout="${escape(layout.id)}" data-fastppt-layout-object="${escape(object.name)}" data-fastppt-object-scope="${scope}" style="${escape(style)}">${object.baselinePercent === undefined && object.kerningThreshold === undefined && object.capitalization === undefined ? escape(object.text ?? '') : `<span${object.capitalization === undefined ? '' : ` data-fastppt-text-capitalization-run="${escape(JSON.stringify(object.capitalization))}"`} data-fastppt-text-baseline-run="${object.baselinePercent ?? 0}"${object.kerningThreshold === undefined ? '' : ` data-fastppt-text-kerning="${escape(JSON.stringify({ threshold: object.kerningThreshold, canvasWidth: canvas.width }))}"`} style="${object.capitalization === undefined ? '' : `text-transform:${object.capitalization === 'all' ? 'uppercase' : 'none'};font-variant-caps:${object.capitalization === 'small' ? 'small-caps' : 'normal'};`}position:relative;top:${-(object.baselinePercent ?? 0) / 100}em;vertical-align:baseline;text-decoration-line:${[object.underline ? 'underline' : '', object.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'};text-decoration-style:solid;text-decoration-color:currentColor;text-decoration-skip-ink:none">${escape(object.text ?? '')}</span>`}</div>`
    })
    .join('\n')
  const fixedLayer = fixedObjects
    ? `<section class="${cls}-fixed">${fixedObjects}</section>`
    : ''
  const fixedStyles = fixedObjects
    ? `.${cls} { position: relative; container-type: inline-size; }\n.${cls} > div { position: relative; z-index: 1; }\n.${cls}-fixed { position: absolute; inset: 0; z-index: 0; pointer-events: none; }`
    : ''
  const named = layout.regions.filter((region) => region !== 'content')
  const slots = named
    .map(
      (region) =>
        `    <div class="${cls}-${region}"><slot name="${region}" /></div>`,
    )
    .join('\n')
  const template: Record<
    ThemeDesignSpec['layouts'][number]['composition'],
    string
  > = {
    cover: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-content"><slot /></div>\n${slots}\n  </div>`,
    centered: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-content"><slot /></div>\n${slots}\n  </div>`,
    split: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-content"><slot /></div>\n${slots}\n  </div>`,
    'media-right': `<div class="slidev-layout ${cls}">\n    <div class="${cls}-content"><slot /></div>\n${slots}\n  </div>`,
    grid: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-content"><slot /></div>\n${slots}\n  </div>`,
    metrics: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-content"><slot /></div>\n${slots}\n  </div>`,
    statement: `<div class="slidev-layout ${cls}">\n    <div class="${cls}-content"><slot /></div>\n${slots}\n  </div>`,
  }
  const styles: Record<
    ThemeDesignSpec['layouts'][number]['composition'],
    string
  > = {
    cover: `.${cls} { display: flex; align-items: end; }\n.${cls}-content { max-width: 76%; }\n.${cls} :deep(h1) { font-size: calc(var(--fastppt-design-heading-size) * 1.5); margin: 0; }`,
    centered: `.${cls} { display: grid; place-items: center; text-align: center; }\n.${cls}-content { max-width: 78%; }`,
    split: `.${cls} { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: var(--fastppt-design-gap); align-items: center; }`,
    'media-right': `.${cls} { display: grid; grid-template-columns: minmax(0, 1fr) minmax(12rem, 0.9fr); gap: calc(var(--fastppt-design-gap) * 1.4); align-items: center; }\n.${cls}-media { min-height: 65%; background: var(--fastppt-design-surface); border-radius: var(--fastppt-design-radius); overflow: hidden; }`,
    grid: `.${cls} { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--fastppt-design-gap); align-content: center; }\n.${cls}-content { grid-column: 1 / -1; }\n.${cls} > div:not(.${cls}-content) { padding-top: 0.7rem; border-top: var(--fastppt-design-rule-width) solid var(--fastppt-design-accent); }`,
    metrics: `.${cls} { display: flex; flex-direction: column; justify-content: center; }\n.${cls} :deep(h1) { color: var(--fastppt-design-primary); }`,
    statement: `.${cls} { display: grid; place-items: center; text-align: center; }\n.${cls}-content { max-width: 80%; }\n.${cls} :deep(h1) { font-size: calc(var(--fastppt-design-heading-size) * 1.25); line-height: 1.2; }`,
  }
  const kerning = entries.some(({ object }) => object.kerningThreshold !== undefined)
  return `${kerning ? `<script setup>\n${sourceKerningSetup}\n</script>\n` : ''}<template>\n  ${template[layout.composition].replace(`class="slidev-layout ${cls}">`, `class="slidev-layout ${cls}"${kerning ? ' ref="kerningRoot" data-fastppt-kerning-root' : ''}>${fixedLayer}`)}\n</template>\n\n<style scoped>\n${styles[layout.composition]}\n${fixedStyles}\n${groupStyles}\n</style>\n`
}

function componentSystemSfc(
  component: ThemeDesignSpec['components'][number],
): string {
  const kebab = component.name
    .replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
    .replace(/^-/, '')
  const cls = `fastppt-component-${kebab}`
  const variants = component.variants
    .map((variant) => `'${variant}'`)
    .join(' | ')
  const template: Record<
    ThemeDesignSpec['components'][number]['archetype'],
    string
  > = {
    metric: `<div :class="[root, variant && \`${cls}--\${variant}\`]"><strong><slot name="value" /></strong><small><slot /></small></div>`,
    callout: `<aside :class="[root, variant && \`${cls}--\${variant}\`]"><b><slot name="title" /></b><div><slot /></div></aside>`,
    badge: `<span :class="[root, variant && \`${cls}--\${variant}\`]"><slot /></span>`,
    panel: `<section :class="[root, variant && \`${cls}--\${variant}\`]"><slot name="title" /><div><slot /></div></section>`,
    timeline: `<ol :class="[root, variant && \`${cls}--\${variant}\`]"><slot /></ol>`,
  }
  const styles: Record<
    ThemeDesignSpec['components'][number]['archetype'],
    string
  > = {
    metric: `.${cls} { display: inline-grid; gap: 0.2rem; }\n.${cls} strong { color: var(--fastppt-design-primary); font-size: calc(var(--fastppt-design-heading-size) * 0.9); line-height: 1; }\n.${cls} small { color: var(--fastppt-design-muted); }`,
    callout: `.${cls} { display: grid; gap: 0.35rem; padding: 0.9rem 1rem; border-left: var(--fastppt-design-rule-width) solid var(--fastppt-design-accent); background: var(--fastppt-design-surface); }\n.${cls} b { color: var(--fastppt-design-primary); }`,
    badge: `.${cls} { display: inline-flex; padding: 0.15rem 0.7rem; border-radius: 999px; background: var(--fastppt-design-primary); color: var(--fastppt-design-canvas); font-size: 0.78em; }`,
    panel: `.${cls} { display: grid; gap: 0.65rem; padding: 1rem; border: 1px solid var(--fastppt-design-border); border-radius: var(--fastppt-design-radius); background: var(--fastppt-design-surface); }`,
    timeline: `.${cls} { display: grid; gap: 0.65rem; list-style: none; padding: 0; }\n.${cls} :deep(li) { border-left: var(--fastppt-design-rule-width) solid var(--fastppt-design-accent); padding-left: 0.8rem; }`,
  }
  const variantCss = component.variants
    .map(
      (variant) =>
        `.${cls}--${variant} { border-color: var(--fastppt-design-primary); }`,
    )
    .join('\n')
  return `<script setup lang="ts">\ndefineProps<{ variant?: ${variants || 'string'} }>()\nconst root = '${cls}'\n</script>\n\n<template>\n  ${template[component.archetype]}\n</template>\n\n<style scoped>\n${styles[component.archetype]}\n${variantCss}\n</style>\n`
}

function designGuide(spec: ThemeDesignSpec): string {
  const colors = Object.entries(spec.foundation.colors)
    .map(([name, value]) => `- ${name}: \`${value}\``)
    .join('\n')
  return [
    `Use the generated design system; do not introduce arbitrary colours or one-off spacing values.`,
    '',
    '### Foundation',
    '',
    colors,
    `- heading font: \`${spec.foundation.typography.heading}\``,
    `- body font: \`${spec.foundation.typography.body}\``,
    `- density: ${spec.rules.density}; maximum ${spec.rules.maxColorsPerSlide} purposeful colours per slide.`,
    `- image treatment: ${spec.rules.imageTreatment}`,
    '',
    '### Visual review loop',
    '',
    '1. Open the generated `theme-samples/<theme-id>.md` deck in FastPPT Preview.',
    '2. Call `review_theme_design_samples` and inspect all reported quality or overflow issues.',
    '3. If a structural issue appears, call `design_theme_system` again with a revised complete design contract, then regenerate the samples.',
  ].join('\n')
}

async function ensureStyleImport(stylePath: string): Promise<void> {
  const source = await readFile(stylePath, 'utf8')
  const statement = "import './agent-design-tokens.css'"
  if (!source.includes(statement))
    await writeFile(stylePath, `${statement}\n${source}`)
}

export function resolveMasterGroupThemes(
  layouts: readonly ThemeDesignSpec['layouts'][number][],
): ThemeDesignSpec['layouts'] {
  const groupObjects = new Map<
    string,
    NonNullable<ThemeDesignSpec['layouts'][number]['nativeMasterObjects']>
  >()
  for (const layout of layouts) {
    if (!layout.nativeMasterObjects) continue
    const id = layout.nativeMasterId ?? 'default'
    if (
      groupObjects.has(id) &&
      JSON.stringify(groupObjects.get(id)) !==
        JSON.stringify(layout.nativeMasterObjects)
    )
      throw new Error(`Conflicting fixed objects for master ${id}`)
    groupObjects.set(id, layout.nativeMasterObjects)
  }
  const groupThemes = new Map<
    string,
    NonNullable<ThemeDesignSpec['layouts'][number]['nativeMasterTheme']>
  >()
  for (const layout of layouts) {
    if (!layout.nativeMasterTheme) continue
    const id = layout.nativeMasterId ?? 'default'
    const theme = {
      ...(layout.nativeMasterTheme.fontFamily
        ? { fontFamily: layout.nativeMasterTheme.fontFamily }
        : {}),
      ...(layout.nativeMasterTheme.colors
        ? {
            colors: layout.nativeMasterTheme.colors.map((color) =>
              color.toUpperCase(),
            ),
          }
        : {}),
    }
    if (
      groupThemes.has(id) &&
      JSON.stringify(groupThemes.get(id)) !== JSON.stringify(theme)
    )
      throw new Error(`Conflicting theme definitions for master ${id}`)
    groupThemes.set(id, theme)
  }
  return layouts.map((layout) => {
    const theme = groupThemes.get(layout.nativeMasterId ?? 'default')
    const objects = groupObjects.get(layout.nativeMasterId ?? 'default')
    return {
      ...layout,
      ...(objects ? { nativeMasterObjects: structuredClone(objects) } : {}),
      ...(theme
        ? {
            nativeMasterTheme: {
              ...theme,
              ...(theme.colors ? { colors: [...theme.colors] } : {}),
            },
          }
        : {}),
    }
  })
}

/** Compile an inspected, schema-validated design contract into theme sources. */
export async function designThemeSystem(
  input: DesignThemeSystemInput,
): Promise<DesignThemeSystemResult> {
  const design = ThemeDesignSpecSchema.parse(input.design)
  design.layouts = resolveMasterGroupThemes(design.layouts)
  const fixedFont = design.foundation.typography.body
    .split(',')[0]!
    .trim()
    .replace(/^['"]|['"]$/g, '')
  for (const layout of design.layouts) {
    const withDefaults = (
      objects: NonNullable<typeof layout.nativeFixedObjects>,
    ) =>
      objects.map((object) =>
        object.text === undefined
          ? object
          : {
              ...object,
              fontFamily:
                object.fontFamily ??
                layout.nativeMasterTheme?.fontFamily ??
                fixedFont,
              fontSize: object.fontSize ?? 12,
              color: object.color ?? design.foundation.colors.ink.slice(1),
            },
      )
    if (layout.nativeFixedObjects)
      layout.nativeFixedObjects = withDefaults(layout.nativeFixedObjects)
    if (layout.nativeMasterObjects)
      layout.nativeMasterObjects.objects = withDefaults(
        layout.nativeMasterObjects.objects,
      )
  }
  const { path, manifest } = await manifestPath(input.themeDir)
  const agentDir = join(input.themeDir, 'agent')
  const stylesDir = join(input.themeDir, 'styles')
  const layoutsDir = join(input.themeDir, 'layouts')
  const componentsDir = join(input.themeDir, 'components')
  await Promise.all([
    mkdir(agentDir, { recursive: true }),
    mkdir(stylesDir, { recursive: true }),
    mkdir(layoutsDir, { recursive: true }),
    mkdir(componentsDir, { recursive: true }),
  ])

  const nativeLayouts = design.layouts
    .filter(
      (layout) =>
        layout.nativeMasterObjects !== undefined ||
        layout.nativePlaceholders !== undefined ||
        layout.nativeFixedObjects !== undefined ||
        layout.nativeMasterTheme !== undefined ||
        layout.nativeMasterId !== undefined,
    )
    .map((layout) =>
      NativeMasterLayoutSchema.parse({
        name: layout.id,
        ...(layout.nativeMasterObjects
          ? { masterObjects: layout.nativeMasterObjects }
          : {}),
        ...(layout.nativeMasterTheme
          ? { masterTheme: layout.nativeMasterTheme }
          : {}),
        ...(layout.nativeMasterId ? { masterId: layout.nativeMasterId } : {}),
        placeholders: layout.nativePlaceholders ?? [],
        ...(layout.nativeCanvas ? { canvas: layout.nativeCanvas } : {}),
        ...(layout.nativeFixedObjects
          ? { fixedObjects: layout.nativeFixedObjects }
          : {}),
      }),
    )
  await Promise.all([
    writeFile(
      join(agentDir, 'native-layouts.json'),
      `${JSON.stringify(nativeLayouts, null, 2)}\n`,
    ),
    writeFile(
      join(agentDir, 'theme-design.json'),
      `${JSON.stringify(design, null, 2)}\n`,
    ),
    writeFile(
      join(stylesDir, 'agent-design-tokens.css'),
      designTokensCss(design),
    ),
    ...design.layouts.map((layout) =>
      writeFile(join(layoutsDir, `${layout.id}.vue`), layoutSystemSfc(layout)),
    ),
    ...design.components.map((component) =>
      writeFile(
        join(componentsDir, `${component.name}.vue`),
        componentSystemSfc(component),
      ),
    ),
  ])
  const machineRules = [
    {
      id: 'design.allowed-layouts',
      kind: 'allowed-layouts' as const,
      layouts: design.layouts.map((layout) => layout.id),
      severity: 'error' as const,
      message: 'Use a registered layout from this theme.',
    },
    ...(design.rules.requiredFirstLayout
      ? [
          {
            id: 'design.first-layout',
            kind: 'first-layout' as const,
            layout: design.rules.requiredFirstLayout,
            severity: 'error' as const,
          },
        ]
      : []),
    ...(design.rules.requiredLastLayout
      ? [
          {
            id: 'design.last-layout',
            kind: 'last-layout' as const,
            layout: design.rules.requiredLastLayout,
            severity: 'warning' as const,
          },
        ]
      : []),
    ...design.rules.requiredLayouts.map((layout) => ({
      id: `design.required-${layout}`,
      kind: 'required-layout' as const,
      layout,
      severity: 'warning' as const,
    })),
    ...design.rules.forbiddenLayouts.map((layout) => ({
      id: `design.forbidden-${layout}`,
      kind: 'forbidden-layout' as const,
      layout,
      severity: 'error' as const,
    })),
  ]
  await writeFile(
    join(agentDir, 'theme-rules.json'),
    `${JSON.stringify({ version: 1, rules: machineRules }, null, 2)}\n`,
  )
  manifest.machineRulesFile = 'agent/theme-rules.json'
  await ensureStyleImport(join(stylesDir, 'index.ts'))

  const layoutsById = new Map<
    string,
    { id: string; label: string; description?: string }
  >(
    ((manifest.layouts ?? []) as Array<{ id: string; label: string }>).map(
      (layout) => [layout.id, layout],
    ),
  )
  for (const layout of design.layouts)
    layoutsById.set(layout.id, {
      id: layout.id,
      label: layout.label,
      description: layout.purpose,
    })
  manifest.layouts = [...layoutsById.values()]
  if (design.motionPreset !== undefined)
    manifest.motionPreset = design.motionPreset
  manifest.designSystem = {
    specFile: 'agent/theme-design.json',
    tokensFile: 'styles/agent-design-tokens.css',
    version: 1,
  }
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)

  const skillPath = join(agentDir, 'SKILL.md')
  let skill = await readFile(skillPath, 'utf8')
  skill = replaceSection(skill, 'Design system', designGuide(design))
  skill = replaceSection(
    skill,
    'Registered layouts',
    design.layouts
      .map((layout) => `- \`${layout.id}\`: ${layout.purpose}`)
      .join('\n'),
  )
  skill = replaceSection(
    skill,
    'Registered components',
    design.components
      .map((component) => `- \`<${component.name}>\`: ${component.purpose}`)
      .join('\n') || '- No signature components registered.',
  )
  await writeFile(skillPath, skill)

  return {
    specFile: 'agent/theme-design.json',
    tokensFile: 'styles/agent-design-tokens.css',
    layouts: design.layouts.map(({ id, label }) => ({ id, label })),
    components: design.components.map(({ name }) => name),
  }
}
