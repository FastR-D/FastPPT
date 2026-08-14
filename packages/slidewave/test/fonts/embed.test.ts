import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { embedFonts } from '../../src/fonts/embedFonts.js'
import { writeEditablePptx } from '../../src/server/index.js'
import { htmlDeckToPresentation } from '../../src/slidev/render.js'
import type { HtmlDeckSnapshot } from '../../src/snapshot-types.js'

const FONT_ROOT = new URL('../../../fonts/assets/fonts/', import.meta.url)
const TEST_CATALOG: Record<string, { file: string; variable?: boolean }> = {
  'Noto Sans SC': { file: 'noto-sans-sc-variable.ttf', variable: true },
  Inter: { file: 'inter-variable.ttf', variable: true },
  MiSans: { file: 'misans-regular.ttf' },
  'MiSans Semibold': { file: 'misans-semibold.ttf' },
}
const testResolveFont = (family: string): { path: string; variable?: boolean } | undefined => {
  const entry = TEST_CATALOG[family]
  if (!entry) return undefined
  return { path: new URL(entry.file, FONT_ROOT).pathname, variable: entry.variable }
}

function textElement(id: string, text: string, fontFamily: string): Record<string, unknown> {
  return {
    id,
    kind: 'text',
    text,
    box: { x: 0, y: 0, width: 800, height: 80 },
    order: 1,
    zIndex: 1,
    opacity: 1,
    source: { tag: 'span', path: id },
    style: {
      fontFamily,
      fontSizePx: 40,
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeightPx: 48,
      letterSpacingPx: 0,
      color: { hex: '000000', alpha: 1 },
      align: 'left',
      decoration: [],
      direction: 'ltr',
      language: 'en',
    },
  }
}

function deckWith(elements: Array<Record<string, unknown>>): HtmlDeckSnapshot {
  return {
    version: 1,
    source: 'slidev',
    slides: [
      {
        version: 1,
        id: 'slide-1',
        width: 1920,
        height: 1080,
        elements: elements as unknown as HtmlDeckSnapshot['slides'][number]['elements'],
        warnings: [],
      },
    ],
    warnings: [],
  }
}

function extractEotFontData(eot: Uint8Array): Uint8Array {
  for (let i = 96; i < eot.length - 4; i++) {
    if (eot[i] === 0 && eot[i + 1] === 0x01 && eot[i + 2] === 0 && eot[i + 3] === 0)
      return eot.slice(i)
  }
  throw new Error('no TTF signature found in EOT payload')
}

describe('PPTX font embedding', () => {
  it('embeds subsetted CJK and Latin fonts and wires embeddedFontLst', async () => {
    const deck = deckWith([
      textElement('cjk', '数据报告 2026', 'Noto Sans SC'),
      textElement('latin', 'Revenue grew 30%', 'Inter'),
    ])
    const rendered = htmlDeckToPresentation(deck)
    const result = await embedFonts(await rendered.presentation.toArrayBuffer(), { resolveFont: testResolveFont })

    expect(result.warnings).toEqual([])
    expect(result.embeddedFaces).toBeGreaterThanOrEqual(2)

    const zip = await JSZip.loadAsync(result.buffer)
    const fontParts = Object.keys(zip.files).filter((name) =>
      /^ppt\/fonts\/font\d+\.fntdata$/.test(name),
    )
    expect(fontParts.length).toBe(result.embeddedFaces)

    const presentation = await zip.file('ppt/presentation.xml')!.async('string')
    expect(presentation).toContain('<p:embeddedFontLst>')
    expect(presentation).toContain('typeface="Noto Sans SC"')
    expect(presentation).toContain('typeface="Inter"')
    expect(presentation).toContain('embedTrueTypeFonts="1"')

    const contentTypes = await zip.file('[Content_Types].xml')!.async('string')
    expect(contentTypes).toContain('Extension="fntdata"')
    expect(contentTypes).toContain('application/x-fontdata')

    const rels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')
    expect(rels).toContain('relationships/embeddedFont')
    expect(rels).toContain('fonts/font1.fntdata')

    // Every .fntdata is an EOT with an embedded TTF payload.
    for (const part of fontParts) {
      const eot = new Uint8Array(await zip.file(part)!.async('arraybuffer'))
      expect(String.fromCharCode(eot[34], eot[35])).toBe('LP') // EOT magic
      const ttf = extractEotFontData(eot)
      expect(ttf[0]).toBe(0)
      expect(ttf[1]).toBe(1)
    }
  })

  it('warns and continues for families missing from the catalog', async () => {
    const deck = deckWith([textElement('x', 'Fancy', 'Definitely Not A Font')])
    const rendered = htmlDeckToPresentation(deck)
    const result = await embedFonts(await rendered.presentation.toArrayBuffer(), { resolveFont: testResolveFont })

    expect(result.embeddedFaces).toBe(0)
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unembedded-font' })]),
    )
  })

  it('embeds MiSans Chinese glyphs without substituting a fallback family', async () => {
    const deck = deckWith([
      textElement('mi', 'XIAOMI SU7 2026 小米汽车超级电机', 'MiSans'),
    ])
    const rendered = htmlDeckToPresentation(deck)
    const result = await embedFonts(
      await rendered.presentation.toArrayBuffer(),
      { resolveFont: testResolveFont },
    )

    expect(result.warnings).toEqual([])
    expect(result.embeddedFaces).toBe(1)
    const zip = await JSZip.loadAsync(result.buffer)
    const presentation = await zip.file('ppt/presentation.xml')!.async('string')
    expect(presentation).toContain('typeface="MiSans"')
  })

  it('embeds the real MiSans semibold face for mixed-script weight 600 text', async () => {
    const element = textElement(
      'mi-semibold',
      'XIAOMI SU7 673 马力',
      'MiSans',
    )
    element.style = { ...element.style as object, fontWeight: 600 }
    const rendered = htmlDeckToPresentation(deckWith([element]))
    const result = await embedFonts(
      await rendered.presentation.toArrayBuffer(),
      { resolveFont: testResolveFont },
    )

    expect(result.warnings).toEqual([])
    const zip = await JSZip.loadAsync(result.buffer)
    const presentation = await zip.file('ppt/presentation.xml')!.async('string')
    expect(presentation).toContain('typeface="MiSans Semibold"')
  })

  it('writeEditablePptx embeds fonts and writes a valid file by default', async () => {
    const deck = deckWith([textElement('cjk', '数据', 'Noto Sans SC')])
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-embed-'))
    const output = join(dir, 'out.pptx')
    try {
      const result = await writeEditablePptx(deck, output, { resolveFont: testResolveFont })
      expect(result.embeddedFaces).toBeGreaterThanOrEqual(1)
      expect(result.warnings).toEqual([])
      const bytes = await readFile(output)
      const zip = await JSZip.loadAsync(bytes)
      const presentation = await zip.file('ppt/presentation.xml')!.async('string')
      expect(presentation).toContain('embeddedFontLst')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writeEditablePptx can disable embedding and still writes', async () => {
    const deck = deckWith([textElement('cjk', '数据', 'Noto Sans SC')])
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-embed-off-'))
    const output = join(dir, 'out.pptx')
    try {
      const result = await writeEditablePptx(deck, output, { embedFonts: false })
      expect(result.embeddedFaces).toBe(0)
      const bytes = await readFile(output)
      expect(bytes.byteLength).toBeGreaterThan(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
