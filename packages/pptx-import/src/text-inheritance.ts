import type {
  SourceCharacterProperties,
  SourceFill,
  SourceObject,
  SourceParagraphProperties,
  SourcePartTextStyles,
  SourceTextProperty,
} from './objects.js'
import {
  resolveSourceColor,
  type ResolvedColor,
  type ThemeDefinitionLike,
} from './color-resolution.js'
import { DRAWING_NS, matchesNamespace } from './relationships.js'

export interface TextStyleOrigin {
  part: string
  shapeId?: string
  order?: number
  scope: string
  level?: number
  paragraph?: number
  run?: number
}
interface CharacterStyle {
  attributes: Record<string, string>
  fonts: SourceCharacterProperties['fonts']
  fill?: SourceFill
  children: Record<string, SourceTextProperty>
  origins: Record<string, TextStyleOrigin>
  sources: Array<TextStyleOrigin & { sourceXml: string }>
}
interface ParagraphStyle {
  attributes: Record<string, string>
  children: Record<string, SourceTextProperty>
  defaultRun: CharacterStyle
  origins: Record<string, TextStyleOrigin>
  sources: Array<TextStyleOrigin & { sourceXml: string }>
}
type FontScript = 'latin' | 'eastAsian' | 'complexScript'
interface ResolvedFont {
  reference: string
  family?: string
  themePart?: string
  script?: string
  issue?: string
}
interface TextContext {
  theme?: ThemeDefinitionLike | undefined
  colorMap?: Record<string, string> | undefined
}
const emptyCharacter = (): CharacterStyle => ({
  attributes: {},
  fonts: {},
  children: {},
  origins: {},
  sources: [],
})
const emptyParagraph = (): ParagraphStyle => ({
  attributes: {},
  children: {},
  defaultRun: emptyCharacter(),
  origins: {},
  sources: [],
})

// Choice groups replace their previous alternative; explicit buNone, noFill,
// b="0" and i="0" are overrides, never treated as absent values.
function childKey(child: SourceTextProperty): string {
  if (!matchesNamespace(child.namespace, DRAWING_NS))
    return `${child.namespace}:${child.kind}`
  for (const [key, choices] of Object.entries({
    bullet: ['buNone', 'buChar', 'buAutoNum', 'buBlip'],
    bulletColor: ['buClr', 'buClrTx'],
    bulletSize: ['buSzPct', 'buSzPts', 'buSzTx'],
    bulletFont: ['buFont', 'buFontTx'],
    underlineFill: ['uFill', 'uFillTx'],
    underlineLine: ['uLn', 'uLnTx'],
  }))
    if (choices.includes(child.kind)) return key
  return child.kind
}

function mergeChildren(
  target: Pick<CharacterStyle, 'children' | 'origins'>,
  children: readonly SourceTextProperty[],
  origin: TextStyleOrigin,
  issues: string[],
): void {
  const groups = new Map<string, SourceTextProperty[]>()
  for (const child of children) {
    const key = childKey(child)
    groups.set(key, [...(groups.get(key) ?? []), child])
  }
  for (const [key, entries] of groups) {
    if (entries.length !== 1) {
      // An ambiguous local choice blocks inherited values too. Keep every
      // source node in sources/sourceObjects, without inventing a winner.
      delete target.children[key]
      delete target.origins[`children.${key}`]
      const location = `${origin.part}${origin.shapeId === undefined && origin.order === undefined ? '' : `#${origin.shapeId ?? origin.order}`}/${origin.scope}${origin.level === undefined ? '' : `/level${origin.level}`}${origin.paragraph === undefined ? '' : `/p${origin.paragraph}`}${origin.run === undefined ? '' : `/r${origin.run}`}`
      issues.push(
        `Ambiguous text property ${key} (${entries.map((entry) => entry.kind).join(', ')}) at ${location}`,
      )
      continue
    }
    target.children[key] = entries[0]!
    target.origins[`children.${key}`] = origin
  }
}

