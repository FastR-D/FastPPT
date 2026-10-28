import { validateTextCapitalization, type TextCapitalization } from '../primitives/text-capitalization.mjs'
import { validateTextKerning, type TextKerning } from '../primitives/text-kerning.mjs'
import { validateTextBaseline, type TextBaseline } from '../primitives/text-baseline.mjs'
import { validateTextLanguages, type TextLanguages } from '../primitives/text-language.mjs'
import { validateTextDecorations, type TextDecorations } from '../primitives/text-decoration.mjs'
import { validateTextLetterSpacing, type TextLetterSpacing } from '../primitives/text-letter-spacing.mjs'
import { nativeListStyleXml, scaleNativeTextStyle, type NativeTextStyle } from './native-text-style.js'
import { nativeTextBodyXml, scaleNativeTextBody, type NativeTextBody } from './native-text-body.js'
export type { NativeTextStyle } from './native-text-style.js'
export type { NativeTextBody } from './native-text-body.js'

export interface NativeMasterLayout {
  name: string
  masterId?: string | undefined
  masterTheme?: { fontFamily?: string | undefined; colors?: string[] | undefined } | undefined
  masterObjects?: { canvas?: { width: number; height: number } | undefined; objects: NonNullable<NativeMasterLayout['fixedObjects']> } | undefined
  canvas?: { width: number; height: number } | undefined
  fixedObjects?: Array<TextCapitalization & TextKerning & TextLanguages & TextDecorations & TextLetterSpacing & TextBaseline & {
    anchor?: string | undefined
    name: string; x: number; y: number; width: number; height: number
    fill?: string | undefined; text?: string | undefined; fontFamily?: string | undefined
    fontSize?: number | undefined; color?: string | undefined
    direction?: 'ltr' | 'rtl' | undefined
  }> | undefined
  placeholders: Array<{
    index: number
    type: 'title' | 'ctrTitle' | 'subTitle' | 'body' | 'obj' | 'pic'
    /** Source geometry in English Metric Units (914400 EMU per inch). */
    x: number
    y: number
    width: number
    height: number
    /** Default text size in points; RGB color without a hash. */
    textStyle?: NativeTextStyle | undefined
    textBody?: NativeTextBody | undefined
  }>
}
const escape = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
export function nativeMasterLayoutXml(layout: NativeMasterLayout, targetCanvas?: { width: number; height: number }): string {
  if (layout.canvas) {
    if (![layout.canvas.width, layout.canvas.height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid layout reference canvas.')
    if (targetCanvas) {
      if (![targetCanvas.width, targetCanvas.height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid target canvas.')
      const sx = targetCanvas.width / layout.canvas.width, sy = targetCanvas.height / layout.canvas.height
      const scale = <T extends { x: number; y: number; width: number; height: number }>(item: T): T => ({ ...item, x: Math.round(item.x * sx), y: Math.round(item.y * sy), width: Math.round(item.width * sx), height: Math.round(item.height * sy) })
      layout = { ...layout, placeholders: layout.placeholders.map(item => ({ ...scale(item), ...(item.textStyle ? { textStyle: scaleNativeTextStyle(item.textStyle, sx) } : {}), ...(item.textBody ? { textBody: scaleNativeTextBody(item.textBody, sx, sy) } : {}) })), ...(layout.fixedObjects ? { fixedObjects: layout.fixedObjects.map(item => ({ ...scale(item), ...(item.kerningThreshold === undefined ? {} : { kerningThreshold: item.kerningThreshold * sx }), ...(item.letterSpacing === undefined ? {} : { letterSpacing: item.letterSpacing * sx }), ...(item.fontSize === undefined ? {} : { fontSize: item.fontSize * sx }) })) } : {}) }
    }
  }
  if (!layout.name.trim()) throw new Error('Master layout name must not be empty.')
  const indices = new Set<number>()
  const shapes = layout.placeholders.map((slot, order) => {
    if (!Number.isSafeInteger(slot.index) || slot.index < 0 || indices.has(slot.index)) throw new Error(`Invalid or duplicate placeholder index: ${slot.index}`)
    indices.add(slot.index)
    if (![slot.x, slot.y, slot.width, slot.height].every(Number.isSafeInteger) || slot.width <= 0 || slot.height <= 0) throw new Error(`Invalid placeholder geometry: ${slot.index}`)
    if (!['title', 'ctrTitle', 'subTitle', 'body', 'obj', 'pic'].includes(slot.type)) throw new Error(`Unsupported placeholder type: ${slot.type}`)
    const listStyle = nativeListStyleXml(slot.textStyle)
    if (slot.type === 'pic' && slot.textBody) throw new Error('Picture placeholders cannot define a text body.')
    return `<p:sp><p:nvSpPr><p:cNvPr id="${order + 2}" name="${escape(`${layout.name}:${slot.index}`)}"/><p:cNvSpPr/><p:nvPr><p:ph type="${slot.type}" idx="${slot.index}"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${slot.x}" y="${slot.y}"/><a:ext cx="${slot.width}" cy="${slot.height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody>${nativeTextBodyXml(slot.textBody)}${listStyle}<a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`
  }).join('')
  const fixedNames = new Set<string>()
  const fixed = (layout.fixedObjects ?? []).map((object, index) => {
    if (!object.name.trim() || fixedNames.has(object.name.trim())) throw new Error('Invalid or duplicate fixed object name.')
    fixedNames.add(object.name.trim())
    if (![object.x, object.y, object.width, object.height].every(Number.isSafeInteger) || object.width <= 0 || object.height <= 0) throw new Error('Invalid fixed object geometry.')
    for (const color of [object.fill, object.color]) if (color !== undefined && !/^[0-9a-fA-F]{6}$/.test(color)) throw new Error('Invalid fixed object color.')
    if (object.fontSize !== undefined && (!Number.isFinite(object.fontSize) || object.fontSize < 1 || object.fontSize > 4000)) throw new Error('Invalid fixed object font size.')
    if (object.fontFamily !== undefined && !object.fontFamily.trim()) throw new Error('Invalid fixed object font family.')
    if (object.direction !== undefined && !['ltr', 'rtl'].includes(object.direction)) throw new Error('Invalid fixed object direction.')
    validateTextLanguages(object)
    validateTextDecorations(object)
    validateTextLetterSpacing(object)
    validateTextBaseline(object)
    validateTextKerning(object)
    validateTextCapitalization(object)
    const languages = `${object.language === undefined ? '' : ` lang="${escape(object.language)}"`}${object.alternativeLanguage === undefined ? '' : ` altLang="${escape(object.alternativeLanguage)}"`}`
    const fill = object.fill ? `<a:solidFill><a:srgbClr val="${object.fill.toUpperCase()}"/></a:solidFill>` : '<a:noFill/>'
    const font = object.fontFamily ? `<a:latin typeface="${escape(object.fontFamily)}"/><a:ea typeface="${escape(object.fontFamily)}"/><a:cs typeface="${escape(object.fontFamily)}"/>` : ''
    const textColor = object.color ? `<a:solidFill><a:srgbClr val="${object.color.toUpperCase()}"/></a:solidFill>` : ''
    const text = object.text === undefined ? '' : `<p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" anchor="t"/><a:lstStyle/>${object.text.split(/\r?\n/).map(line => `<a:p><a:pPr algn="l" rtl="${object.direction === 'rtl' ? 1 : 0}"><a:lnSpc><a:spcPct val="120000"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr><a:r><a:rPr${languages}${object.capitalization === undefined ? '' : ` cap="${object.capitalization}"`} b="0" i="0" u="${object.underline ? 'sng' : 'none'}" strike="${object.strike ? 'sngStrike' : 'noStrike'}" kern="${Math.round((object.kerningThreshold ?? 0) * 100)}" spc="${Math.round((object.letterSpacing ?? 0) * 100)}" baseline="${Math.round((object.baselinePercent ?? 0) * 1000)}"${object.fontSize === undefined ? '' : ` sz="${Math.round(object.fontSize * 100)}"`}>${textColor}<a:uLnTx/><a:uFillTx/>${font}</a:rPr><a:t xml:space="preserve">${escape(line)}</a:t></a:r></a:p>`).join('')}</p:txBody>`
    return `<p:sp><p:nvSpPr><p:cNvPr id="${layout.placeholders.length + index + 2}" name="${escape(object.name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${object.x}" y="${object.y}"/><a:ext cx="${object.width}" cy="${object.height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}<a:ln><a:noFill/></a:ln></p:spPr>${text}</p:sp>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="cust" preserve="1"><p:cSld name="${escape(layout.name)}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${fixed}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
}
