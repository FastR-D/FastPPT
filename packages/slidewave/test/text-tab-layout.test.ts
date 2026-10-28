import { expect, it } from 'vitest'
import JSZip from 'jszip'
import { validateTextTabLayout, type TextTabLayout } from '../src/primitives/text-tab-layout.js'
import { HtmlDeckSnapshotSchema } from '../src/snapshot.js'
import { htmlDeckToPresentation } from '../src/slidev/render.js'
import { parseXml } from '../src/server/slide-xml.js'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const fixture = (): TextTabLayout => ({ version: 1, text: 'A\tBBBB CCCC\nD\tE', lines: [
  { start: 0, end: 7, breakBefore: 'paragraph', tabs: [1], box: { x: 0, y: 0, width: 100, height: 20 } },
  { start: 7, end: 12, breakBefore: 'automatic', tabs: [], box: { x: 0, y: 30, width: 50, height: 20 } },
  { start: 12, end: 15, breakBefore: 'soft', tabs: [13], box: { x: 0, y: 60, width: 100, height: 20 } },
] })

it('keeps observed lines bound to every original character and distinguishes automatic from soft breaks', () => {
  const layout = fixture()
  expect(() => validateTextTabLayout(layout, layout.text)).not.toThrow()
  for (const mutate of [
    (value: TextTabLayout) => { value.text += 'changed' },
    (value: TextTabLayout) => { value.lines[1]!.start++ },
    (value: TextTabLayout) => { value.lines.pop() },
    (value: TextTabLayout) => { value.lines[1]!.breakBefore = 'soft' },
    (value: TextTabLayout) => { value.lines[2]!.tabs = [] },
    (value: TextTabLayout) => { value.lines[0]!.box!.height = 0 },
    (value: TextTabLayout) => { delete value.lines[0]!.box },
    (value: TextTabLayout) => { value.lines.push({ start: 15, end: 15, breakBefore: 'automatic', tabs: [] }) },
  ]) {
    const invalid = structuredClone(layout); mutate(invalid)
    expect(() => validateTextTabLayout(invalid, layout.text)).toThrow()
  }
  const trailing: TextTabLayout = { version: 1, text: 'A\t\n\n', lines: [
    { start: 0, end: 3, breakBefore: 'paragraph', tabs: [1], box: { x: 0, y: 0, width: 72, height: 20 } },
    { start: 3, end: 4, breakBefore: 'soft', tabs: [] },
    { start: 4, end: 4, breakBefore: 'soft', tabs: [] },
  ] }
  expect(() => validateTextTabLayout(trailing, trailing.text)).not.toThrow()
  trailing.lines.push({ start: 4, end: 4, breakBefore: 'soft', tabs: [] })
  expect(() => validateTextTabLayout(trailing, trailing.text)).toThrow('final empty')
})

it('writes automatic tab lines as one editable paragraph with only the authored soft break', async () => {
  const tabLayout = fixture()
  const style = { fontFamily: 'Liberation Mono', fontSizePx: 20, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, letterSpacingPx: 0, color: { hex: '000000', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr' }
  const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: [{ version: 1, id: '1', width: 960, height: 540, warnings: [], elements: [{
    id: 'body', kind: 'text', text: tabLayout.text, style, source: { tag: 'div', path: 'body', anchor: 'body' }, box: { x: 40, y: 40, width: 186, height: 200 }, order: 0, zIndex: 0, opacity: 1,
    paragraphs: [{ level: 1, style, tabLayout, defaultTabSizePx: 72, tabStopsPx: [{ position: 72, align: 'left' }], marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs: [{ text: tabLayout.text, style }] }],
  }] }] })
  const result = htmlDeckToPresentation(snapshot)
  expect(result.objects).toMatchObject([{ nativeCount: 1, imageCount: 0, status: 'native' }])
  expect(result.warnings.some(warning => warning.message.includes('automatic tab lines'))).toBe(true)
  const zip = await JSZip.loadAsync(await result.presentation.toArrayBuffer())
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
  const nodes: ReturnType<typeof parseXml>[] = []
  const walk = (node: ReturnType<typeof parseXml>) => { nodes.push(node); node.children.forEach(walk) }
  walk(parseXml(xml))
  expect(nodes.filter(node => node.local === 'sp')).toHaveLength(1)
  expect(nodes.filter(node => node.local === 'p')).toHaveLength(1)
  expect(nodes.filter(node => node.local === 'br')).toHaveLength(1)
  expect(nodes.filter(node => node.local === 'pPr')[0]!.attributes.indent).toBe('0')
  expect(xml).not.toContain('automatic')
  expect(xml).toContain('A\tBBBB CCCC')
  expect(xml).toContain('D\tE')
  const element = snapshot.slides[0]!.elements[0]!
  if (element.kind !== 'text') throw new Error('Expected text fixture')
  element.paragraphs![0]!.tabLayout!.text = 'Stale'
  expect(htmlDeckToPresentation(snapshot).objects[0]!.status).toBe('missing')
})

it('retains reproducible native flow evidence with separate diagnostic and unreviewed bullet observations', async () => {
  type Entry = { id: string; page: number; source: { id: string; text: string }; importedText: string; expected?: Array<[string, number, number]>; known?: Array<[string, number, number]>; words: Array<{ text: string; x: number; y: number; end: number }>; status: string }
  const root = new URL('../../../', import.meta.url)
  const report = JSON.parse(await readFile(new URL('docs/validation/text-flow-libreoffice-7.3.7.2.json', root), 'utf8')) as { sourcePptxSha256: string; tolerancePoints: number; reproducers: Array<{ path: string; sha256: string }>; artifacts: Array<{ stage: string; pptxSha256: string; pageCount: number; cases: Entry[] }> }
  expect(report.tolerancePoints).toBe(0.25)
  expect(report.artifacts.map(artifact => artifact.stage)).toEqual(['actual-native-export', 'diagnostic-indent-removed'])
  expect(report.artifacts[0]!.pptxSha256).toBe(report.sourcePptxSha256)
  expect(report.artifacts[1]!.pptxSha256).not.toBe(report.sourcePptxSha256)
  for (const artifact of report.artifacts) {
    expect(artifact.pageCount).toBe(33)
    expect(artifact.cases).toHaveLength(33)
    expect(artifact.cases.map(entry => entry.page)).toEqual(Array.from({ length: 33 }, (_, index) => index + 1))
    expect(artifact.cases.map(entry => entry.source)).toEqual(report.artifacts[0]!.cases.map(entry => entry.source))
    for (const entry of artifact.cases) {
      expect(entry.importedText).toBe(entry.source.text)
      const matches = (expected: NonNullable<Entry['expected']>) => expected.length === entry.words.length && expected.every(([text, x, line], index) => {
        const actual = entry.words[index]!
        return actual.text === text && Math.abs(actual.x - x) <= 0.25 && Math.abs(actual.end - x - text.length * 12) <= 0.25 && Math.abs(actual.y - entry.words[0]!.y - line * 30) <= 0.25
      })
      expect(entry.status).toBe(!entry.expected ? 'observed-only' : matches(entry.expected) ? 'matched' : entry.known && matches(entry.known) ? 'known-difference' : 'unexpected')
      expect(entry.status).not.toBe('unexpected')
      expect(entry.status === 'observed-only').toBe(entry.id.startsWith('bullet-'))
    }
  }
  expect(report.artifacts.map(artifact => artifact.cases.filter(entry => entry.status === 'matched').length)).toEqual([14, 20])
  for (const source of report.reproducers) expect(createHash('sha256').update(await readFile(new URL(source.path, root))).digest('hex')).toBe(source.sha256)
})