function mergeCharacter(
  target: CharacterStyle,
  source: SourceCharacterProperties,
  origin: TextStyleOrigin,
  issues: string[],
): void {
  for (const [key, value] of Object.entries(source.attributes)) {
    target.attributes[key] = value
    target.origins[`attributes.${key}`] = origin
  }
  for (const [script, font] of Object.entries(source.fonts) as Array<
    [FontScript, Record<string, string>]
  >) {
    target.fonts[script] = { ...target.fonts[script], ...font }
    for (const key of Object.keys(font))
      target.origins[`fonts.${script}.${key}`] = origin
  }
  if (source.fill) {
    target.fill = source.fill
    target.origins.fill = origin
  }
  mergeChildren(target, source.children, origin, issues)
  target.sources.push({ ...origin, sourceXml: source.sourceXml })
}
function mergeParagraph(
  target: ParagraphStyle,
  source: SourceParagraphProperties,
  origin: TextStyleOrigin,
  issues: string[],
): void {
  for (const [key, value] of Object.entries(source.attributes)) {
    target.attributes[key] = value
    target.origins[`attributes.${key}`] = origin
  }
  mergeChildren(target, source.children, origin, issues)
  if (source.defaultRun)
    mergeCharacter(
      target.defaultRun,
      source.defaultRun,
      { ...origin, scope: `${origin.scope}/defRPr` },
      issues,
    )
  target.sources.push({ ...origin, sourceXml: source.sourceXml })
}

