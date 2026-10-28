import { validateTextCapitalization, type TextCapitalization } from '../primitives/text-capitalization.mjs'
import { validateTextKerning, type TextKerning } from '../primitives/text-kerning.mjs'
import { validateTextBaseline, type TextBaseline } from '../primitives/text-baseline.mjs'
import { validateTextLetterSpacing, type TextLetterSpacing } from '../primitives/text-letter-spacing.mjs'
import { parseXml, PRESENTATION_NS } from './slide-xml.js'
import { validateTextDecorations, type TextDecorations } from '../primitives/text-decoration.mjs'
import {
  nativeListStyleXml,
  validateNativeTextStyle,
  type NativeTextStyle,
} from './native-text-style.js'

export interface CapturedNativeParagraph {
  level: number
  style: NativeTextStyle
  softBreakStyles?: Array<TextCapitalization & TextKerning & TextDecorations & TextLetterSpacing & TextBaseline & Pick<NativeTextStyle, 'fontSize'>>
}

/** PptxGenJS owns runs/relationships; normalize its paragraph markup without replacing text. */
export function applyTextParagraphs(
  xml: string,
  name: string,
  values: CapturedNativeParagraph[],
): string {
  const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main'
  const tree = parseXml(xml)
    .children.find(
      (node) => node.namespace === PRESENTATION_NS && node.local === 'cSld',
    )
    ?.children.find(
      (node) => node.namespace === PRESENTATION_NS && node.local === 'spTree',
    )
  const shapes =
    tree?.children.filter(
      (node) =>
        node.namespace === PRESENTATION_NS &&
        node.local === 'sp' &&
        node.children.some((child) =>
          child.children.some(
            (property) =>
              property.namespace === PRESENTATION_NS &&
              property.local === 'cNvPr' &&
              property.attributes.name === name,
          ),
        ),
    ) ?? []
  if (shapes.length !== 1)
    throw new Error(`Text frame must identify one native shape: ${name}`)
  const body = shapes[0]!.children.find(
    (node) => node.namespace === PRESENTATION_NS && node.local === 'txBody',
  )
  const paragraphs =
    body?.children.filter(
      (node) => node.namespace === drawing && node.local === 'p',
    ) ?? []
  if (paragraphs.length !== values.length)
    throw new Error(
      `Native paragraph count changed for ${name}: ${paragraphs.length}/${values.length}`,
    )
  const edits: Array<{ start: number; end: number; content: string }> = []
  for (const [index, paragraph] of paragraphs.entries()) {
    const value = values[index]!
    if (!Number.isInteger(value.level) || value.level < 1 || value.level > 9)
      throw new Error('Invalid native paragraph level')
    const breaks = paragraph.children.filter(child => child.namespace === drawing && child.local === 'br')
    if (value.softBreakStyles) {
      if (breaks.length !== value.softBreakStyles.length) throw new Error(`Native soft break count changed for ${name}`)
      for (const [at, child] of breaks.entries()) {
        const decoration = value.softBreakStyles[at]!
        validateTextDecorations(decoration)
        validateTextLetterSpacing(decoration)
        validateTextBaseline(decoration)
        validateTextKerning(decoration)
        validateTextCapitalization(decoration)
        validateNativeTextStyle({ fontSize: decoration.fontSize })
        const attrs = [
          decoration.capitalization === undefined ? '' : ` cap="${decoration.capitalization}"`,
          decoration.kerningThreshold === undefined ? '' : ` kern="${Math.round(decoration.kerningThreshold * 100)}"`,
          decoration.fontSize === undefined ? '' : ` sz="${Math.round(decoration.fontSize * 100)}"`,
          decoration.baselinePercent === undefined ? '' : ` baseline="${Math.round(decoration.baselinePercent * 1000)}"`,
          decoration.letterSpacing === undefined ? '' : ` spc="${Math.round(decoration.letterSpacing * 100)}"`,
          decoration.underline === undefined ? '' : ` u="${decoration.underline ? 'sng' : 'none'}"`,
          decoration.strike === undefined ? '' : ` strike="${decoration.strike ? 'sngStrike' : 'noStrike'}"`,
        ].join('')
        const run = child.children.find(node => node.namespace === drawing && node.local === 'rPr')
        if (run) {
          let opening = xml.slice(run.start, run.openEnd)
          if (decoration.capitalization !== undefined) opening = opening.replace(/\scap="[^"]*"/g, '')
          if (decoration.fontSize !== undefined) opening = opening.replace(/\ssz="[^"]*"/g, '')
          if (decoration.kerningThreshold !== undefined) opening = opening.replace(/\skern="[^"]*"/g, '')
          if (decoration.baselinePercent !== undefined) opening = opening.replace(/\sbaseline="[^"]*"/g, '')
          if (decoration.letterSpacing !== undefined) opening = opening.replace(/\sspc="[^"]*"/g, '')
          if (decoration.underline !== undefined) opening = opening.replace(/\su="[^"]*"/g, '')
          if (decoration.strike !== undefined) opening = opening.replace(/\sstrike="[^"]*"/g, '')
          edits.push({ start: run.start, end: run.openEnd, content: opening.replace(/\/?>(?=$)/, end => attrs + end) })
        } else if (xml.slice(child.start, child.openEnd).endsWith('/>')) {
          edits.push({ start: child.start, end: child.end, content: `<a:br><a:rPr${attrs}/></a:br>` })
        } else edits.push({ start: child.openEnd, end: child.openEnd, content: `<a:rPr${attrs}/>` })
      }
    }
    const defaults = nativeListStyleXml(value.style).match(
      /<a:lvl1pPr\b[^>]*>[\s\S]*?<\/a:lvl1pPr>/,
    )![0]
    const properties = defaults
      .replace('<a:lvl1pPr', `<a:pPr lvl="${value.level - 1}"`)
      .replace('</a:lvl1pPr>', '</a:pPr>')
    edits.push({
      start: paragraph.openEnd,
      end: paragraph.openEnd,
      content: properties,
    })
    for (const child of paragraph.children) {
      if (child.namespace !== drawing) continue
      if (child.local === 'pPr')
        edits.push({ start: child.start, end: child.end, content: '' })
      if (child.local === 'endParaRPr') {
        const end = defaults
          .match(/<a:defRPr\b[^>]*>[\s\S]*?<\/a:defRPr>/)![0]
          .replaceAll('a:defRPr', 'a:endParaRPr')
        edits.push({ start: child.start, end: child.end, content: end })
      }
      if (child.local !== 'r') continue
      for (const run of child.children.filter(
        (node) => node.namespace === drawing && node.local === 'rPr',
      )) {
        let opening = xml.slice(run.start, run.openEnd)
        // The writer omits false character flags. Make regular runs explicit so
        // a bold/italic layout cannot override their measured page formatting.
        for (const [attribute, fallback] of [
          ['b', '0'],
          ['i', '0'],
          ['u', 'none'],
          ['strike', 'noStrike'],
        ])
          if (run.attributes[attribute!] === undefined)
            opening = opening.replace(
              /\/?>(?=$)/,
              (match) => ` ${attribute}="${fallback}"${match}`,
            )
        edits.push({ start: run.start, end: run.openEnd, content: opening })
      }
    }
  }
  // Deletions at the first child must precede insertions at the same offset.
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end))
    xml = xml.slice(0, edit.start) + edit.content + xml.slice(edit.end)
  return xml
}
