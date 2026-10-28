import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { nativeListStyleXml, resolveNativeTextStyle, scaleNativeTextStyle } from '../src/server/native-text-style.js'
import { nativeMasterLayoutXml } from '../src/server/master-layout.js'
import { bindSlidePlaceholder } from '../src/server/placeholder-binding.js'
import { NodePresentation } from '../src/server/presentation.js'
import { parseXml } from '../src/server/slide-xml.js'
import { HtmlDeckSnapshotSchema } from '../src/snapshot.js'
import { htmlDeckToPresentation } from '../src/slidev/render.js'

type Xml = ReturnType<typeof parseXml>
const nodes = (node: Xml, local: string): Xml[] => [...(node.local === local ? [node] : []), ...node.children.flatMap(child => nodes(child, local))]
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main'

it('scales point kerning thresholds and preserves zero, omitted levels and fixed text', () => {
  const source = { fontSize: 20, kerningThreshold: 1.25, levels: [{ level: 2, textStyle: { kerningThreshold: 0 } }, { level: 3, textStyle: { kerningThreshold: 0.75 } }] }
  const scaled = scaleNativeTextStyle(source, 2)
  expect([1, 2, 3, 4].map(level => resolveNativeTextStyle(scaled, level).kerningThreshold)).toEqual([2.5, 0, 1.5, 2.5])
  expect(source.kerningThreshold).toBe(1.25)
  expect(scaled.fontSize).toBe(40)
  expect(resolveNativeTextStyle({}, 2).kerningThreshold).toBeUndefined()
  const root = parseXml(`<root xmlns:a="${drawing}">${nativeListStyleXml(scaled)}</root>`)
  expect(nodes(root, 'defRPr').slice(0, 4).map(node => node.attributes.kern)).toEqual(['250', '0', '150', '250'])
  const fixed = parseXml(nativeMasterLayoutXml({ name: 'Spacing', canvas: { width: 1000, height: 1000 }, placeholders: [], fixedObjects: [{ name: 'Fixed', x: 0, y: 0, width: 500, height: 100, text: 'Body', kerningThreshold: 0.25 }] }, { width: 2000, height: 1000 }))
  expect(nodes(fixed, 'rPr')[0]!.attributes.kern).toBe('50')
  for (const kerningThreshold of [Infinity, NaN, 4000.01, -0.01, '1', null]) {
    expect(() => nativeListStyleXml({ kerningThreshold } as never)).toThrow('kerningThreshold')
    expect(() => nativeMasterLayoutXml({ name: 'Bad', placeholders: [], fixedObjects: [{ name: 'Bad', x: 0, y: 0, width: 100, height: 100, kerningThreshold }] } as never)).toThrow('kerningThreshold')
  }
  expect(nativeListStyleXml({ kerningThreshold: 0 })).toContain('kern="0"')
  expect(nativeListStyleXml({ kerningThreshold: 4000 })).toContain('kern="400000"')
})

