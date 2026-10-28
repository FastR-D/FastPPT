export { nativeEffectXml, groupNativeAnimationTarget } from './native-animation.js'
import { nativeEffectXml, groupNativeAnimationTarget } from './native-animation.js'
import { validateNativeTableReadback } from './table-readback.js'
import { textCapitalizationCompatibility } from '../primitives/text-capitalization.mjs'
import { textKerningCompatibility } from '../primitives/text-kerning.mjs'
import { textBaselineCompatibility } from '../primitives/text-baseline.mjs'
import { transitionXml, type NativeSlideTransition } from './transitions.js'
export type { NativeSlideTransition } from './transitions.js'
import { writeTemplateIdentities } from './template-identity.js'
import { fixedObjectOverrides, isFixedObjectOverridden } from './fixed-object-overrides.js'
import { materializeMasterObjects } from './master-objects.js'
import { materializeMasterThemes } from './master-themes.js'
import { materializeMasterGroups } from './master-groups.js'
import { bindSlidePlaceholder } from './placeholder-binding.js'
import { resolveNativeTextStyle } from './native-text-style.js'
import { decimalTabCompatibility } from '../primitives/text-tabs.mjs'
import { textBulletCompatibility } from '../primitives/text-bullet.js'
import { textLetterSpacingCompatibility } from '../primitives/text-letter-spacing.mjs'
import { nativeMasterLayoutXml, type NativeMasterLayout } from './master-layout.js'
export type { NativeMasterLayout } from './master-layout.js'
import { scheduleMotion } from '../primitives/motion-schedule.js'
import { animationShapeIds, parseXml, setSlideChild } from './slide-xml.js'
import { writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

import { htmlDeckToPresentation } from '../slidev/render.js'
import type { NativeDiagramDocument } from './presentation.js'
export type { NativeDiagramDocument } from './presentation.js'
import { embedFonts, type FontEmbedOptions } from '../fonts/embedFonts.js'
import type { ResolvedFontFile } from '../fonts/embedFonts.js'
import { validateEditablePptx, type ExportQaReport } from '../export/validate.js'

import type { HtmlObjectRenderReport, HtmlDeckSnapshot } from '../snapshot-types.js'
import type { HtmlConversionWarning } from '../snapshot-types.js'

function escapeXmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
}

