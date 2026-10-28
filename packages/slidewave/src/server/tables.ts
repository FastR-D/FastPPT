import { parseXml, PRESENTATION_NS } from './slide-xml.js'

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
type XmlNode = ReturnType<typeof parseXml>

/** Correct writer-specific IDs and legacy cell-margin units before any bindings. */
export function finalizeNativeTables(
  xml: string,
  tables: Array<{
    name: string
    headerRows: number
    runStyles: Record<string, Record<string, unknown>>
    insets: Array<{ row: number; column: number; values: number[] }>
  }>,
): string {
  if (!tables.length) return xml
  const root = parseXml(xml)
  const all: XmlNode[] = []
  const visit = (node: XmlNode) => {
    all.push(node)
    node.children.forEach(visit)
  }
  visit(root)
  let nextId =
    Math.max(
      0,
      ...all
        .filter(
          (node) =>
            node.namespace === PRESENTATION_NS && node.local === 'cNvPr',
        )
        .map((node) => Number(node.attributes.id)),
    ) + 1
  const edits: Array<{ start: number; end: number; text: string }> = []
  for (const record of tables) {
    const frames = all.filter(
      (node) =>
        node.namespace === PRESENTATION_NS &&
        node.local === 'graphicFrame' &&
        node.children.some(
          (child) =>
            child.local === 'nvGraphicFramePr' &&
            child.children.some(
              (value) =>
                value.local === 'cNvPr' &&
                value.attributes.name === record.name,
            ),
        ),
    )
    if (frames.length !== 1)
      throw new Error(`Expected one native table frame: ${record.name}`)
    const frame = frames[0]!
    const nodes = all.filter(
      (node) => node.start > frame.start && node.end < frame.end,
    )
    const identity = nodes.find(
      (node) => node.namespace === PRESENTATION_NS && node.local === 'cNvPr',
    )!
    edits.push({
      start: identity.start,
      end: identity.openEnd,
      text: xml
        .slice(identity.start, identity.openEnd)
        .replace(/\bid="\d+"/, `id="${nextId++}"`),
    })
    const properties = nodes.find(
      (node) => node.namespace === DRAWING_NS && node.local === 'tblPr',
    )!
    if (record.headerRows)
      edits.push({
        start: properties.start,
        end: properties.openEnd,
        text: xml
          .slice(properties.start, properties.openEnd)
          .replace(/\/?>(?=$)/, (end) => ` firstRow="1"${end}`),
      })
    for (const run of nodes.filter(
      (node) => node.namespace === DRAWING_NS && node.local === 'r',
    )) {
      const properties = run.children.find(
        (node) => node.namespace === DRAWING_NS && node.local === 'rPr',
      )
      const text = run.children.find(
        (node) => node.namespace === DRAWING_NS && node.local === 't',
      )
      if (!properties || !text) continue
      const style = record.runStyles[properties.attributes.lang ?? '']
      let formatted = xml.slice(properties.start, properties.end)
      if (style) {
        formatted = formatted
          .replace(/\s(?:b|i|u|strike)="[^"]*"/g, '')
          .replace(
            /(\/?>)/,
            ` b="${style.bold ? 1 : 0}" i="${style.italic ? 1 : 0}" u="${style.underline ? 'sng' : 'none'}" strike="${style.strike ? 'sngStrike' : 'noStrike'}"$1`,
          )
      }
      // The library can put CRLF directly into a:t when a standalone BR run ends in a newline.
      // Authored line breaks are explicit DrawingML breaks, never literal control characters.
      const fragments = xml
        .slice(text.openEnd, text.closeStart)
        .split(/\r\n|\r|\n/)
      const body = fragments
        .map((value) => `<a:r>${formatted}<a:t>${value}</a:t></a:r>`)
        .join(`<a:br>${formatted}</a:br>`)
      edits.push({ start: run.start, end: run.end, text: body })
    }
    const rows = nodes.filter(
      (node) => node.namespace === DRAWING_NS && node.local === 'tr',
    )
    for (const inset of record.insets) {
      const cell = rows[inset.row]?.children.filter(
        (node) => node.namespace === DRAWING_NS && node.local === 'tc',
      )[inset.column]
      const properties = cell?.children.find(
        (node) => node.namespace === DRAWING_NS && node.local === 'tcPr',
      )
      if (!properties)
        throw new Error(
          `Missing native table cell: ${record.name}/${inset.row}/${inset.column}`,
        )
      const opening = xml
        .slice(properties.start, properties.openEnd)
        .replace(/\smar[LRTB]="[^"]*"/g, '')
      edits.push({
        start: properties.start,
        end: properties.openEnd,
        text: opening.replace(
          /\/?>(?=$)/,
          (end) =>
            ` marL="${inset.values[0]}" marR="${inset.values[1]}" marT="${inset.values[2]}" marB="${inset.values[3]}"${end}`,
        ),
      })
    }
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    xml = xml.slice(0, edit.start) + edit.text + xml.slice(edit.end)
  return xml
}
