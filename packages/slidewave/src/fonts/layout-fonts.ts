import { autoNumberGlyphs } from '../primitives/text-numbering.mjs'
import { parseXml, PRESENTATION_NS } from '../server/slide-xml.js'
import { fontScript } from './font-script.js'
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
type Node = ReturnType<typeof parseXml>
const child = (node: Node | undefined, local: string, namespace = DRAWING_NS) => node?.children.find(item => item.local === local && item.namespace === namespace)
const descendants = (node: Node, local: string, namespace: string): Node[] => [
  ...(node.local === local && node.namespace === namespace ? [node] : []),
  ...node.children.flatMap(item => descendants(item, local, namespace)),
]
const escape = (text: string) => text.replace(/[&<>"]/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[value]!)

/** Produce collection-only runs; never flatten inheritance in the saved package. */
export function layoutFontRuns(slideXml: string, layoutXml?: string, masterXml?: string): string {
  const slide = parseXml(slideXml)
  const layouts = layoutXml ? descendants(parseXml(layoutXml), 'sp', PRESENTATION_NS) : []
  const master = masterXml ? parseXml(masterXml) : undefined
  const masterShapes = master ? descendants(master, 'sp', PRESENTATION_NS) : []
  const output: string[] = []
  for (const shape of descendants(slide, 'sp', PRESENTATION_NS)) {
    const placeholder = descendants(shape, 'ph', PRESENTATION_NS)[0]
    const layout = placeholder ? layouts.find(candidate => {
      const slot = descendants(candidate, 'ph', PRESENTATION_NS)[0]
      return slot && (slot.attributes.idx ?? '0') === (placeholder.attributes.idx ?? '0')
    }) : undefined
    const layoutPlaceholder = layout ? descendants(layout, 'ph', PRESENTATION_NS)[0] : placeholder
    const placeholderType = layoutPlaceholder?.attributes.type ?? 'obj'
    const masterShape = layoutPlaceholder ? masterShapes.find(candidate => {
      const slot = descendants(candidate, 'ph', PRESENTATION_NS)[0]
      return slot && (slot.attributes.type ?? 'obj') === placeholderType
    }) : undefined
    const masterBody = child(masterShape, 'txBody', PRESENTATION_NS)
    const styleKind = ['title', 'ctrTitle'].includes(placeholderType) ? 'titleStyle' : placeholderType === 'body' ? 'bodyStyle' : 'otherStyle'
    const masterStyle = child(child(master, 'txStyles', PRESENTATION_NS), styleKind, PRESENTATION_NS)
    const body = child(shape, 'txBody', PRESENTATION_NS)
    const layoutBody = child(layout, 'txBody', PRESENTATION_NS)
    for (const paragraph of body?.children.filter(item => item.namespace === DRAWING_NS && item.local === 'p') ?? []) {
      const paragraphProperties = child(paragraph, 'pPr')
      const level = Number(paragraphProperties?.attributes.lvl ?? 0) + 1
      const paragraphDefaults = [masterStyle, child(masterBody, 'lstStyle'), child(layoutBody, 'lstStyle'), child(body, 'lstStyle')]
        .flatMap(style => [child(style, 'defPPr'), child(style, `lvl${level}pPr`)])
      paragraphDefaults.push(paragraphProperties)
      const defaults = paragraphDefaults.map(properties => child(properties, 'defRPr'))
      let bullet: Node | undefined, bulletFont: Node | undefined
      for (const properties of paragraphDefaults) {
        const choice = properties?.children.find(item => item.namespace === DRAWING_NS && ['buNone', 'buChar', 'buAutoNum', 'buBlip'].includes(item.local))
        if (choice) bullet = choice
        const font = properties?.children.find(item => item.namespace === DRAWING_NS && ['buFont', 'buFontTx'].includes(item.local))
        if (font) bulletFont = font
      }
      let collectedBullet = false
      for (const run of paragraph.children.filter(item => item.namespace === DRAWING_NS && ['r', 'fld'].includes(item.local))) {
        const values: Record<string, string> = {}
        for (const properties of [...defaults, child(run, 'rPr')]) {
          if (!properties) continue
          for (const attribute of ['b', 'i', 'cap']) if (properties.attributes[attribute] !== undefined) values[attribute] = properties.attributes[attribute]!
          for (const script of ['latin', 'ea', 'cs']) {
            const face = child(properties, script)?.attributes.typeface
            if (face !== undefined) values[script] = face
          }
        }
        const text = child(run, 't')
        if (!text) continue
        const content = slideXml.slice(text.openEnd, text.closeStart)
        // Reuse the XML attribute decoder so numeric entities route to the
        // actual first script, including CJK references and escaped ampersands.
        const decoded = parseXml(`<text value="${content.replace(/"/g, '&quot;')}"/>`).attributes.value ?? ''
        if (!collectedBullet && decoded.trim()) {
          collectedBullet = true
          const family = bulletFont?.local === 'buFont' ? bulletFont.attributes.typeface : values[fontScript([...decoded.trim()][0]!)] ?? values.latin
          const glyphs = bullet?.local === 'buChar' ? bullet.attributes.char : bullet?.local === 'buAutoNum' ? autoNumberGlyphs(bullet.attributes.type ?? '') : undefined
          if (glyphs && family) output.push(`<a:r><a:rPr b="${values.b === '1' || values.b === 'true' ? 1 : 0}" i="${values.i === '1' || values.i === 'true' ? 1 : 0}"><a:latin typeface="${escape(family)}"/><a:ea typeface="${escape(family)}"/><a:cs typeface="${escape(family)}"/></a:rPr><a:t>${escape(glyphs)}</a:t></a:r>`)
        }
        output.push(`<a:r><a:rPr${values.cap === undefined ? '' : ` cap="${escape(values.cap)}"`} b="${values.b === '1' || values.b === 'true' ? 1 : 0}" i="${values.i === '1' || values.i === 'true' ? 1 : 0}">${['latin', 'ea', 'cs'].filter(script => values[script]).map(script => `<a:${script} typeface="${escape(values[script]!)}"/>`).join('')}</a:rPr><a:t>${slideXml.slice(text.openEnd, text.closeStart)}</a:t></a:r>`)
      }
    }
  }
  return output.join('')
}
