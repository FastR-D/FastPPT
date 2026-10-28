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

it('keeps display modes independent of scaling, omission and explicit cancellation', () => {
  const source = { fontSize: 20, capitalization: 'all' as const, levels: [{ level: 2, textStyle: { capitalization: 'none' as const } }, { level: 3, textStyle: { capitalization: 'small' as const } }] }
  const scaled = scaleNativeTextStyle(source, 2)
  expect([1, 2, 3, 4].map(level => resolveNativeTextStyle(scaled, level).capitalization)).toEqual(['all', 'none', 'small', 'all'])
  expect(scaled.fontSize).toBe(40)
  expect(source.fontSize).toBe(20)
  expect(nativeListStyleXml({})).not.toContain('cap=')
  expect(nodes(parseXml(`<root xmlns:a="${drawing}">${nativeListStyleXml(scaled)}</root>`), 'defRPr').slice(0, 4).map(node => node.attributes.cap)).toEqual(['all', 'none', 'small', 'all'])
  const fixed = parseXml(nativeMasterLayoutXml({ name: 'Caps', canvas: { width: 1000, height: 1000 }, placeholders: [], fixedObjects: [{ name: 'Fixed', x: 0, y: 0, width: 500, height: 100, text: 'Straße', capitalization: 'small' }] }, { width: 2000, height: 1000 }))
  expect(nodes(fixed, 'rPr')[0]!.attributes.cap).toBe('small')
  for (const capitalization of ['ALL', '', 'uppercase', null, 0, true]) {
    expect(() => nativeListStyleXml({ capitalization } as never)).toThrow('capitalization')
    expect(() => nativeMasterLayoutXml({ name: 'Bad', placeholders: [], fixedObjects: [{ name: 'Bad', x: 0, y: 0, width: 100, height: 100, capitalization }] } as never)).toThrow('capitalization')
  }
})

