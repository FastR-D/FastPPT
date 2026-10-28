import { validateTextCapitalization, type TextCapitalization } from '../primitives/text-capitalization.mjs'
import { validateTextKerning, type TextKerning } from '../primitives/text-kerning.mjs'
import { validateTextBaseline, type TextBaseline } from '../primitives/text-baseline.mjs'
import { validateTextTabs, type DecimalTab } from '../primitives/text-tabs.mjs'
import { validateTextLanguages, type TextLanguages } from '../primitives/text-language.mjs'
import { validateTextDecorations, type TextDecorations } from '../primitives/text-decoration.mjs'
import { validateTextLetterSpacing, type TextLetterSpacing } from '../primitives/text-letter-spacing.mjs'
import {
  validateTextBulletProperties,
  type TextBulletProperties,
} from '../primitives/text-bullet.js'

export interface NativeCharacterStyle extends TextCapitalization, TextKerning, TextLanguages, TextDecorations, TextLetterSpacing, TextBaseline {
  fontFamily?: string | undefined
  fontFamilies?:
    | {
        latin?: string | undefined
        ea?: string | undefined
        cs?: string | undefined
      }
    | undefined
  fontSize?: number | undefined
  color?: string | undefined
  bold?: boolean | undefined
  italic?: boolean | undefined
}

export interface NativeTextSpacing {
  unit: 'points' | 'percent'
  value: number
}

export interface NativeParagraphStyle extends TextBulletProperties {
  /** Paragraph base direction for ordinary horizontal text. */
  direction?: 'ltr' | 'rtl' | undefined
  /** Declared browser convention; null clears inheritance. Not encoded in DrawingML. */
  decimalTab?: DecimalTab | null | undefined
  /** EMU interval; zero disables the default grid in the native contract. */
  defaultTabSize?: number | undefined
  /** Whole-list replacement; [] explicitly clears inherited stops. */
  tabStops?: Array<{ position: number; align: 'left' | 'center' | 'right' | 'decimal' }> | undefined
  align?: 'left' | 'center' | 'right' | 'justify' | undefined
  /** EMU relative to the text frame, independent of list nesting. */
  marginLeft?: number | undefined
  marginRight?: number | undefined
  indent?: number | undefined
  lineSpacing?: NativeTextSpacing | undefined
  spaceBefore?: NativeTextSpacing | undefined
  spaceAfter?: NativeTextSpacing | undefined
}

export interface NativeTextStyle extends NativeCharacterStyle {
  paragraph?: NativeParagraphStyle | undefined
  /** Sparse, one-based level overrides. Levels never inherit from one another. */
  levels?:
    | Array<{
        level: number
        textStyle?: NativeCharacterStyle | undefined
        paragraph?: NativeParagraphStyle | undefined
      }>
    | undefined
}

export function resolveNativeTextStyle(
  style: NativeTextStyle,
  level: number,
): NativeCharacterStyle & { paragraph?: NativeParagraphStyle | undefined } {
  if (!Number.isSafeInteger(level) || level < 1 || level > 9)
    throw new Error('Invalid text paragraph level.')
  const { levels, ...base } = style
  const override = levels?.find((entry) => entry.level === level)
  const local = override?.textStyle
  const fontFamilies =
    local?.fontFamily !== undefined
      ? local.fontFamilies
      : { ...base.fontFamilies, ...local?.fontFamilies }
  return {
    ...base,
    ...local,
    ...(base.fontFamilies ||
    local?.fontFamilies ||
    local?.fontFamily !== undefined
      ? { fontFamilies }
      : {}),
    ...(base.paragraph || override?.paragraph
      ? { paragraph: { ...base.paragraph, ...override?.paragraph } }
      : {}),
  }
}

const escape = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  )

