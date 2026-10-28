import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { HtmlDeckSnapshotSchema } from '../src/snapshot.js'
import { htmlDeckToPresentation } from '../src/slidev/render.js'
import { parseXml } from '../src/server/slide-xml.js'

it('preserves independent run cancellation, soft breaks, empty defaults and linked script runs in native XML', async () => {
  const style = { fontFamily: 'Liberation Mono', fontFamilies: { ea: 'Noto Serif SC' }, fontSizePx: 20, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, letterSpacingPx: 0, color: { hex: '112233', alpha: 1 }, align: 'left', decoration: ['underline', 'line-through'], direction: 'ltr' }
  const paragraphs = [
    { level: 1, style, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs: [
      { text: 'Latin中文', style: { ...style, decoration: ['underline'] }, hyperlink: 'https://example.com/' },
      { text: '\nStrike\n', style: { ...style, decoration: ['line-through'] } },
      { text: 'Plain\n', style: { ...style, decoration: [] } },
    ] },
    { level: 2, style: { ...style, decoration: [] }, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs: [] },
  ]
  const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: [{ version: 1, id: '1', width: 960, height: 540, warnings: [], elements: [{ id: 'body', kind: 'text', source: { tag: 'div', path: 'body', anchor: 'body' }, order: 0, zIndex: 0, opacity: 1, box: { x: 40, y: 40, width: 600, height: 300 }, style, text: paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n'), paragraphs }] }] })
  const result = htmlDeckToPresentation(snapshot)
  expect(result.objects).toMatchObject([{ status: 'native', nativeCount: 1, imageCount: 0 }])
  const zip = await JSZip.loadAsync(await result.presentation.toArrayBuffer())
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
  const nodes: ReturnType<typeof parseXml>[] = []
  const visit = (node: ReturnType<typeof parseXml>) => { nodes.push(node); node.children.forEach(visit) }
  visit(parseXml(xml))
  const all = (local: string) => nodes.filter(node => node.local === local)
  const flags = (node: ReturnType<typeof parseXml>) => [node.attributes.u, node.attributes.strike]
  expect(all('sp')).toHaveLength(1)
  expect(all('p')).toHaveLength(2)
  expect(all('defRPr').map(flags)).toEqual([['sng', 'sngStrike'], ['none', 'noStrike']])
  expect(all('endParaRPr').map(flags)).toEqual(all('defRPr').map(flags))
  expect(all('br').map(node => flags(node.children.find(child => child.local === 'rPr')!))).toEqual([['none', 'sngStrike'], ['none', 'sngStrike'], ['none', 'noStrike']])
  const runs = all('r').map(node => ({ text: node.children.filter(child => child.local === 't').map(child => xml.slice(child.openEnd, child.closeStart)).join(''), flags: flags(node.children.find(child => child.local === 'rPr')!) }))
  expect(runs).toEqual([{ text: 'Latin', flags: ['sng', 'noStrike'] }, { text: '中文', flags: ['sng', 'noStrike'] }, { text: 'Strike', flags: ['none', 'sngStrike'] }, { text: 'Plain', flags: ['none', 'noStrike'] }])
  expect(all('hlinkClick')).toHaveLength(2)
  expect(await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')).toContain('https://example.com/')
})

it('replays the measured decoration paths and pins the actual application evidence producers', async () => {
  type Segment = { kind: string; line: number; left: number; right: number }
  type Entry = { id: string; page: number; status: string; source: { runs: Array<{ text: string }> }; importedText: string; expected: Segment[]; measured: Segment[]; spans: Array<{ origin: [number, number] }>; drawings: Array<{ left: number; right: number; y: number; width: number; color: number[] }> }
  const root = new URL('../../../', import.meta.url)
  const report = JSON.parse(await readFile(new URL('docs/validation/decorations-libreoffice-7.3.7.2.json', root), 'utf8')) as { browserPixelEquivalence: string; tolerancePoints: number; sourcePptxSha256: string; reproducers: Array<{ path: string; sha256: string }>; artifacts: Array<{ stage: string; pptxSha256: string; pdfSha256: string; drawingsSha256: string; pageCount: number; cases: Entry[] }> }
  expect(report.browserPixelEquivalence).toBe('unverified')
  expect(report.tolerancePoints).toBe(0.25)
  expect(report.artifacts).toHaveLength(1)
  const artifact = report.artifacts[0]!
  expect(artifact.stage).toBe('actual-native-export')
  expect(artifact.pptxSha256).toBe(report.sourcePptxSha256)
  for (const hash of [artifact.pptxSha256, artifact.pdfSha256, artifact.drawingsSha256]) expect(hash).toMatch(/^[a-f0-9]{64}$/)
  expect(artifact.pageCount).toBe(12)
  expect(artifact.cases).toHaveLength(12)
  expect(new Set(artifact.cases.map(entry => entry.id)).size).toBe(12)
  for (const [index, entry] of artifact.cases.entries()) {
    expect(entry.page).toBe(index + 1)
    expect(entry.status).toBe('matched')
    expect(entry.importedText).toBe(entry.source.runs.map(run => run.text).join(''))
    // Recompute from saved PDF paths, rather than trusting the recorded status.
    const paths = entry.drawings.map(drawing => {
      const delta = drawing.y - entry.spans[0]!.origin[1], line = Math.round(delta / 30) || 0
      expect(drawing.width).toBeGreaterThan(0)
      expect(drawing.color).toHaveLength(3)
      drawing.color.forEach((value, channel) => expect(value).toBeCloseTo([17 / 255, 34 / 255, 51 / 255][channel]!, 3))
      return { kind: delta - line * 30 > 0 ? 'underline' : 'line-through', line, left: drawing.left, right: drawing.right }
    }).sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind) || a.left - b.left)
    const segments: Segment[] = []
    for (const path of paths) {
      const previous = segments.at(-1)
      if (previous && previous.kind === path.kind && previous.line === path.line && Math.abs(previous.right - path.left) <= report.tolerancePoints) previous.right = path.right
      else segments.push({ ...path })
    }
    expect(segments).toEqual(entry.measured)
    expect(segments).toHaveLength(entry.expected.length)
    for (const [at, segment] of segments.entries()) {
      const expected = entry.expected[at]!
      expect([segment.kind, segment.line]).toEqual([expected.kind, expected.line])
      expect(Math.abs(segment.left - expected.left)).toBeLessThanOrEqual(report.tolerancePoints)
      expect(Math.abs(segment.right - expected.right)).toBeLessThanOrEqual(report.tolerancePoints)
    }
  }
  for (const file of report.reproducers) expect(createHash('sha256').update(await readFile(new URL(file.path, root))).digest('hex')).toBe(file.sha256)
})