const scriptMatchers: Array<[RegExp, string, FontScript]> = [
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, 'Jpan', 'eastAsian'],
  [/\p{Script=Hangul}/u, 'Hang', 'eastAsian'],
  [/\p{Script=Bopomofo}/u, 'Hant', 'eastAsian'],
  [/\p{Script=Arabic}/u, 'Arab', 'complexScript'],
  [/\p{Script=Hebrew}/u, 'Hebr', 'complexScript'],
  [/\p{Script=Syriac}/u, 'Syrc', 'complexScript'],
  [/\p{Script=Thaana}/u, 'Thaa', 'complexScript'],
  [/\p{Script=Devanagari}/u, 'Deva', 'complexScript'],
  [/\p{Script=Bengali}/u, 'Beng', 'complexScript'],
  [/\p{Script=Gurmukhi}/u, 'Guru', 'complexScript'],
  [/\p{Script=Gujarati}/u, 'Gujr', 'complexScript'],
  [/\p{Script=Oriya}/u, 'Orya', 'complexScript'],
  [/\p{Script=Tamil}/u, 'Taml', 'complexScript'],
  [/\p{Script=Telugu}/u, 'Telu', 'complexScript'],
  [/\p{Script=Kannada}/u, 'Knda', 'complexScript'],
  [/\p{Script=Malayalam}/u, 'Mlym', 'complexScript'],
  [/\p{Script=Sinhala}/u, 'Sinh', 'complexScript'],
  [/\p{Script=Thai}/u, 'Thai', 'complexScript'],
  [/\p{Script=Lao}/u, 'Laoo', 'complexScript'],
  [/\p{Script=Tibetan}/u, 'Tibt', 'complexScript'],
  [/\p{Script=Myanmar}/u, 'Mymr', 'complexScript'],
  [/\p{Script=Khmer}/u, 'Khmr', 'complexScript'],
]
function eastAsianLanguage(language: string | undefined): string | undefined {
  const lang = language?.toLowerCase()
  if (/^ja(?:-|$)/.test(lang ?? '')) return 'Jpan'
  if (/^ko(?:-|$)/.test(lang ?? '')) return 'Hang'
  if (/^zh-(?:hant|tw|hk|mo)(?:-|$)/.test(lang ?? '')) return 'Hant'
  if (/^zh-(?:hans|cn|sg)(?:-|$)/.test(lang ?? '')) return 'Hans'
  return undefined
}
function scriptFor(
  character: string,
  language?: string,
): { face: FontScript; script?: string } {
  for (const [pattern, script, face] of scriptMatchers)
    if (pattern.test(character)) return { face, script }
  if (/\p{Script=Han}|[\u3000-\u303f\uff00-\uffef]/u.test(character)) {
    const script = eastAsianLanguage(language)
    return { face: 'eastAsian', ...(script ? { script } : {}) }
  }
  return { face: 'latin' }
}
export function resolveTextFont(
  reference: string,
  theme: ThemeDefinitionLike | undefined,
  script?: string,
): ResolvedFont {
  if (reference.trim() && !reference.startsWith('+'))
    return { reference, family: reference }
  const alias = /^\+(mj|mn)-(lt|ea|cs)$/.exec(reference)
  if (!alias)
    return {
      reference,
      issue: `Unresolved font reference ${JSON.stringify(reference)}`,
    }
  const collection = alias[1] === 'mj' ? theme?.majorFonts : theme?.minorFonts
  const field =
    alias[2] === 'lt'
      ? 'latin'
      : alias[2] === 'ea'
        ? 'eastAsian'
        : 'complexScript'
  const family = collection?.[field]?.typeface
  const evidence = {
    reference,
    ...(theme ? { themePart: collection?.sourcePart ?? theme.part } : {}),
  }
  if (family?.trim()) return { ...evidence, family }
  const matches = script
    ? (collection?.scripts?.filter(
        (font) => font.script === script && font.typeface?.trim(),
      ) ?? [])
    : []
  if (matches.length === 1)
    return { ...evidence, script: script!, family: matches[0]!.typeface! }
  return {
    ...evidence,
    ...(script ? { script } : {}),
    issue:
      matches.length > 1
        ? `Ambiguous theme font ${reference} for ${script}`
        : `Theme font ${reference} has no face${script ? ` for ${script}` : '; language/script evidence is required'}`,
  }
}
function resolvedCharacter(
  style: CharacterStyle,
  context: TextContext,
  text = '',
) {
  let color: ResolvedColor | undefined
  const issues: string[] = []
  if (style.fill && style.fill.kind !== 'none') {
    if (style.fill.kind === 'solid' && style.fill.color) {
      color = resolveSourceColor(style.fill.color, {
        theme: context.theme ?? { part: '', colors: [] },
        colorMap: context.colorMap ?? {},
        ...(style.origins.fill ? { sourcePart: style.origins.fill.part } : {}),
      })
      if (!color) issues.push('Unresolved text fill color')
    } else issues.push(`Text ${style.fill.kind} fill requires review`)
  }
  const language = style.attributes.lang
  const alternate = style.attributes.altLang
  const fonts: Partial<Record<FontScript, ResolvedFont>> = {}
  for (const [face, value] of Object.entries(style.fonts) as Array<
    [FontScript, Record<string, string>]
  >) {
    if (value.typeface === undefined) continue
    const script =
      face === 'eastAsian'
        ? (eastAsianLanguage(language) ?? eastAsianLanguage(alternate))
        : undefined
    fonts[face] = resolveTextFont(value.typeface, context.theme, script)
  }
  const segments: Array<{
    text: string
    face: FontScript
    script?: string
    font: ResolvedFont
    origin?: TextStyleOrigin
  }> = []
  let preceding: ReturnType<typeof scriptFor> = { face: 'latin' }
  for (const character of text) {
    const routing = /\p{Script=Inherited}/u.test(character)
      ? preceding
      : scriptFor(
          character,
          eastAsianLanguage(language) ? language : (alternate ?? language),
        )
    preceding = routing
    const reference = style.fonts[routing.face]?.typeface
    const font =
      reference === undefined
        ? { reference: '', issue: `Missing ${routing.face} font` }
        : resolveTextFont(reference, context.theme, routing.script)
    if (font.issue && character.trim()) issues.push(font.issue)
    const previous = segments.at(-1)
    if (
      previous?.face === routing.face &&
      previous.script === routing.script &&
      JSON.stringify(previous.font) === JSON.stringify(font)
    )
      previous.text += character
    else
      segments.push({
        text: character,
        ...routing,
        font,
        ...(style.origins[`fonts.${routing.face}.typeface`]
          ? { origin: style.origins[`fonts.${routing.face}.typeface`]! }
          : {}),
      })
  }
  return {
    ...style,
    resolvedFonts: fonts,
    ...(color ? { color } : {}),
    segments,
    issues: [...new Set(issues)],
    provenance: 'derived' as const,
  }
}