export function validateNativeTextStyle(style: NativeTextStyle): void {
  const validateCharacter = (character: NativeCharacterStyle) => {
    validateTextLanguages(character)
    validateTextDecorations(character)
    validateTextLetterSpacing(character)
    validateTextBaseline(character)
    validateTextKerning(character)
    validateTextCapitalization(character)
    if (
      character.fontFamily !== undefined &&
      (typeof character.fontFamily !== 'string' || !character.fontFamily.trim())
    )
      throw new Error('Placeholder font family must not be empty.')
    if (
      character.fontFamilies &&
      (!Object.values(character.fontFamilies).some(Boolean) ||
        Object.entries(character.fontFamilies).some(
          ([script, face]) =>
            !['latin', 'ea', 'cs'].includes(script) ||
            (face !== undefined && (typeof face !== 'string' || !face.trim())),
        ))
    )
      throw new Error('Invalid placeholder script fonts.')
    if (
      character.fontSize !== undefined &&
      (!Number.isFinite(character.fontSize) ||
        character.fontSize < 1 ||
        character.fontSize > 4000)
    )
      throw new Error('Invalid placeholder font size.')
    if (
      character.color !== undefined &&
      !/^[0-9a-fA-F]{6}$/.test(character.color)
    )
      throw new Error('Invalid placeholder text color.')
    for (const flag of [character.bold, character.italic])
      if (flag !== undefined && typeof flag !== 'boolean')
        throw new Error('Invalid placeholder character flag.')
  }
  const validateParagraph = (paragraph: NativeParagraphStyle | undefined) => {
    if (!paragraph) return
    if (
      Object.keys(paragraph).some(
        (key) =>
          ![
            'align',
            'direction',
            'marginLeft',
            'marginRight',
            'indent',
            'lineSpacing',
            'spaceBefore',
            'spaceAfter',
            'bullet',
            'bulletFont',
            'bulletSize',
            'bulletColor',
            'defaultTabSize',
            'tabStops',
            'decimalTab',
          ].includes(key),
      )
    )
      throw new Error('Unknown paragraph style property.')
    validateTextBulletProperties(paragraph)
    validateTextTabs(paragraph)
    if (
      paragraph.align !== undefined &&
      !['left', 'center', 'right', 'justify'].includes(paragraph.align)
    )
      throw new Error('Invalid paragraph alignment.')
    if (
      paragraph.direction !== undefined &&
      !['ltr', 'rtl'].includes(paragraph.direction)
    )
      throw new Error('Invalid paragraph direction.')
    for (const key of ['marginLeft', 'marginRight', 'indent'] as const) {
      const value = paragraph[key]
      if (
        value !== undefined &&
        (!Number.isSafeInteger(value) ||
          Math.abs(value) > 51206400 ||
          (key !== 'indent' && value < 0))
      )
        throw new Error('Invalid paragraph margin or indent.')
    }
    for (const value of [
      paragraph.lineSpacing,
      paragraph.spaceBefore,
      paragraph.spaceAfter,
    ]) {
      if (
        value !== undefined &&
        (!value ||
          !['points', 'percent'].includes(value.unit) ||
          Object.keys(value).some((key) => key !== 'unit' && key !== 'value') ||
          !Number.isFinite(value.value) ||
          value.value < 0 ||
          value.value > (value.unit === 'points' ? 1584 : 13200))
      )
        throw new Error('Invalid paragraph spacing.')
    }
  }
  validateCharacter(style)
  validateParagraph(style.paragraph)
  const levels = new Set<number>()
  for (const entry of style.levels ?? []) {
    if (
      !Number.isSafeInteger(entry.level) ||
      entry.level < 1 ||
      entry.level > 9 ||
      levels.has(entry.level)
    )
      throw new Error('Invalid or duplicate text style level.')
    levels.add(entry.level)
    if (entry.textStyle) validateCharacter(entry.textStyle)
    validateParagraph(entry.paragraph)
  }
  if (style.levels?.length === 0)
    throw new Error('Text style levels must not be empty.')
}

export function scaleNativeTextStyle(
  style: NativeTextStyle,
  scale: number,
): NativeTextStyle {
  const character = <T extends NativeCharacterStyle>(value: T): T => ({
    ...value,
    ...(value.kerningThreshold === undefined ? {} : { kerningThreshold: value.kerningThreshold * scale }),
    ...(value.letterSpacing === undefined ? {} : { letterSpacing: value.letterSpacing * scale }),
    ...(value.fontSize === undefined
      ? {}
      : { fontSize: value.fontSize * scale }),
  })
  const paragraph = (value: NativeParagraphStyle): NativeParagraphStyle => ({
    ...value,
    ...(value.tabStops === undefined ? {} : { tabStops: value.tabStops.map(stop => ({ ...stop, position: Math.round(stop.position * scale) })) }),
    ...(value.bulletSize?.kind === 'points'
      ? {
          bulletSize: { kind: 'points', value: value.bulletSize.value * scale },
        }
      : {}),
    ...Object.fromEntries(
      (['marginLeft', 'marginRight', 'indent', 'defaultTabSize'] as const).flatMap((key) =>
        value[key] === undefined ? [] : [[key, Math.round(value[key] * scale)]],
      ),
    ),
    ...Object.fromEntries(
      (['lineSpacing', 'spaceBefore', 'spaceAfter'] as const).flatMap((key) =>
        value[key]?.unit !== 'points'
          ? []
          : [[key, { ...value[key], value: value[key].value * scale }]],
      ),
    ),
  })
  return {
    ...character(style),
    ...(style.paragraph ? { paragraph: paragraph(style.paragraph) } : {}),
    ...(style.levels
      ? {
          levels: style.levels.map((entry) => ({
            ...entry,
            ...(entry.textStyle
              ? { textStyle: character(entry.textStyle) }
              : {}),
            ...(entry.paragraph
              ? { paragraph: paragraph(entry.paragraph) }
              : {}),
          })),
        }
      : {}),
  }
}