async function materializeMasterLayouts(zip: JSZip, requestedLayouts: readonly string[], definitions: readonly NativeMasterLayout[] = []): Promise<Map<string, string>> {
  const presentation = await zip.file('ppt/presentation.xml')!.async('string')
  const size = parseXml(presentation).children.find(node => node.namespace === 'http://schemas.openxmlformats.org/presentationml/2006/main' && node.local === 'sldSz')
  const targetCanvas = size ? { width: Number(size.attributes.cx), height: Number(size.attributes.cy) } : undefined
  const byName = new Map(definitions.map(layout => [layout.name.trim(), nativeMasterLayoutXml({ ...layout, name: layout.name.trim() }, targetCanvas)]))
  if (byName.size !== definitions.length) throw new Error('Duplicate native master layout names.')
  const layouts = [...new Set([...requestedLayouts, ...byName.keys()].map((layout) => layout.trim()).filter(Boolean))]
  const paths = new Map<string, string>()
  if (layouts.length === 0) return paths
  const masterPath = 'ppt/slideMasters/slideMaster1.xml'
  const masterRelsPath = 'ppt/slideMasters/_rels/slideMaster1.xml.rels'
  const seedPath = 'ppt/slideLayouts/slideLayout2.xml'
  const seedRelsPath = 'ppt/slideLayouts/_rels/slideLayout2.xml.rels'
  const master = zip.file(masterPath)
  const masterRels = zip.file(masterRelsPath)
  const seed = zip.file(seedPath)
  if (!master || !masterRels || !seed) throw new Error('Cannot materialize layouts: required master or layout parts are missing.')

  let masterXml = await master.async('string')
  let relsXml = await masterRels.async('string')
  const seedXml = await seed.async('string')
  const seedRels = await zip.file(seedRelsPath)?.async('string')
  const layoutNumbers = Object.keys(zip.files)
    .map((path) => /^ppt\/slideLayouts\/slideLayout(\d+)\.xml$/.exec(path)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
  let nextLayoutNumber = Math.max(0, ...layoutNumbers) + 1
  const relIds = [...relsXml.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1]))
  let nextRelId = Math.max(0, ...relIds) + 1
  const layoutIds = [...masterXml.matchAll(/<p:sldLayoutId\b[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1]))
  let nextLayoutId = Math.max(2_147_483_648, ...layoutIds) + 1
  const namedLayout = (xml: string, name: string): string => xml.replace(/<p:cSld\b([^>]*?)\bname="[^"]*"([^>]*)>/, `<p:cSld$1name="${escapeXmlAttribute(name)}"$2>`)

  paths.set(layouts[0]!, seedPath)
  zip.file(seedPath, byName.get(layouts[0]!) ?? namedLayout(seedXml, layouts[0]!))
  for (const name of layouts.slice(1)) {
    const number = nextLayoutNumber++
    const relationshipId = `rId${nextRelId++}`
    const layoutId = nextLayoutId++
    const layoutPath = `ppt/slideLayouts/slideLayout${number}.xml`
    paths.set(name, layoutPath)
    zip.file(layoutPath, byName.get(name) ?? namedLayout(seedXml, name))
    if (seedRels) zip.file(`ppt/slideLayouts/_rels/slideLayout${number}.xml.rels`, seedRels)
    relsXml = relsXml.replace('</Relationships>', `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${number}.xml"/></Relationships>`)
    masterXml = masterXml.replace('</p:sldLayoutIdLst>', `<p:sldLayoutId id="${layoutId}" r:id="${relationshipId}"/></p:sldLayoutIdLst>`)
    const contentTypes = zip.file('[Content_Types].xml')
    if (contentTypes) {
      const contentTypesXml = await contentTypes.async('string')
      zip.file('[Content_Types].xml', contentTypesXml.replace('</Types>', `<Override PartName="/${layoutPath}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/></Types>`))
    }
  }
  zip.file(masterPath, masterXml)
  zip.file(masterRelsPath, relsXml)
  await materializeMasterGroups(zip, definitions, paths)
  await materializeMasterThemes(zip, definitions, paths)
  await materializeMasterObjects(zip, definitions, paths, targetCanvas)
  return paths
}

export type EditablePptxPolicy = 'editable' | 'strict-editable' | 'visual-fidelity'

export class EditablePptxPolicyError extends Error {
  constructor(message: string, readonly objects: HtmlObjectRenderReport[]) {
    super(message)
    this.name = 'EditablePptxPolicyError'
  }
}

export interface WriteEditablePptxOptions {
  policy?: EditablePptxPolicy
  title?: string
  /**
   * Embed subsetted fonts into the PPTX. Enabled when `true` or when a
   * `resolveFont` catalog is supplied (FastPPT passes `@fastppt/fonts`'s
   * registry resolver here). Explicitly `false` disables embedding.
   */
  embedFonts?: boolean | FontEmbedOptions
  /** Per-family font-binary resolver for embedding. */
  resolveFont?: (family: string) => ResolvedFontFile | undefined
  notes?: readonly string[]
  transitions?: readonly NativeSlideTransition[]
  /** Theme accent colors, mapped in order to accent1 through accent6. */
  themeColors?: readonly string[]
  themeFont?: string
  /** Theme layouts materialized as selectable PowerPoint slide layouts. */
  masterLayouts?: readonly string[]
  masterLayoutDefinitions?: readonly NativeMasterLayout[]
  /** Zero-based page selections, resolved against the materialized layout names. */
  slideLayouts?: readonly (string | undefined)[]
  placeholderBindings?: readonly { slide: number; target: string; index: number; geometry?: 'page' | 'layout'; textStyle?: 'page' | 'layout'; textBody?: 'page' | 'layout' }[]
  objectAnimations?: readonly {
    slide: number
    target: string
    kind: 'entrance_fade' | 'appear' | 'fly' | 'zoom' | 'emphasis_pulse' | 'teeter' | 'path_line' | 'path_arc' | 'exit_fade' | 'native'
    path?: string
    nativeXml?: string
    nativeDurationMs?: number
    trigger?: 'on-click' | 'with-previous' | 'after-previous'
    delayMs?: number
    durationMs?: number
  }[]
  master?: boolean
  nativeDiagrams?: readonly { slide: number; diagramId?: string; document: NativeDiagramDocument }[]
}

