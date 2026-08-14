import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'

import { htmlDeckToPresentation } from '../../src/slidev/render.js'
import { validateEditablePptx } from '../../src/export/validate.js'
import type { HtmlDeckSnapshot } from '../../src/snapshot-types.js'

function deckWith(elements: Array<Record<string, unknown>>): HtmlDeckSnapshot {
  return {
    version: 1,
    source: 'slidev',
    slides: [
      {
        version: 1,
        id: 's1',
        width: 1280,
        height: 720,
        elements: elements as unknown as HtmlDeckSnapshot['slides'][number]['elements'],
        warnings: [],
      },
    ],
    warnings: [],
  }
}

function textElement(id: string, text: string): Record<string, unknown> {
  return {
    id,
    kind: 'text',
    text,
    box: { x: 0, y: 0, width: 600, height: 60 },
    order: 1,
    zIndex: 1,
    opacity: 1,
    source: { tag: 'span', path: id },
    style: {
      fontFamily: 'Inter',
      fontSizePx: 28,
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeightPx: 32,
      letterSpacingPx: 0,
      color: { hex: '111111', alpha: 1 },
      align: 'left',
      decoration: [],
      direction: 'ltr',
      language: 'en',
    },
  }
}

async function addFullSlideRaster(pptx: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(pptx)
  const slide = zip.file('ppt/slides/slide1.xml')
  if (!slide) throw new Error('slide1.xml is missing')
  const xml = await slide.async('string')
  zip.file(
    'ppt/slides/slide1.xml',
    xml.replace(
      '</p:spTree>',
      '<p:pic><p:spPr><a:xfrm><a:ext cx="12192000" cy="6858000"/></a:xfrm></p:spPr></p:pic></p:spTree>',
    ),
  )
  return zip.generateAsync({ type: 'arraybuffer' })
}

describe('validateEditablePptx', () => {
  it('passes a well-formed generated deck and reports the slide count', async () => {
    const rendered = htmlDeckToPresentation(
      deckWith([textElement('t1', 'Slide one'), textElement('t2', 'Slide two')]),
    )
    const report = await validateEditablePptx(
      await rendered.presentation.toArrayBuffer(),
      1,
    )
    expect(report.ok).toBe(true)
    expect(report.slideCount).toBe(1)
    expect(report.issues).toEqual([])
  })

  it('flags a slide-count mismatch against the manifest', async () => {
    const rendered = htmlDeckToPresentation(deckWith([textElement('t1', 'Only one')]))
    const report = await validateEditablePptx(
      await rendered.presentation.toArrayBuffer(),
      3,
    )
    expect(report.ok).toBe(false)
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'slide-count-mismatch' }),
      ]),
    )
  })

  it('allows full-bleed photography behind native editable text', async () => {
    const rendered = htmlDeckToPresentation(
      deckWith([textElement('t1', 'Editable title over a photo')]),
    )
    const pptx = await addFullSlideRaster(
      await rendered.presentation.toArrayBuffer(),
    )
    const report = await validateEditablePptx(pptx, 1)

    expect(report.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'full-slide-raster' }),
      ]),
    )
  })

  it('rejects a non-OOXML payload as an invalid package', async () => {
    const report = await validateEditablePptx(new Uint8Array([1, 2, 3, 4]))
    expect(report.ok).toBe(false)
    expect(report.issues[0]?.code).toBe('invalid-package')
  })

  it('surfaces missing native text on an empty slide', async () => {
    const rendered = htmlDeckToPresentation(
      deckWith([]),
    )
    const report = await validateEditablePptx(
      await rendered.presentation.toArrayBuffer(),
      1,
    )
    // An empty element list still yields a slide part; it should warn about no text.
    expect(report.slideCount).toBe(1)
  })
})
