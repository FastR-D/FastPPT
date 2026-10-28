/** Independent horizontal bullet geometry evidence; no browser helper is used.
 * Requires LibreOffice/UNO and Poppler. Baseline equality is intentionally unverified. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { TextRenderingEnvironmentSchema } from '@fastppt/presentation-ir'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'

type Align = 'left' | 'center' | 'right' | 'justify'
type ProbeCase = { id: string; align: Align; indent: number; text?: string; label?: string; followFont?: boolean; font?: string; percent?: number; points?: number; bold?: boolean; rows?: string[]; knownRows?: string[]; observationOnly?: string }
type Word = { text: string; x: number; y: number; end: number }
type Horizontal = { text: string; x: number; width: number; line: number }
const normalRows = ['AAAA BBBB', 'CCCC DDDD', 'EEEE']
const inputs: ProbeCase[] = [
  ...(['left', 'center', 'right', 'justify'] as const).flatMap(align => [-20, 0, 20].map(indent => ({ id: `explicit-${align}-${indent}`, align, indent }))),
  ...(['left', 'center', 'right', 'justify'] as const).flatMap(align => [-20, 0, 20].map(indent => ({ id: `follow-font-${align}-${indent}`, align, indent, followFont: true }))),
  ...(['left', 'center', 'right'] as const).flatMap(align => [50, 200].map(percent => ({ id: `percent-${align}-${percent}`, align, indent: 0, percent }))),
  ...(['left', 'center', 'right'] as const).map(align => ({ id: `serif-${align}`, align, indent: 20, font: 'Liberation Serif' })),
  { id: 'points-36', align: 'left', indent: 20, points: 36, rows: ['AAAA', 'BBBB CCCC', 'DDDD EEEE'], knownRows: normalRows },
  ...(['left', 'center', 'right'] as const).map(align => ({ id: `long-marker-${align}`, align, indent: -20, label: '1234.', rows: ['AAAA', 'BBBB CCCC', 'DDDD EEEE'] })),
  ...(['left', 'center', 'right'] as const).map(align => ({ id: `long-word-${align}`, align, indent: 20, text: 'AAAAAAAAAAAAAAAAAAAA BBBB', rows: ['AAAAAAAAA', 'AAAAAAAAAAA', 'BBBB'] })),
  { id: 'too-wide-indent', align: 'left', indent: 160, text: 'AAAA BBBB', observationOnly: 'Prefix exceeds paragraph width; browser capture rejects this combination.' },
  { id: 'soft-break', align: 'left', indent: 20, text: 'AAAA\nBBBB CCCC', rows: ['AAAA', 'BBBB CCCC'] },
  { id: 'empty', align: 'left', indent: 20, text: '', rows: [] },
  { id: 'large-marker-long-word', align: 'left', indent: 20, text: 'AAAAAAAAAAAAAAAAAAAA BBBB', points: 36, rows: ['AAAAAAAA', 'AAAAAAAAAAAA', 'BBBB'], knownRows: ['AAAAAAAAA', 'AAAAAAAAAAA', 'BBBB'] },
  { id: 'tab-after-marker', align: 'left', indent: 20, text: 'A\tB\tC', observationOnly: 'Tab behavior is covered separately by text-flow evidence; this probe records marker interaction.' },
  { id: 'bold-first-run', align: 'left', indent: 20, bold: true },
]
const cases = inputs.map(entry => ({ ...entry, text: entry.text ?? 'AAAA BBBB CCCC DDDD EEEE', label: entry.label ?? '*', rows: entry.rows ?? normalRows }))

// Independent expected rows and Mono20 advances (12pt). Source Serif20 '*' is
// 10pt. OpenSymbol '*' at 20pt is a previously observed fallback (7.77pt).
function expectedGeometry(entry: ProbeCase, known = false): Horizontal[] {
  if (!entry.text) return []
  const label = entry.label!, markerWidth = known && entry.followFont ? 7.77 : label.length * (entry.font === 'Liberation Serif' ? 10 : 12) * (known && entry.points ? 1 : entry.points ? entry.points / 20 : (entry.percent ?? 100) / 100)
  const prefix = Math.max(0, entry.indent + markerWidth)
  const rows = known ? entry.knownRows ?? entry.rows! : entry.rows!
  const result: Horizontal[] = []
  rows.forEach((row, line) => {
    const words = row.split(' '), occupied = line === 0 ? prefix : 0
    const glyphWidth = row.replaceAll(' ', '').length * 12
    const slack = 146 - occupied - row.length * 12
    let x = 80 + occupied + (entry.align === 'center' ? slack / 2 : entry.align === 'right' ? slack : 0)
    if (line === 0) result.push({ text: label, x: x + entry.indent - prefix, width: markerWidth, line: 0 })
    const space = entry.align === 'justify' && line < rows.length - 1 && words.length > 1 ? (146 - occupied - glyphWidth) / (words.length - 1) : 12
    for (const word of words) { result.push({ text: word, x, width: word.length * 12, line }); x += word.length * 12 + space }
  })
  return result
}

function measuredGeometry(words: Word[], label: string): Horizontal[] {
  if (!words.length) return []
  const result: Horizontal[] = []
  for (const word of words) {
    const line = Math.max(0, Math.round((word.y - 46.98) / 30))
    if (word.text.startsWith(label) && !result.some(value => value.text === label)) {
      const body = word.text.slice(label.length), width = word.end - word.x - body.length * 12
      result.push({ text: label, x: word.x, width, line: 0 })
      if (body) result.push({ text: body, x: word.end - body.length * 12, width: body.length * 12, line })
    } else result.push({ text: word.text, x: word.x, width: word.end - word.x, line })
  }
  return result.sort((a, b) => a.line - b.line || a.x - b.x)
}
const run = promisify(execFile), directory = resolve(process.argv[2] ?? '/tmp/fastppt-bullet-compatibility')
const helper = fileURLToPath(new URL('./lib/libreoffice-text-probe.py', import.meta.url))
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
await mkdir(directory, { recursive: true })
const style = { fontFamily: 'Liberation Mono', fontSizePx: 20, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, letterSpacingPx: 0, color: { hex: '000000', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr' }
const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: cases.map((entry, index) => {
  const local = { ...style, align: entry.align, fontWeight: entry.bold ? 700 : 400 }
  return { version: 1, id: String(index + 1), width: 959.976, height: 539.9865, warnings: [], elements: [{ id: 'body', kind: 'text', source: { tag: 'div', path: 'body', anchor: 'body' }, order: 0, zIndex: 0, opacity: 1, box: { x: 40, y: 40, width: 186, height: 440 }, style: local, text: entry.text,
    paragraphs: [{ level: 1, style: local, marginLeftPx: 40, marginRightPx: 0, indentPx: entry.indent, spaceBeforePx: 0, spaceAfterPx: 0, defaultTabSizePx: 72,
      bullet: entry.label === '*' ? { kind: 'character', character: '*' } : { kind: 'auto-number', scheme: 'arabicPeriod', startAt: 1234 },
      bulletFont: entry.followFont ? { kind: 'text' } : { kind: 'font', fontFamily: entry.font ?? 'Liberation Mono' },
      bulletSize: entry.points ? { kind: 'pixels', value: entry.points } : entry.percent ? { kind: 'percent', value: entry.percent } : { kind: 'text' }, bulletColor: { kind: 'text' },
      runs: [{ text: entry.text, style: local }],
    }],
  }] }
}) })
const native = join(directory, 'bullets-native.pptx')
await writeEditablePptx(snapshot, native, { embedFonts: false })
await writeFile(join(directory, 'cases.json'), JSON.stringify(cases, null, 2))
// Check source facts before opening the actual output. No diagnostic rewriting.
await run('python3', ['-c', `
import json,sys,zipfile,xml.etree.ElementTree as E
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
cases=json.load(open(sys.argv[2]))
with zipfile.ZipFile(sys.argv[1]) as z:
 for index,c in enumerate(cases):
  root=E.fromstring(z.read('ppt/slides/slide%d.xml'%(index+1)))
  shapes=[s for s in root.findall('./p:cSld/p:spTree/p:sp',ns) if s.find('./p:nvSpPr/p:cNvPr',ns).get('name')=='fastppt:body:body']
  assert len(shapes)==1,(index,'one editable content object required')
  ps=shapes[0].findall('./p:txBody/a:p',ns);assert len(ps)==1
  text=''.join('\\n' if n.tag=='{'+ns['a']+'}br' else n.findtext('a:t','',ns) for n in ps[0]);assert text==c['text'],(index,text)
  p=ps[0].find('a:pPr',ns);assert p.get('indent')==str(c['indent']*12700)
  assert p.get('algn')=={'left':'l','right':'r','center':'ctr','justify':'just'}[c['align']]
  if c['label']=='*':assert p.find('a:buChar',ns).get('char')=='*'
  else:assert p.find('a:buAutoNum',ns).get('startAt')=='1234'
  if c.get('points'):assert p.find('a:buSzPts',ns).get('val')==str(c['points']*100)
  if c.get('percent'):assert p.find('a:buSzPct',ns).get('val')==str(c['percent']*1000)
  if c.get('followFont'):assert p.find('a:buFontTx',ns) is not None
  else:assert p.find('a:buFont',ns).get('typeface')==c.get('font','Liberation Mono')
`, native, join(directory, 'cases.json')])
await writeFile(join(directory, 'manifest.json'), JSON.stringify({ directory, locale: 'en-US', artifacts: [{ stage: 'actual-native-export', input: native }] }))
await run('/usr/bin/python3', [helper, join(directory, 'manifest.json')], { timeout: 60000 })
const observation = JSON.parse(await readFile(join(directory, 'observations.json'), 'utf8')) as { environment: unknown; artifacts: Array<{ pptxSha256: string; pdfSha256: string; pdf: string; pages: Array<{ paragraphs: Array<{ text: string }> }> }> }
const environment = TextRenderingEnvironmentSchema.parse(observation.environment)
if (environment.locale.observed !== 'en-US' || environment.configurationSha256 !== await hash(join(directory, 'initial-configuration.xcu'))) throw new Error('Application configuration changed.')
const artifact = observation.artifacts[0]!
if (observation.artifacts.length !== 1 || artifact.pptxSha256 !== await hash(native) || artifact.pdfSha256 !== await hash(artifact.pdf)) throw new Error('Artifact identity changed.')
const html = join(directory, 'actual.html'), fontXml = join(directory, 'fonts.xml')
await Promise.all([run('pdftotext', ['-bbox-layout', artifact.pdf, html]), run('pdftohtml', ['-xml', '-hidden', '-zoom', '1', artifact.pdf, fontXml])])
const pages = [...(await readFile(html, 'utf8')).matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)].map(page => [...page[1]!.matchAll(/<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([^<]*)<\/word>/g)].map(word => ({ text: word[5]!, x: Number(word[1]), y: Number(word[2]), end: Number(word[3]) })))
const fontDocument = await readFile(fontXml, 'utf8')
const pdfFonts = (await run('pdffonts', [artifact.pdf])).stdout
const actualFonts = pdfFonts.split('\n').slice(2).map(line => line.trim().split(/\s+/)[0]).filter((name): name is string => !!name)
const fonts = Object.fromEntries([...fontDocument.matchAll(/<fontspec id="([^"]+)" size="([^"]+)" family="([^"]+)"/g)].map(font => [font[1]!, { size: Number(font[2]), family: font[3]!, actualFamily: actualFonts.find(name => name.startsWith(font[3]!.split('+')[0] + '+')) ?? font[3]! }] as const))
const fontPages = [...fontDocument.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)].map(page => [...page[1]!.matchAll(/<text\b[^>]*font="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g)].map(text => ({ text: text[2]!.replace(/<[^>]*>/g, ''), ...fonts[text[1]!]! })))
if (pages.length !== cases.length || artifact.pages.length !== cases.length || fontPages.length !== cases.length) throw new Error('Page count/order changed.')
const results = cases.map((entry, index) => {
  const importedText = artifact.pages[index]!.paragraphs.map(p => p.text).join('\n'), measured = measuredGeometry(pages[index]!, entry.label)
  const expected = expectedGeometry(entry), known = entry.followFont || entry.points || entry.bold ? expectedGeometry(entry, true) : undefined
  const matches = (values: Horizontal[]) => values.length === measured.length && values.every((value, at) => {
    const actual = measured[at]!
    return actual.text === value.text && actual.line === value.line && Math.abs(actual.x - value.x) <= 0.25 && Math.abs(actual.width - value.width) <= 0.25
  })
  const markerFont = fontPages[index]!.find(run => run.text.startsWith(entry.label))
  // Poppler fontspec sizes are integer approximations; glyph advances remain checked at 0.25pt.
  const fontMatches = !entry.text || !!markerFont && markerFont.actualFamily.endsWith((entry.font ?? 'Liberation Mono').replaceAll(' ', '') + (entry.bold ? '-Bold' : '')) && Math.abs(markerFont.size - (entry.points ?? 20 * (entry.percent ?? 100) / 100)) <= 1
  const knownFont = entry.followFont ? markerFont?.family.endsWith('OpenSymbol') : entry.points ? markerFont?.family.endsWith('LiberationMono') && markerFont.size === 20 : entry.bold ? markerFont?.actualFamily.endsWith('LiberationMono') : fontMatches
  const status = importedText !== entry.text ? 'unexpected' : entry.observationOnly ? 'observed-only' : matches(expected) && fontMatches ? 'matched' : known && matches(known) && knownFont ? 'known-difference' : 'unexpected'
  return { id: entry.id, page: index + 1, source: entry, importedText, expected, known, words: pages[index], measured, fonts: fontPages[index], fontMatches, status }
})
const report = { version: 1, generatedAt: new Date().toISOString(), comparisonBasis: 'target-application-probe', measurement: 'horizontal-marker-and-body-advances-and-row-assignment', baseline: 'unverified', fontSizePrecision: 'Poppler integer approximation, tolerance 1pt', units: 'points', tolerancePoints: 0.25, environment, sourcePptxSha256: artifact.pptxSha256,
  reproducers: await Promise.all([['tests/e2e/scripts/bullet-compatibility.ts', fileURLToPath(import.meta.url)], ['tests/e2e/scripts/lib/libreoffice-text-probe.py', helper]].map(async ([path, file]) => ({ path, sha256: await hash(file!) }))),
  artifacts: [{ stage: 'actual-native-export', pptxSha256: artifact.pptxSha256, pdfSha256: artifact.pdfSha256, fontXmlSha256: await hash(fontXml), pdfFonts, pageCount: cases.length, cases: results }] }
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(['matched', 'known-difference', 'observed-only', 'unexpected'].map(status => `${results.filter(result => result.status === status).length} ${status}`).join(', '))
for (const result of results.filter(entry => entry.status === 'unexpected')) console.log(JSON.stringify({ id: result.id, measured: result.measured, expected: result.expected, known: result.known, fonts: result.fonts }))
if (results.some(entry => entry.status === 'unexpected')) process.exitCode = 1
