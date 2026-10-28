/** Compare actual native kerning against independent installed-font pair metrics. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { TextRenderingEnvironmentSchema } from '@fastppt/presentation-ir'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'

type Case = { id: string; threshold: number; size: number; spacing: number; font: string; text: string }
type Glyph = { text: string; x: number; line: number; size: number; font: string }
type Font = { requested: string; path: string; sha256: string; postscript: string; unitsPerEm: number; advances: Record<string, number>; pairs: Record<string, number> }
const plain = { size: 20, spacing: 0, font: 'Liberation Serif', text: 'AVATAR To WA' }
const cases: Case[] = [
  ...[0, 19, 20, 20.01, 21, 4000].map(threshold => ({ ...plain, id: `threshold-${threshold}`, threshold })),
  ...[19, 19.99, 20.01, 21, 40].map(size => ({ ...plain, id: `size-${size}`, threshold: 20, size })),
  ...[0, 4000].flatMap(threshold => [1, -1].map(spacing => ({ ...plain, id: `spacing-${threshold}-${spacing}`, threshold, spacing }))),
  ...[0, 4000].map(threshold => ({ ...plain, id: `dejavu-${threshold}`, threshold, font: 'DejaVu Serif' })),
  { ...plain, id: 'empty-defaults', threshold: 30, text: '' },
  { ...plain, id: 'soft-break', threshold: 30, text: 'AV\nTo' },
  { ...plain, id: 'missing-font', threshold: 30, font: 'FastPPT Missing Kerning Probe' },
]
const directory = resolve(process.argv[2] ?? '/tmp/fastppt-kerning-compatibility'), run = promisify(execFile)
const helper = fileURLToPath(new URL('./lib/libreoffice-text-probe.py', import.meta.url))
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
await mkdir(directory, { recursive: true })
const fontResult = await run('python3', ['-c', `
import json,hashlib,subprocess
from fontTools.ttLib import TTFont
result=[]
for requested in ['Liberation Serif','DejaVu Serif']:
 path=subprocess.check_output(['fc-match','-f','%{file}',requested],text=True);font=TTFont(path);cmap=font.getBestCmap();chars=set('AVATAR To WA');pairs={pair:value for table in font['kern'].kernTables for pair,value in table.kernTable.items()}
 result.append({'requested':requested,'path':path,'sha256':hashlib.sha256(open(path,'rb').read()).hexdigest(),'postscript':font['name'].getDebugName(6),'unitsPerEm':font['head'].unitsPerEm,'advances':{c:font['hmtx'][cmap[ord(c)]][0] for c in chars},'pairs':{a+b:pairs[(cmap[ord(a)],cmap[ord(b)])] for a in chars for b in chars if (cmap[ord(a)],cmap[ord(b)]) in pairs}})
print(json.dumps(result))
`])
const fonts = JSON.parse(fontResult.stdout) as Font[]
const positions = (entry: Case, enabled: boolean): Glyph[] | undefined => {
  const font = fonts.find(font => font.requested === entry.font)
  if (!font) return undefined
  return entry.text.split('\n').flatMap((text, line) => {
    let x = 40
    return [...text].map((text, index, characters) => {
      if (index && enabled) x += (font.pairs[characters[index - 1]! + text] ?? 0) * entry.size / font.unitsPerEm
      const glyph = { text, x, line, size: entry.size, font: font.postscript }
      x += font.advances[text]! * entry.size / font.unitsPerEm + entry.spacing
      return glyph
    })
  })
}
const sourceCases = cases.map(entry => ({ ...entry, expected: positions(entry, entry.size >= entry.threshold), known: positions(entry, true) }))
const base = { fontFamily: 'Liberation Serif', fontSizePx: 20, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 60, letterSpacingPx: 0, color: { hex: '112233', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr', kerningThresholdPx: 20 }
const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: cases.map((entry, index) => {
  const style = { ...base, fontFamily: entry.font, fontSizePx: entry.size, letterSpacingPx: entry.spacing, kerningThresholdPx: entry.threshold }
  return { version: 1, id: String(index + 1), width: 959.976, height: 539.9865, warnings: [], elements: [{ id: 'body', kind: 'text', source: { tag: 'div', path: 'body', anchor: 'body' }, box: { x: 40, y: 40, width: 500, height: 300 }, order: 0, zIndex: 0, opacity: 1, style, text: entry.text, paragraphs: [{ level: 1, style, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs: entry.text ? [{ text: entry.text, style }] : [] }] }] }
}) })
const native = join(directory, 'kerning-native.pptx')
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
  assert ps[0].find('./a:pPr/a:defRPr',ns).get('kern')==str(round(c['threshold']*100))
  assert ps[0].find('a:endParaRPr',ns).get('kern')==str(round(c['threshold']*100))
  actual=''
  for n in ps[0]:
   if n.tag in ['{'+ns['a']+'}r','{'+ns['a']+'}br']:
    r=n.find('a:rPr',ns);assert r.get('kern')==str(round(c['threshold']*100));assert r.get('sz')==str(round(c['size']*100))
    if n.tag=='{'+ns['a']+'}br':actual+='\\n'
    else:
     actual+=n.findtext('a:t','',ns);assert r.find('a:latin',ns).get('typeface')==c['font']
  assert actual==c['text']
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
const results = sourceCases.map((entry, index) => {
  const glyphs = glyphReport.pages[index]!, importedText = artifact.pages[index]!.paragraphs.map(p => p.text).join('\n'), baseline = glyphs[0]?.origin[1] ?? 0
  const measured: Glyph[] = glyphs.map(glyph => ({ text: glyph.text, x: glyph.origin[0], line: Math.round((glyph.origin[1] - baseline) / 60) || 0, size: glyph.size, font: glyph.font }))
  const matches = (expected: Glyph[]) => measured.length === expected.length && measured.every((value, at) => value.text === expected[at]!.text && value.font === expected[at]!.font && value.line === expected[at]!.line && Math.abs(value.x - expected[at]!.x) <= 0.5 && Math.abs(value.size - expected[at]!.size) < 0.05 && Math.abs(glyphs[at]!.origin[1] - baseline - value.line * 60) <= 0.25)
  const status = importedText !== entry.text ? 'unexpected' : !entry.expected ? 'observed-only' : matches(entry.expected) ? 'matched' : entry.known && matches(entry.known) ? 'known-difference' : 'unexpected'
  return { id: entry.id, page: index + 1, source: entry, importedText, measured, glyphs, status }
})
const report = { version: 1, generatedAt: new Date().toISOString(), comparisonBasis: 'target-application-probe', measurement: 'installed-font-advances-and-kern-table-pairs', browserPixelEquivalence: 'unverified', units: 'points', tolerancePoints: 0.5, fontSizeTolerancePoints: 0.05, environment, fonts, reader: glyphReport.reader, sourcePptxSha256: artifact.pptxSha256,
  typography: { lineSpacingPoints: 60, missingFontPolicy: 'observed-only; no substitute metrics declared as source' },
  reproducers: await Promise.all([['tests/e2e/scripts/kerning-compatibility.ts', fileURLToPath(import.meta.url)], ['tests/e2e/scripts/lib/libreoffice-text-probe.py', helper]].map(async ([path, file]) => ({ path, sha256: await hash(file!) }))),
  artifacts: [{ stage: 'actual-native-export', pptxSha256: artifact.pptxSha256, pdfSha256: artifact.pdfSha256, glyphsSha256: await hash(join(directory, 'glyphs.json')), pageCount: cases.length, cases: results }] }
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(Object.fromEntries(['matched', 'known-difference', 'observed-only', 'unexpected'].map(status => [status, results.filter(entry => entry.status === status).length]))))
for (const result of results.filter(entry => entry.status === 'unexpected')) console.log(JSON.stringify(result))
if (results.some(entry => entry.status === 'unexpected')) process.exitCode = 1
