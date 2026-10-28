import { parseXml, PRESENTATION_NS } from './slide-xml.js'
import type { NativeMasterLayout } from './master-layout.js'
import { resolveNativeTextStyle } from './native-text-style.js'
import { validateNativeTextBody } from './native-text-body.js'

/** Bind one top-level native object while retaining its captured content and geometry. */
export function bindSlidePlaceholder(xml: string, shapeId: string, slot: NativeMasterLayout['placeholders'][number], geometry: 'page' | 'layout' = 'page', textStyle: 'page' | 'layout' = 'page', textBody: 'page' | 'layout' = 'page'): string {
  if (!['page', 'layout'].includes(geometry)) throw new Error('Invalid placeholder geometry policy')
  if (!['page', 'layout'].includes(textStyle)) throw new Error('Invalid placeholder text style policy')
  if (!['page', 'layout'].includes(textBody)) throw new Error('Invalid placeholder text body policy')
  if (textStyle === 'layout' && !slot.textStyle) throw new Error('Layout placeholder has no text defaults')
  if (textBody === 'layout' && (!slot.textBody || slot.type === 'pic')) throw new Error('Layout placeholder has no text body defaults')
  const root = parseXml(xml)
  const tree = root.children.find(node => node.namespace === PRESENTATION_NS && node.local === 'cSld')
    ?.children.find(node => node.namespace === PRESENTATION_NS && node.local === 'spTree')
  const shapes = tree?.children.filter(node => {
    if (node.namespace !== PRESENTATION_NS || !['sp', 'pic'].includes(node.local)) return false
    return node.children.some(child => child.children.some(property => property.namespace === PRESENTATION_NS && property.local === 'cNvPr' && property.attributes.id === shapeId))
  }) ?? []
  if (shapes.length !== 1) throw new Error(`Placeholder binding requires one top-level native shape: ${shapeId}`)
  const shape = shapes[0]!
  if ((slot.type === 'pic') !== (shape.local === 'pic')) throw new Error(`Placeholder type does not match shape: ${shapeId}`)
  const properties = shape.children.find(node => node.namespace === PRESENTATION_NS && ['nvSpPr', 'nvPicPr'].includes(node.local))
  const application = properties?.children.find(node => node.namespace === PRESENTATION_NS && node.local === 'nvPr')
  if (!application) throw new Error(`Missing non-visual properties: ${shapeId}`)
  if (application.children.some(node => node.namespace === PRESENTATION_NS && node.local === 'ph')) throw new Error(`Shape already bound to a placeholder: ${shapeId}`)
  const placeholder = `<ph xmlns="${PRESENTATION_NS}" type="${slot.type}" idx="${slot.index}"/>`
  const original = xml.slice(application.start, application.end)
  const replacement = original.endsWith('/>')
    ? original.slice(0, -2) + `>${placeholder}</${application.name}>`
    : xml.slice(application.start, application.openEnd) + placeholder + xml.slice(application.openEnd, application.end)
  const edits = [{ start: application.start, end: application.end, content: replacement }]
  if (geometry === 'layout') {
    const shapeProperties = shape.children.find(node => node.namespace === PRESENTATION_NS && node.local === 'spPr')
    for (const transform of shapeProperties?.children.filter(node => node.namespace === 'http://schemas.openxmlformats.org/drawingml/2006/main' && node.local === 'xfrm') ?? [])
      edits.push({ start: transform.start, end: transform.end, content: '' })
  }
  if (textBody === 'layout') {
    const contract = slot.textBody!
    validateNativeTextBody(contract)
    const body = shape.children.find(node => node.namespace === PRESENTATION_NS && node.local === 'txBody')
    if (!body) throw new Error('Text body inheritance requires a text shape')
    const properties = body.children.filter(node => node.namespace === 'http://schemas.openxmlformats.org/drawingml/2006/main' && node.local === 'bodyPr')
    if (properties.length !== 1) throw new Error('Text body inheritance requires one bodyPr')
    const property = properties[0]!
    let opening = xml.slice(property.start, property.openEnd)
    for (const [attribute, enabled] of [
      ['lIns', contract.insets?.left !== undefined], ['rIns', contract.insets?.right !== undefined],
      ['tIns', contract.insets?.top !== undefined], ['bIns', contract.insets?.bottom !== undefined],
      ['anchor', contract.verticalAlign !== undefined], ['wrap', contract.wrap !== undefined],
    ] as const)
      if (enabled) opening = opening.replace(new RegExp(`\\s+${attribute}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'g'), '')
    edits.push({ start: property.start, end: property.openEnd, content: opening })
    if (contract.autoFit !== undefined) for (const child of property.children.filter(node => node.namespace === property.namespace && ['noAutofit', 'normAutofit', 'spAutoFit'].includes(node.local))) edits.push({ start: child.start, end: child.end, content: '' })
  }
  if (textStyle === 'layout') {
    const contract = slot.textStyle!
    const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/main'
    const visit = (node: ReturnType<typeof parseXml>, level = 1): void => {
      if (node.namespace === drawingNs && node.local === 'p') {
        const properties = node.children.find(child => child.namespace === drawingNs && child.local === 'pPr')
        level = Number(properties?.attributes.lvl ?? 0) + 1
      } else if (node.namespace === drawingNs && /^lvl[1-9]pPr$/.test(node.local)) level = Number(node.local[3])
      const defaults = resolveNativeTextStyle(contract, level)
      const removed = new Set<ReturnType<typeof parseXml>>()
      if (node.namespace === drawingNs && ['pPr', 'defPPr', `lvl${level}pPr`].includes(node.local)) {
        if (node.local === 'defPPr' && contract.levels?.length && (node.children.length || Object.keys(node.attributes).length))
          throw new Error('Shared page paragraph defaults cannot be partially inherited through distinct layout levels.')
        const paragraph = defaults.paragraph
        if (paragraph) {
          let opening = xml.slice(node.start, node.openEnd)
          for (const [attribute, property] of [['algn', 'align'], ['marL', 'marginLeft'], ['marR', 'marginRight'], ['indent', 'indent'], ['defTabSz', 'defaultTabSize'], ['rtl', 'direction']] as const)
            if (paragraph[property] !== undefined) opening = opening.replace(new RegExp(`\\s+${attribute}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'g'), '')
          edits.push({ start: node.start, end: node.openEnd, content: opening })
          for (const [tag, property] of [['lnSpc', 'lineSpacing'], ['spcBef', 'spaceBefore'], ['spcAft', 'spaceAfter'], ['tabLst', 'tabStops']] as const)
            if (paragraph[property] !== undefined) for (const child of node.children.filter(child => child.namespace === drawingNs && child.local === tag)) {
              edits.push({ start: child.start, end: child.end, content: '' })
              removed.add(child)
            }
          for (const [property, choices] of [
            ['bullet', ['buNone', 'buChar', 'buAutoNum', 'buBlip']],
            ['bulletFont', ['buFont', 'buFontTx']],
            ['bulletSize', ['buSzPts', 'buSzPct', 'buSzTx']],
            ['bulletColor', ['buClr', 'buClrTx']],
          ] as const) if (paragraph[property] !== undefined) {
            for (const child of node.children.filter(child => child.namespace === drawingNs && choices.some(tag => tag === child.local))) {
              edits.push({ start: child.start, end: child.end, content: '' })
              removed.add(child)
            }
          }
        }
      }
      if (node.namespace === drawingNs && ['rPr', 'defRPr', 'endParaRPr'].includes(node.local)) {
        let opening = xml.slice(node.start, node.openEnd)
        for (const [attribute, enabled] of [['cap', defaults.capitalization !== undefined], ['kern', defaults.kerningThreshold !== undefined], ['baseline', defaults.baselinePercent !== undefined], ['spc', defaults.letterSpacing !== undefined], ['sz', defaults.fontSize !== undefined], ['b', defaults.bold !== undefined], ['i', defaults.italic !== undefined], ['u', defaults.underline !== undefined], ['strike', defaults.strike !== undefined], ['lang', defaults.language !== undefined], ['altLang', defaults.alternativeLanguage !== undefined]] as const) {
          if (enabled) opening = opening.replace(new RegExp(`\\s+${attribute}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'g'), '')
        }
        edits.push({ start: node.start, end: node.openEnd, content: opening })
        for (const child of node.children) {
          if (child.namespace !== drawingNs) continue
          const inheritFont = (['latin', 'ea', 'cs'] as const).some(script => child.local === script && (defaults.fontFamily !== undefined || defaults.fontFamilies?.[script] !== undefined))
          const inheritColor = defaults.color !== undefined && ['solidFill', 'gradFill', 'noFill', 'pattFill', 'blipFill', 'grpFill'].includes(child.local)
          const inheritUnderline = defaults.underline !== undefined && ['uFill', 'uFillTx', 'uLn', 'uLnTx'].includes(child.local)
          if (inheritFont || inheritColor || inheritUnderline) edits.push({ start: child.start, end: child.end, content: '' })
        }
        return
      }
      for (const child of node.children) if (!removed.has(child)) visit(child, level)
    }
    const textBody = shape.children.find(node => node.namespace === PRESENTATION_NS && node.local === 'txBody')
    if (!textBody) throw new Error('Text style inheritance requires a text shape')
    visit(textBody)
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    xml = xml.slice(0, edit.start) + edit.content + xml.slice(edit.end)
  return xml
}
