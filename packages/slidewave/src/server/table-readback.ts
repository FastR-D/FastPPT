import JSZip from 'jszip'
import { parseXml, PRESENTATION_NS } from './slide-xml.js'
import type {
  HtmlDeckSnapshot,
  HtmlObjectRenderReport,
} from '../snapshot-types.js'

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
type XmlNode = ReturnType<typeof parseXml>
const children = (node: XmlNode, local: string, namespace = DRAWING_NS) =>
  node.children.filter(
    (child) => child.local === local && child.namespace === namespace,
  )
const descendants = (node: XmlNode): XmlNode[] =>
  node.children.flatMap((child) => [child, ...descendants(child)])
const decodeText = (value: string) =>
  value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&apos;': "'",
    }
    return (
      named[entity] ??
      String.fromCodePoint(
        parseInt(
          entity.slice(entity.startsWith('&#x') ? 3 : 2, -1),
          entity.startsWith('&#x') ? 16 : 10,
        ),
      )
    )
  })

/** Reads the final package, using source expectations independent of writer operations. */
export async function validateNativeTableReadback(
  buffer: ArrayBuffer,
  snapshot: HtmlDeckSnapshot,
  reports: HtmlObjectRenderReport[],
): Promise<void> {
  if (
    !snapshot.slides.some((slide) =>
      slide.elements.some((element) => element.kind === 'table'),
    )
  )
    return
  const zip = await JSZip.loadAsync(buffer)
  const presentation = parseXml(
    await zip.file('ppt/presentation.xml')!.async('string'),
  )
  const size = children(presentation, 'sldSz', PRESENTATION_NS)[0]!
  for (const [index, slide] of snapshot.slides.entries()) {
    const tables = slide.elements.filter((element) => element.kind === 'table')
    if (!tables.length) continue
    const xml = await zip
      .file(`ppt/slides/slide${index + 1}.xml`)!
      .async('string')
    const nodes = descendants(parseXml(xml))
    const ids = nodes
      .filter(
        (node) => node.namespace === PRESENTATION_NS && node.local === 'cNvPr',
      )
      .map((node) => node.attributes.id)
    if (new Set(ids).size !== ids.length)
      throw new Error(`Duplicate PPTX object IDs on table slide ${slide.id}.`)
    const sx = Number(size.attributes.cx) / slide.width,
      sy = Number(size.attributes.cy) / slide.height
    const close = (actual: string | undefined, expected: number) =>
      actual !== undefined && Math.abs(Number(actual) - expected) <= 10
    for (const table of tables) {
      const fail = (detail: string): never => {
        throw new Error(
          `Native table readback ${slide.id}/${table.id}: ${detail}`,
        )
      }
      const report = reports.find(
        (value) => value.slideId === slide.id && value.elementId === table.id,
      )
      if (!report?.pptxObjectName) fail('missing object mapping')
      const frames = nodes.filter(
        (node) =>
          node.namespace === PRESENTATION_NS &&
          node.local === 'graphicFrame' &&
          descendants(node).some(
            (child) =>
              child.namespace === PRESENTATION_NS &&
              child.local === 'cNvPr' &&
              child.attributes.name === report!.pptxObjectName,
          ),
      )
      if (frames.length !== 1) fail('expected one graphicFrame')
      const frame = frames[0]!,
        frameNodes = descendants(frame)
      const grid = frameNodes.filter(
        (node) => node.namespace === DRAWING_NS && node.local === 'tbl',
      )
      if (grid.length !== 1) fail('missing a:tbl')
      const transform = children(frame, 'xfrm', PRESENTATION_NS)[0]
      const off = transform && children(transform, 'off')[0],
        ext = transform && children(transform, 'ext')[0]
      if (
        !close(off?.attributes.x, table.box.x * sx) ||
        !close(off?.attributes.y, table.box.y * sy) ||
        !close(ext?.attributes.cx, table.box.width * sx) ||
        !close(ext?.attributes.cy, table.box.height * sy)
      )
        fail(
          `table frame differs from source geometry: ${JSON.stringify({ off: off?.attributes, ext: ext?.attributes, source: table.box, sx, sy })}`,
        )
      const columns = children(children(grid[0]!, 'tblGrid')[0]!, 'gridCol')
      const rows = children(grid[0]!, 'tr')
      if (
        columns.length !== table.columnWidthsPx.length ||
        rows.length !== table.rowHeightsPx.length
      )
        fail('row or column count mismatch')
      for (const [i, column] of columns.entries())
        if (!close(column.attributes.w, table.columnWidthsPx[i]! * sx))
          fail('column width mismatch')
      for (const [i, row] of rows.entries()) {
        if (!close(row.attributes.h, table.rowHeightsPx[i]! * sy))
          fail('row height mismatch')
        if (children(row, 'tc').length !== columns.length)
          fail('incomplete cell grid')
      }
      for (const cell of table.cells) {
        const native = children(rows[cell.row]!, 'tc')[cell.column]!
        const body = children(native, 'txBody')[0]
        if (
          !body ||
          native.attributes.gridSpan ||
          native.attributes.rowSpan ||
          native.attributes.hMerge ||
          native.attributes.vMerge
        )
          fail(`invalid cell structure ${cell.id}`)
        const paragraphs = children(body!, 'p')
        const text = paragraphs
          .map((paragraph) =>
            descendants(paragraph)
              .filter(
                (node) =>
                  node.namespace === DRAWING_NS &&
                  (node.local === 't' || node.local === 'br'),
              )
              .map((node) =>
                node.local === 'br'
                  ? '\n'
                  : decodeText(xml.slice(node.openEnd, node.closeStart)),
              )
              .join(''),
          )
          .join('\n')
        if (text !== cell.text)
          fail(`cell text mismatch ${cell.id}: ${JSON.stringify(text)}`)
        const properties = children(native, 'tcPr')[0]!
        const pointScale = Math.sqrt(sx * sy) / 12700
        const insetScale = Math.sqrt(sx * sy)
        for (const [attribute, expected] of Object.entries({
          marL: cell.insetsPx.left,
          marR: cell.insetsPx.right,
          marT: cell.insetsPx.top,
          marB: cell.insetsPx.bottom,
        }))
          if (!close(properties.attributes[attribute], expected * insetScale))
            fail(`cell inset mismatch ${cell.id}/${attribute}`)
        const anchor = { top: 't', middle: 'ctr', bottom: 'b' }[
          cell.verticalAlign
        ]
        if (properties.attributes.anchor !== anchor)
          fail(`cell vertical alignment mismatch ${cell.id}`)
        const fill = children(properties, 'solidFill')[0]
        if (
          cell.fill &&
          (!fill ||
            children(fill, 'srgbClr')[0]?.attributes.val?.toUpperCase() !==
              cell.fill.hex.toUpperCase())
        )
          fail(`cell fill mismatch ${cell.id}`)
        for (const [i, side] of ['lnT', 'lnR', 'lnB', 'lnL'].entries()) {
          const border = children(properties, side)[0],
            expected = cell.borders[i]!
          if (!border) fail(`missing cell border ${cell.id}/${side}`)
          if (
            expected.widthPx > 0 &&
            expected.color.alpha > 0 &&
            !close(border!.attributes.w, expected.widthPx * insetScale)
          )
            fail(`cell border width mismatch ${cell.id}/${side}`)
        }
        // Match source run ranges independently of the writer's font/newline splitting.
        const expectedRuns = cell.runs
          .map((run) => ({ ...run, text: run.text.replace(/\n/g, '') }))
          .filter((run) => run.text.length)
        let runIndex = 0,
          runOffset = 0
        for (const run of descendants(body!).filter(
          (node) => node.namespace === DRAWING_NS && node.local === 'r',
        )) {
          const value = children(run, 't')[0],
            formatting = children(run, 'rPr')[0]
          if (!value || !formatting) continue
          let remaining = decodeText(
            xml.slice(value.openEnd, value.closeStart),
          ).length
          while (remaining > 0) {
            const expected = expectedRuns[runIndex]
            if (!expected) fail(`extra rich run ${cell.id}`)
            const flags = formatting.attributes
            if (
              flags.b !== (expected!.style.fontWeight >= 600 ? '1' : '0') ||
              flags.i !==
                (expected!.style.fontStyle === 'italic' ? '1' : '0') ||
              flags.u !==
                (expected!.style.decoration.includes('underline')
                  ? 'sng'
                  : 'none') ||
              flags.strike !==
                (expected!.style.decoration.includes('line-through')
                  ? 'sngStrike'
                  : 'noStrike')
            )
              fail(`rich run style mismatch ${cell.id}`)
            if (
              Math.abs(
                Number(flags.sz) -
                  Math.round(expected!.style.fontSizePx * pointScale * 100),
              ) > 1
            )
              fail(`rich run font size mismatch ${cell.id}`)
            const consumed = Math.min(
              remaining,
              expected!.text.length - runOffset,
            )
            remaining -= consumed
            runOffset += consumed
            if (runOffset === expected!.text.length) {
              runIndex++
              runOffset = 0
            }
          }
        }
      }
      report!.verification = {
        structure: 'passed',
        visual: 'unverified',
        application: 'unverified',
      }
    }
  }
}
