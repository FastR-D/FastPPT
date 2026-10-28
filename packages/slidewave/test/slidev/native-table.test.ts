import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { HtmlDeckSnapshotSchema } from '../../src/snapshot.js'
import type {
  HtmlDeckSnapshot,
  HtmlTableElement,
  HtmlTextStyle,
} from '../../src/snapshot-types.js'
import { htmlDeckToPresentation } from '../../src/slidev/render.js'
import {
  writeEditablePptx,
  EditablePptxPolicyError,
} from '../../src/server/index.js'
import { validateNativeTableReadback } from '../../src/server/table-readback.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})
const style: HtmlTextStyle = {
  fontFamily: 'Arial',
  fontSizePx: 16,
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeightPx: 20,
  letterSpacingPx: 0,
  color: { hex: '000000', alpha: 1 },
  align: 'left',
  decoration: [],
  direction: 'ltr',
  language: 'zh-CN',
}
function deck(): HtmlDeckSnapshot {
  const table: HtmlTableElement = {
    id: 'metrics',
    kind: 'table',
    source: { tag: 'table', path: 'root/table', anchor: 'metrics' },
    box: { x: 40, y: 60, width: 800, height: 160 },
    zIndex: 0,
    opacity: 1,
    order: 1,
    columnWidthsPx: [300, 500],
    rowHeightsPx: [60, 100],
    cells: ['指标', 'Value', '', 'A & B\nNext'].map((text, index) => ({
      id: `cell-${index}`,
      row: Math.floor(index / 2),
      column: index % 2,
      header: index < 2,
      text,
      style,
      runs: text
        ? [
            {
              text,
              style: { ...style, fontWeight: index < 2 ? 700 : 400 },
              ...(index === 3 ? { hyperlink: 'https://example.com/data' } : {}),
            },
          ]
        : [],
      fill: { hex: index < 2 ? '3B99D4' : 'FFFFFF', alpha: 1 },
      borders: Array.from({ length: 4 }, () => ({
        widthPx: 1,
        color: { hex: '808080', alpha: 1 },
      })),
      insetsPx: { left: 4, right: 6, top: 2, bottom: 3 },
      verticalAlign: 'middle',
    })),
  }
  return {
    version: 2,
    source: 'slidev',
    warnings: [],
    slides: [
      {
        version: 2,
        id: '1',
        width: 980,
        height: 552,
        warnings: [],
        elements: [
          {
            kind: 'shape',
            id: 'panel',
            source: { tag: 'div', path: 'root/panel' },
            order: 0,
            zIndex: 0,
            opacity: 1,
            box: { x: 10, y: 10, width: 5, height: 5 },
            shape: 'rect',
          },
          table,
        ],
      },
    ],
  }
}
async function output() {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-table-'))
  directories.push(directory)
  return join(directory, 'table.pptx')
}

const tableOf = (snapshot: HtmlDeckSnapshot) =>
  snapshot.slides[0]!.elements.find((element) => element.kind === 'table')!