it('inherits only the declared kerning level, including defaults, breaks and paragraph ends', () => {
  const xml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${drawing}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody>${[0, 1, 2].map(level => `<a:p><a:pPr lvl="${level}"><a:defRPr kern="120"/></a:pPr><a:r><a:rPr kern="-80" u="sng"/><a:t>Body</a:t></a:r><a:br><a:rPr kern="0"/></a:br><a:endParaRPr kern="100"/></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const slot = { index: 0, type: 'body' as const, x: 0, y: 0, width: 1000, height: 1000, textStyle: { levels: [{ level: 2, textStyle: { kerningThreshold: 0 } }] } }
  const result = parseXml(bindSlidePlaceholder(xml, '2', slot, 'page', 'layout'))
  expect(nodes(result, 'rPr').map(node => node.attributes.kern)).toEqual(['-80', '0', undefined, undefined, '-80', '0'])
  expect(nodes(result, 'endParaRPr').map(node => node.attributes.kern)).toEqual(['100', undefined, '100'])
  expect(nodes(result, 'defRPr').map(node => node.attributes.kern)).toEqual(['120', undefined, '120'])
  expect(nodes(result, 'rPr').filter(node => node.attributes.u === 'sng')).toHaveLength(3)
  expect(bindSlidePlaceholder(xml, '2', slot, 'page', 'page')).toContain('kern="-80"')
})

it('restores explicitly zero native run kerning while preserving undeclared inheritance and input data', async () => {
  const presentation = new NodePresentation({ layout: 'LAYOUT_16x9' }), slide = presentation.addSlide()
  const runs = [{ text: 'Base' }, { text: 'Zero\nNext', options: { kerningThreshold: 0, hyperlink: { url: 'https://example.com/' } } }, { text: 'Local', options: { kerningThreshold: 1.25 } }]
  const original = structuredClone(runs)
  slide.addText(runs, { x: 1, y: 1, w: 8, h: 2, kerningThreshold: 2 })
  slide.addText('Undeclared', { x: 1, y: 4, w: 8, h: 1 })
  const zip = await JSZip.loadAsync(await presentation.toArrayBuffer())
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
  expect(nodes(parseXml(xml), 'rPr').map(node => node.attributes.kern)).toEqual(['200', '0', '0', '125', undefined])
  expect(xml).not.toContain('x-fastppt-')
  expect(runs).toEqual(original)
  expect(nodes(parseXml(xml), 'hlinkClick')).toHaveLength(2)
  for (const kerningThreshold of [null, '0', Infinity, 4001]) expect(() => slide.addText('Invalid', { kerningThreshold })).toThrow('kerningThreshold')
})

it('writes independent paragraph, run, soft-break and empty-line kerning in one editable frame', async () => {
  const style = { fontFamily: 'Liberation Mono', fontFamilies: { ea: 'Noto Serif SC' }, fontSizePx: 20, letterSpacingPx: 0, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, kerningThresholdPx: 2, color: { hex: '112233', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr' }
  const paragraphs = [{ level: 1, style, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs: [{ text: 'Zero中文\n', style: { ...style, kerningThresholdPx: 0 }, hyperlink: 'https://example.com/' }, { text: 'Local\n', style: { ...style, kerningThresholdPx: 1.25 } }] }, { level: 2, style: { ...style, kerningThresholdPx: 0 }, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs: [] }]
  const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: [{ version: 1, id: '1', width: 959.976, height: 539.9865, warnings: [], elements: [{ id: 'body', kind: 'text', source: { tag: 'div', path: 'body', anchor: 'body' }, box: { x: 40, y: 40, width: 600, height: 300 }, order: 0, zIndex: 0, opacity: 1, style, text: paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n'), paragraphs }] }] })
  const result = htmlDeckToPresentation(snapshot)
  expect(result.objects).toMatchObject([{ status: 'native', nativeCount: 1, imageCount: 0 }])
  expect(result.warnings).toMatchObject([{ code: 'text-kerning-compatibility', elementId: 'body' }])
  expect(result.objects[0]!.reasons).toEqual([expect.stringContaining('threshold')])
  const zip = await JSZip.loadAsync(await result.presentation.toArrayBuffer()), tree = parseXml(await zip.file('ppt/slides/slide1.xml')!.async('string'))
  expect(nodes(tree, 'sp')).toHaveLength(1)
  expect(nodes(tree, 'p')).toHaveLength(2)
  expect(nodes(tree, 'defRPr').map(n => n.attributes.kern)).toEqual(['200', '0'])
  expect(nodes(tree, 'endParaRPr').map(n => n.attributes.kern)).toEqual(['200', '0'])
  expect(nodes(tree, 'br').map(n => n.children[0]!.attributes.kern)).toEqual(['0', '125'])
  expect(nodes(tree, 'rPr').map(n => n.attributes.kern)).toEqual(['0', '0', '0', '125', '125'])
})


it('parses source kerning thresholds without conflating omission, zero and malformed values', async () => {
  const { parseSourceKerning } = await import('../src/primitives/text-kerning.mjs')
  expect(['0', '2000', '2001', '400000'].map(parseSourceKerning)).toEqual([0, 20, 20.01, 4000])
  for (const value of ['-1', '1.5', '20pt', '400001', '', 'NaN', null]) expect(parseSourceKerning(value)).toBeUndefined()
})

it('replays actual glyphs against independently stored font advances and kerning pairs', async () => {
  const { readFile } = await import('node:fs/promises'), { createHash } = await import('node:crypto')
  type Glyph = { text: string; x: number; line: number; size: number; font: string }
  type Font = { requested: string; sha256: string; postscript: string; unitsPerEm: number; advances: Record<string, number>; pairs: Record<string, number> }
  type Entry = { id: string; page: number; status: string; importedText: string; source: { text: string; threshold: number; size: number; spacing: number; font: string; expected?: Glyph[]; known?: Glyph[] }; measured: Glyph[]; glyphs: Array<{ text: string; origin: [number, number]; size: number; font: string }> }
  const root = new URL('../../../', import.meta.url)
  const report = JSON.parse(await readFile(new URL('docs/validation/kerning-libreoffice-7.3.7.2.json', root), 'utf8')) as { browserPixelEquivalence: string; tolerancePoints: number; fontSizeTolerancePoints: number; sourcePptxSha256: string; fonts: Font[]; reproducers: Array<{ path: string; sha256: string }>; artifacts: Array<{ stage: string; pptxSha256: string; pdfSha256: string; glyphsSha256: string; pageCount: number; cases: Entry[] }> }
  expect(report.browserPixelEquivalence).toBe('unverified')
  expect(report.tolerancePoints).toBe(0.5)
  expect(report.fontSizeTolerancePoints).toBe(0.05)
  expect(report.artifacts).toHaveLength(1)
  const artifact = report.artifacts[0]!
  expect(artifact.stage).toBe('actual-native-export')
  expect(artifact.pptxSha256).toBe(report.sourcePptxSha256)
  for (const hash of [artifact.pptxSha256, artifact.pdfSha256, artifact.glyphsSha256, ...report.fonts.map(font => font.sha256)]) expect(hash).toMatch(/^[a-f0-9]{64}$/)
  expect(artifact.pageCount).toBe(20)
  expect(artifact.cases).toHaveLength(20)
  expect(artifact.cases.filter(entry => entry.status === 'matched')).toHaveLength(10)
  expect(artifact.cases.filter(entry => entry.status === 'known-difference')).toHaveLength(9)
  expect(artifact.cases.filter(entry => entry.status === 'observed-only').map(entry => entry.id)).toEqual(['missing-font'])
  for (const [index, entry] of artifact.cases.entries()) {
    expect(entry.page).toBe(index + 1)
    expect(entry.status).not.toBe('unexpected')
    expect(entry.importedText).toBe(entry.source.text)
    const baseline = entry.glyphs[0]?.origin[1] ?? 0
    const measured = entry.glyphs.map(glyph => ({ text: glyph.text, x: glyph.origin[0], line: Math.round((glyph.origin[1] - baseline) / 60) || 0, size: glyph.size, font: glyph.font }))
    expect(measured).toEqual(entry.measured)
    const font = report.fonts.find(font => font.requested === entry.source.font)
    if (!font) {
      expect(entry.status).toBe('observed-only')
      expect(entry.source.expected).toBeUndefined()
      expect(entry.glyphs.length).toBeGreaterThan(0)
      continue
    }
    const positions = (on: boolean) => entry.source.text.split('\n').flatMap((text, line) => {
      let x = 40
      return [...text].map((text, at, characters) => {
        if (at && on) x += (font.pairs[characters[at - 1]! + text] ?? 0) * entry.source.size / font.unitsPerEm
        const value = { text, x, line, size: entry.source.size, font: font.postscript }
        x += font.advances[text]! * entry.source.size / font.unitsPerEm + entry.source.spacing
        return value
      })
    })
    expect(entry.source.expected).toEqual(positions(entry.source.size >= entry.source.threshold))
    expect(entry.source.known).toEqual(positions(true))
    const matches = (expected: Glyph[]) => measured.length === expected.length && measured.every((glyph, at) => glyph.text === expected[at]!.text && glyph.font === expected[at]!.font && glyph.line === expected[at]!.line && Math.abs(glyph.x - expected[at]!.x) <= report.tolerancePoints && Math.abs(glyph.size - expected[at]!.size) < report.fontSizeTolerancePoints && Math.abs(entry.glyphs[at]!.origin[1] - baseline - glyph.line * 60) <= 0.25)
    expect(matches(entry.source.expected!)).toBe(entry.status === 'matched')
    if (entry.status === 'known-difference') expect(matches(entry.source.known!)).toBe(true)
  }
  for (const file of report.reproducers) expect(createHash('sha256').update(await readFile(new URL(file.path, root))).digest('hex')).toBe(file.sha256)
})
