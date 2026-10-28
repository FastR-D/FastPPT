import { persistSlideIds } from './identity.js'
export { persistSlideIds } from './identity.js'
import { parseSlidevDocument, parseSlidevPage } from '@fastppt/markdown/parser'
import {
  digest,
  estimateNotesSeconds,
  normalizeAnimation,
  AnimationDocumentV1Schema,
  type AnimationDocumentV1,
  type SpeakerNotesDocumentV1,
} from '@fastppt/presentation-ir'

function renderedTags(markdown: string): RegExpStringIterator<RegExpExecArray> {
  let fence: string | undefined
  const masked = markdown
    .replace(/<!--([\s\S]*?)-->/g, (text) => text.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => {
      const token = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
      if (fence) {
        if (token && token[0] === fence[0] && token.length >= fence.length)
          fence = undefined
        return ' '.repeat(line.length)
      }
      if (token) {
        fence = token
        return ' '.repeat(line.length)
      }
      return line.replace(/`+[^`]*`+/g, (text) => ' '.repeat(text.length))
    })
    .join('\n')
  return masked.matchAll(/<(?:section|div|article|img|svg|span|h[1-6])\b[^>]*>/gi)
}

export interface CompiledSlide {
  slideId: string
  layout: string
  placeholderBindings: { target: string; index: number; geometry?: 'page' | 'layout'; textStyle?: 'page' | 'layout'; textBody?: 'page' | 'layout' }[]
  markdown: string
  animation: AnimationDocumentV1
  notes: SpeakerNotesDocumentV1
  anchors: string[]
  animationTargets: Array<{ anchor: string; role: string; static: boolean }>
}
export function splitSlides(source: string): string[] {
  return parseSlidevDocument(source).map((slide) => slide.raw)
}
export function compileSlide(source: string, slideId: string): CompiledSlide {
  const parsed = parseSlidevPage(source)
  const frontmatter = parsed.frontmatter
  if (typeof frontmatter.fastpptId === 'string' && frontmatter.fastpptId.trim())
    slideId = frontmatter.fastpptId
  const markdown = parsed.content
  const diagnostics: string[] = []
  const transition =
    typeof frontmatter.transition === 'string' &&
    ['none', 'fade', 'push', 'wipe', 'morph'].includes(frontmatter.transition)
      ? (frontmatter.transition as 'none' | 'fade' | 'push' | 'wipe' | 'morph')
      : 'none'
  if (
    frontmatter.transition !== undefined &&
    transition === 'none' &&
    frontmatter.transition !== 'none'
  )
    diagnostics.push(
      `Unsupported transition: ${String(frontmatter.transition)}`,
    )
  const nodes = [...renderedTags(markdown)].map((m, i) => {
    const id =
      m[0].match(/\bdata-fastppt-group=["']([^"']+)/i)?.[1] ??
      m[0].match(/\sid=["']([^"']+)/i)?.[1]
    const tag = /^<([a-z0-9-]+)/i.exec(m[0])?.[1]?.toLowerCase() ?? 'element'
    const tail =
      markdown
        .slice((m.index ?? 0) + m[0].length)
        .match(/^[^<]*/)?.[0]
        ?.trim() ?? ''
    const declaredRole = m[0].match(/\bdata-fastppt-role=["']([^"']+)/i)?.[1]
    return {
      role: declaredRole ?? (/^h[1-6]$/.test(tag) ? 'title' : 'unknown'),
      static: /\bdata-fastppt-static(?:\s|=|>|$)/i.test(m[0]),
      anchor: id ?? `g-${digest({ tag, path: i, text: tail }).slice(0, 10)}`,
      click: /\bv-click(?:\s|=|>|$)/i.test(m[0]),
    }
  })
  const anchors = nodes.map((node) => node.anchor)
  for (const anchor of new Set(anchors)) {
    if (anchors.filter((value) => value === anchor).length > 1)
      diagnostics.push(`Duplicate animation anchor: ${anchor}`)
  }
  const placeholderBindings: { target: string; index: number; geometry?: 'page' | 'layout'; textStyle?: 'page' | 'layout'; textBody?: 'page' | 'layout' }[] = []
  if (frontmatter.fastpptPlaceholders !== undefined) {
    const bindings = frontmatter.fastpptPlaceholders
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings))
      throw new Error('fastpptPlaceholders must map object anchors to slot indices')
    const slots = new Set<number>()
    for (const [target, value] of Object.entries(bindings)) {
      const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
      const index = record ? record.index : value
      const geometry = record?.geometry
      const textStyle = record?.textStyle
      const textBody = record?.textBody
      if (textBody !== undefined && textBody !== 'page' && textBody !== 'layout')
        throw new Error(`Invalid placeholder text body policy for ${target}`)
      if (textStyle !== undefined && textStyle !== 'page' && textStyle !== 'layout')
        throw new Error(`Invalid placeholder text style policy for ${target}`)
      if (geometry !== undefined && geometry !== 'page' && geometry !== 'layout')
        throw new Error(`Invalid placeholder geometry policy for ${target}`)
      if (record && Object.keys(record).some(key => !['index', 'geometry', 'textStyle', 'textBody'].includes(key)))
        throw new Error(`Unknown placeholder binding field for ${target}`)
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0)
        throw new Error(`Invalid placeholder index for ${target}`)
      if (anchors.filter(anchor => anchor === target).length !== 1)
        throw new Error(`Placeholder requires a unique object anchor: ${target}`)
      if (slots.has(index)) throw new Error(`Duplicate placeholder slot: ${index}`)
      slots.add(index)
      placeholderBindings.push({ target, index, ...(geometry ? { geometry } : {}), ...(textStyle ? { textStyle } : {}), ...(textBody ? { textBody } : {}) })
    }
  }
  const groups: Array<{
    id: string
    effects: Array<Record<string, unknown>>
    static: boolean
  }> = anchors.map((id) => ({ id, effects: [], static: false }))
  const motionPayload = markdown.match(/<template\b[^>]*\bdata-fastppt-motion="([^"]*)"/i)?.[1]
  if (motionPayload) {
    const json = motionPayload.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    const imported = AnimationDocumentV1Schema.parse(JSON.parse(json))
    for (const group of imported.groups) {
      if (!anchors.includes(group.id)) throw new Error(`Imported animation target does not exist: ${group.id}`)
      for (const effect of group.effects) if (!anchors.includes(effect.target)) throw new Error(`Imported animation target does not exist: ${effect.target}`)
      const existing = groups.find(row => row.id === group.id)
      if (existing) existing.effects.push(...group.effects)
      else groups.push(group)
    }
    diagnostics.push(...imported.diagnostics)
  }
  const clickCount =
    typeof frontmatter.clicks === 'number'
      ? Math.max(0, Math.floor(frontmatter.clicks))
      : 0
  const clickTargets = nodes
    .filter((node) => node.click)
    .map((node) => node.anchor)
  for (const [index, target] of clickTargets.entries()) {
    if (!anchors.includes(target))
      diagnostics.push(`Animation target does not exist: ${target}`)
    const group = groups.find((g) => g.id === target)
    if (group)
      group.effects.push({
        id: `click-${index + 1}`,
        kind: 'appear',
        target,
        trigger: 'on-click',
        delayMs: 0,
        durationMs: 400,
        params: {},
      })
  }
  if (clickCount > clickTargets.length)
    diagnostics.push(
      `Slide declares ${clickCount} clicks but only ${clickTargets.length} v-click targets were found.`,
    )
  const notesMatch = source.match(/<!--\s*notes:\s*([\s\S]*?)-->/i)
  const spokenText = notesMatch?.[1]?.trim() ?? parsed.note ?? ''
  const notes = {
    version: 1 as const,
    slideId,
    spokenText,
    format: 'plain' as const,
    language: typeof frontmatter.lang === 'string' ? frontmatter.lang : 'en-US',
    estimatedSeconds: estimateNotesSeconds(spokenText),
    cues: [],
    status: 'draft' as const,
  }
  return {
    slideId,
    layout: typeof frontmatter.layout === 'string' && frontmatter.layout.trim() ? frontmatter.layout.trim() : 'default',
    markdown,
    placeholderBindings,
    anchors,
    animationTargets: nodes.map(({ anchor, role, static: isStatic }) => ({ anchor, role, static: isStatic })),
    notes,
    animation: normalizeAnimation({
      version: 1,
      slideId,
      transition: { kind: transition, durationMs: 500 },
      groups,
      diagnostics,
    }),
  }
}
export function compileDeck(source: string): CompiledSlide[] {
  const slides = splitSlides(source).map((s, i) =>
    compileSlide(s, `slide-${i + 1}`),
  )
  if (new Set(slides.map((slide) => slide.slideId)).size !== slides.length)
    throw new Error('Duplicate slide identities')
  return slides
}

/** Materialize generated DOM anchors instead of rebinding them after text edits. */
export function persistDeckIdentities(
  source: string,
  createId: () => string,
): string {
  const initialized = parseSlidevDocument(source).some(
    (page) => page.frontmatter.fastpptId !== undefined,
  )
  const withSlides = persistSlideIds(source, createId)
  const eol = withSlides.includes('\r\n') ? '\r\n' : '\n'
  const lines = withSlides.split(/\r?\n/)
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + eol.length
  }
  const edits: Array<{ position: number; content: string }> = []
  for (const page of parseSlidevDocument(withSlides)) {
    const compiled = compileSlide(page.raw, '')
    const contentOffset = page.raw.indexOf(page.content)
    if (contentOffset < 0) continue
    let index = 0
    for (const match of renderedTags(page.content)) {
      const previousAnchor = compiled.anchors[index++]
      const hasPlaceholderBinding = compiled.placeholderBindings.some(binding => binding.target === previousAnchor)
      const anchor = initialized && !hasPlaceholderBinding ? `g-${createId()}` : previousAnchor
      if (!anchor || /\s(?:id|data-fastppt-group)=["']/.test(match[0])) continue
      // Offsets from Slidev are normalized to LF; restore the input newline width.
      const before = page.raw.slice(0, contentOffset + match.index)
      const position =
        (offsets[page.start] ?? 0) +
        before.length +
        (eol.length - 1) * (before.match(/\n/g)?.length ?? 0) +
        match[0].search(/\s*\/?>$/)
      edits.push({ position, content: ` data-fastppt-group="${anchor}"` })
    }
  }
  let result = withSlides
  for (const edit of edits.sort((a, b) => b.position - a.position))
    result =
      result.slice(0, edit.position) +
      edit.content +
      result.slice(edit.position)
  return result
}