describe('native structured table export', () => {
  it('accepts V1 unchanged and rejects unknown, mixed and disguised V1 tables', () => {
    const snapshot = deck()
    expect(HtmlDeckSnapshotSchema.parse(snapshot).version).toBe(2)
    snapshot.version = 1
    expect(() => HtmlDeckSnapshotSchema.parse(snapshot)).toThrow()
    snapshot.slides[0]!.version = 1
    expect(() => HtmlDeckSnapshotSchema.parse(snapshot)).toThrow(/V2/)
    snapshot.slides[0]!.elements = []
    expect(HtmlDeckSnapshotSchema.parse(snapshot).version).toBe(1)
    expect(
      HtmlDeckSnapshotSchema.safeParse({ ...snapshot, version: 3 }).success,
    ).toBe(false)
  })
  it.each([
    'duplicate',
    'hole',
    'text',
    'dimensions',
    'budget',
    'span',
  ] as const)('rejects invalid table %s before rendering', (error) => {
    const snapshot = deck(),
      table = tableOf(snapshot)
    if (error === 'duplicate') table.cells[1]!.column = 0
    if (error === 'hole') table.cells.pop()
    if (error === 'text') table.cells[0]!.text += 'lost'
    if (error === 'dimensions') table.columnWidthsPx[0] = 999
    if (error === 'budget') table.columnWidthsPx = Array(101).fill(1)
    if (error === 'span') Object.assign(table.cells[0]!, { rowSpan: 2 })
    expect(() => htmlDeckToPresentation(snapshot)).toThrow()
  })
  it('writes one real table with source geometry, rich runs, cell margins and unique IDs, then validates the final file', async () => {
    const snapshot = deck(),
      path = await output()
    const result = await writeEditablePptx(snapshot, path, {
      policy: 'strict-editable',
      embedFonts: false,
    })
    const zip = await JSZip.loadAsync(await readFile(path)),
      xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(xml.match(/<a:tbl>/g)).toHaveLength(1)
    expect(xml.match(/<a:tc>/g)).toHaveLength(4)
    expect(xml).toContain('name="fastppt:metrics"')
    expect(xml).toContain('firstRow="1"')
    expect(xml).toContain('lang="zh-CN"')
    expect(xml).not.toContain('x-fastppt-')
    expect(xml).toContain('A &amp; B')
    expect(xml).toContain('marL="49762" marR="74643" marT="24881" marB="37322"')
    const ids = [...xml.matchAll(/<p:cNvPr\b[^>]*\bid="([^"]+)"/g)].map(
      (match) => match[1],
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(result.slideCount).toBe(1)
    expect(result.qa.ok).toBe(true)
    const report = result.objects.find(
      (object) => object.elementId === 'metrics',
    )!
    expect(report).toMatchObject({
      kind: 'table',
      nativeCount: 1,
      imageCount: 0,
      semanticPreserved: true,
      representation: 'native-table',
      childIds: ['cell-0', 'cell-1', 'cell-2', 'cell-3'],
      verification: {
        structure: 'passed',
        visual: 'unverified',
        application: 'unverified',
      },
    })
    expect(report.fonts?.emitted).toEqual(['Arial'])
    const rels = await zip
      .file('ppt/slides/_rels/slide1.xml.rels')!
      .async('string')
    expect(rels).toContain('https://example.com/data')
    zip.file('ppt/slides/slide1.xml', xml.replace('指标', 'tampered'))
    await expect(
      validateNativeTableReadback(
        await zip.generateAsync({ type: 'arraybuffer' }),
        snapshot,
        result.objects,
      ),
    ).rejects.toThrow(/cell text mismatch/)
  })
  it('exports pure table pages including a completely empty editable grid', async () => {
    const snapshot = deck()
    snapshot.slides[0]!.elements = [tableOf(snapshot)]
    const path = await output()
    expect(
      (await writeEditablePptx(snapshot, path, { policy: 'strict-editable' }))
        .qa.ok,
    ).toBe(true)
    for (const cell of tableOf(snapshot).cells) {
      cell.text = ''
      cell.runs = []
    }
    const result = await writeEditablePptx(snapshot, path, {
      policy: 'strict-editable',
    })
    expect(result.qa.ok).toBe(true)
    expect(result.objects[0]?.verification?.structure).toBe('passed')
  })

  it('rejects table fragments in strict mode even when there are zero images; ordinary editable mode reports the loss', async () => {
    const snapshot = deck()
    snapshot.slides[0]!.elements = [snapshot.slides[0]!.elements[0]!]
    snapshot.slides[0]!.elements[0]!.structure = {
      kind: 'table',
      ownerId: 'lost-table',
      requiredRepresentation: 'native-table',
    }
    const path = await output()
    await expect(
      writeEditablePptx(snapshot, path, { policy: 'strict-editable' }),
    ).rejects.toBeInstanceOf(EditablePptxPolicyError)
    for (const policy of ['editable', 'visual-fidelity'] as const) {
      const result = await writeEditablePptx(snapshot, path, { policy })
      expect(result.objects[0]).toMatchObject({
        imageCount: 0,
        nativeCount: 1,
        semanticPreserved: false,
        representation: 'native-shapes',
      })
    }
  })
  it('keeps a whole-table image fallback subject to the structural requirement', async () => {
    const snapshot = deck(),
      source = snapshot.slides[0]!.elements[0]!
    snapshot.slides[0]!.elements = [
      {
        kind: 'image',
        id: source.id,
        source: source.source,
        box: source.box,
        order: 0,
        zIndex: 0,
        opacity: 1,
        structure: {
          kind: 'table',
          ownerId: 'image-table',
          requiredRepresentation: 'native-table',
        },
        data: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1IiBoZWlnaHQ9IjUiPjwvc3ZnPg==',
      },
    ]
    expect(htmlDeckToPresentation(snapshot).objects[0]).toMatchObject({
      editableRequired: true,
      semanticPreserved: false,
      representation: 'image',
    })
    await expect(
      writeEditablePptx(snapshot, await output(), {
        policy: 'strict-editable',
      }),
    ).rejects.toBeInstanceOf(EditablePptxPolicyError)
  })

  it('does not let a native inner table conceal the loss of an enclosing table', async () => {
    const snapshot = deck()
    tableOf(snapshot).structure = {
      kind: 'table',
      ownerId: 'enclosing-table',
      requiredRepresentation: 'native-table',
    }
    expect(
      htmlDeckToPresentation(snapshot).objects.find(
        (object) => object.kind === 'table',
      ),
    ).toMatchObject({
      nativeCount: 1,
      semanticPreserved: false,
      structureOwnerId: 'enclosing-table',
    })
    await expect(
      writeEditablePptx(snapshot, await output(), {
        policy: 'strict-editable',
      }),
    ).rejects.toBeInstanceOf(EditablePptxPolicyError)
  })

  it('blocks table overflow without silently adding slides or shrinking text', async () => {
    const snapshot = deck()
    tableOf(snapshot).box.y = 500
    await expect(
      writeEditablePptx(snapshot, await output(), { policy: 'editable' }),
    ).rejects.toBeInstanceOf(EditablePptxPolicyError)
  })
})