export const nativeSpacingXml = (
  tag: string,
  spacing: NativeTextSpacing,
): string =>
  `<a:${tag}><a:${spacing.unit === 'points' ? 'spcPts' : 'spcPct'} val="${Math.round(spacing.value * (spacing.unit === 'points' ? 100 : 1000))}"/></a:${tag}>`

export function nativeBulletXml(properties: TextBulletProperties = {}): string {
  validateTextBulletProperties(properties)
  const { bullet, bulletFont, bulletSize, bulletColor } = properties
  const color =
    bulletColor?.kind === 'color'
      ? `<a:buClr><a:srgbClr val="${bulletColor.color.toUpperCase()}"/></a:buClr>`
      : '<a:buClrTx/>'
  const size =
    !bulletSize || bulletSize.kind === 'text'
      ? '<a:buSzTx/>'
      : `<a:${bulletSize.kind === 'points' ? 'buSzPts' : 'buSzPct'} val="${Math.round(bulletSize.value * (bulletSize.kind === 'points' ? 100 : 1000))}"/>`
  const font =
    bulletFont?.kind === 'font'
      ? `<a:buFont typeface="${escape(bulletFont.fontFamily)}"/>`
      : '<a:buFontTx/>'
  const marker =
    bullet?.kind === 'character'
      ? `<a:buChar char="${escape(bullet.character)}"/>`
      : bullet?.kind === 'auto-number'
        ? `<a:buAutoNum type="${bullet.scheme}"${bullet.startAt === undefined ? '' : ` startAt="${bullet.startAt}"`}/>`
        : '<a:buNone/>'
  // Follow-text defaults prevent seed-master bullet formatting leaking in.
  return color + size + font + marker
}

export function nativeTabStopsXml(stops: NativeParagraphStyle['tabStops']): string {
  if (stops === undefined) return ''
  validateTextTabs({ tabStops: stops })
  const align = { left: 'l', center: 'ctr', right: 'r', decimal: 'dec' }
  return `<a:tabLst>${stops.map(stop => `<a:tab pos="${stop.position}" algn="${align[stop.align]}"/>`).join('')}</a:tabLst>`
}

export function nativeListStyleXml(style: NativeTextStyle | undefined): string {
  if (!style) return '<a:lstStyle/>'
  validateNativeTextStyle(style)
  return `<a:lstStyle>${Array.from({ length: 9 }, (_, index) => {
    const value = resolveNativeTextStyle(style, index + 1)
    const paragraph = value.paragraph
    const align = { left: 'l', center: 'ctr', right: 'r', justify: 'just' }[
      paragraph?.align ?? 'left'
    ]
    const attributes = `${value.fontSize === undefined ? '' : ` sz="${Math.round(value.fontSize * 100)}"`}${value.language === undefined ? '' : ` lang="${escape(value.language)}"`}${value.alternativeLanguage === undefined ? '' : ` altLang="${escape(value.alternativeLanguage)}"`}${value.capitalization === undefined ? '' : ` cap="${value.capitalization}"`} b="${value.bold ? 1 : 0}" i="${value.italic ? 1 : 0}" u="${value.underline ? 'sng' : 'none'}" strike="${value.strike ? 'sngStrike' : 'noStrike'}" kern="${Math.round((value.kerningThreshold ?? 0) * 100)}" spc="${Math.round((value.letterSpacing ?? 0) * 100)}" baseline="${Math.round((value.baselinePercent ?? 0) * 1000)}"`
    const fonts = (['latin', 'ea', 'cs'] as const)
      .map((script) => {
        const face = value.fontFamilies?.[script] ?? value.fontFamily
        return face ? `<a:${script} typeface="${escape(face)}"/>` : ''
      })
      .join('')
    const color = value.color
      ? `<a:solidFill><a:srgbClr val="${value.color.toUpperCase()}"/></a:solidFill>`
      : ''
    return `<a:lvl${index + 1}pPr algn="${align}" marL="${paragraph?.marginLeft ?? 0}" marR="${paragraph?.marginRight ?? 0}" indent="${paragraph?.indent ?? 0}" defTabSz="${paragraph?.defaultTabSize ?? 914400}"${paragraph?.direction === undefined ? '' : ` rtl="${paragraph.direction === 'rtl' ? 1 : 0}"`} eaLnBrk="1" latinLnBrk="0" hangingPunct="1">${nativeSpacingXml('lnSpc', paragraph?.lineSpacing ?? { unit: 'percent', value: 120 })}${nativeSpacingXml('spcBef', paragraph?.spaceBefore ?? { unit: 'points', value: 0 })}${nativeSpacingXml('spcAft', paragraph?.spaceAfter ?? { unit: 'points', value: 0 })}${nativeBulletXml(paragraph)}${nativeTabStopsXml(paragraph?.tabStops)}<a:defRPr${attributes}>${color}<a:uLnTx/><a:uFillTx/>${fonts}</a:defRPr></a:lvl${index + 1}pPr>`
  }).join('')}</a:lstStyle>`
}
