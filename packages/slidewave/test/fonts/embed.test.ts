import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { embedFonts } from '../../src/fonts/embedFonts.js'
import { parseXml } from '../../src/server/slide-xml.js'
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
  return { path: fileURLToPath(new URL(entry.file, FONT_ROOT)), variable: entry.variable }
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
  it('retains complete font glyphs for capitalized runs, including inherited layout modes', async () => {
    const font = await readFile(testResolveFont('MiSans')!.path)
    for (const inherited of [false, true]) {
      const element = textElement('caps', 'Straße i', 'MiSans')
      element.style = { ...element.style as object, capitalization: 'small' }
      const rendered = htmlDeckToPresentation(deckWith([element]))
      const input = await JSZip.loadAsync(await rendered.presentation.toArrayBuffer())
      if (inherited) {
        const path = 'ppt/slides/slide1.xml'
        // Move the declaration to paragraph defaults. The collector must resolve
        // inheritance without adding the attribute to the saved text run.
        input.file(path, (await input.file(path)!.async('string')).replace(/ cap="small"/g, '').replace(/(<a:pPr\b[^>]*>)/, '$1<a:defRPr cap="small"/>'))
      }
      const result = await embedFonts(await input.generateAsync({ type: 'arraybuffer' }), { resolveFont: testResolveFont })
      expect(result.warnings).toEqual([])
      expect(result.embeddedFaces).toBe(1)
      const output = await JSZip.loadAsync(result.buffer)
      const eot = new Uint8Array(await output.file('ppt/fonts/font1.fntdata')!.async('arraybuffer'))
      expect(Buffer.from(extractEotFontData(eot)).equals(font)).toBe(true)
      if (inherited) expect(await output.file('ppt/slides/slide1.xml')!.async('string')).not.toMatch(/<a:rPr[^>]* cap=/)
    }
  }, 30_000) // Two PPTX exports retain the complete original CJK font.

  it('still pins the requested weight when retaining a variable font for capitalization', async () => {
    const element = textElement('caps', 'a', 'Inter')
    element.style = { ...element.style as object, capitalization: 'all', fontWeight: 700 }
    const rendered = htmlDeckToPresentation(deckWith([element]))
    const result = await embedFonts(await rendered.presentation.toArrayBuffer(), { resolveFont: testResolveFont })
    expect(result.warnings).toEqual([])
    expect(result.embeddedFaces).toBe(1)
    const output = await JSZip.loadAsync(result.buffer)
    const eot = new Uint8Array(await output.file('ppt/fonts/font1.fntdata')!.async('arraybuffer'))
    const font = Buffer.from(extractEotFontData(eot)), original = await readFile(testResolveFont('Inter')!.path)
    const table = (data: Buffer, name: string) => {
      for (let index = 0; index < data.readUInt16BE(4); index++) {
        const offset = 12 + index * 16
        if (data.toString('ascii', offset, offset + 4) === name) return data.subarray(data.readUInt32BE(offset + 8), data.readUInt32BE(offset + 8) + data.readUInt32BE(offset + 12))
      }
      throw new Error(`Missing font table ${name}`)
    }
    expect(table(font, 'OS/2').readUInt16BE(4)).toBe(700)
    // Retain the full character map, including uppercase and unrelated future
    // edits, while allowing glyph IDs/offsets to change during instantiation.
    const coverage = (data: Buffer) => {
      const cmap = table(data, 'cmap'), result = new Set<number>()
      for (let index = 0; index < cmap.readUInt16BE(2); index++) {
        const sub = cmap.subarray(cmap.readUInt32BE(8 + index * 8)), format = sub.readUInt16BE(0)
        if (format === 4) {
          const count = sub.readUInt16BE(6) / 2
          for (let segment = 0; segment < count; segment++) for (let point = sub.readUInt16BE(16 + 2 * count + 2 * segment); point <= sub.readUInt16BE(14 + 2 * segment) && point !== 0xffff; point++) result.add(point)
        } else if (format === 12) for (let group = 0; group < sub.readUInt32BE(12); group++) for (let point = sub.readUInt32BE(16 + group * 12); point <= sub.readUInt32BE(20 + group * 12); point++) result.add(point)
      }
      return result
    }
    expect(coverage(font)).toEqual(coverage(original))
  })

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
    expect(() => parseXml(presentation)).not.toThrow()
    expect(presentation.match(/\bembedTrueTypeFonts=/g)).toHaveLength(1)
    expect(presentation.match(/\bsaveSubsetFonts=/g)).toHaveLength(1)
    expect(parseXml(presentation).attributes).toMatchObject({ embedTrueTypeFonts: '1', saveSubsetFonts: '1' })

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

  it('updates preexisting embedding flags without duplicating XML attributes', async () => {
    const rendered = htmlDeckToPresentation(deckWith([textElement('text', 'Editable', 'Inter')]))
    const input = await JSZip.loadAsync(await rendered.presentation.toArrayBuffer())
    const path = 'ppt/presentation.xml'
    const original = await input.file(path)!.async('string')
    input.file(path, original.replace(/<p:presentation\b[^>]*>/, (tag) =>
      tag.replace(/\s+(?:embedTrueTypeFonts|saveSubsetFonts)="[^"]*"/g, '')
        .replace(/>$/, ' embedTrueTypeFonts="0" saveSubsetFonts="0">'),
    ))
    const result = await embedFonts(await input.generateAsync({ type: 'arraybuffer' }), { resolveFont: testResolveFont })
    const output = await JSZip.loadAsync(result.buffer)
    const xml = await output.file(path)!.async('string')
    expect(parseXml(xml).attributes).toMatchObject({ embedTrueTypeFonts: '1', saveSubsetFonts: '1' })
    expect(xml.match(/\bembedTrueTypeFonts=/g)).toHaveLength(1)
    expect(xml.match(/\bsaveSubsetFonts=/g)).toHaveLength(1)
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

  it('writes speaker notes into notes slides and preserves their text', async () => {
    const deck = deckWith([textElement('note', '正文', 'Arial')])
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-notes-'))
    const output = join(dir, 'notes.pptx')
    try {
      await writeEditablePptx(deck, output, { embedFonts: false, notes: ['演示这页的口语备注'] })
      const zip = await JSZip.loadAsync(await readFile(output))
      const noteFiles = Object.keys(zip.files).filter((name) => name.startsWith('ppt/notesSlides/notesSlide') && name.endsWith('.xml'))
      expect(noteFiles.length).toBe(1)
      expect(await zip.file(noteFiles[0]!)!.async('string')).toContain('演示这页的口语备注')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('writes supported page transitions into slide XML', async () => {
    const deck = deckWith([textElement('transition', '正文', 'Arial')])
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-transition-'))
    const output = join(dir, 'transition.pptx')
    try {
      await writeEditablePptx(deck, output, { embedFonts: false, transitions: [{ kind: 'fade', durationMs: 750 }] })
      const zip = await JSZip.loadAsync(await readFile(output))
      const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect(slide).toContain('<p:transition spd="med"><p:fade/></p:transition>')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('writes an editable slide master by default and can disable it', async () => {
    const deck = deckWith([textElement('master', '正文', 'Arial')])
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-master-'))
    try {
      const output = join(dir, 'master.pptx')
      await writeEditablePptx(deck, output, { embedFonts: false })
      const zip = await JSZip.loadAsync(await readFile(output))
      const masters = Object.keys(zip.files).filter((name) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name))
      expect(masters.length).toBeGreaterThan(0)
      const masterXml = await Promise.all(masters.map((path) => zip.file(path)!.async('string')))
      const layoutPaths = Object.keys(zip.files).filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name))
      const layoutXml = await Promise.all(layoutPaths.map((path) => zip.file(path)!.async('string')))
      expect(masterXml.length).toBeGreaterThan(0)
      expect(layoutXml.length).toBeGreaterThan(0)
      expect(layoutXml.every((xml) => !/<p:ph\b/.test(xml))).toBe(true)
      const noMaster = join(dir, 'no-master.pptx')
      await writeEditablePptx(deck, noMaster, { embedFonts: false, master: false })
      const plainZip = await JSZip.loadAsync(await readFile(noMaster))
      const plainLayouts = Object.keys(plainZip.files).filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name))
      const plainLayoutXml = await Promise.all(plainLayouts.map((path) => plainZip.file(path)!.async('string')))
      expect(plainLayoutXml.some((xml) => xml.includes('name="title"'))).toBe(false)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('materializes registered theme layouts as selectable slide layouts', async () => {
    const deck = deckWith([textElement('master-layouts', '正文', 'Arial')])
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-master-layouts-'))
    try {
      const output = join(dir, 'master-layouts.pptx')
      await writeEditablePptx(deck, output, { embedFonts: false, masterLayouts: ['title', 'section', 'comparison'] })
      const zip = await JSZip.loadAsync(await readFile(output))
      const layoutPaths = Object.keys(zip.files).filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name))
      const layoutXml = await Promise.all(layoutPaths.map((path) => zip.file(path)!.async('string')))
      expect(layoutXml.filter((xml) => /name="(?:title|section|comparison)"/.test(xml)).length).toBe(3)
      const masterRels = await zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels')!.async('string')
      expect((masterRels.match(/Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/slideLayout"/g) ?? []).length).toBeGreaterThanOrEqual(3)
      const contentTypes = await zip.file('[Content_Types].xml')!.async('string')
      expect((contentTypes.match(/presentationml\.slideLayout\+xml/g) ?? []).length).toBeGreaterThanOrEqual(3)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })


  it('writes distinct native layout geometry with master relationships', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-native-layouts-'))
    try {
      const output = join(dir, 'layouts.pptx')
      const element = textElement('text', 'Content', 'Arial')
      ;(element.source as Record<string, unknown>).anchor = 'content'
      const deck = deckWith([element])
      deck.slides.push({ ...deck.slides[0]!, id: 'slide-2' })
      await writeEditablePptx(deck, output, { embedFonts: false, slideLayouts: ['Body', 'Cover'], placeholderBindings: [{ slide: 1, target: 'content', index: 1 }, { slide: 2, target: 'content', index: 0, geometry: 'layout', textStyle: 'layout' }], masterLayoutDefinitions: [
        { name: ' Cover ', placeholders: [{ index: 0, type: 'title', x: 100, y: 200, width: 3000, height: 400, textStyle: { fontFamily: 'Inter', fontSize: 28, color: '223344', bold: true } }] },
        { name: 'Body', masterId: 'Secondary', placeholders: [{ index: 1, type: 'body', x: 500, y: 600, width: 7000, height: 800 }], fixedObjects: [{ name: 'Brand footer', x: 0, y: 9000, width: 7000, height: 500, fill: '112233', text: 'Layout-owned brand' }] },
      ] })
      const zip = await JSZip.loadAsync(await readFile(output))
      const firstSlide = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect(firstSlide).toContain('type="body" idx="1"')
      expect(firstSlide).toContain('Content')
      const secondSlide = await zip.file('ppt/slides/slide2.xml')!.async('string')
      expect(secondSlide).toContain('type="title" idx="0"')
      expect(secondSlide).toContain('Content')
      const transforms = (xml: string) => parseXml(xml).children
        .find(node => node.local === 'cSld')!.children.find(node => node.local === 'spTree')!.children
        .filter(node => node.local === 'sp' && node.children.some(child => child.children.some(property => property.local === 'cNvPr' && property.attributes.name?.startsWith('fastppt:content')))).flatMap(node => node.children.filter(child => child.local === 'spPr'))
        .flatMap(node => node.children.filter(child => child.local === 'xfrm'))
      expect(transforms(firstSlide)).toHaveLength(1)
      expect(transforms(secondSlide)).toHaveLength(0)
      const entries = await Promise.all(Object.keys(zip.files).filter(path => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(path)).map(async path => ({ path, xml: await zip.file(path)!.async('string') })))
      const cover = entries.find(entry => entry.xml.includes('name="Cover"'))
      const body = entries.find(entry => entry.xml.includes('name="Body"'))
      expect(cover?.xml).toContain('<a:off x="100" y="200"/>')
      expect(cover?.xml).toContain('<a:defRPr sz="2800" b="1"')
      expect(cover?.xml).toContain('<a:latin typeface="Inter"/>')
      expect(cover?.xml).toContain('<a:srgbClr val="223344"/>')
      const textShape = parseXml(secondSlide).children.find(node => node.local === 'cSld')!.children.find(node => node.local === 'spTree')!.children.find(node => node.children.some(child => child.children.some(property => property.local === 'cNvPr' && property.attributes.name?.startsWith('fastppt:content'))))!
      const objectXml = secondSlide.slice(textShape.start, textShape.end)
      expect(objectXml).not.toContain('typeface=')
      expect(objectXml).not.toMatch(/\bsz=|\bb=/)
      expect(objectXml).toContain('Content')
      expect(body?.xml).toContain('<a:ext cx="7000" cy="800"/>')
      expect(body?.xml).toContain('<p:ph type="body" idx="1"/>')
      expect(body?.xml).toContain('Layout-owned brand')
      expect(firstSlide).not.toContain('Layout-owned brand')
      expect(body?.xml).not.toContain('cx="3000"')
      const secondaryMaster = await zip.file('ppt/slideMasters/slideMaster2.xml')!.async('string')
      expect(secondaryMaster).toContain('name="Secondary"')
      const secondaryRels = await zip.file('ppt/slideMasters/_rels/slideMaster2.xml.rels')!.async('string')
      expect(secondaryRels).toContain(body!.path.split('/').at(-1)!)
      expect(secondaryRels).not.toContain(cover!.path.split('/').at(-1)!)
      expect(await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')).toContain('slideMasters/slideMaster2.xml')
      for (const [index, layout] of [body, cover].entries()) {
        const rels = await zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`)!.async('string')
        expect(rels).toContain(`Target="../${layout!.path.slice(4)}"`)
      }
      for (const layout of [cover, body]) {
        expect(layout).toBeDefined()
        const fileName = layout!.path.split('/').at(-1)!
        const rels = await zip.file(`ppt/slideLayouts/_rels/${fileName}.rels`)!.async('string')
        expect(rels).toContain('slideMaster')
        expect(rels).toContain(layout === body ? 'slideMaster2.xml' : 'slideMaster1.xml')
      }
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it.each([
    { slide: 1, target: 'missing', index: 0 },
    { slide: 1, target: 'content', index: 99 },
    { slide: 2, target: 'content', index: 0 },
  ])('rejects unresolved placeholder bindings before writing an artifact: %j', async binding => {
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-invalid-binding-'))
    const output = join(dir, 'invalid.pptx')
    try {
      const element = textElement('text', 'Content', 'Arial')
      ;(element.source as Record<string, unknown>).anchor = 'content'
      await expect(writeEditablePptx(deckWith([element]), output, {
        embedFonts: false,
        slideLayouts: ['Cover'],
        masterLayoutDefinitions: [{ name: 'Cover', placeholders: [{ index: 0, type: 'title', x: 0, y: 0, width: 3000, height: 400 }] }],
        placeholderBindings: [binding],
      })).rejects.toThrow('PPTX serialization failed')
      await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('embeds fonts used only by fixed layout text after materializing layouts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-layout-font-'))
    try {
      const output = join(dir, 'layout-font.pptx')
      const result = await writeEditablePptx(deckWith([]), output, {
        resolveFont: testResolveFont,
        masterLayoutDefinitions: [{ name: 'Brand', placeholders: [], fixedObjects: [{ name: 'Brand label', x: 0, y: 0, width: 1000, height: 200, text: '品牌 Brand', fontFamily: 'Noto Sans SC', fontSize: 12 }] }],
        slideLayouts: ['Brand'],
      })
      expect(result.embeddedFaces).toBe(1)
      const zip = await JSZip.loadAsync(await readFile(output))
      expect(await zip.file('ppt/presentation.xml')!.async('string')).toContain('typeface="Noto Sans SC"')
      expect(Object.keys(zip.files).filter(path => /ppt\/fonts\/.*\.fntdata$/.test(path))).toHaveLength(1)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it.each(['Noto Sans SC', '+mj-lt'])('embeds inherited font %s without flattening page text', async fontFamily => {
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-inherited-font-'))
    try {
      const output = join(dir, 'inherited.pptx')
      const element = textElement('title', '继承字体', 'Arial')
      ;(element.source as Record<string, unknown>).anchor = 'title'
      const result = await writeEditablePptx(deckWith([element]), output, {
        resolveFont: testResolveFont,
        themeFont: 'Noto Sans SC',
        masterLayoutDefinitions: [{ name: 'Title', placeholders: [{ index: 0, type: 'title', x: 0, y: 0, width: 1000, height: 200, textStyle: { fontFamily } }] }],
        slideLayouts: ['Title'], placeholderBindings: [{ slide: 1, target: 'title', index: 0, textStyle: 'layout' }],
      })
      expect(result.embeddedFaces).toBe(1)
      const zip = await JSZip.loadAsync(await readFile(output))
      expect(await zip.file('ppt/presentation.xml')!.async('string')).toContain('typeface="Noto Sans SC"')
      const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect(slide).not.toContain('typeface="Noto Sans SC"')
      expect(slide).toContain('继承字体')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('does not collect a complex-script font for Latin-only text', async () => {
    const rendered = htmlDeckToPresentation(deckWith([textElement('latin', 'ABC', 'Inter')]))
    const zip = await JSZip.loadAsync(await rendered.presentation.toArrayBuffer())
    const path = 'ppt/slides/slide1.xml'
    const xml = await zip.file(path)!.async('string')
    expect(xml).toContain('<a:cs typeface="Inter"')
    zip.file(path, xml.replace(/<a:cs typeface="Inter"/g, '<a:cs typeface="Unused complex face"'))
    const families: string[] = []
    const result = await embedFonts(await zip.generateAsync({ type: 'arraybuffer' }), { resolveFont: family => { families.push(family); return testResolveFont(family) } })
    expect(families).toEqual(['Inter'])
    expect(result.embeddedFaces).toBe(1)
    expect(result.warnings).toEqual([])
  })

  it('writes an opaque root background behind layout content as p:bg', async () => {
    const element = { id: 'root-bg', kind: 'shape', shape: 'rect', box: { x: 0, y: 0, width: 1920, height: 1080 }, opacity: 1, zIndex: 0, order: 0, source: { tag: 'div', path: 'root', role: 'slide-background' }, fill: { hex: '123456', alpha: 1 } }
    const rendered = htmlDeckToPresentation(deckWith([element]))
    const zip = await JSZip.loadAsync(await rendered.presentation.toArrayBuffer())
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(xml).toContain('<p:bg>')
    expect(xml).toContain('<a:srgbClr val="123456"/>')
    expect(rendered.objects[0]).toMatchObject({ status: 'native', nativeCount: 1, imageCount: 0 })
    expect(rendered.presentation._slides[0]!._ops).toEqual([{ kind: 'background', color: '123456' }])
    const overlay = htmlDeckToPresentation(deckWith([{ ...element, source: { tag: 'div', path: 'overlay' } }]))
    expect(overlay.presentation._slides[0]!._ops[0]?.kind).toBe('shape')
  })

  it.each([
    { opacity: 0.5 },
    { fill: { hex: '123456', alpha: 0.5 } },
    { rotation: 15 },
    { radiusPx: 10 },
    { source: { tag: 'div', path: 'root', role: 'slide-background', anchor: 'animated' } },
    { box: { x: 10, y: 0, width: 1920, height: 1080 } },
  ])('retains root backgrounds with local visual semantics as shapes: %j', patch => {
    const element = { id: 'root-bg', kind: 'shape', shape: 'rect', box: { x: 0, y: 0, width: 1920, height: 1080 }, opacity: 1, zIndex: 0, order: 0, source: { tag: 'div', path: 'root', role: 'slide-background' }, fill: { hex: '123456', alpha: 1 }, ...patch }
    const result = htmlDeckToPresentation(deckWith([element]))
    expect(result.presentation._slides[0]!._ops.some(operation => operation.kind === 'background')).toBe(false)
    expect(result.objects[0]?.status).toBe('native')
  })

  it('does not move a later background below an earlier page object', () => {
    const background = { id: 'root-bg', kind: 'shape', shape: 'rect', box: { x: 0, y: 0, width: 1920, height: 1080 }, opacity: 1, zIndex: 1, order: 1, source: { tag: 'div', path: 'root', role: 'slide-background' }, fill: { hex: '123456', alpha: 1 } }
    const result = htmlDeckToPresentation(deckWith([textElement('earlier', 'Underlay', 'Arial'), background]))
    expect(result.presentation._slides[0]!._ops.some(operation => operation.kind === 'background')).toBe(false)
  })

  it.each([{ master: true, scope: 'layout' }, { master: false, scope: 'layout' }, { master: true, scope: 'master' }, { master: false, scope: 'master' }])('deduplicates captured fixed objects with matching native ownership ($master, $scope)', async ({ master, scope }) => {
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-fixed-dedup-'))
    try {
      const element = textElement('brand', 'Brand text', 'Arial')
      ;(element.source as Record<string, unknown>).nativeLayoutObject = { layout: 'Brand', name: 'footer', scope }
      const output = join(dir, 'brand.pptx')
      const result = await writeEditablePptx(deckWith([element]), output, {
        master, embedFonts: false,
        ...(master ? { slideLayouts: ['Brand'] } : {}),
        masterLayoutDefinitions: [{ name: 'Brand', placeholders: [], ...(scope === 'master' ? { masterObjects: { objects: [{ name: 'footer', x: 0, y: 0, width: 1000, height: 300, text: 'Brand text' }] } } : { fixedObjects: [{ name: 'footer', x: 0, y: 0, width: 1000, height: 300, text: 'Brand text' }] }) }],
      })
      const zip = await JSZip.loadAsync(await readFile(output))
      const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect(slide.includes('Brand text')).toBe(!master)
      if (master && scope === 'master') {
        expect(await zip.file('ppt/slideMasters/slideMaster1.xml')!.async('string')).toContain('Brand text')
        const layouts = await Promise.all(Object.keys(zip.files).filter(path => /^ppt\/slideLayouts\/[^/]+\.xml$/.test(path)).map(path => zip.file(path)!.async('string')))
        expect(layouts.some(xml => xml.includes('Brand text'))).toBe(false)
      }
      expect(result.objects[0]?.status).toBe('native')
      if (master) expect(result.objects[0]?.reasons).toContain('Object is inherited from the selected native layout.')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it.each(['layout', 'master'] as const)('isolates animated fixed %s objects without changing other pages', async scope => {
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-fixed-animation-'))
    try {
      const element = textElement('brand', 'Animated brand', 'Arial')
      ;(element.source as Record<string, unknown>).anchor = 'brand-anchor'
      ;(element.source as Record<string, unknown>).nativeLayoutObject = { layout: 'Brand', name: 'logo', scope }
      const deck = deckWith([element])
      deck.slides.push({ ...deck.slides[0]!, id: 'second' })
      const objects = [{ name: 'logo', x: 0, y: 0, width: 1000, height: 300, text: 'Animated brand' }, { name: 'static', x: 0, y: 500, width: 1000, height: 300, text: 'Shared footer' }]
      const output = join(dir, 'animated.pptx')
      await writeEditablePptx(deck, output, {
        embedFonts: false, slideLayouts: ['Brand', 'Brand'],
        masterLayoutDefinitions: [{ name: 'Brand', placeholders: [], ...(scope === 'master' ? { masterObjects: { objects } } : { fixedObjects: objects }) }],
        objectAnimations: [{ slide: 1, target: 'brand-anchor', kind: 'exit_fade' }],
      })
      const zip = await JSZip.loadAsync(await readFile(output))
      const first = await zip.file('ppt/slides/slide1.xml')!.async('string')
      const second = await zip.file('ppt/slides/slide2.xml')!.async('string')
      expect(first).toContain('Animated brand')
      expect(first).toContain('<p:timing>')
      expect(second).not.toContain('Animated brand')
      const related = async (part: string, role: string): Promise<string> => {
        const rels = await zip.file(`${posix.dirname(part)}/_rels/${posix.basename(part)}.rels`)!.async('string')
        const relation = parseXml(rels).children.find(node => node.attributes.Type?.endsWith(`/${role}`))!
        return posix.normalize(posix.join(posix.dirname(part), relation.attributes.Target!))
      }
      const firstLayout = await related('ppt/slides/slide1.xml', 'slideLayout')
      const secondLayout = await related('ppt/slides/slide2.xml', 'slideLayout')
      expect(firstLayout).not.toBe(secondLayout)
      const firstOwner = scope === 'master' ? await related(firstLayout, 'slideMaster') : firstLayout
      const secondOwner = scope === 'master' ? await related(secondLayout, 'slideMaster') : secondLayout
      const variant = await zip.file(firstOwner)!.async('string')
      const original = await zip.file(secondOwner)!.async('string')
      expect(variant).not.toContain('Animated brand')
      expect(variant).toContain('Shared footer')
      expect(original).toContain('Animated brand')
      expect(original).toContain('Shared footer')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('preserves layout and master membership across twelve pages and three groups', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-multi-master-'))
    try {
      const deck = deckWith([textElement('body', 'Content', 'Arial')])
      deck.slides = Array.from({ length: 12 }, (_, index) => ({ ...deck.slides[0]!, id: `slide-${index + 1}` }))
      const definitions = [
        { name: 'Default', masterId: 'default', masterTheme: { fontFamily: 'Inter', colors: ['112233'] }, placeholders: [] },
        { name: 'Brand title', masterId: 'Brand', masterTheme: { fontFamily: 'Noto Sans SC', colors: ['AABBCC'] }, placeholders: [] },
        { name: 'Brand body', masterId: 'Brand', placeholders: [] },
        { name: 'Appendix', masterId: 'Appendix', placeholders: [] },
      ]
      const selections = deck.slides.map((_, index) => definitions[index % definitions.length]!.name)
      const output = join(dir, 'groups.pptx')
      await writeEditablePptx(deck, output, { embedFonts: false, masterLayoutDefinitions: definitions, slideLayouts: selections })
      const zip = await JSZip.loadAsync(await readFile(output))
      const related = async (source: string, role: string): Promise<string[]> => {
        const xml = await zip.file(`${posix.dirname(source)}/_rels/${posix.basename(source)}.rels`)!.async('string')
        return parseXml(xml).children.filter(node => node.attributes.Type?.endsWith(`/${role}`)).map(node => posix.normalize(posix.join(posix.dirname(source), node.attributes.Target!)))
      }
      const masters = await related('ppt/presentation.xml', 'slideMaster')
      expect(masters).toHaveLength(3)
      const membership = new Map<string, string>()
      for (const master of masters) {
        const layouts = await related(master, 'slideLayout')
        const xml = parseXml(await zip.file(master)!.async('string'))
        expect(xml.children.find(node => node.local === 'sldLayoutIdLst')!.children).toHaveLength(layouts.length)
        for (const layout of layouts) {
          expect(await related(layout, 'slideMaster')).toEqual([master])
          const name = parseXml(await zip.file(layout)!.async('string')).children.find(node => node.local === 'cSld')!.attributes.name
          if (definitions.some(item => item.name === name)) {
            expect(membership.has(name!)).toBe(false)
            membership.set(name!, master)
          }
        }
      }
      const [defaultTheme] = await related(membership.get('Default')!, 'theme')
      const [brandTheme] = await related(membership.get('Brand title')!, 'theme')
      expect(defaultTheme).not.toBe(brandTheme)
      const defaultXml = await zip.file(defaultTheme!)!.async('string')
      const brandXml = await zip.file(brandTheme!)!.async('string')
      expect(defaultXml).toContain('typeface="Inter"')
      expect(defaultXml).toContain('val="112233"')
      expect(brandXml).toContain('typeface="Noto Sans SC"')
      expect(brandXml).toContain('val="AABBCC"')
      expect(defaultXml).not.toContain('val="AABBCC"')
      expect(membership.get('Brand title')).toBe(membership.get('Brand body'))
      expect(new Set([membership.get('Default'), membership.get('Brand title'), membership.get('Appendix')]).size).toBe(3)
      for (let index = 0; index < 12; index++) {
        const [layout] = await related(`ppt/slides/slide${index + 1}.xml`, 'slideLayout')
        const name = parseXml(await zip.file(layout!)!.async('string')).children.find(node => node.local === 'cSld')!.attributes.name
        expect(name).toBe(selections[index])
        expect(await related(layout!, 'slideMaster')).toEqual([membership.get(name!)])
      }
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('maps the captured text font into the PPTX theme', async () => {
    const deck = deckWith([textElement('theme-font', '正文', 'Inter')])
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-theme-font-'))
    const output = join(dir, 'theme-font.pptx')
    try {
      await writeEditablePptx(deck, output, { embedFonts: false })
      const zip = await JSZip.loadAsync(await readFile(output))
      const theme = await zip.file('ppt/theme/theme1.xml')!.async('string')
      expect(theme).toContain('typeface="Inter"')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('maps supplied theme colors into PPTX accent tokens', async () => {
    const deck = deckWith([textElement('theme-colors', '正文', 'Inter')])
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-theme-colors-'))
    const output = join(dir, 'theme-colors.pptx')
    try {
      await writeEditablePptx(deck, output, {
        embedFonts: false,
        themeColors: ['#112233', 'AABBCC', 'not-a-color'],
      })
      const zip = await JSZip.loadAsync(await readFile(output))
      const theme = await zip.file('ppt/theme/theme1.xml')!.async('string')
      expect(theme).toContain('<a:accent1><a:srgbClr val="112233"/>')
      expect(theme).toContain('<a:accent2><a:srgbClr val="AABBCC"/>')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('rejects negative native animation timing before writing an output file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-invalid-timing-'))
    try {
      const output = join(dir, 'invalid.pptx')
      await expect(writeEditablePptx(deckWith([textElement('a', 'A', 'Inter')]), output, {
        embedFonts: false, objectAnimations: [{ slide: 1, target: 'a', kind: 'entrance_fade', delayMs: -10 }],
      })).rejects.toMatchObject({ cause: expect.any(RangeError) })
      await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('writes native fade timing for a compiler-anchored object', async () => {
    const element = textElement('animated', '正文', 'Inter')
    ;(element.source as Record<string, unknown>).anchor = 'agenda'
    const deck = deckWith([element])
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-object-animation-'))
    const output = join(dir, 'animated.pptx')
    try {
      await writeEditablePptx(deck, output, {
        embedFonts: false,
        objectAnimations: [{ slide: 1, target: 'agenda', kind: 'entrance_fade', durationMs: 350 }],
      })
      const zip = await JSZip.loadAsync(await readFile(output))
      const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
      const target = /<p:cNvPr[^>]*id="(\d+)"[^>]*name="fastppt:agenda:animated"/.exec(slide)
      expect(target?.[1]).toBeTruthy()
      expect(slide).toContain('<p:animEffect transition="in" filter="fade">')
      expect(slide).toContain(`<p:spTgt spid="${target?.[1]}"/>`)
      expect(slide).toContain('dur="350"')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('preserves click groups and parallel/sequential offsets in native timing', async () => {
    const element = textElement('timed', 'Timing', 'Inter')
    ;(element.source as Record<string, unknown>).anchor = 'timed'
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-triggers-'))
    try {
      const output = join(dir, 'timing.pptx')
      await writeEditablePptx(deckWith([element]), output, { embedFonts: false, objectAnimations: [
        { slide: 1, target: 'timed', kind: 'entrance_fade', trigger: 'on-click', delayMs: 100, durationMs: 500 },
        { slide: 1, target: 'timed', kind: 'emphasis_pulse', trigger: 'with-previous', delayMs: 50, durationMs: 100 },
        { slide: 1, target: 'timed', kind: 'exit_fade', trigger: 'after-previous', delayMs: 20, durationMs: 100 },
        { slide: 1, target: 'timed', kind: 'appear', trigger: 'on-click' },
      ] })
      const zip = await JSZip.loadAsync(await readFile(output))
      const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect((xml.match(/<p:cond delay="indefinite"\/>/g) ?? []).length).toBe(2)
      for (const [id, delay] of [[3, 100], [6, 150], [9, 270], [12, 0]])
        expect(xml).toContain(`<p:cTn id="${id}" fill="hold"><p:stCondLst><p:cond delay="${delay}"/>`)
      for (const nodeType of ['clickEffect', 'withEffect', 'afterEffect']) expect(xml).toContain(`nodeType="${nodeType}"`)
      expect(xml).toContain('evt="onNext"')
      expect(xml).toContain('evt="onPrev"')
      expect(xml).toContain('presetClass="entr"')
      expect(xml).toContain('<p:attrName>style.visibility</p:attrName>')
      expect(xml).not.toContain('filter="appear"')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('animates every native shape belonging to one source anchor', async () => {
    const elements = [textElement('label', 'Label', 'Inter'), textElement('value', 'Value', 'Inter')]
    for (const element of elements) (element.source as Record<string, unknown>).anchor = 'shared'
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-group-animation-'))
    try {
      const output = join(dir, 'group.pptx')
      await writeEditablePptx(deckWith(elements), output, { embedFonts: false, objectAnimations: [
        { slide: 1, target: 'shared', kind: 'entrance_fade' },
      ] })
      const zip = await JSZip.loadAsync(await readFile(output))
      const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
      const shapes = [...xml.matchAll(/<p:cNvPr[^>]*id="(\d+)"[^>]*name="fastppt:shared:/g)].map((match) => match[1])
      expect(shapes).toHaveLength(2)
      for (const id of shapes) expect(xml).toContain(`<p:spTgt spid="${id}"/>`)
      const timingIds = [...xml.matchAll(/<p:cTn[^>]*id="(\d+)"/g)].map((match) => match[1])
      expect(new Set(timingIds).size).toBe(timingIds.length)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('serializes multiple object animations into one slide timing tree', async () => {
    const first = textElement('first', 'First', 'Inter')
    const second = textElement('second', 'Second', 'Inter')
    ;(first.source as Record<string, unknown>).anchor = 'first'
    ;(second.source as Record<string, unknown>).anchor = 'second'
    const deck = deckWith([first, second])
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-animation-sequence-'))
    const output = join(dir, 'sequence.pptx')
    try {
      await writeEditablePptx(deck, output, {
        embedFonts: false,
        objectAnimations: [
          { slide: 1, target: 'first', kind: 'entrance_fade' },
          { slide: 1, target: 'second', kind: 'exit_fade', durationMs: 550 },
        ],
      })
      const zip = await JSZip.loadAsync(await readFile(output))
      const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect((slide.match(/<p:timing>/g) ?? []).length).toBe(1)
      expect((slide.match(/<p:animEffect /g) ?? []).length).toBe(2)
      expect(slide).toContain('transition="out" filter="fade"')
      expect(slide).toContain('dur="550"')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('round-trips fly, zoom and emphasis filters in native timing', async () => {
    const elements = ['fly', 'zoom', 'pulse'].map((id) => textElement(id, id, 'Inter'))
    for (const element of elements) (element.source as Record<string, unknown>).anchor = element.id
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-animation-effects-'))
    const output = join(dir, 'effects.pptx')
    try {
      await writeEditablePptx(deckWith(elements), output, {
        embedFonts: false,
        objectAnimations: [
          { slide: 1, target: 'fly', kind: 'fly' },
          { slide: 1, target: 'zoom', kind: 'zoom' },
          { slide: 1, target: 'pulse', kind: 'emphasis_pulse', trigger: 'after-previous' },
        ],
      })
      const zip = await JSZip.loadAsync(await readFile(output))
      const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect(slide).toContain('transition="in" filter="fly"')
      expect(slide).toContain('transition="in" filter="zoom"')
      expect(slide).toContain('transition="none" filter="pulse"')
      expect(slide).toContain('delay="0"')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('writes a native motion path for path effects', async () => {
    const element = textElement('path-node', 'Move', 'Inter')
    ;(element.source as Record<string, unknown>).anchor = 'path-node'
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-motion-path-'))
    const output = join(dir, 'path.pptx')
    try {
      await writeEditablePptx(deckWith([element]), output, {
        embedFonts: false,
        objectAnimations: [{ slide: 1, target: 'path-node', kind: 'path_line', path: 'M 0 0 L 0.5 0.25', durationMs: 700 }],
      })
      const zip = await JSZip.loadAsync(await readFile(output))
      const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect(slide).toContain('<p:animMotion')
      expect(slide).toContain('path="M 0 0 L 0.5 0.25"')
      expect(slide).toContain('dur="700"')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('expands native flowcharts into editable PPTX shapes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-native-diagram-'))
    const output = join(dir, 'diagram.pptx')
    try {
      await writeEditablePptx(deckWith([]), output, {
        embedFonts: false,
        nativeDiagrams: [{
          slide: 1,
          document: {
            style: { width: 1200, height: 700, direction: 'lr', fontFamily: 'Arial' },
            nodes: [{ id: 'a', label: 'Start', x: 80, y: 80 }, { id: 'b', label: 'Finish', x: 300, y: 80 }],
            edges: [{ from: 'a', to: 'b' }],
          },
        }],
      })
      const zip = await JSZip.loadAsync(await readFile(output))
      const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect((slide.match(/<p:sp>/g) ?? []).length).toBeGreaterThanOrEqual(4)
      expect(slide).toContain('Start')
      expect(slide).toContain('Finish')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('expands gantt tasks into editable PPTX bars and labels', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-native-gantt-'))
    const output = join(dir, 'gantt.pptx')
    try {
      await writeEditablePptx(deckWith([]), output, {
        embedFonts: false,
        nativeDiagrams: [{
          slide: 1,
          document: {
            kind: 'gantt', style: { width: 1200, height: 700, direction: 'lr', fontFamily: 'Arial' }, nodes: [], edges: [],
            tasks: [{ id: 'build', label: 'Build', start: '2026-01-01T00:00:00.000Z', end: '2026-01-03T00:00:00.000Z' }],
          },
        }],
      })
      const zip = await JSZip.loadAsync(await readFile(output))
      const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect(slide).toContain('Build')
      expect(slide).toContain('2563EB')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('expands timeline tasks into editable markers and labels', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-native-timeline-'))
    const output = join(dir, 'timeline.pptx')
    try {
      await writeEditablePptx(deckWith([]), output, {
        embedFonts: false,
        nativeDiagrams: [{ slide: 1, document: {
          kind: 'timeline', style: { width: 1200, height: 700, direction: 'lr', fontFamily: 'Arial' }, nodes: [], edges: [],
          tasks: [{ id: 'milestone', label: 'Launch', start: '2026-01-02T00:00:00.000Z', end: '2026-01-02T00:00:00.000Z' }],
        } }],
      })
      const zip = await JSZip.loadAsync(await readFile(output))
      const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect(slide).toContain('Launch')
      expect(slide).toContain('ellipse')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('expands matrix nodes into editable PPTX shapes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-native-matrix-'))
    const output = join(dir, 'matrix.pptx')
    try {
      await writeEditablePptx(deckWith([]), output, {
        embedFonts: false,
        nativeDiagrams: [{ slide: 1, document: {
          kind: 'matrix', style: { width: 1200, height: 700, direction: 'lr', fontFamily: 'Arial' },
          nodes: [{ id: 'high', label: 'High impact', x: 700, y: 80, color: '#DCFCE7' }], edges: [],
        } }],
      })
      const zip = await JSZip.loadAsync(await readFile(output))
      const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect(slide).toContain('High impact')
      expect(slide).toContain('DCFCE7')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('replaces only the captured SVG that belongs to a native diagram', async () => {
    const image = (id: string, assetKey: string): Record<string, unknown> => ({
      id,
      kind: 'image',
      box: { x: 0, y: 0, width: 300, height: 160 },
      order: 1,
      zIndex: 1,
      opacity: 1,
      source: { tag: 'img', path: id },
      assetKey,
      data: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
      alt: id,
    })
    const dir = await mkdtemp(join(tmpdir(), 'slidewave-diagram-replacement-'))
    const output = join(dir, 'diagram-replacement.pptx')
    try {
      const result = await writeEditablePptx(deckWith([
        image('diagram', 'http://localhost/assets/generated/flow.svg'),
        image('second-diagram', 'http://localhost/assets/generated/second.svg'),
        image('photo', 'http://localhost/assets/photo.svg'),
      ]), output, {
        embedFonts: false,
        nativeDiagrams: [{ slide: 1, diagramId: 'second', document: { style: { width: 1200, height: 700, direction: 'lr', fontFamily: 'Arial' }, nodes: [{ id: 'b', label: 'Second diagram' }], edges: [] } }, {
          slide: 1,
          diagramId: 'flow',
          document: { style: { width: 1200, height: 700, direction: 'lr', fontFamily: 'Arial' }, nodes: [{ id: 'a', label: 'A' }], edges: [] },
        }],
      })
      const zip = await JSZip.loadAsync(await readFile(output))
      const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect(slide).toContain('A')
      expect(slide).toContain('Second diagram')
      expect(result.objects.filter((object) => object.editableRequired)).toEqual([
        expect.objectContaining({ elementId: 'diagram', status: 'native', imageCount: 0 }),
        expect.objectContaining({ elementId: 'second-diagram', status: 'native', imageCount: 0 }),
      ])
      expect(result.elementCount).toBe(3)
      expect((slide.match(/<p:pic>/g) ?? []).length).toBe(1)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
