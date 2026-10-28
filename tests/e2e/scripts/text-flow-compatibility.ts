/** Native wrapping evidence. Run with system Python/UNO, LibreOffice and Poppler.
 * Fixed point/line expectations are independent of browser layout helpers. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { TextRenderingEnvironmentSchema, type TextRenderingEnvironment } from '@fastppt/presentation-ir'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'

type Expected = [text: string, x: number, line: number]
type Case = { id: string; text: string; width?: number; margin?: number; indent?: number; stops?: number[]; align?: 'left' | 'center' | 'right' | 'decimal'; paragraphAlign?: 'left' | 'center' | 'right' | 'justify'; bullet?: boolean; bulletFont?: string; expected?: Expected[]; known?: Expected[]; diagnosticExpected?: Expected[] }
const left: Expected[] = [['A', 40, 0], ['BBBB', 112, 0], ['CCCC', 172, 0], ['DDDD', 40, 1], ['EEEE', 100, 1]]
const aligned: Expected[] = [['ABBBB', 40, 0], ['CCCC', 112, 0], ['DDDD', 172, 0], ['EEEE', 40, 1]]
const before: Expected[] = [['AAAA', 40, 0], ['BBBB', 100, 0], ['CCCC', 160, 0], ['DDDD', 40, 1], ['EE', 112, 1], ['FF', 148, 1]]
const cases: Case[] = [
  { id: 'baseline', text: 'AAAA BBBB CCCC DDDD EEEE', expected: [['AAAA', 40, 0], ['BBBB', 100, 0], ['CCCC', 160, 0], ['DDDD', 40, 1], ['EEEE', 100, 1]] },
  { id: 'left-field-wrap', text: 'A\tBBBB CCCC DDDD EEEE', stops: [72], expected: left },
  { id: 'center-field-wrap', text: 'A\tBBBB CCCC DDDD EEEE', stops: [72], align: 'center', expected: aligned, known: left },
  { id: 'right-field-wrap', text: 'A\tBBBB CCCC DDDD EEEE', stops: [72], align: 'right', expected: aligned, known: left },
  { id: 'decimal-field-wrap', text: 'A\t12.34 CCCC DDDD EEEE', stops: [72], align: 'decimal', expected: [['A', 40, 0], ['12.34', 88, 0], ['CCCC', 160, 0], ['DDDD', 40, 1], ['EEEE', 100, 1]], known: [['A', 40, 0], ['12.34', 112, 0], ['CCCC', 40, 1], ['DDDD', 100, 1], ['EEEE', 160, 1]] },
  { id: 'before-tab-wrap', text: 'AAAA BBBB CCCC DDDD\tEE FF', stops: [72], expected: before },
  { id: 'tab-exceeds-width', text: 'A\tB', stops: [240], expected: [['A', 40, 0], ['B', 40, 2]], known: [['A', 40, 0], ['B', 112, 0]] },
  { id: 'default-exceeds-width', text: 'ABCDEFGHIJKLMN\tB', expected: [['ABCDEFGHIJKLMN', 40, 0], ['B', 112, 1]] },
  { id: 'before-tab-at-edge', text: 'ABCDEFGHIJKLMNO\tB', expected: [['ABCDEFGHIJKLMNO', 40, 0], ['B', 112, 1]] },
  { id: 'tab-after-wrapped-word', text: 'AAAAAAAAAAAAAAAAAAAA\tB', stops: [72], expected: [['AAAAAAAAAAAAAAA', 40, 0], ['AAAAA', 40, 1], ['B', 112, 1]] },
  { id: 'negative-indent', text: 'A\tBBBB CCCC DDDD EEEE', stops: [72], margin: 40, indent: -20, expected: [['A', 60, 0], ['BBBB', 152, 0], ['CCCC', 80, 1], ['DDDD', 140, 1], ['EEEE', 80, 2]], known: [['A', 60, 0], ['BBBB', 80, 0], ['CCCC', 140, 0], ['DDDD', 80, 1], ['EEEE', 140, 1]], diagnosticExpected: [['A', 80, 0], ['BBBB', 152, 0], ['CCCC', 80, 1], ['DDDD', 140, 1], ['EEEE', 80, 2]] },
  { id: 'positive-indent', text: 'A\tBBBB CCCC DDDD EEEE', stops: [72], margin: 20, indent: 20, expected: [['A', 80, 0], ['BBBB', 132, 0], ['CCCC', 60, 1], ['DDDD', 120, 1], ['EEEE', 60, 2]], diagnosticExpected: [['A', 60, 0], ['BBBB', 132, 0], ['CCCC', 60, 1], ['DDDD', 120, 1], ['EEEE', 60, 2]] },
  { id: 'zero-stop', text: 'A\tBBBB CCCC DDDD EEEE', stops: [0], expected: left },
  { id: 'two-tabs-wrapped', text: 'A\tBBBB CCCC DDDD\tEE FF', stops: [72, 120], expected: [['A', 40, 0], ['BBBB', 112, 0], ['CCCC', 172, 0], ['DDDD', 40, 1], ['EE', 112, 1], ['FF', 148, 1]] },
  { id: 'exhausted-stops', text: 'A\tBBBB\tCC DD EE', stops: [72], expected: [['A', 40, 0], ['BBBB', 112, 0], ['CC', 184, 0], ['DD', 40, 1], ['EE', 76, 1]] },
  { id: 'end-tab', text: 'AAAAAAAAAAAAAA\t', expected: [['AAAAAAAAAAAAAA', 40, 0]] },
  { id: 'long-word', text: 'A\tBBBBBBBBBBBBBBBBBBBBB', stops: [72], expected: [['A', 40, 0], ['BBBBBBBBBBBBBBB', 40, 1], ['BBBBBB', 40, 2]] },
  { id: 'boundary-long-word', text: 'A\tBBBBBBBBBBBBBBBBBBBBB', width: 180, stops: [72], expected: [['A', 40, 0], ['BBBBBBBBBBBBBBB', 40, 1], ['BBBBBB', 40, 2]] },
  { id: 'soft-break-indent', text: 'A\tB\nC\tD', stops: [72], margin: 40, indent: 20, expected: [['A', 100, 0], ['B', 152, 0], ['C', 80, 1], ['D', 152, 1]], diagnosticExpected: [['A', 80, 0], ['B', 152, 0], ['C', 80, 1], ['D', 152, 1]] },
  { id: 'decimal-prefix-wrap', text: 'A\tBBBB CCCC DDDD. EEEE', stops: [72], align: 'decimal', expected: [['ABBBB', 40, 0], ['CCCC', 112, 0], ['DDDD.', 40, 1], ['EEEE', 112, 1]], known: [['A', 40, 0], ['BBBB', 112, 0], ['CCCC', 172, 0], ['DDDD.', 40, 1], ['EEEE', 112, 1]] },
  ...(['left', 'center', 'right', 'justify'] as const).flatMap(paragraphAlign => [-20, 0, 20].map(indent => ({ id: `bullet-${paragraphAlign}-${indent}`, text: 'AAAA BBBB CCCC DDDD EEEE', bullet: true, paragraphAlign, margin: 40, indent }))),
  { id: 'bullet-explicit-font-positive', text: 'AAAA BBBB CCCC DDDD EEEE', bullet: true, bulletFont: 'Liberation Mono', margin: 40, indent: 20 },
]
const run = promisify(execFile), directory = resolve(process.argv[2] ?? '/tmp/fastppt-text-flow-compatibility')
const helper = fileURLToPath(new URL('./lib/libreoffice-text-probe.py', import.meta.url))
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
await mkdir(directory, { recursive: true })
const style = { fontFamily: 'Liberation Mono', fontSizePx: 20, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, letterSpacingPx: 0, color: { hex: '000000', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr' }
const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: cases.map((entry, index) => {
  const localStyle = { ...style, align: entry.paragraphAlign ?? 'left' }
  return { version: 1, id: String(index + 1), width: 959.976, height: 539.9865, warnings: [], elements: [{ id: 'body', kind: 'text', source: { tag: 'div', path: 'body', anchor: 'body' }, order: 0, zIndex: 0, opacity: 1, box: { x: 40, y: 40, width: entry.width ?? 186, height: 440 }, style: localStyle, text: entry.text,
    paragraphs: [{ level: 1, style: localStyle, marginLeftPx: entry.margin ?? 0, marginRightPx: 0, indentPx: entry.indent ?? 0, spaceBeforePx: 0, spaceAfterPx: 0, defaultTabSizePx: 72,
      ...(entry.stops ? { tabStopsPx: entry.stops.map(position => ({ position, align: entry.align ?? 'left' })) } : {}),
      ...(entry.bullet ? { bullet: { kind: 'character', character: '*' }, bulletFont: entry.bulletFont ? { kind: 'font', fontFamily: entry.bulletFont } : { kind: 'text' }, bulletSize: { kind: 'percent', value: 100 }, bulletColor: { kind: 'text' } } : {}),
      runs: [{ text: entry.text, style: localStyle }],
    }],
  }] }
}) })
const native = join(directory, 'flow-native.pptx'), diagnostic = join(directory, 'flow-no-indent.pptx')
for (const file of ['report.json', 'observations.json', 'flow-native.pptx', 'flow-no-indent.pptx']) await rm(join(directory, file), { force: true })
await writeEditablePptx(snapshot, native, { embedFonts: false })
await writeFile(join(directory, 'cases.json'), JSON.stringify(cases, null, 2))
await run('python3', ['-c', `
import json,re,sys,zipfile,xml.etree.ElementTree as ET
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
cases=json.load(open(sys.argv[3]))
with zipfile.ZipFile(sys.argv[1]) as source, zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as output:
 for index,case in enumerate(cases):
  root=ET.fromstring(source.read('ppt/slides/slide%d.xml'%(index+1)))
  shapes=[shape for shape in root.findall('./p:cSld/p:spTree/p:sp',ns) if any(node.text for node in shape.findall('.//a:t',ns))]
  assert len(shapes)==1,(index,'expected one editable shape')
  paragraphs=shapes[0].findall('./p:txBody/a:p',ns)
  assert len(paragraphs)==1,(index,'automatic wrapping became extra paragraphs')
  text=''.join('\\n' if n.tag=='{'+ns['a']+'}br' else n.findtext('a:t','',ns) for n in paragraphs[0])
  assert text==case['text'],(index,'source characters changed')
  assert paragraphs[0].find('a:pPr',ns).get('indent')==str(case.get('indent',0)*12700),(index,'source indent changed')
  extent=shapes[0].find('./p:spPr/a:xfrm/a:ext',ns)
  assert abs(int(extent.get('cx'))-case.get('width',186)*12700)<=12.7,(index,'source width changed beyond 0.001pt serialization tolerance')
 for entry in source.infolist():
  data=source.read(entry.filename)
  if re.fullmatch(r'ppt/(slides|slideLayouts|slideMasters)/[^/]+\\.xml',entry.filename):data=re.sub(rb'\\sindent="-?\\d+"',b'',data)
  output.writestr(entry,data)
`, native, diagnostic, join(directory, 'cases.json')])
await writeFile(join(directory, 'manifest.json'), JSON.stringify({ directory, locale: 'en-US', artifacts: [{ stage: 'actual-native-export', input: native }, { stage: 'diagnostic-indent-removed', input: diagnostic }] }))
await run('/usr/bin/python3', [helper, join(directory, 'manifest.json')], { timeout: 60000 })
type Observation = { environment: TextRenderingEnvironment; artifacts: Array<{ stage: 'actual-native-export' | 'diagnostic-indent-removed'; pptxSha256: string; pdfSha256: string; pdf: string; pages: Array<{ paragraphs: Array<{ text: string; tabs: unknown[] }> }> }> }
const observation = JSON.parse(await readFile(join(directory, 'observations.json'), 'utf8')) as Observation
const environment = TextRenderingEnvironmentSchema.parse(observation.environment)
if (environment.locale.observed !== 'en-US' || environment.configurationSha256 !== await hash(join(directory, 'initial-configuration.xcu'))) throw new Error('Application configuration identity changed.')
const artifacts = []
for (const artifact of observation.artifacts) {
  const isDiagnostic = artifact.stage === 'diagnostic-indent-removed'
  if (artifact.pptxSha256 !== await hash(isDiagnostic ? diagnostic : native) || artifact.pdfSha256 !== await hash(artifact.pdf)) throw new Error('Artifact identity changed.')
  const htmlPath = join(directory, artifact.stage + '.html')
  await rm(htmlPath, { force: true })
  await run('pdftotext', ['-bbox-layout', artifact.pdf, htmlPath])
  const pages = [...(await readFile(htmlPath, 'utf8')).matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)].map(page => [...page[1]!.matchAll(/<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([^<]*)<\/word>/g)]
    .map(word => ({ text: word[5]!, x: Number(word[1]), y: Number(word[2]), end: Number(word[3]) })).sort((a, b) => Math.abs(a.y - b.y) > 1 ? a.y - b.y : a.x - b.x))
  if (pages.length !== cases.length || artifact.pages.length !== cases.length) throw new Error('Imported/rendered page count changed.')
  const results = cases.map((entry, index) => {
    const words = pages[index]!, importedText = artifact.pages[index]!.paragraphs.map(paragraph => paragraph.text).join('\n')
    const expected = isDiagnostic ? entry.diagnosticExpected ?? entry.expected : entry.expected
    const known = isDiagnostic ? undefined : entry.known
    const matches = (expected: Expected[]) => expected.length === words.length && expected.every(([text, x, line], at) => {
      const word = words[at]!
      return word.text === text && Math.abs(word.x - x) <= 0.25 && Math.abs(word.end - x - text.length * 12) <= 0.25 && Math.abs(word.y - words[0]!.y - line * 30) <= 0.25
    })
    const status = importedText !== entry.text ? 'unexpected' : !expected ? 'observed-only' : matches(expected) ? 'matched' : known && matches(known) ? 'known-difference' : 'unexpected'
    return { id: entry.id, page: index + 1, source: entry, importedText, importedTabs: artifact.pages[index]!.paragraphs.flatMap(paragraph => paragraph.tabs), expected, known, words, status }
  })
  artifacts.push({ stage: artifact.stage, pptxSha256: artifact.pptxSha256, pdfSha256: artifact.pdfSha256, pageCount: pages.length, fonts: (await run('pdffonts', [artifact.pdf])).stdout, cases: results })
  console.log(`${artifact.stage}: ${['matched', 'known-difference', 'observed-only', 'unexpected'].map(status => `${results.filter(result => result.status === status).length} ${status}`).join(', ')}`)
}
const report = { version: 1, generatedAt: new Date().toISOString(), sourcePptxSha256: await hash(native), comparisonBasis: 'target-application-probe', units: 'points', tolerancePoints: 0.25, environment,
  reproducers: await Promise.all([['tests/e2e/scripts/text-flow-compatibility.ts', fileURLToPath(import.meta.url)], ['tests/e2e/scripts/lib/libreoffice-text-probe.py', helper]].map(async ([path, file]) => ({ path, sha256: await hash(file!) }))), artifacts }
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
if (artifacts.some(artifact => artifact.cases.some(entry => entry.status === 'unexpected'))) process.exitCode = 1
