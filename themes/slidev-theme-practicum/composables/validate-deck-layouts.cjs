const { readFileSync } = require('node:fs')
const { isAbsolute, join, resolve } = require('node:path')
const { parseSync } = require('@slidev/parser')
const { createCommentVNode, createTextVNode, createVNode } = require('vue')
const { registerTypeScript } = require('./typescript-require.cjs')
const { extractDeckLiveStructure } = require('./deck-slot-markup.cjs')
const { markdownToVnodes } = require('./markdown-to-vnodes.cjs')

/** @typedef {import('@slidev/types').SourceSlideInfo} SourceSlideInfo */
/** @typedef {import('./layout-recipes').ThemeLayout} ThemeLayout */
/** @typedef {import('./layout-recipes').ThemeLayoutRole} ThemeLayoutRole */
/** @typedef {{ role: string, hasCoordinates: boolean, label: string }} ExplicitSlotIntent */
/**
 * @typedef {(
 *   | { kind: 'comment' }
 *   | { kind: 'text', content: string }
 *   | { kind: 'element', tag: string, props: Record<string, unknown>, children: DeckLiveNode[] }
 * )} DeckLiveNode
 */
/** @typedef {{ index: number, page: number, layout: string, variant: string, title: string, label: string }} SlideReference */
/** @typedef {SlideReference & { message: string, hint?: string }} DeckValidationIssue */

const THEME_ROOT = join(__dirname, '..')
/** @type {Set<ThemeLayout>} */
const THEME_LAYOUTS = new Set(['cover', 'message', 'explainer', 'collection'])

/** @param {...string} segments */
function themePath(...segments) {
  return join(THEME_ROOT, ...segments)
}

/**
 * @param {string} value
 * @returns {value is ThemeLayout}
 */
function isThemeLayout(value) {
  return THEME_LAYOUTS.has(/** @type {ThemeLayout} */ (value))
}

registerTypeScript()

const { compileLayoutAuthoring } = require(themePath('composables/layout-authoring.ts'))
const { hasLayoutShorthand } = require(themePath('composables/layout-shorthands.ts'))
const {
  resolveLayoutSlotSpec,
  resolveLayoutVariant,
} = require(themePath('composables/layout-recipes.ts'))
const { createSlotRules } = require(themePath('composables/slot-rules.ts'))

/** @returns {Record<string, import('vue').Component>} */
function stubComponents() {
  /** @param {string} name */
  const named = name => ({ name })
  return {
    Image: named('Image'),
    Person: named('Person'),
    Slot: named('Slot'),
    Text: named('Text'),
    Timeline: named('Timeline'),
  }
}

function stripAuthorNotes(content = '') {
  return String(content).replace(/<!--[\s\S]*?-->/g, '').trim()
}

/**
 * @param {DeckLiveNode} node
 * @param {ReturnType<typeof stubComponents>} components
 * @returns {import('vue').VNode}
 */
function liveNodeToVNode(node, components) {
  if (node.kind === 'comment')
    return createCommentVNode()

  if (node.kind === 'text')
    return createTextVNode(node.content)

  const component = components[node.tag] ?? node.tag
  return createVNode(
    component,
    node.props,
    node.children.map(child => liveNodeToVNode(child, components)),
  )
}

/**
 * @param {ExplicitSlotIntent[]} intents
 * @param {{ Slot: import('vue').Component, layout: ThemeLayout, variant: string }} input
 */
function validateExplicitSlotIntents(intents, input) {
  const slotRules = createSlotRules({ Slot: input.Slot })
  const roleIndices = new Map()

  for (const intent of intents) {
    const node = createVNode(input.Slot, {
      role: intent.role,
      label: intent.label,
      area: intent.hasCoordinates ? 'explicit' : '',
    })
    slotRules.assertLayoutChild(node, {
      label: `${input.layout}:${input.variant}`,
    })

    const index = roleIndices.get(intent.role) ?? 0
    resolveLayoutSlotSpec(
      input.layout,
      input.variant,
      /** @type {ThemeLayoutRole} */ (intent.role),
      index,
    )
    roleIndices.set(intent.role, index + 1)
  }
}

/**
 * @param {SourceSlideInfo} slide
 * @param {number} index
 * @returns {SlideReference}
 */