export interface WriteEditablePptxResult {
  objects: HtmlObjectRenderReport[]
  warnings: HtmlConversionWarning[]
  elementCount: number
  slideCount: number
  embeddedFaces: number
  qa: ExportQaReport
}

export interface EditablePptxRuntimeStatus {
  status: 'available'
  version: 'slidewave 0.6.1-fastppt.1'
  byteLength: number
  fontEmbedding: 'ok'
}

export async function probeEditablePptxRuntime(): Promise<EditablePptxRuntimeStatus> {
  const rendered = htmlDeckToPresentation({
    version: 1,
    source: 'html',
    slides: [
      {
        version: 1,
        id: 'readiness-probe',
        width: 1600,
        height: 900,
        elements: [],
        warnings: [],
      },
    ],
    warnings: [],
  })
  const output = await rendered.presentation.toArrayBuffer()
  const signature = new Uint8Array(output, 0, Math.min(2, output.byteLength))
  if (output.byteLength === 0 || signature[0] !== 0x50 || signature[1] !== 0x4b)
    throw new Error('Slidewave did not produce a valid PPTX ZIP payload.')
  return {
    status: 'available',
    version: 'slidewave 0.6.1-fastppt.1',
    byteLength: output.byteLength,
    fontEmbedding: 'ok',
  }
}