/** Resolve defaults property by property, without treating template sample runs
 * or end-of-paragraph markers as formatting for unrelated slide text. */
export function resolveObjectText(
  options: TextContext & {
    object: SourceObject
    /** Nearest first, including the local object. */
    chain?: readonly SourceObject[]
    chainIssues?: readonly string[]
    presentation: SourcePartTextStyles
    master?: SourcePartTextStyles | undefined
  },
) {
  const { object, presentation, master } = options
  const chain = options.chain ?? [object]
  // A slide's omitted type inherits its matched layout's type before txStyles
  // selection. The default 'obj' parsed from a missing @type is not evidence.
  const type =
    chain.find((entry) => entry.placeholder?.explicit.type !== undefined)
      ?.placeholder?.type ?? object.placeholder?.type
  const category = ['title', 'ctrTitle'].includes(type ?? '')
    ? 'titleStyle'
    : [
          'body',
          'obj',
          'subTitle',
          'pic',
          'chart',
          'tbl',
          'dgm',
          'media',
          'clipArt',
        ].includes(type ?? '')
      ? 'bodyStyle'
      : 'otherStyle'
  const issues: string[] = [...(options.chainIssues ?? [])]
  const defaultAt = (level: number): ParagraphStyle => {
    const style = emptyParagraph()
    const applyList = (
      list: readonly SourceParagraphProperties[],
      origin: TextStyleOrigin,
    ) => {
      for (const entry of list.filter((entry) => entry.level === undefined))
        mergeParagraph(style, entry, origin, issues)
      for (const entry of list.filter((entry) => entry.level === level))
        mergeParagraph(style, entry, { ...origin, level }, issues)
    }
    applyList(presentation.defaultTextStyle, {
      part: presentation.part,
      scope: 'presentation/defaultTextStyle',
    })
    if (master) {
      applyList(master.defaultTextStyle, {
        part: master.part,
        scope: 'master/defaultTextStyle',
      })
      applyList(master[category], {
        part: master.part,
        scope: `master/txStyles/${category}`,
      })
    }
    for (const entry of [...chain].reverse()) {
      const origin = {
        part: entry.part,
        ...(entry.shapeId ? { shapeId: entry.shapeId } : {}),
        order: entry.order,
        scope: 'shape/lstStyle',
      }
      const reference = entry.appearance?.fontReference
      if (reference && ['major', 'minor', 'none'].includes(reference.index)) {
        const prefix = reference.index === 'major' ? 'mj' : 'mn'
        mergeCharacter(
          style.defaultRun,
          {
            attributes: {},
            fonts:
              reference.index === 'none'
                ? {}
                : {
                    latin: { typeface: `+${prefix}-lt` },
                    eastAsian: { typeface: `+${prefix}-ea` },
                    complexScript: { typeface: `+${prefix}-cs` },
                  },
            ...(reference.color
              ? {
                  fill: {
                    kind: 'solid',
                    attributes: {},
                    color: reference.color,
                    sourceXml: reference.sourceXml,
                    provenance: 'extracted',
                  },
                }
              : {}),
            children: [],
            sourceXml: reference.sourceXml,
            provenance: 'extracted',
          },
          { ...origin, scope: 'shape/style/fontRef' },
          issues,
        )
      } else if (reference && reference.index !== 'none')
        issues.push(
          `Unresolved fontRef index ${reference.index} at ${entry.part}#${entry.shapeId ?? entry.order}`,
        )
      applyList(entry.appearance?.paragraphDefaults ?? [], origin)
    }
    return style
  }
  const resolveParagraphStyle = (style: ParagraphStyle) => {
    const font = style.children.bulletFont
    const bullet = style.children.bullet
    const color = style.children.bulletColor
    const colorNode =
      color?.kind === 'buClr' && color.children.length === 1
        ? color.children[0]
        : undefined
    const resolvedBulletColor =
      colorNode &&
      matchesNamespace(colorNode.namespace, DRAWING_NS) &&
      colorNode.children.every((child) =>
        matchesNamespace(child.namespace, DRAWING_NS),
      )
        ? resolveSourceColor(
            {
              kind: colorNode.kind,
              attributes: colorNode.attributes,
              transforms: colorNode.children.map((child) => ({
                kind: child.kind,
                attributes: child.attributes,
              })),
            },
            {
              theme: options.theme ?? { part: '', colors: [] },
              colorMap: options.colorMap ?? {},
              sourcePart:
                style.origins['children.bulletColor']?.part ?? object.part,
            },
          )
        : undefined
    const resolvedBulletFont =
      font?.kind === 'buFont'
        ? resolveTextFont(
            font.attributes.typeface ?? '',
            options.theme,
            scriptFor(
              bullet?.attributes.char ?? '',
              style.defaultRun.attributes.lang,
            ).script ?? eastAsianLanguage(style.defaultRun.attributes.lang),
          )
        : undefined
    return {
      ...style,
      ...(resolvedBulletFont ? { resolvedBulletFont } : {}),
      ...(resolvedBulletColor ? { resolvedBulletColor } : {}),
      defaultRun: resolvedCharacter(style.defaultRun, options),
      provenance: 'derived' as const,
    }
  }
  const levels = Array.from({ length: 9 }, (_, index) => ({
    level: index + 1,
    ...resolveParagraphStyle(defaultAt(index + 1)),
  }))
  const paragraphs = (object.text?.paragraphs ?? []).map((paragraph, p) => {
    const rawLevel = paragraph.format?.attributes.lvl ?? '0'
    const level = /^[0-8]$/.test(rawLevel) ? Number(rawLevel) + 1 : undefined
    if (level === undefined)
      issues.push(
        `Invalid paragraph level ${rawLevel} at ${object.part}#${object.shapeId ?? object.order}/p${p}`,
      )
    const style = level === undefined ? emptyParagraph() : defaultAt(level)
    const origin = {
      part: object.part,
      ...(object.shapeId ? { shapeId: object.shapeId } : {}),
      order: object.order,
      scope: 'paragraph/pPr',
      paragraph: p,
    }
    if (paragraph.format)
      mergeParagraph(style, paragraph.format, origin, issues)
    const runs = paragraph.runs.map((run, r) => {
      const character = structuredClone(style.defaultRun)
      if (run.character)
        mergeCharacter(
          character,
          run.character,
          { ...origin, scope: 'run/rPr', run: r },
          issues,
        )
      const resolved = resolvedCharacter(character, options, run.text)
      return { text: run.text, kind: run.kind, ...resolved }
    })
    const end = structuredClone(style.defaultRun)
    if (paragraph.endProperties)
      mergeCharacter(
        end,
        paragraph.endProperties,
        { ...origin, scope: 'paragraph/endParaRPr' },
        issues,
      )
    return {
      paragraph: p,
      level,
      ...resolveParagraphStyle(style),
      runs,
      end: resolvedCharacter(end, options),
    }
  })
  for (const paragraph of paragraphs)
    for (const [r, run] of paragraph.runs.entries())
      for (const issue of run.issues)
        issues.push(
          `${object.part}#${object.shapeId ?? object.order}/p${paragraph.paragraph}/r${r}: ${issue}`,
        )
  return {
    part: object.part,
    shapeId: object.shapeId,
    order: object.order,
    category,
    levels,
    paragraphs,
    issues: [...new Set(issues)],
    provenance: 'derived' as const,
  }
}
