/** Measure original native tracking with independent glyph-origin expectations. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { TextRenderingEnvironmentSchema } from '@fastppt/presentation-ir'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'

type Glyph = { text: string; x: number; line: number; font: string }
type Case = { id: string; width: number; runs: Array<{ text: string; spacing: number }>; expected: Glyph[]; known?: Glyph[]; reason?: string }
// Independent advances: 20pt Mono = 12pt; fullwidth CJK = 20pt. Each glyph
// consumes its declared tracking, including at an authored run boundary.
const row = (text: string, spacing: number, line = 0, start = 40): Glyph[] => {
  let x = start
  return [...text].map(text => { const cjk = /[中文]/u.test(text), value = { text, x, line, font: cjk ? 'NotoSansCJKjp-Regular-VK' : 'LiberationMono' }; x += (cjk ? 20 : 12) + spacing; return value })
}
const cases: Case[] = [
  ...[-2, 0, 2, 1.25, -0.75].map(spacing => ({ id: `tracking-${spacing}`, width: 186, runs: [{ text: 'AAAA', spacing }], expected: row('AAAA', spacing) })),
  { id: 'mixed-runs', width: 186, runs: [{ text: 'AAAA', spacing: 2 }, { text: 'BBBB', spacing: 0 }, { text: 'CCCC', spacing: -2 }], expected: [...row('AAAA', 2), ...row('BBBB', 0, 0, 96), ...row('CCCC', -2, 0, 144)] },
  { id: 'spaces', width: 186, runs: [{ text: 'AA  BB', spacing: 2 }], expected: row('AA  BB', 2) },
  { id: 'tab', width: 186, runs: [{ text: 'AA\tBB', spacing: 2 }], expected: [...row('AA', 2), ...row('BB', 2, 0, 112)] },
  { id: 'soft-break', width: 186, runs: [{ text: 'AAAA\nBBBB', spacing: -2 }], expected: [...row('AAAA', -2), ...row('BBBB', -2, 1)] },
  ...[-2, 0, 2].map(spacing => ({ id: `wrap-${spacing}`, width: 100, runs: [{ text: 'AAAA BBBB CCCC', spacing }], expected: (spacing === -2 ? ['AAAA BBBB ', 'CCCC'] : ['AAAA ', 'BBBB ', 'CCCC']).flatMap((text, line) => row(text, spacing, line)) })),
  { id: 'boundary-55', width: 55, runs: [{ text: 'AAAABBBB', spacing: 2 }], expected: ['AAA', 'ABB', 'BB'].flatMap((text, line) => row(text, 2, line)) },
  ...[-2, 0, 2].map((spacing, index) => {
    const expected = row('AAAA中文BBBB', spacing)
    // Pinned actual application observations, separate from the browser model.
    const positions = [[40, 50, 60, 70, 86.7, 104.7, 129.6, 139.6, 149.6, 159.6], [40, 52, 64, 76, 92.7, 112.7, 137.6, 149.6, 161.6, 173.6], [40, 54, 68, 82, 100.8, 122.8, 149.7, 163.7, 177.7, 191.7]][index]!
    return { id: `cjk-${spacing}`, width: 186, runs: [{ text: 'AAAA中文BBBB', spacing }], expected, known: expected.map((glyph, at) => ({ ...glyph, x: positions[at]! })), reason: 'LibreOffice adds spacing at Latin/CJK boundaries even with the requested installed font; tracking remains present within each script run.' }
  }),
  { id: 'empty-defaults', width: 186, runs: [], expected: [] },
  { id: 'consecutive-breaks', width: 186, runs: [{ text: 'AAAA\n\nBBBB', spacing: 2 }], expected: [...row('AAAA', 2), ...row('BBBB', 2, 2)] },
]
const directory = resolve(process.argv[2] ?? '/tmp/fastppt-letter-spacing-compatibility'), run = promisify(execFile)
const helper = fileURLToPath(new URL('./lib/libreoffice-text-probe.py', import.meta.url))
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
await mkdir(directory, { recursive: true })
const base = { fontFamily: 'Liberation Mono', fontFamilies: { ea: 'Noto Sans CJK JP' }, fontSizePx: 20, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, letterSpacingPx: 2, color: { hex: '112233', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr' }
const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: cases.map((entry, index) => {
  const runs = entry.runs.map(r => ({ text: r.text, style: { ...base, letterSpacingPx: r.spacing } }))
  return { version: 1, id: String(index + 1), width: 959.976, height: 539.9865, warnings: [], elements: [{ id: 'body', kind: 'text', source: { tag: 'div', path: 'body', anchor: 'body' }, order: 0, zIndex: 0, opacity: 1, box: { x: 40, y: 40, width: entry.width, height: 300 }, style: base, text: runs.map(r => r.text).join(''), paragraphs: [{ level: 1, style: base, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, defaultTabSizePx: 72, runs }] }] }
}) })
const native = join(directory, 'letter-spacing-native.pptx')
await writeEditablePptx(snapshot, native, { embedFonts: false })
await writeFile(join(directory, 'cases.json'), JSON.stringify(cases, null, 2))
await run('python3', ['-c', `
import json,sys,zipfile,xml.etree.ElementTree as E
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as z:
 for i,c in enumerate(json.load(open(sys.argv[2]))):
  root=E.fromstring(z.read('ppt/slides/slide%d.xml'%(i+1)))
  shapes=[s for s in root.findall('./p:cSld/p:spTree/p:sp',ns) if s.find('./p:nvSpPr/p:cNvPr',ns).get('name')=='fastppt:body:body'];assert len(shapes)==1
  ps=shapes[0].findall('./p:txBody/a:p',ns);assert len(ps)==1
  assert ps[0].find('./a:pPr/a:defRPr',ns).get('spc')=='200'
  assert ps[0].find('a:endParaRPr',ns).get('spc')=='200'
  text=''.join('\\n' if n.tag=='{'+ns['a']+'}br' else n.findtext('a:t','',ns) for n in ps[0]);assert text==''.join(r['text'] for r in c['runs'])
  expected=[(ch,round(r['spacing']*100)) for r in c['runs'] for ch in r['text']];actual=[]
  for n in ps[0]:
   if n.tag=='{'+ns['a']+'}r':actual.extend((ch,int(n.find('a:rPr',ns).get('spc'))) for ch in n.findtext('a:t','',ns))
   if n.tag=='{'+ns['a']+'}br':actual.append(('\\n',int(n.find('a:rPr',ns).get('spc'))))
  assert actual==expected,(i,actual,expected)
`, native, join(directory, 'cases.json')])
await writeFile(join(directory, 'manifest.json'), JSON.stringify({ directory, locale: 'en-US', artifacts: [{ stage: 'actual-native-export', input: native }] }))
await run('/usr/bin/python3', [helper, join(directory, 'manifest.json')], { timeout: 60000 })
const observation = JSON.parse(await readFile(join(directory, 'observations.json'), 'utf8')) as { environment: unknown; artifacts: Array<{ pptxSha256: string; pdfSha256: string; pdf: string; pages: Array<{ paragraphs: Array<{ text: string }> }> }> }
const environment = TextRenderingEnvironmentSchema.parse(observation.environment), artifact = observation.artifacts[0]!
if (observation.artifacts.length !== 1 || environment.application.version !== '7.3.7.2' || environment.locale.observed !== 'en-US' || environment.configurationSha256 !== await hash(join(directory, 'initial-configuration.xcu')) || artifact.pptxSha256 !== await hash(native) || artifact.pdfSha256 !== await hash(artifact.pdf)) throw new Error('Application or artifact identity changed.')
const extracted = await run('python3', ['-c', `
import pymupdf,json,sys
pages=[]
with pymupdf.open(sys.argv[1]) as document:
 for page in document:
  spans=[s for b in page.get_text('rawdict',flags=pymupdf.TEXTFLAGS_RAWDICT|pymupdf.TEXT_INHIBIT_SPACES)['blocks'] if 'lines' in b for l in b['lines'] for s in l['spans']]
  pages.append([{'text':c['c'],'origin':c['origin'],'box':c['bbox'],'font':s['font'],'size':s['size']} for s in spans for c in s['chars']])
print(json.dumps({'reader':{'name':'PyMuPDF','version':pymupdf.VersionBind,'inhibitSyntheticSpaces':True},'pages':pages}))
`, artifact.pdf])
type RawGlyph = { text: string; origin: [number, number]; box: number[]; font: string; size: number }
const glyphReport = JSON.parse(extracted.stdout) as { reader: unknown; pages: RawGlyph[][] }
await writeFile(join(directory, 'glyphs.json'), JSON.stringify(glyphReport, null, 2))
if (artifact.pages.length !== cases.length || glyphReport.pages.length !== cases.length) throw new Error('Rendered page count changed.')
const results = cases.map((entry, index) => {
  const glyphs = glyphReport.pages[index]!, importedText = artifact.pages[index]!.paragraphs.map(p => p.text).join('\n'), baseline = glyphs[0]?.origin[1] ?? 0
  const measured: Glyph[] = glyphs.map(glyph => ({ text: glyph.text, x: glyph.origin[0], line: Math.round((glyph.origin[1] - baseline) / 30) || 0, font: glyph.font }))
  const matches = (expected: Glyph[]) => measured.length === expected.length && measured.every((value, at) => value.text === expected[at]!.text && value.font === expected[at]!.font && value.line === expected[at]!.line && Math.abs(value.x - expected[at]!.x) <= 0.25 && Math.abs(glyphs[at]!.size - 20) < 0.05 && Math.abs(glyphs[at]!.origin[1] - baseline - value.line * 30) <= 0.25)
  const status = importedText !== entry.runs.map(r => r.text).join('') ? 'unexpected' : matches(entry.expected) ? 'matched' : entry.known && matches(entry.known) ? 'known-difference' : 'unexpected'
  return { id: entry.id, page: index + 1, source: entry, importedText, measured, glyphs, status }
})
const report = { version: 1, generatedAt: new Date().toISOString(), comparisonBasis: 'target-application-probe', measurement: 'glyph-origins-fonts-and-line-assignment', browserPixelEquivalence: 'unverified', units: 'points', tolerancePoints: 0.25, environment, reader: glyphReport.reader, sourcePptxSha256: artifact.pptxSha256,
  typography: { defaultFont: base.fontFamily, eastAsianFont: base.fontFamilies.ea, fontSizePoints: 20, lineSpacingPoints: 30, paragraphLetterSpacingPoints: 2 },
  reproducers: await Promise.all([['tests/e2e/scripts/letter-spacing-compatibility.ts', fileURLToPath(import.meta.url)], ['tests/e2e/scripts/lib/libreoffice-text-probe.py', helper]].map(async ([path, file]) => ({ path, sha256: await hash(file!) }))),
  artifacts: [{ stage: 'actual-native-export', pptxSha256: artifact.pptxSha256, pdfSha256: artifact.pdfSha256, glyphsSha256: await hash(join(directory, 'glyphs.json')), pageCount: cases.length, cases: results }] }
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`${results.filter(entry => entry.status === 'matched').length} matched, ${results.filter(entry => entry.status === 'known-difference').length} known, ${results.filter(entry => entry.status === 'unexpected').length} unexpected`)
for (const result of results.filter(entry => entry.status === 'unexpected')) console.log(JSON.stringify(result))
if (results.some(entry => entry.status === 'unexpected')) process.exitCode = 1