export async function writeEditablePptx(
  snapshot: HtmlDeckSnapshot,
  outputPath: string,
  options: WriteEditablePptxOptions = {},
): Promise<WriteEditablePptxResult> {
  const replacements = new Map<string, Map<string, NativeDiagramDocument>>()
  for (const diagram of options.nativeDiagrams ?? []) {
    const page = snapshot.slides[diagram.slide - 1]
    if (!page) throw new Error(`Native diagram references missing slide ${diagram.slide}`)
    if (!diagram.diagramId) continue
    const matches = page.elements.filter((element) => element.kind === 'image' && element.assetKey?.split(/[?#]/)[0]?.endsWith(`assets/generated/${diagram.diagramId}.svg`))
    if (!matches.length) throw new Error(`Native diagram ${diagram.diagramId} has no captured source on slide ${diagram.slide}`)
    const pageReplacements = replacements.get(page.id) ?? new Map<string, NativeDiagramDocument>()
    for (const element of matches) {
      if (pageReplacements.has(element.id)) throw new Error(`Duplicate native diagram replacement for ${element.id}`)
      pageReplacements.set(element.id, diagram.document)
    }
    replacements.set(page.id, pageReplacements)
  }
  const overrides = fixedObjectOverrides(snapshot, options)
  const inherited: HtmlObjectRenderReport[] = []
  const renderSnapshot = { ...snapshot, slides: snapshot.slides.map((page, index) => {
    const layoutName = options.master === false ? undefined : options.slideLayouts?.[index]?.trim()
    const definition = options.masterLayoutDefinitions?.find(layout => layout.name.trim() === layoutName)
    return { ...page, elements: page.elements.filter(element => {
      const owner = element.source.nativeLayoutObject
      if (!owner || owner.layout !== layoutName || !definition || isFixedObjectOverridden(overrides.excluded, index, owner)) return true
      const objects = owner.scope === 'master'
        ? options.masterLayoutDefinitions?.find(layout => (layout.masterId?.trim() ?? 'default') === (definition.masterId?.trim() ?? 'default') && layout.masterObjects)?.masterObjects?.objects
        : definition.fixedObjects
      if (!objects?.some(object => object.name === owner.name)) return true
      inherited.push({ slideId: page.id, elementId: element.id, source: element.source, kind: element.kind, editableRequired: true, nativeCount: 1, imageCount: 0, status: 'native', reasons: ['Object is inherited from the selected native layout.'] })
      return false
    }) }
  }) }
  options = overrides.options
  const rendered = htmlDeckToPresentation(renderSnapshot, {
    slideDiagramReplacements: replacements,
    ...(options.title ? { title: options.title } : {}),
    ...(options.notes ? { notes: options.notes } : {}),
    ...(options.master === false ? {} : { master: true }),
    ...(options.themeFont ? { themeFont: options.themeFont } : {}),
  })
  rendered.objects.push(...inherited)
  rendered.elementCount += inherited.length
  // Unbound diagrams remain supported for callers authoring an entire native slide.
  for (const [index, diagram] of (options.nativeDiagrams ?? []).entries()) {
    if (diagram.diagramId) continue
    const slide = rendered.presentation._slides[diagram.slide - 1]!
    const start = slide._ops.length
    slide.addDiagram(diagram.document)
    const count = slide._ops.length - start
    rendered.objects.push({
      slideId: snapshot.slides[diagram.slide - 1]!.id,
      elementId: `native-diagram-${index}`,
      source: { tag: 'diagram', path: `nativeDiagrams/${index}` },
      kind: 'image', editableRequired: true, nativeCount: count, imageCount: 0,
      status: count ? 'native' : 'missing', reasons: count ? [] : ['Native diagram emitted no objects.'],
    })
    if (count) rendered.elementCount += 1
  }
  const missing = rendered.objects.filter((object) => object.status === 'missing')
  const degraded = rendered.objects.filter((object) => object.editableRequired && (object.imageCount > 0 || object.semanticPreserved === false))
  if (missing.length || (options.policy === 'strict-editable' && degraded.length)) {
    throw new EditablePptxPolicyError(
      `Export policy rejected ${missing.length} missing and ${degraded.length} image- or structure-degraded objects.`,
      rendered.objects,
    )
  }
  const embed =
    options.embedFonts !== false &&
    (options.embedFonts === true || typeof options.resolveFont === 'function')
  const embedOptions: FontEmbedOptions | undefined = typeof options.embedFonts === 'object'
    ? options.embedFonts
    : typeof options.resolveFont === 'function'
      ? { resolveFont: options.resolveFont }
      : undefined
  const warnings: HtmlConversionWarning[] = [...rendered.warnings]
  for (const layout of options.masterLayoutDefinitions ?? []) for (const slot of layout.placeholders) {
    if (!slot.textStyle) continue
    const messages = new Set<string>()
    let hasBullet = false, hasLetterSpacing = false, hasBaseline = false, hasKerning = false, hasCapitalization = false
    for (let level = 1; level <= 9; level++) {
      const style = resolveNativeTextStyle(slot.textStyle, level), paragraph = style.paragraph
      if (style.letterSpacing) hasLetterSpacing = true
      if (style.baselinePercent) hasBaseline = true
      if (style.capitalization !== undefined && style.capitalization !== 'none') hasCapitalization = true
      if (style.kerningThreshold !== undefined) hasKerning = true
      if (paragraph?.tabStops?.some(stop => stop.align === 'decimal')) messages.add(decimalTabCompatibility(paragraph.decimalTab))
      if (paragraph?.bullet?.kind === 'character' || paragraph?.bullet?.kind === 'auto-number') hasBullet = true
    }
    for (const message of messages) warnings.push({ code: 'text-tab-compatibility', message: `Layout ${layout.name}, placeholder ${slot.index}: ${message}` })
    if (hasBullet) warnings.push({ code: 'text-bullet-compatibility', message: `Layout ${layout.name}, placeholder ${slot.index}: ${textBulletCompatibility}` })
    if (hasCapitalization) warnings.push({ code: 'text-capitalization-compatibility', message: `Layout ${layout.name}, placeholder ${slot.index}: ${textCapitalizationCompatibility}` })
    if (hasKerning) warnings.push({ code: 'text-kerning-compatibility', message: `Layout ${layout.name}, placeholder ${slot.index}: ${textKerningCompatibility}` })
    if (hasBaseline) warnings.push({ code: 'text-baseline-compatibility', message: `Layout ${layout.name}, placeholder ${slot.index}: ${textBaselineCompatibility}` })
    if (hasLetterSpacing) warnings.push({ code: 'text-letter-spacing-compatibility', message: `Layout ${layout.name}, placeholder ${slot.index}: ${textLetterSpacingCompatibility}` })
  }
  for (const layout of options.masterLayoutDefinitions ?? []) for (const object of [...layout.fixedObjects ?? [], ...layout.masterObjects?.objects ?? []]) {
    if (object.capitalization !== undefined && object.capitalization !== 'none') warnings.push({ code: 'text-capitalization-compatibility', message: `Layout ${layout.name}, fixed object ${object.name}: ${textCapitalizationCompatibility}` })
    if (object.kerningThreshold !== undefined) warnings.push({ code: 'text-kerning-compatibility', message: `Layout ${layout.name}, fixed object ${object.name}: ${textKerningCompatibility}` })
    if (object.baselinePercent) warnings.push({ code: 'text-baseline-compatibility', message: `Layout ${layout.name}, fixed object ${object.name}: ${textBaselineCompatibility}` })
    if (object.letterSpacing) warnings.push({ code: 'text-letter-spacing-compatibility', message: `Layout ${layout.name}, fixed object ${object.name}: ${textLetterSpacingCompatibility}` })
  }
  let embeddedFaces = 0
  try {
    const raw = await rendered.presentation.toArrayBuffer()
    let buffer = raw
    if (options.transitions?.some((kind) => kind !== 'none') || options.themeColors?.length || options.objectAnimations?.length || options.masterLayouts?.length || options.masterLayoutDefinitions?.length || options.slideLayouts?.length || options.placeholderBindings?.length) {
      const zip = await JSZip.loadAsync(buffer)
      if (options.transitions) {
        for (let index = 0; index < options.transitions.length; index++) {
          const transition = options.transitions[index]
          if (!transition) continue
          const fragment = transitionXml(transition)
          if (!fragment) continue
          const kind = typeof transition === 'string' ? transition : transition.kind
          const path = `ppt/slides/slide${index + 1}.xml`
          const file = zip.file(path)
          if (!file) continue
          const xml = await file.async('string')
          if (kind === 'morph') warnings.push({ code: 'invalid-snapshot', message: `Slide ${index + 1}: Morph is not validated; exported fade transition instead.` })
          zip.file(path, setSlideChild(xml, 'transition', fragment))
        }
      }
      const colors = (options.themeColors ?? [])
        .map((color) => color.replace(/^#/, '').toUpperCase())
        .filter((color) => /^[0-9A-F]{6}$/.test(color))
        .slice(0, 6)
      if (colors.length > 0) {
        const theme = zip.file('ppt/theme/theme1.xml')
        if (theme) {
          let xml = await theme.async('string')
          for (const [index, color] of colors.entries()) {
            const accent = `accent${index + 1}`
            xml = xml.replace(
              new RegExp(`(<a:${accent}><a:srgbClr val=")[0-9A-Fa-f]{6}("/>)`),
              `$1${color}$2`,
            )
          }
          zip.file('ppt/theme/theme1.xml', xml)
        }
      }
      const animationsBySlide = new Map<number, Array<NonNullable<WriteEditablePptxOptions['objectAnimations']>[number]>>()
      for (const animation of options.objectAnimations ?? []) {
        if (!Number.isInteger(animation.slide) || animation.slide < 1) throw new Error(`Invalid animation slide: ${animation.slide}`)
        const current = animationsBySlide.get(animation.slide) ?? []
        current.push(animation)
        animationsBySlide.set(animation.slide, current)
      }
      for (const [slide, animations] of animationsBySlide) {
        const path = `ppt/slides/slide${slide}.xml`
        const file = zip.file(path)
        if (!file) {
          throw new Error(`Animation target slide ${slide} does not exist.`)
        }
        let xml = await file.async('string')
        for (const anchor of new Set(animations.filter(e => e.kind === 'native').map(e => e.target))) xml = groupNativeAnimationTarget(xml, anchor)
        scheduleMotion(animations) // Validate caller values before rounding to OOXML milliseconds.
        const scheduled = scheduleMotion(animations.map((animation) => ({ ...animation, durationMs: Math.max(1, Math.round(animation.durationMs ?? 400)), delayMs: Math.max(0, Math.round(animation.delayMs ?? 0)) })))
        const groups = new Map<number, string[]>()
        let nextTimingId = 3 + animations.length * 3
        const rows = scheduled.flatMap(({ effect: animation, index, clickGroup, startMs }) => {
          const targets = animationShapeIds(xml, animation.target)
          if (targets.length === 0) {
            throw new Error(`Animation target was not found on slide ${slide}: ${animation.target}`)
          }
          const base = 3 + index * 3
          const duration = Math.max(1, Math.round(animation.durationMs ?? 400))
          const delay = String(startMs)
          const nodeType = animation.trigger === 'with-previous' ? 'withEffect' : animation.trigger === 'after-previous' ? 'afterEffect' : 'clickEffect'
          const transition = animation.kind === 'exit_fade' ? 'out' : animation.kind.startsWith('emphasis_') || animation.kind === 'teeter' || animation.kind.startsWith('path_') ? 'none' : 'in'
          const filter = animation.kind === 'appear' ? 'appear' : animation.kind === 'fly' ? 'fly' : animation.kind === 'zoom' ? 'zoom' : animation.kind === 'emphasis_pulse' ? 'pulse' : animation.kind === 'teeter' ? 'teeter' : 'fade'
          const behavior = targets.map((targetId, targetIndex) => {
            const behaviorId = targetIndex === 0 ? base + 2 : nextTimingId++
            if (animation.kind === 'native') {
              if (!animation.nativeXml) throw new Error('Native animation XML is missing')
              return nativeEffectXml(animation.nativeXml, targetId, () => nextTimingId++, animation.durationMs && animation.nativeDurationMs ? animation.durationMs / animation.nativeDurationMs : 1)
            }
            const visibility = (id: number) => `<p:set><p:cBhvr><p:cTn id="${id}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${targetId}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`
            if (animation.kind === 'appear') return visibility(behaviorId)
            const visibleOnStart = transition === 'in' ? visibility(nextTimingId++) : ''
            return visibleOnStart + (animation.kind.startsWith('path_')
            ? `<p:animMotion origin="layout" path="${escapeXmlAttribute(animation.path ?? (animation.kind === 'path_arc' ? 'M 0 0 C 0.25 0.5 0.75 0.5 1 0' : 'M 0 0 L 1 0'))}" pathEditMode="relative"><p:cBhvr><p:cTn id="${behaviorId}" dur="${duration}" fill="hold"/><p:tgtEl><p:spTgt spid="${targetId}"/></p:tgtEl></p:cBhvr></p:animMotion>`
            : `<p:animEffect transition="${transition}" filter="${filter}"><p:cBhvr><p:cTn id="${behaviorId}" dur="${duration}" fill="hold"/><p:tgtEl><p:spTgt spid="${targetId}"/></p:tgtEl></p:cBhvr></p:animEffect>`)
          }).join('')
          const row = `<p:par><p:cTn id="${base}" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${base + 1}" fill="hold" nodeType="${nodeType}" presetClass="${transition === 'in' ? 'entr' : transition === 'out' ? 'exit' : animation.kind.startsWith('path_') ? 'path' : 'emph'}"><p:childTnLst>${behavior}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`
          const groupRows = groups.get(clickGroup) ?? []
          groupRows.push(row)
          groups.set(clickGroup, groupRows)
          return [row]
        })
        if (rows.length === 0) continue
        const steps = [...groups].map(([group, children]) => {
          const conditions = group === 0 ? '<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>' : '<p:cond delay="indefinite"/>'
          return `<p:par><p:cTn id="${nextTimingId++}" fill="hold"><p:stCondLst>${conditions}</p:stCondLst><p:childTnLst>${children.join('')}</p:childTnLst></p:cTn></p:par>`
        }).join('')
        const timing = `  <p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${steps}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`
        zip.file(path, setSlideChild(xml, 'timing', timing.trim()))
      }
      if (options.master === false && options.slideLayouts?.some(name => name !== undefined))
        throw new Error('Slide layout selections require a master.')
      const layoutPaths = options.master === false ? new Map<string, string>()
        : await materializeMasterLayouts(zip, options.masterLayouts ?? [], options.masterLayoutDefinitions)
      for (const [index, name] of (options.slideLayouts ?? []).entries()) {
        if (name === undefined) continue
        const target = layoutPaths.get(name.trim())
        if (!target) throw new Error(`Unknown slide layout: ${name}`)
        const relsPath = `ppt/slides/_rels/slide${index + 1}.xml.rels`
        const file = zip.file(relsPath)
        if (!file) throw new Error(`Missing slide for layout selection: ${index + 1}`)
        const xml = await file.async('string')
        const relationships = parseXml(xml).children.filter(node =>
          node.namespace === 'http://schemas.openxmlformats.org/package/2006/relationships'
          && node.local === 'Relationship'
          && node.attributes.Type === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout')
        if (relationships.length !== 1) throw new Error(`Expected one layout relationship on slide ${index + 1}`)
        const relation = relationships[0]!
        const replacement = `<${relation.name} Id="${escapeXmlAttribute(relation.attributes.Id!)}" Type="${relation.attributes.Type}" Target="../${escapeXmlAttribute(target.slice(4))}"/>`
        zip.file(relsPath, xml.slice(0, relation.start) + replacement + xml.slice(relation.end))
      }
      const boundSlots = new Set<string>()
      for (const binding of options.placeholderBindings ?? []) {
        if (options.master === false) throw new Error('Placeholder bindings require a master.')
        const layoutName = options.slideLayouts?.[binding.slide - 1]?.trim()
        const definition = options.masterLayoutDefinitions?.find(layout => layout.name.trim() === layoutName)
        const slot = definition?.placeholders.find(slot => slot.index === binding.index)
        if (!Number.isSafeInteger(binding.slide) || binding.slide < 1 || !slot)
          throw new Error(`Unknown placeholder on slide ${binding.slide}: ${binding.index}`)
        const key = `${binding.slide}:${binding.index}`
        if (boundSlots.has(key)) throw new Error(`Duplicate placeholder binding: ${key}`)
        boundSlots.add(key)
        const path = `ppt/slides/slide${binding.slide}.xml`
        const file = zip.file(path)
        if (!file) throw new Error(`Missing placeholder slide: ${binding.slide}`)
        const xml = await file.async('string')
        const ids = animationShapeIds(xml, binding.target)
        if (ids.length !== 1) throw new Error(`Placeholder target must resolve to one shape: ${binding.target}`)
        zip.file(path, bindSlidePlaceholder(xml, ids[0]!, slot, binding.geometry, binding.textStyle, binding.textBody))
      }
      await writeTemplateIdentities(zip, layoutPaths, options.masterLayoutDefinitions ?? [], overrides.identities, overrides.excluded, snapshot)
      buffer = await zip.generateAsync({ type: 'arraybuffer' })
    }
    if (embed && embedOptions) {
      const result = await embedFonts(buffer, embedOptions)
      warnings.push(...result.warnings)
      embeddedFaces = result.embeddedFaces
      buffer = result.buffer
    }
    await validateNativeTableReadback(buffer, renderSnapshot, rendered.objects)
    const qa = await validateEditablePptx(buffer, snapshot.slides.length, renderSnapshot.slides.map(slide => slide.elements.some(element => (element.kind === 'text' && element.text.trim().length > 0) || (element.kind === 'table' && element.cells.some(cell => cell.text.trim().length > 0)))))
    if (!qa.ok) {
      const detail = qa.issues
        .map((issue) =>
          issue.slide === undefined
            ? `${issue.code}: ${issue.message}`
            : `slide ${issue.slide} ${issue.code}: ${issue.message}`,
        )
        .join('; ')
      throw new Error(`Editable PPTX quality gate failed: ${detail}`)
    }
    await writeFile(outputPath, Buffer.from(buffer))
    return {
      warnings,
      objects: rendered.objects,
      elementCount: rendered.elementCount,
      slideCount: snapshot.slides.length,
      embeddedFaces,
      qa,
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`PPTX serialization failed: ${message}`, { cause })
  }
}
