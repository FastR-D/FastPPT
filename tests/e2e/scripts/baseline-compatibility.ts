/** Actual native baseline export: full-size source model and pinned application behavior. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { TextRenderingEnvironmentSchema } from '@fastppt/presentation-ir'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'

type Glyph = { text: string; x: number; y: number; size: number }
type Case = { id: string; baseline: number; fontSize: number; lineHeight: number; text: string; mixed: boolean; expected: Glyph[]; known?: Glyph[] }
// Independent font metrics: Liberation Mono advance = 0.6em. Source percentage
// offsets declared size; LibreOffice instead reduces every nonzero run to 58%.
// Absolute line origins below were established by the isolated source-attribute
// probe before this production implementation. A separate fractional probe pinned
// whole-percent truncation and the first-line clamp for small negative offsets.
const row = (text: string, size: number, x: number, y: number): Glyph[] => [...text].map((text, index) => ({ text, x: x + index * size * 0.6, y, size }))
const sample = (id: string, baseline: number, fontSize = 20, lineHeight = 30, text = 'XXXX', mixed = true): Case => {
  const nominal = lineHeight + 36
  const make = (target: boolean) => {
    const size = target && baseline !== 0 ? fontSize * 0.58 : fontSize
    const effective = target ? Math.trunc(baseline) : baseline
    const reference = target && baseline < 0 ? Math.min(nominal, 67.7 + effective * fontSize / 100) : target && fontSize === 40 ? 92 : nominal
    const lines = text.split('\n')
    return [...(mixed ? row('A', 20, 40, reference) : []), ...lines.flatMap((line, index) => row(line, size, index === 0 && mixed ? 52 : 40, reference - effective * fontSize / 100 + index * lineHeight)), ...(mixed ? row('B', 20, (lines.length === 1 ? 52 : 40) + lines.at(-1)!.length * size * 0.6, reference + (lines.length - 1) * lineHeight) : [])]
  }
  return { id, baseline, fontSize, lineHeight, text, mixed, expected: make(false), ...(baseline !== 0 ? { known: make(true) } : {}) }
}
const cases: Case[] = [
  ...[-50, -25, -10, -1.5, -0.5, -0.001, 0, 0.001, 0.5, 1.5, 10, 19, 20, 30, 50, 100].map(value => sample(`baseline-${value}`, value)),
  sample('wide-leading', 30, 20, 60), sample('small-font', 30, 10), sample('large-font', 30, 40, 60),
  sample('entire-run', 30, 20, 30, 'XXXX', false), sample('entire-run-negative', -25, 20, 30, 'XXXX', false),
  sample('soft-break', 30, 20, 30, 'XX\nXX'), sample('empty-defaults', 0, 20, 30, '', false),
]
const directory = resolve(process.argv[2] ?? '/tmp/fastppt-baseline-compatibility'), run = promisify(execFile)
const helper = fileURLToPath(new URL('./lib/libreoffice-text-probe.py', import.meta.url))
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
await mkdir(directory, { recursive: true })
const base = { fontFamily: 'Liberation Mono', fontSizePx: 20, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, letterSpacingPx: 0, color: { hex: '112233', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr', baselinePercent: 0 }
const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: cases.map((entry, index) => {
  const style = { ...base, lineHeightPx: entry.lineHeight }
  const runs = [...(entry.mixed ? [{ text: 'A', style }] : []), ...(entry.text ? [{ text: entry.text, style: { ...style, fontSizePx: entry.fontSize, baselinePercent: entry.baseline } }] : []), ...(entry.mixed ? [{ text: 'B', style }] : [])]
  return { version: 1, id: String(index + 1), width: 959.976, height: 539.9865, warnings: [], elements: [{ id: 'body', kind: 'text', source: { tag: 'div', path: 'body', anchor: 'body' }, box: { x: 40, y: 40, width: 300, height: 300 }, order: 0, zIndex: 0, opacity: 1, style, text: runs.map(r => r.text).join(''), paragraphs: [{ level: 1, style, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs }] }] }
}) })
const native = join(directory, 'baseline-native.pptx')
await writeEditablePptx(snapshot, native, { embedFonts: false })
await writeFile(join(directory, 'cases.json'), JSON.stringify(cases, null, 2))
// Validate actual XML without changing the native artifact before opening it.
await run('python3', ['-c', `
import json,sys,zipfile,xml.etree.ElementTree as E
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as z:
 for i,c in enumerate(json.load(open(sys.argv[2]))):
  root=E.fromstring(z.read('ppt/slides/slide%d.xml'%(i+1)))
  shapes=[s for s in root.findall('./p:cSld/p:spTree/p:sp',ns) if s.find('./p:nvSpPr/p:cNvPr',ns).get('name')=='fastppt:body:body'];assert len(shapes)==1
  ps=shapes[0].findall('./p:txBody/a:p',ns);assert len(ps)==1
  assert ps[0].find('./a:pPr/a:defRPr',ns).get('baseline')=='0'
  assert ps[0].find('a:endParaRPr',ns).get('baseline')=='0'
  expected=[(ch,round(c['baseline']*1000),c['fontSize']*100) for ch in c['text']]
  if c['mixed']:expected=[('A',0,2000)]+expected+[('B',0,2000)]
  actual=[]
  for n in ps[0]:
   if n.tag=='{'+ns['a']+'}r':actual.extend((ch,int(n.find('a:rPr',ns).get('baseline')),int(n.find('a:rPr',ns).get('sz'))) for ch in n.findtext('a:t','',ns))
   if n.tag=='{'+ns['a']+'}br':actual.append(('\\n',int(n.find('a:rPr',ns).get('baseline')),int(n.find('a:rPr',ns).get('sz'))))
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
  const glyphs = glyphReport.pages[index]!, importedText = artifact.pages[index]!.paragraphs.map(p => p.text).join('\n')
  const measured: Glyph[] = glyphs.map(glyph => ({ text: glyph.text, x: glyph.origin[0], y: glyph.origin[1], size: glyph.size }))
  const matches = (expected: Glyph[]) => measured.length === expected.length && measured.every((value, at) => value.text === expected[at]!.text && glyphs[at]!.font === 'LiberationMono' && Math.abs(value.x - expected[at]!.x) <= 0.25 && Math.abs(value.y - expected[at]!.y) <= 0.25 && Math.abs(value.size - expected[at]!.size) < 0.05)
  const text = entry.mixed ? `A${entry.text}B` : entry.text
  const status = importedText !== text ? 'unexpected' : matches(entry.expected) ? 'matched' : entry.known && matches(entry.known) ? 'known-difference' : 'unexpected'
  return { id: entry.id, page: index + 1, source: entry, importedText, measured, glyphs, status }
})
const report = { version: 1, generatedAt: new Date().toISOString(), comparisonBasis: 'target-application-probe', measurement: 'declared-size-glyph-size-and-baseline-origins', browserPixelEquivalence: 'unverified', units: 'points', tolerancePoints: 0.25, fontSizeTolerancePoints: 0.05, environment, reader: glyphReport.reader, sourcePptxSha256: artifact.pptxSha256,
  typography: { defaultFont: base.fontFamily, fontSizePoints: 20, defaultLineSpacingPoints: 30, nativePercentageUnit: 'thousandths-of-a-percent', previewPolicy: 'preserve-declared-size-and-line-box; offset-by-font-size' },
  reproducers: await Promise.all([['tests/e2e/scripts/baseline-compatibility.ts', fileURLToPath(import.meta.url)], ['tests/e2e/scripts/lib/libreoffice-text-probe.py', helper]].map(async ([path, file]) => ({ path, sha256: await hash(file!) }))),
  artifacts: [{ stage: 'actual-native-export', pptxSha256: artifact.pptxSha256, pdfSha256: artifact.pdfSha256, glyphsSha256: await hash(join(directory, 'glyphs.json')), pageCount: cases.length, cases: results }] }
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`${results.filter(entry => entry.status === 'matched').length} matched, ${results.filter(entry => entry.status === 'known-difference').length} known, ${results.filter(entry => entry.status === 'unexpected').length} unexpected`)
for (const result of results.filter(entry => entry.status === 'unexpected')) console.log(JSON.stringify(result))
if (results.some(entry => entry.status === 'unexpected')) process.exitCode = 1
