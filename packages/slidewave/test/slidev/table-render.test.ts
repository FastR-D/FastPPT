import { describe, expect, it } from 'vitest'

import { htmlDeckToPresentation } from '../../src/slidev/render'
import {
  HTML_SNAPSHOT_VERSION,
  type HtmlDeckSnapshot,
  type HtmlElementSource,
  type HtmlShapeElement,
  type HtmlTextElement,
} from '../../src/snapshot-types'

const source = (path: string, tag = 'div'): HtmlElementSource => ({
  tag,
  path,
})

/** Builds a deck whose only slide contains an academic table as the Landing
 * capture would snapshot it after the theme table styles apply: blue header
 * row and first column (white bold text) over black body text. */
function academicTableDeck(): HtmlDeckSnapshot {
  const cells: HtmlShapeElement[] = []
  const text: HtmlTextElement[] = []
  let order = 0

  type BuildableShape = Omit<HtmlShapeElement, 'order'>
  type BuildableText = Omit<HtmlTextElement, 'order'>

  const push = (element: BuildableShape | BuildableText) => {
    if (element.kind === 'shape')
      cells.push({ ...element, order: order++ })
    else text.push({ ...element, order: order++ })
  }

  const headerBoxes = [
    { x: 35, y: 100, width: 455, height: 28 },
    { x: 490, y: 100, width: 455, height: 28 },
  ]
  const rowBoxes = [
    { x: 35, y: 128, width: 455, height: 28 },
    { x: 490, y: 128, width: 455, height: 28 },
    { x: 35, y: 156, width: 455, height: 28 },
    { x: 490, y: 156, width: 455, height: 28 },
  ]

  const textElement = (
    id: string,
    text: string,
    box: { x: number; y: number; width: number; height: number },
    color: string,
    bold: boolean,
    path: string,
  ): BuildableText => ({
    id,
    kind: 'text',
    text,
    box,
    zIndex: 2,
    opacity: 1,
    source: source(path, 'span'),
    style: {
      fontFamily: 'Source Han Sans',
      fontSizePx: 14,
      fontWeight: bold ? 700 : 400,
      fontStyle: 'normal',
      lineHeightPx: 20,
      letterSpacingPx: 0,
      color: { hex: color, alpha: 1 },
      align: 'left',
      decoration: [],
      direction: 'ltr',
      language: 'en',
    },
  })

  const blueCell = (
    id: string,
    box: { x: number; y: number; width: number; height: number },
    path: string,
  ): BuildableShape => ({
    id,
    kind: 'shape',
    shape: 'rect',
    box,
    zIndex: 1,
    opacity: 1,
    source: source(path),
    fill: { hex: '3B99D4', alpha: 1 },
  })

  // Root white background.
  push({
    id: 'root:background-0',
    kind: 'shape',
    shape: 'rect',
    box: { x: 0, y: 0, width: 980, height: 552 },
    zIndex: 0,
    opacity: 1,
    source: source('root'),
    fill: { hex: 'FFFFFF', alpha: 1 },
  })

  // Header row: blue cells with white bold text.
  push(blueCell('th-1-bg', headerBoxes[0]!, 'root/main/table/thead/th-1'))
  push(
    textElement(
      'th-1-text',
      'Metric',
      headerBoxes[0]!,
      'FFFFFF',
      true,
      'root/main/table/thead/th-1',
    ),
  )
  push(blueCell('th-2-bg', headerBoxes[1]!, 'root/main/table/thead/th-2'))
  push(
    textElement(
      'th-2-text',
      'Value',
      headerBoxes[1]!,
      'FFFFFF',
      true,
      'root/main/table/thead/th-2',
    ),
  )

  // Body rows: first column keeps the blue header style, other cells stay black.
  const rows: Array<[string, string, string]> = [
    ['A', '1.00', 'row-1'],
    ['B', '2.50', 'row-2'],
  ]
  rows.forEach(([label, value, rowId], rowIndex) => {
    const labelBox = rowBoxes[rowIndex * 2]!
    const valueBox = rowBoxes[rowIndex * 2 + 1]!
    push(
      blueCell(`${rowId}-label-bg`, labelBox, `root/main/table/tbody/${rowId}/td-1`),
    )
    push(
      textElement(
        `${rowId}-label-text`,
        label,
        labelBox,
        'FFFFFF',
        true,
        `root/main/table/tbody/${rowId}/td-1`,
      ),
    )
    push(
      textElement(
        `${rowId}-value-text`,
        value,
        valueBox,
        '000000',
        false,
        `root/main/table/tbody/${rowId}/td-2`,
      ),
    )
  })

  return {
    version: HTML_SNAPSHOT_VERSION,
    source: 'slidev',
    warnings: [],
    slides: [
      {
        version: HTML_SNAPSHOT_VERSION,
        id: '1',
        width: 980,
        height: 552,
        warnings: [],
        elements: [...cells, ...text].sort(
          (left, right) => left.zIndex - right.zIndex || left.order - right.order,
        ),
      },
    ],
  }
}

describe('editable Slidev table rendering', () => {
  it('maps the Landing academic table format to blue header shapes, white bold text, and black body text', async () => {
    const result = htmlDeckToPresentation(academicTableDeck())
    await result.presentation.flush()

    const operations = result.presentation['_slides'][0]._ops
    const blueFills = operations.filter(
      (operation) =>
        operation.kind === 'shape' &&
        (operation.opts as { fill?: { color?: string } })?.fill?.color ===
          '3B99D4',
    )
    const headerText = operations.filter(
      (operation) =>
        operation.kind === 'text' &&
        (operation.text === 'Metric' || operation.text === 'Value'),
    )
    const labelText = operations.filter(
      (operation) =>
        operation.kind === 'text' &&
        (operation.text === 'A' || operation.text === 'B'),
    )
    const valueText = operations.filter(
      (operation) =>
        operation.kind === 'text' &&
        (operation.text === '1.00' || operation.text === '2.50'),
    )

    expect(blueFills).toHaveLength(4)
    expect(headerText).toHaveLength(2)
    expect(labelText).toHaveLength(2)
    expect(valueText).toHaveLength(2)
    expect(result.warnings).toEqual([])
    expect(result.elementCount).toBe(11)

    for (const text of headerText) {
      if (text.kind !== 'text') continue
      expect(text.opts.color).toBe('FFFFFF')
      expect(text.opts.bold).toBe(true)
    }
    for (const text of labelText) {
      if (text.kind !== 'text') continue
      expect(text.opts.color).toBe('FFFFFF')
      expect(text.opts.bold).toBe(true)
    }
    for (const text of valueText) {
      if (text.kind !== 'text') continue
      expect(text.opts.color).toBe('000000')
      expect(text.opts.bold).toBe(false)
    }
  })
})
