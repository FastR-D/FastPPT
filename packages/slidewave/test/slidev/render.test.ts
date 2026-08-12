import { describe, expect, it } from 'vitest'

import { normalizeSlidevPageNumber } from '../../src/slidev/capture'
import { htmlDeckToPresentation } from '../../src/slidev/render'
import { landingContentDeck } from './fixtures/landingContentSlide'

describe('editable Slidev rendering', () => {
  it('does not pass HTTP image paths to PptxGenJS', () => {
    const deck = structuredClone(landingContentDeck)
    deck.slides[0]!.elements.push({
      id: 'remote-image',
      kind: 'image',
      box: { x: 0, y: 0, width: 100, height: 100 },
      zIndex: 1,
      opacity: 1,
      order: 999,
      source: { tag: 'img', path: 'root/img' },
      path: 'http://127.0.0.1:4399/image.png',
      alt: 'remote',
    })
    const result = htmlDeckToPresentation(deck)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-snapshot',
          elementId: 'remote-image',
        }),
      ]),
    )
  })

  it('maps measured Landing geometry, typography, alpha, and layers to native objects', async () => {
    const result = htmlDeckToPresentation(landingContentDeck, {
      fontMap: { 'Source Han Sans': 'Microsoft YaHei' },
    })
    await result.presentation.flush()

    const operations = result.presentation['_slides'][0]._ops
    const title = operations.find(
      (operation) =>
        operation.kind === 'text' && operation.text === 'Research background',
    )
    const cards = operations.filter(
      (operation) =>
        operation.kind === 'shape' && operation.type === 'roundRect',
    )
    const cardShadow = cards[0]
    const cardBorder = cards[1]
    const cardGradient = operations.find(
      (operation) =>
        operation.kind === 'image' &&
        operation.data?.startsWith('data:image/svg+xml'),
    )
    const line = operations.find((operation) => operation.kind === 'line')
    const pageNumber = operations.find(
      (operation) =>
        operation.kind === 'text' && operation.text === 'Slide 4 / 17',
    )
    const body = operations.find(
      (operation) =>
        operation.kind === 'text' && operation.text === 'Editable text',
    )
    if (
      !title ||
      title.kind !== 'text' ||
      !cardShadow ||
      cardShadow.kind !== 'shape' ||
      !cardBorder ||
      cardBorder.kind !== 'shape' ||
      !line ||
      line.kind !== 'line' ||
      !pageNumber ||
      pageNumber.kind !== 'text' ||
      !body ||
      body.kind !== 'text'
    )
      throw new Error('Expected native rendering operations were not produced')

    expect(result.elementCount).toBe(7)
    expect(result.warnings).toHaveLength(1)
    expect(operations.map((operation) => operation.kind)).toEqual([
      'shape',
      'text',
      'shape',
      'image',
      'shape',
      'line',
      'text',
      'text',
      'image',
    ])
    expect(title.opts.fontFace).toBe('Microsoft YaHei')
    expect(title.opts.fontSize).toBeCloseTo(19.58, 2)
    expect(title.opts.x).toBeCloseTo((35 * 13.333) / 980, 4)
    expect(title.opts.y).toBeCloseTo((16 * 7.5) / 552, 4)
    expect(cardShadow.opts.fill).toEqual({
      type: 'solid',
      color: 'ECF5FB',
      transparency: 0,
    })
    expect(cardShadow.opts.shadow).toBeDefined()
    expect(cardBorder.opts.line).toMatchObject({
      color: '2563EB',
      transparency: 20,
      dashType: 'solid',
    })
    expect(cardGradient).toBeDefined()
    expect(line.transparency).toBe(0)
    expect(line.x1).toBeCloseTo(line.x2, 5)
    expect(pageNumber.opts.fontFace).toBe('Times New Roman')
    expect(pageNumber.opts.italic).toBe(true)
    expect(pageNumber.opts.charSpacing).toBeCloseTo(1.566, 2)
    expect(body.opts.valign).toBe('middle')
  })

  it('uses the captured slide id for Slidev overview page numbers', () => {
    expect(normalizeSlidevPageNumber('Slide 1 / 17', '4')).toBe('Slide 4 / 17')
    expect(normalizeSlidevPageNumber('Slide 1 / 17', '17')).toBe(
      'Slide 17 / 17',
    )
    expect(normalizeSlidevPageNumber('Slide 1 / 17', 'slide-4')).toBe(
      'Slide 1 / 17',
    )
  })

  it('maps Source Han Sans to Source Han Sans SC by default', async () => {
    const result = htmlDeckToPresentation(landingContentDeck)
    await result.presentation.flush()
    const title = result.presentation['_slides'][0]._ops.find(
      (operation) =>
        operation.kind === 'text' && operation.text === 'Research background',
    )

    expect(title?.kind).toBe('text')
    if (!title || title.kind !== 'text') throw new Error('Missing title text')
    expect(title.opts.fontFace).toBe('Source Han Sans SC')
  })

  it('maps ui-monospace to an editable monospace font and centers tall text boxes', async () => {
    const deck = structuredClone(landingContentDeck)
    const text = deck.slides[0]!.elements.find(
      (element) => element.kind === 'text' && element.text === 'Editable text',
    )
    if (!text || text.kind !== 'text') throw new Error('Missing text fixture')
    text.style.fontFamily = 'ui-monospace'
    text.box.height = text.style.lineHeightPx * 2
    const result = htmlDeckToPresentation(deck)
    await result.presentation.flush()
    const operation = result.presentation['_slides'][0]._ops.find(
      (candidate) =>
        candidate.kind === 'text' && candidate.text === 'Editable text',
    )
    expect(operation?.kind).toBe('text')
    if (!operation || operation.kind !== 'text')
      throw new Error('Missing text operation')
    expect(operation.opts.fontFace).toBe('JetBrains Mono NL')
    expect(operation.opts.valign).toBe('middle')
  })

  it('preserves Inter so export matches the browser preview', async () => {
    const deck = structuredClone(landingContentDeck)
    const text = deck.slides[0]!.elements.find(
      (element) => element.kind === 'text' && element.text === 'Editable text',
    )
    if (!text || text.kind !== 'text') throw new Error('Missing text fixture')
    text.style.fontFamily = 'Inter'
    const result = htmlDeckToPresentation(deck)
    await result.presentation.flush()
    const operation = result.presentation['_slides'][0]._ops.find(
      (candidate) =>
        candidate.kind === 'text' && candidate.text === 'Editable text',
    )
    expect(operation?.kind).toBe('text')
    if (!operation || operation.kind !== 'text')
      throw new Error('Missing text operation')
    expect(operation.opts.fontFace).toBe('Inter')
  })

  it('uses the first preview font instead of a later mapped fallback', async () => {
    const deck = structuredClone(landingContentDeck)
    const text = deck.slides[0]!.elements.find(
      (element) => element.kind === 'text' && element.text === 'Editable text',
    )
    if (!text || text.kind !== 'text') throw new Error('Missing text fixture')
    text.style.fontFamily =
      'Unknown Academy Font, "Microsoft YaHei", sans-serif'
    const result = htmlDeckToPresentation(deck)
    await result.presentation.flush()
    const operation = result.presentation['_slides'][0]._ops.find(
      (candidate) =>
        candidate.kind === 'text' && candidate.text === 'Editable text',
    )
    expect(operation?.kind).toBe('text')
    if (!operation || operation.kind !== 'text')
      throw new Error('Missing text operation')
    expect(operation.opts.fontFace).toBe('Unknown Academy Font')
  })

  it('uses preview-equivalent font runs for mixed Latin and CJK text', async () => {
    const deck = structuredClone(landingContentDeck)
    const text = deck.slides[0]!.elements.find(
      (element) => element.kind === 'text' && element.text === 'Editable text',
    )
    if (!text || text.kind !== 'text') throw new Error('Missing text fixture')
    text.text = 'Academy 学术汇报'
    text.style.fontFamily = 'Inter, "Noto Sans CJK SC", sans-serif'
    const result = htmlDeckToPresentation(deck)
    await result.presentation.flush()
    const operation = result.presentation['_slides'][0]._ops.find(
      (candidate) =>
        candidate.kind === 'text' && candidate.text === 'Academy 学术汇报',
    )
    expect(operation?.kind).toBe('text')
    if (!operation || operation.kind !== 'text')
      throw new Error('Missing text operation')
    expect(operation.opts.fontFace).toBe('Inter')
    expect(
      operation.runs?.map((run) => ({
        text: run.text,
        fontFace: run.options?.fontFace,
      })),
    ).toEqual([
      { text: 'Academy ', fontFace: 'Inter' },
      { text: '学术汇报', fontFace: 'Noto Sans CJK SC' },
    ])
  })

  it('uses measured text advance to prevent clipping after font substitution', async () => {
    const deck = structuredClone(landingContentDeck)
    const text = deck.slides[0]!.elements.find(
      (element) => element.kind === 'text' && element.text === 'Editable text',
    )
    if (!text || text.kind !== 'text') throw new Error('Missing text fixture')
    text.box = { x: 200, y: 100, width: 50, height: 19 }
    text.style.align = 'right'
    text.metrics = { advancePx: 80, graphemeCount: 13 }

    const result = htmlDeckToPresentation(deck)
    await result.presentation.flush()
    const operation = result.presentation['_slides'][0]._ops.find(
      (candidate) =>
        candidate.kind === 'text' && candidate.text === 'Editable text',
    )
    if (!operation || operation.kind !== 'text')
      throw new Error('Missing text operation')

    const expectedWidth = 80 + 16 * 0.08
    expect(operation.opts.w).toBeCloseTo((expectedWidth * 13.333) / 980, 5)
    expect(operation.opts.x).toBeCloseTo(
      ((250 - expectedWidth) * 13.333) / 980,
      5,
    )
  })

  it('maps Helvetica Neue to Arial for portable editable text', async () => {
    const deck = structuredClone(landingContentDeck)
    const text = deck.slides[0]!.elements.find(
      (element) => element.kind === 'text' && element.text === 'Editable text',
    )
    if (!text || text.kind !== 'text') throw new Error('Missing text fixture')
    text.style.fontFamily = 'Helvetica Neue'
    const result = htmlDeckToPresentation(deck)
    await result.presentation.flush()
    const operation = result.presentation['_slides'][0]._ops.find(
      (candidate) =>
        candidate.kind === 'text' && candidate.text === 'Editable text',
    )
    expect(operation?.kind).toBe('text')
    if (!operation || operation.kind !== 'text')
      throw new Error('Missing text operation')
    expect(operation.opts.fontFace).toBe('Arial')
  })

  it('preserves a small CSS radius on a tall clipped container', async () => {
    const deck = structuredClone(landingContentDeck)
    const rounded = deck.slides[0].elements.find(
      (element) => element.kind === 'shape' && element.id === 'root/main/card',
    )
    if (!rounded || rounded.kind !== 'shape')
      throw new Error('Missing rounded fixture shape')
    rounded.gradient = undefined
    rounded.fill = undefined
    rounded.preciseRadius = true
    deck.slides[0].elements = [rounded]
    deck.slides[0].warnings = []
    deck.warnings = []

    const result = htmlDeckToPresentation(deck)
    await result.presentation.flush()
    const operations = result.presentation['_slides'][0]._ops
    const outline = operations.find((operation) => operation.kind === 'image')
    if (!outline || outline.kind !== 'image' || !outline.data) {
      throw new Error(
        'Expected rounded rectangle SVG operation was not produced',
      )
    }
    const svg = Buffer.from(outline.data.split(',')[1], 'base64').toString(
      'utf8',
    )

    expect(operations.map((operation) => operation.kind)).toEqual([
      'shape',
      'image',
    ])
    expect(svg).toContain('rx="8"')
    expect(svg).toContain('stroke="#2563EB"')
    expect(svg).toContain('fill="none"')
  })

  it('produces the same native operation model for repeated input', async () => {
    const first = htmlDeckToPresentation(landingContentDeck)
    const second = htmlDeckToPresentation(structuredClone(landingContentDeck))
    await Promise.all([first.presentation.flush(), second.presentation.flush()])

    expect(first.presentation['_slides'].map((slide) => slide._ops)).toEqual(
      second.presentation['_slides'].map((slide) => slide._ops),
    )

    const bytes = new Uint8Array(await first.presentation.toArrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(1_000)
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK')
  })

  it('rejects unsupported snapshot versions before creating partial output', () => {
    const invalid = { ...landingContentDeck, version: 2 }
    expect(() => htmlDeckToPresentation(invalid as never)).toThrow(
      /expected version 1/,
    )
  })
})
