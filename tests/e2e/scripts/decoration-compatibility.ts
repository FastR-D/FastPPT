/** Real application evidence for native single underline and single strike.
 * Expected horizontal segments are independent of browser decoration helpers. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { TextRenderingEnvironmentSchema } from '@fastppt/presentation-ir'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'

type Decoration = 'underline' | 'line-through'
type Segment = { kind: Decoration; line: number; left: number; right: number }
type Case = { id: string; runs: Array<{ text: string; decoration: Decoration[] }>; defaults?: Decoration[]; expected: Segment[] }
const segment = (kind: Decoration, left = 40, right = 88, line = 0): Segment => ({ kind, left, right, line })
const cases: Case[] = [
  { id: 'none', runs: [{ text: 'AAAA', decoration: [] }], expected: [] },
  { id: 'underline', runs: [{ text: 'AAAA', decoration: ['underline'] }], expected: [segment('underline')] },
  { id: 'strike', runs: [{ text: 'AAAA', decoration: ['line-through'] }], expected: [segment('line-through')] },
  { id: 'both', runs: [{ text: 'AAAA', decoration: ['underline', 'line-through'] }], expected: [segment('underline'), segment('line-through')] },
  { id: 'spaces', runs: [{ text: 'AA  BB', decoration: ['underline'] }], expected: [segment('underline', 40, 112)] },
  { id: 'tab', runs: [{ text: 'A\tB', decoration: ['underline'] }], expected: [segment('underline', 40, 52), segment('underline', 112, 124)] },
  { id: 'soft-break', runs: [{ text: 'AAAA\nBBBB', decoration: ['underline'] }], expected: [segment('underline'), segment('underline', 40, 88, 1)] },
  { id: 'descenders', runs: [{ text: 'gypsy', decoration: ['underline'] }], expected: [segment('underline', 40, 100)] },
  { id: 'empty-defaults', runs: [], defaults: ['underline', 'line-through'], expected: [] },
  { id: 'independent-cancellation', defaults: ['underline', 'line-through'], runs: [{ text: 'AAAA', decoration: ['underline'] }, { text: 'BBBB', decoration: ['line-through'] }, { text: 'CCCC', decoration: ['underline', 'line-through'] }], expected: [segment('underline', 40, 88), segment('line-through', 88, 184), segment('underline', 136, 184)] },
  { id: 'explicit-none', defaults: ['underline', 'line-through'], runs: [{ text: 'AAAA\nBBBB', decoration: [] }], expected: [] },
  { id: 'soft-empty-line', runs: [{ text: 'AAAA\n\nBBBB', decoration: ['line-through'] }], expected: [segment('line-through'), segment('line-through', 40, 88, 2)] },
]
const directory = resolve(process.argv[2] ?? '/tmp/fastppt-decoration-compatibility'), run = promisify(execFile)
const helper = fileURLToPath(new URL('./lib/libreoffice-text-probe.py', import.meta.url))
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
await mkdir(directory, { recursive: true })
const base = { fontFamily: 'Liberation Mono', fontSizePx: 20, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, letterSpacingPx: 0, color: { hex: '112233', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr' }
const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: cases.map((entry, index) => {
  const style = { ...base, decoration: entry.defaults ?? entry.runs[0]?.decoration ?? [] }, text = entry.runs.map(run => run.text).join('')
  return { version: 1, id: String(index + 1), width: 959.976, height: 539.9865, warnings: [], elements: [{ id: 'body', kind: 'text', source: { tag: 'div', path: 'body', anchor: 'body' }, order: 0, zIndex: 0, opacity: 1, box: { x: 40, y: 40, width: 186, height: 200 }, style, text,
    paragraphs: [{ level: 1, style, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, defaultTabSizePx: 72, runs: entry.runs.map(value => ({ text: value.text, style: { ...base, decoration: value.decoration } })) }],
  }] }
}) })
const native = join(directory, 'decorations-native.pptx')
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
  text=''.join('\\n' if n.tag=='{'+ns['a']+'}br' else n.findtext('a:t','',ns) for n in ps[0]);assert text==''.join(r['text'] for r in c['runs'])
  expected=[(ch,r['decoration']) for r in c['runs'] for ch in r['text'] if ch!='\\n'];actual=[]
  for r in ps[0].findall('a:r',ns):
   p=r.find('a:rPr',ns);d=[]
   if p.get('u')=='sng':d.append('underline')
   else:assert p.get('u')=='none'
   if p.get('strike')=='sngStrike':d.append('line-through')
   else:assert p.get('strike')=='noStrike'
   actual.extend((ch,d) for ch in r.findtext('a:t','',ns))
  assert actual==expected,(i,actual,expected)
  breaks=[r['decoration'] for r in c['runs'] for ch in r['text'] if ch=='\\n']
  actual_breaks=[]
  for br in ps[0].findall('a:br',ns):
   p=br.find('a:rPr',ns);assert p is not None
   assert p.get('u') in ('none','sng') and p.get('strike') in ('noStrike','sngStrike')
   actual_breaks.append(([ 'underline' ] if p.get('u')=='sng' else [])+([ 'line-through' ] if p.get('strike')=='sngStrike' else []))
  assert actual_breaks==breaks,(i,actual_breaks,breaks)
`, native, join(directory, 'cases.json')])
await writeFile(join(directory, 'manifest.json'), JSON.stringify({ directory, locale: 'en-US', artifacts: [{ stage: 'actual-native-export', input: native }] }))
await run('/usr/bin/python3', [helper, join(directory, 'manifest.json')], { timeout: 60000 })
const observation = JSON.parse(await readFile(join(directory, 'observations.json'), 'utf8')) as { environment: unknown; artifacts: Array<{ pptxSha256: string; pdfSha256: string; pdf: string; pages: Array<{ paragraphs: Array<{ text: string }> }> }> }
const environment = TextRenderingEnvironmentSchema.parse(observation.environment), artifact = observation.artifacts[0]!
if (observation.artifacts.length !== 1 || environment.locale.observed !== 'en-US' || environment.configurationSha256 !== await hash(join(directory, 'initial-configuration.xcu')) || artifact.pptxSha256 !== await hash(native) || artifact.pdfSha256 !== await hash(artifact.pdf)) throw new Error('Application or artifact identity changed.')
const extracted = await run('python3', ['-c', `
import pymupdf,json,sys
pages=[]
with pymupdf.open(sys.argv[1]) as document:
 for page in document:
  spans=[s for b in page.get_text('dict')['blocks'] if 'lines' in b for l in b['lines'] for s in l['spans']]
  drawings=[]
  for d in page.get_drawings():
   if d['type']=='f' and d['fill']==(1,1,1):continue
   if d['type']!='s' or any(i[0]!='l' or abs(i[1].y-i[2].y)>.01 for i in d['items']):raise RuntimeError('Unexpected non-horizontal decoration drawing')
   for _,start,end in d['items']:drawings.append({'left':start.x,'right':end.x,'y':start.y,'width':d['width'],'color':d['color']})
  pages.append({'spans':[{'text':s['text'],'origin':s['origin'],'box':s['bbox'],'font':s['font'],'size':s['size']} for s in spans],'drawings':drawings})
print(json.dumps({'reader':{'name':'PyMuPDF','version':pymupdf.VersionBind},'pages':pages}))
`, artifact.pdf])
type Drawing = { left: number; right: number; y: number; width: number; color: number[] }
type Page = { spans: Array<{ text: string; origin: [number, number]; box: number[]; font: string; size: number }>; drawings: Drawing[] }
const drawingReport = JSON.parse(extracted.stdout) as { reader: { name: string; version: string }; pages: Page[] }
await writeFile(join(directory, 'drawings.json'), JSON.stringify(drawingReport, null, 2))
if (artifact.pages.length !== cases.length || drawingReport.pages.length !== cases.length) throw new Error('Rendered page count changed.')
const order = (a: Segment, b: Segment) => a.line - b.line || a.kind.localeCompare(b.kind) || a.left - b.left
const results = cases.map((entry, index) => {
  const page = drawingReport.pages[index]!, importedText = artifact.pages[index]!.paragraphs.map(p => p.text).join('\n')
  const baseline = page.spans[0]?.origin[1] ?? 0
  const measured = page.drawings.map(drawing => {
    const line = Math.round((drawing.y - baseline) / 30)
    return { kind: drawing.y - baseline - line * 30 > 0 ? 'underline' as const : 'line-through' as const, line, left: drawing.left, right: drawing.right }
  }).sort(order)
  // PDF writers may split one continuous line at run boundaries. Merge only
  // touching pieces of the same line/kind; original paths remain in the report.
  const merged: Segment[] = []
  for (const value of measured) {
    const previous = merged.at(-1)
    if (previous && previous.kind === value.kind && previous.line === value.line && Math.abs(previous.right - value.left) <= 0.25) previous.right = value.right
    else merged.push({ ...value })
  }
  const expected = [...entry.expected].sort(order)
  const matches = merged.length === expected.length && merged.every((value, at) => value.kind === expected[at]!.kind && value.line === expected[at]!.line && Math.abs(value.left - expected[at]!.left) <= 0.25 && Math.abs(value.right - expected[at]!.right) <= 0.25)
  const colorMatches = page.drawings.every(drawing => drawing.width > 0 && drawing.color.every((value, index) => Math.abs(value - [17 / 255, 34 / 255, 51 / 255][index]!) < 0.001))
  return { id: entry.id, page: index + 1, source: entry, importedText, expected, measured: merged, ...page, status: importedText === entry.runs.map(run => run.text).join('') && matches && colorMatches ? 'matched' : 'unexpected' }
})
const report = { version: 1, generatedAt: new Date().toISOString(), comparisonBasis: 'target-application-probe', measurement: 'single-line-presence-horizontal-extents-and-position-relative-to-text-baseline', browserPixelEquivalence: 'unverified', units: 'points', tolerancePoints: 0.25, environment, reader: drawingReport.reader, sourcePptxSha256: artifact.pptxSha256,
  reproducers: await Promise.all([['tests/e2e/scripts/decoration-compatibility.ts', fileURLToPath(import.meta.url)], ['tests/e2e/scripts/lib/libreoffice-text-probe.py', helper]].map(async ([path, file]) => ({ path, sha256: await hash(file!) }))),
  artifacts: [{ stage: 'actual-native-export', pptxSha256: artifact.pptxSha256, pdfSha256: artifact.pdfSha256, drawingsSha256: await hash(join(directory, 'drawings.json')), pageCount: cases.length, cases: results }] }
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`${results.filter(entry => entry.status === 'matched').length} matched, ${results.filter(entry => entry.status === 'unexpected').length} unexpected`)
for (const result of results.filter(entry => entry.status === 'unexpected')) console.log(JSON.stringify(result))
if (results.some(entry => entry.status === 'unexpected')) process.exitCode = 1