function slideRef(slide, index) {
  const layout = String(slide.frontmatter?.layout ?? '').trim()
  const variant = String(slide.frontmatter?.variant ?? '').trim()
  const title = String(slide.title || slide.content?.match(/^#\s+(.+)/m)?.[1] || '').trim()
  return {
    index,
    page: index + 1,
    layout,
    variant,
    title: title.slice(0, 80),
    label: `${layout}:${variant || '-'}`,
  }
}

/**
 * @param {string} deckPath
 * @returns {Promise<DeckValidationIssue[]>}
 */
async function validateDeckLayouts(deckPath) {
  const absolutePath = isAbsolute(deckPath) ? deckPath : resolve(deckPath)
  const source = readFileSync(absolutePath, 'utf8')
  const deck = parseSync(source, absolutePath)
  const components = stubComponents()
  /** @type {DeckValidationIssue[]} */
  const issues = []

  for (const [index, slide] of deck.slides.entries()) {
    const layout = String(slide.frontmatter?.layout ?? '').trim()
    if (!isThemeLayout(layout))
      continue

    const rawVariant = String(slide.frontmatter?.variant ?? '').trim()
    const arrangement = String(slide.frontmatter?.arrangement ?? '').trim()
    const ref = slideRef(slide, index)
    /** @type {string} */
    let variant

    try {
      variant = resolveLayoutVariant(layout, rawVariant, arrangement)
    }
    catch (error) {
      const hint = error && typeof error === 'object' && 'hint' in error ? error.hint : undefined
      issues.push({
        ...ref,
        message: error instanceof Error ? error.message : String(error),
        hint: typeof hint === 'string' ? hint : undefined,
      })
      continue
    }

    const shorthandKey = `${layout}:${variant}`

    let liveStructure
    try {
      liveStructure = extractDeckLiveStructure(slide.content ?? '')
    }
    catch (error) {
      const hint = error && typeof error === 'object' && 'hint' in error ? error.hint : undefined
      issues.push({
        ...ref,
        message: error instanceof Error ? error.message : String(error),
        hint: typeof hint === 'string' ? hint : undefined,
      })
      continue
    }

    if (liveStructure.intents.length) {
      try {
        compileLayoutAuthoring({
          props: {
            layout,
            variant: rawVariant,
            arrangement,
            mode: slide.frontmatter?.mode,
            tone: slide.frontmatter?.tone ?? '',
          },
          frontmatter: slide.frontmatter ?? {},
          children: liveStructure.children.map(node => liveNodeToVNode(node, components)),
          components,
          defaultTone: 'blue',
        })
        validateExplicitSlotIntents(liveStructure.intents, {
          Slot: components.Slot,
          layout,
          variant,
        })
      }
      catch (error) {
        const hint = error && typeof error === 'object' && 'hint' in error ? error.hint : undefined
        issues.push({
          ...ref,
          message: error instanceof Error ? error.message : String(error),
          hint: typeof hint === 'string' ? hint : undefined,
        })
      }
      continue
    }

    if (!hasLayoutShorthand(shorthandKey) && layout !== 'cover')
      continue

    const content = stripAuthorNotes(slide.content ?? '')

    try {
      compileLayoutAuthoring({
        props: {
          layout,
          variant: rawVariant,
          arrangement,
          mode: slide.frontmatter?.mode,
          tone: slide.frontmatter?.tone ?? '',
        },
        frontmatter: slide.frontmatter ?? {},
        children: markdownToVnodes(content),
        components,
        defaultTone: 'blue',
      })
    }
    catch (error) {
      const hint = error && typeof error === 'object' && 'hint' in error ? error.hint : undefined
      issues.push({
        ...ref,
        message: error instanceof Error ? error.message : String(error),
        hint: typeof hint === 'string' ? hint : undefined,
      })
    }
  }

  return issues
}

/**
 * @param {DeckValidationIssue[]} issues
 * @param {string} [deckPath]
 */
function formatDeckLayoutIssues(issues, deckPath = 'deck') {
  if (!issues.length)
    return ''

  const body = issues.map((issue) => {
    const lines = [
      `Слайд ${issue.page} (${issue.label})${issue.title ? `: «${issue.title}»` : ''}`,
      `  ${issue.message}`,
    ]
    if (issue.hint)
      lines.push(`  Подсказка: ${issue.hint}`)
    lines.push('  См. example.md в slidev-theme-practicum (заметки «Контракт»).')
    return lines.join('\n')
  }).join(`\n\n${'—'.repeat(40)}\n\n`)

  return `${body}\n\nКолода: ${deckPath}\n`
}

module.exports = {
  formatDeckLayoutIssues,
  validateDeckLayouts,
}