it('removes only capitalization owned by the bound layout level', () => {
  const xml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${drawing}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody>${[0, 1, 2].map(level => `<a:p><a:pPr lvl="${level}"><a:defRPr cap="all"/></a:pPr><a:r><a:rPr cap="none" u="sng"/><a:t>Straße</a:t></a:r><a:br><a:rPr cap="small"/></a:br><a:endParaRPr cap="all"/></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const slot = { index: 0, type: 'body' as const, x: 0, y: 0, width: 1000, height: 1000, textStyle: { levels: [{ level: 2, textStyle: { capitalization: 'none' as const } }] } }
  const result = parseXml(bindSlidePlaceholder(xml, '2', slot, 'page', 'layout'))
  expect(nodes(result, 'rPr').map(node => node.attributes.cap)).toEqual(['none', 'small', undefined, undefined, 'none', 'small'])
  expect(nodes(result, 'endParaRPr').map(node => node.attributes.cap)).toEqual(['all', undefined, 'all'])
  expect(nodes(result, 'defRPr').map(node => node.attributes.cap)).toEqual(['all', undefined, 'all'])
  expect(nodes(result, 'rPr').filter(node => node.attributes.u === 'sng')).toHaveLength(3)
  expect(nodes(parseXml(bindSlidePlaceholder(xml, '2', slot, 'page', 'page')), 'rPr').map(node => node.attributes.cap)).toEqual(['none', 'small', 'none', 'small', 'none', 'small'])
})

it('preserves original Unicode and per-run display modes after writer splitting', async () => {
  const presentation = new NodePresentation({ layout: 'LAYOUT_16x9' }), slide = presentation.addSlide()
  const runs = [{ text: 'Straße' }, { text: 'i ı\nﬃ', options: { capitalization: 'none', lang: 'tr-TR', hyperlink: { url: 'https://example.com/' } } }, { text: 'Abc', options: { capitalization: 'small' } }]
  const original = structuredClone(runs)
  slide.addText(runs, { x: 1, y: 1, w: 8, h: 2, capitalization: 'all', lang: 'de-DE' })
  slide.addText('Undeclared', { x: 1, y: 4, w: 8, h: 1 })
  const zip = await JSZip.loadAsync(await presentation.toArrayBuffer()), xml = await zip.file('ppt/slides/slide1.xml')!.async('string'), tree = parseXml(xml)
  expect(nodes(tree, 'rPr').map(node => node.attributes.cap)).toEqual(['all', 'none', 'none', 'small', undefined])
  expect(nodes(tree, 'rPr').map(node => node.attributes.lang)).toEqual(['de-DE', 'tr-TR', 'tr-TR', 'de-DE', undefined])
  expect(xml).toContain('<a:t>Straße</a:t>')
  expect(xml).toContain('<a:t>ﬃ</a:t>')
  expect(xml).not.toContain('x-fastppt-')
  expect(runs).toEqual(original)
  expect(nodes(tree, 'hlinkClick')).toHaveLength(2)
  for (const capitalization of [null, 'uppercase', '', 0]) {
    expect(() => slide.addText('Invalid', { capitalization })).toThrow('capitalization')
    expect(() => slide.addText([{ text: 'Invalid', options: { capitalization } }], {})).toThrow('capitalization')
  }
})

it('writes paragraph, linked mixed-script run, break and empty-line modes in one editable frame', async () => {
  const style = { fontFamily: 'Liberation Serif', fontFamilies: { ea: 'Noto Serif SC' }, fontSizePx: 20, letterSpacingPx: 0, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, capitalization: 'all', color: { hex: '112233', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr' }
  const paragraphs = [{ level: 1, style, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs: [{ text: 'Straße中文\n', style: { ...style, capitalization: 'none' }, hyperlink: 'https://example.com/' }, { text: 'Abc\n', style: { ...style, capitalization: 'small' } }] }, { level: 2, style: { ...style, capitalization: 'none' }, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs: [] }]
  const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: [{ version: 1, id: '1', width: 959.976, height: 539.9865, warnings: [], elements: [{ id: 'body', kind: 'text', source: { tag: 'div', path: 'body', anchor: 'body' }, box: { x: 40, y: 40, width: 600, height: 300 }, order: 0, zIndex: 0, opacity: 1, style, text: paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n'), paragraphs }] }] })
  const result = htmlDeckToPresentation(snapshot)
  expect(result.objects).toMatchObject([{ status: 'native', nativeCount: 1, imageCount: 0 }])
  expect(result.warnings).toMatchObject([{ code: 'text-capitalization-compatibility', elementId: 'body' }])
  expect(result.objects[0]!.reasons).toEqual([expect.stringContaining('Original text')])
  const zip = await JSZip.loadAsync(await result.presentation.toArrayBuffer()), xml = await zip.file('ppt/slides/slide1.xml')!.async('string'), tree = parseXml(xml)
  expect(nodes(tree, 'sp')).toHaveLength(1)
  expect(nodes(tree, 'p')).toHaveLength(2)
  expect(nodes(tree, 'defRPr').map(n => n.attributes.cap)).toEqual(['all', 'none'])
  expect(nodes(tree, 'endParaRPr').map(n => n.attributes.cap)).toEqual(['all', 'none'])
  expect(nodes(tree, 'br').map(n => n.children[0]!.attributes.cap)).toEqual(['none', 'small'])
  expect(nodes(tree, 'rPr').map(n => n.attributes.cap)).toEqual(['none', 'none', 'none', 'small', 'small'])
  expect(xml).toContain('<a:t>Straße</a:t>')
  expect(xml).toContain('<a:t>Abc</a:t>')
  expect(() => HtmlDeckSnapshotSchema.parse({ ...snapshot, slides: [{ ...snapshot.slides[0], elements: [{ ...snapshot.slides[0]!.elements[0], style: { ...style, capitalization: 'uppercase' } }] }] })).toThrow()
})

it('replays application observations without treating generic CSS as capture or pixel acceptance', async () => {
  const { readFile } = await import('node:fs/promises'), { createHash } = await import('node:crypto')
  type Glyph = { text: string; origin: [number, number]; size: number; font: string }
  type Entry = { page: number; source: { id: string; text: string; font: string; language: string; cap: string; upper: string; knownUpper: string; observationOnly?: boolean }; importedText: string; sourcePreserved: boolean; nativeDisplayText: string; browserDisplayText: string; genericCssReference: { textContent: string; innerText: string; widthPoints: number; withoutSynthesisWidthPoints: number }; nativeGlyphs: Glyph[]; browserGlyphs: Glyph[]; allControlPage?: number; matchesFullCapitals?: boolean; status: string }
  const root = new URL('../../../', import.meta.url)
  const report = JSON.parse(await readFile(new URL('docs/validation/capitalization-libreoffice-7.3.7.2.json', root), 'utf8')) as { browserReference: string; browserPixelEquivalence: string; sourcePptxSha256: string; browser: { pdfSha256: string }; fonts: Array<{ requested: string; features: string[]; sha256: string }>; reproducers: Array<{ path: string; sha256: string }>; artifacts: Array<{ stage: string; pptxSha256: string; pdfSha256: string; glyphsSha256: string; pageCount: number; cases: Entry[] }> }
  expect(report.browserReference).toContain('does not exercise FastPPT capture')
  expect(report.browserPixelEquivalence).toBe('unverified')
  expect(report.artifacts).toHaveLength(1)
  const artifact = report.artifacts[0]!
  expect(artifact.stage).toBe('actual-native-export')
  expect(artifact.pptxSha256).toBe(report.sourcePptxSha256)
  for (const hash of [artifact.pptxSha256, artifact.pdfSha256, artifact.glyphsSha256, report.browser.pdfSha256, ...report.fonts.map(font => font.sha256)]) expect(hash).toMatch(/^[a-f0-9]{64}$/)
  expect(artifact.pageCount).toBe(36)
  expect(artifact.cases).toHaveLength(36)
  const counts: Record<string, number> = {}
  for (const [index, entry] of artifact.cases.entries()) {
    expect(entry.page).toBe(index + 1)
    expect(entry.importedText).toBe(entry.source.text)
    expect(entry.genericCssReference.textContent).toBe(entry.source.text)
    expect(entry.sourcePreserved).toBe(true)
    expect(entry.nativeDisplayText).toBe(entry.nativeGlyphs.map(glyph => glyph.text).join(''))
    expect(entry.browserDisplayText).toBe(entry.browserGlyphs.map(glyph => glyph.text).join(''))
    if (entry.source.cap === 'all') expect(entry.genericCssReference.innerText).toBe(entry.source.upper)
    let status: string
    if (entry.source.observationOnly || (entry.source.cap === 'none' && entry.source.text === 'ﬃ' && entry.source.font === 'Liberation Serif')) status = 'observed-only'
    else if (entry.source.cap === 'small') {
      const control = artifact.cases[entry.allControlPage! - 1]!
      expect(control.source).toMatchObject({ text: entry.source.text, language: entry.source.language, font: entry.source.font, cap: 'all' })
      expect(entry.nativeGlyphs).toHaveLength(control.nativeGlyphs.length)
      for (const [at, glyph] of entry.nativeGlyphs.entries()) {
        const reference = control.nativeGlyphs[at]!
        expect(glyph.text).toBe(reference.text)
        expect(glyph.font).toBe(reference.font)
        expect(Math.abs(glyph.size - reference.size)).toBeLessThan(0.05)
        expect(Math.abs(glyph.origin[0] - reference.origin[0])).toBeLessThan(0.05)
        expect(Math.abs(glyph.origin[1] - reference.origin[1])).toBeLessThan(0.05)
      }
      expect(entry.matchesFullCapitals).toBe(true)
      expect(entry.nativeDisplayText).toBe(entry.source.knownUpper)
      status = 'small-caps-as-full-capitals'
    } else if (entry.nativeDisplayText === (entry.source.cap === 'none' ? entry.source.text : entry.source.upper)) status = 'display-text-matched'
    else {
      expect(entry.source.cap).toBe('all')
      expect(entry.nativeDisplayText).toBe(entry.source.knownUpper)
      status = 'case-mapping-difference'
    }
    expect(entry.status).toBe(status)
    counts[status] = (counts[status] ?? 0) + 1
  }
  expect(counts).toEqual({ 'display-text-matched': 14, 'observed-only': 6, 'case-mapping-difference': 6, 'small-caps-as-full-capitals': 10 })
  for (const font of report.fonts) {
    const basic = artifact.cases.find(entry => entry.source.id === `${font.requested}-small-basic`)!
    const synthetic = Math.abs(basic.genericCssReference.widthPoints - basic.genericCssReference.withoutSynthesisWidthPoints) > 0.5
    expect(synthetic).toBe(!font.features.includes('smcp'))
    expect(basic.browserGlyphs.some(glyph => glyph.size < 19)).toBe(synthetic)
  }
  for (const file of report.reproducers) expect(createHash('sha256').update(await readFile(new URL(file.path, root))).digest('hex')).toBe(file.sha256)
})
