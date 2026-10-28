import { expect, it } from 'vitest'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { HtmlDeckSnapshotSchema } from '../src/snapshot.js'
import { htmlDeckToPresentation } from '../src/slidev/render.js'
import { parseXml } from '../src/server/slide-xml.js'

it('writes aligned and nonnegative bullets as one native shape with source indents and authored breaks', async () => {
  const style = { fontFamily: 'Liberation Mono', fontSizePx: 20, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, letterSpacingPx: 0, color: { hex: '112233', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr' }
  const paragraphs = ['left', 'center', 'right', 'justify'].flatMap(align => [-20, 0, 20].map(indentPx => ({ level: 1, style: { ...style, align }, indentPx, marginLeftPx: 40, marginRightPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, bullet: { kind: 'character', character: '*' }, bulletFont: { kind: 'font', fontFamily: 'Liberation Mono' }, bulletSize: { kind: 'pixels', value: 36 }, runs: [{ text: 'AAAA BBBB CCCC', style }] })))
  paragraphs[3]!.runs[0]!.text = 'AAAA\nBBBB'
  const text = paragraphs.map(p => p.runs.map(run => run.text).join('')).join('\n')
  const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: [{ version: 1, id: '1', width: 959.976, height: 539.9865, warnings: [], elements: [{ id: 'body', kind: 'text', text, style, paragraphs, box: { x: 40, y: 40, width: 186, height: 440 }, source: { tag: 'div', path: 'body', anchor: 'body' }, order: 0, zIndex: 0, opacity: 1 }] }] })
  const result = htmlDeckToPresentation(snapshot)
  expect(result.objects).toMatchObject([{ nativeCount: 1, imageCount: 0, status: 'native', reasons: expect.arrayContaining([expect.stringContaining('OpenSymbol')]) }])
  expect(result.warnings.filter(warning => warning.code === 'text-bullet-compatibility')).toHaveLength(12)
  const zip = await JSZip.loadAsync(await result.presentation.toArrayBuffer())
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
  const nodes: ReturnType<typeof parseXml>[] = []
  const visit = (node: ReturnType<typeof parseXml>) => { nodes.push(node); node.children.forEach(visit) }
  visit(parseXml(xml))
  expect(nodes.filter(node => node.local === 'sp')).toHaveLength(1)
  expect(nodes.filter(node => node.local === 'p')).toHaveLength(12)
  expect(nodes.filter(node => node.local === 'br')).toHaveLength(1)
  expect(nodes.filter(node => node.local === 'pPr').map(node => [node.attributes.algn, node.attributes.indent])).toEqual(['l', 'ctr', 'r', 'just'].flatMap(align => ['-254000', '0', '254000'].map(indent => [align, indent])))
  expect(nodes.filter(node => node.local === 'buChar').map(node => node.attributes.char)).toEqual(Array(12).fill('*'))
  expect(nodes.filter(node => node.local === 'buSzPts').map(node => node.attributes.val)).toEqual(Array(12).fill('3600'))
  expect(nodes.filter(node => node.local === 't').map(node => xml.slice(node.openEnd, node.closeStart)).join('')).toBe(text.replaceAll('\n', ''))
})

it('keeps native bullet observations and known font/size differences tied to reproducible artifacts', async () => {
  type Horizontal = { text: string; x: number; width: number; line: number }
  type Entry = { id: string; page: number; source: { text: string }; importedText: string; measured: Horizontal[]; expected: Horizontal[]; known?: Horizontal[]; status: string; fontMatches: boolean }
  const root = new URL('../../../', import.meta.url)
  const report = JSON.parse(await readFile(new URL('docs/validation/bullets-libreoffice-7.3.7.2.json', root), 'utf8')) as { baseline: string; tolerancePoints: number; sourcePptxSha256: string; reproducers: Array<{ path: string; sha256: string }>; artifacts: Array<{ stage: string; pptxSha256: string; pdfSha256: string; pageCount: number; cases: Entry[] }> }
  expect(report.baseline).toBe('unverified')
  expect(report.tolerancePoints).toBe(0.25)
  expect(report.artifacts).toHaveLength(1)
  const artifact = report.artifacts[0]!
  expect(artifact.stage).toBe('actual-native-export')
  expect(artifact.pptxSha256).toBe(report.sourcePptxSha256)
  expect(artifact.pdfSha256).toMatch(/^[a-f0-9]{64}$/)
  expect(artifact.pageCount).toBe(46)
  expect(artifact.cases).toHaveLength(46)
  expect(new Set(artifact.cases.map(entry => entry.id)).size).toBe(46)
  for (const [index, entry] of artifact.cases.entries()) {
    expect(entry.page).toBe(index + 1)
    expect(entry.importedText).toBe(entry.source.text)
    expect(entry.status).not.toBe('unexpected')
    if (entry.status === 'observed-only') { expect(['too-wide-indent', 'tab-after-marker']).toContain(entry.id); continue }
    const expected = entry.status === 'matched' ? entry.expected : entry.known!
    expect(expected).toBeDefined()
    expect(entry.measured).toHaveLength(expected.length)
    for (const [at, actual] of entry.measured.entries()) {
      const value = expected[at]!
      expect([actual.text, actual.line]).toEqual([value.text, value.line])
      expect(Math.abs(actual.x - value.x)).toBeLessThanOrEqual(report.tolerancePoints)
      expect(Math.abs(actual.width - value.width)).toBeLessThanOrEqual(report.tolerancePoints)
    }
    if (entry.status === 'matched') expect(entry.fontMatches).toBe(true)
  }
  for (const id of ['points-36', 'large-marker-long-word', 'follow-font-left-20', 'bold-first-run']) expect(artifact.cases.find(entry => entry.id === id)!.status).toBe('known-difference')
  for (const file of report.reproducers) expect(createHash('sha256').update(await readFile(new URL(file.path, root))).digest('hex')).toBe(file.sha256)
})
