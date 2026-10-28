/** Real locale-controlled decimal probes. Diagnostic copies never count as
 * production passes. Requires system Python/UNO, LibreOffice and pdftotext. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { DecimalTabEvidenceV1Schema, type TextRenderingEnvironment } from '@fastppt/presentation-ir'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'

const run = promisify(execFile)
const directory = resolve(process.argv[2] ?? '/tmp/fastppt-decimal-compatibility')
const helper = fileURLToPath(new URL('./lib/libreoffice-text-probe.py', import.meta.url))
const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
type Word = { text: string; x: number; end?: number }
type Case = { id: string; text: string; period: number[]; comma: number[]; stops?: number[]; runs?: Array<{ text: string; language?: string }>; diagnosticWords?: string[]; ends?: number[] }
// Independent fixed expectations in points, not the browser tab resolver.
const cases: Case[] = [
  ['period', '12.34', 166, 130], ['comma', '12,34', 130, 166], ['missing', '1234', 142, 142],
  ['multiple-periods', '1.2.3', 178, 130], ['multiple-commas', '1,2,3', 130, 178],
  ['leading-period', '.34', 190, 154], ['leading-comma', ',34', 154, 190],
  ['trailing-period', '12.', 166, 154], ['trailing-comma', '12,', 154, 166],
  ['negative', '-12.34', 154, 118], ['currency-prefix', 'USD12.34', 130, 94],
  ['non-numeric', 'abc.def', 154, 106], ['grouping-comma', '1,234.56', 130, 178],
  ['grouping-period', '1.234,56', 178, 130], ['non-separator', '12x34', 130, 130],
].map(([id, field, period, comma]) => ({ id: String(id), text: `A\t${field}`, period: [40, Number(period)], comma: [40, Number(comma)] }))
cases.push(
  { id: 'run-language-de', text: 'A\t12.34', runs: [{ text: 'A\t12.34', language: 'de-DE' }], period: [40, 166], comma: [40, 130] },
  { id: 'run-language-en', text: 'A\t12,34', runs: [{ text: 'A\t12,34', language: 'en-US' }], period: [40, 130], comma: [40, 166] },
  { id: 'cross-run', text: 'A\t12.34', runs: [{ text: 'A\t1', language: 'fr-FR' }, { text: '2', language: 'en-US' }, { text: '.', language: '' }, { text: '34', language: 'de-DE' }], period: [40, 166], comma: [40, 130] },
  { id: 'soft-break', text: 'A\t12.34\nX\t56,78', period: [40, 166, 40, 130], comma: [40, 130, 40, 166] },
  { id: 'multiple-stops', text: 'A\t12.34\t56,78', stops: [150, 300], period: [40, 166, 280], comma: [40, 130, 316] },
  { id: 'empty-field', text: 'A\t\t12.34', stops: [150, 300], period: [40, 316], comma: [40, 280] },
  { id: 'default-after-explicit', text: 'A\t12.34\tB', period: [40, 166, 256], comma: [40, 130, 256] },
  { id: 'collision', text: 'A\tABCDEFGHIJKLMNOPQRSTUVWX.12', period: [40], comma: [40], diagnosticWords: ['AABCDEFGHIJKLMNOPQRSTUVWX.12'], ends: [376] },
)
const style = { fontFamily: 'Liberation Mono', fontSizePx: 20, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, letterSpacingPx: 0, color: { hex: '000000', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr' }
const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: cases.map((entry, index) => ({
  version: 1, id: String(index + 1), width: 959.976, height: 539.9865, warnings: [],
  elements: [{ id: 'body', kind: 'text', source: { tag: 'div', path: 'body', anchor: 'body' }, order: 0, zIndex: 0, opacity: 1, box: { x: 40, y: 40, width: 840, height: 400 }, style, text: entry.text,
    paragraphs: [{ level: 1, style, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, defaultTabSizePx: 72,
      tabStopsPx: (entry.stops ?? [150]).map(position => ({ position, align: 'decimal' })),
      runs: (entry.runs ?? [{ text: entry.text }]).map(({ text, language }) => ({ text, style: { ...style, ...(language === undefined ? {} : { language }) } })),
    }],
  }],
})) })
await mkdir(directory, { recursive: true })
const nativePath = join(directory, 'decimal-native.pptx'), diagnosticPath = join(directory, 'decimal-no-indent.pptx')
for (const path of ['report.json', 'decimal-native.pptx', 'decimal-no-indent.pptx']) await rm(join(directory, path), { force: true })
for (const locale of ['en-US', 'de-DE', 'fr-FR']) await rm(join(directory, locale, 'observations.json'), { force: true })
await writeEditablePptx(snapshot, nativePath, { embedFonts: false })
const fixturePath = join(directory, 'source-cases.json')
await writeFile(fixturePath, JSON.stringify(cases.map(entry => ({ text: entry.text, runs: entry.runs ?? [{ text: entry.text }] }))))
// Confirm run languages in the actual ZIP: locale-independent geometry alone
// would not detect a writer silently dropping or fabricating run declarations.
await run('python3', ['-c', `
import json,sys,zipfile,xml.etree.ElementTree as ET
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as source:
    for index,entry in enumerate(json.load(open(sys.argv[2]))):
        root=ET.fromstring(source.read('ppt/slides/slide%d.xml'%(index+1)))
        actual=[]
        for shape in root.findall('./p:cSld/p:spTree/p:sp',ns):
            for paragraph in shape.findall('./p:txBody/a:p',ns):
                for node in paragraph:
                    if node.tag=='{'+ns['a']+'}br': actual.append(('\\n',None))
                    if node.tag=='{'+ns['a']+'}r':
                        properties=node.find('a:rPr',ns)
                        language=properties.get('lang') if properties is not None else None
                        actual.extend((c,language) for c in node.findtext('a:t','',ns))
        expected=[(c,run.get('language')) for run in entry['runs'] for c in run['text']]
        assert ''.join(c for c,_ in actual)==entry['text'],(index,'source text changed')
        assert [(c,l) for c,l in actual if c!='\\n']==[(c,l) for c,l in expected if c!='\\n'],(index,'source run languages changed')
`, nativePath, fixturePath])
await run('python3', ['-c', `
import re,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as source, zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as output:
    for entry in source.infolist():
        data=source.read(entry.filename)
        if re.fullmatch(r'ppt/(slides|slideLayouts|slideMasters)/[^/]+\\.xml',entry.filename):
            data=re.sub(rb'\\sindent="-?\\d+"',b'',data)
        output.writestr(entry,data)
`, nativePath, diagnosticPath])
const parseWords = async (pdf: string): Promise<Word[][]> => {
  const html = pdf.replace(/\.pdf$/, '.html')
  await rm(html, { force: true })
  await run('pdftotext', ['-bbox-layout', pdf, html])
  return [...(await readFile(html, 'utf8')).matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)].map(page => [...page[1]!.matchAll(/<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([^<]*)<\/word>/g)]
    .map(word => ({ text: word[5]!, x: Number(word[1]), y: Number(word[2]), end: Number(word[3]) }))
    .sort((a, b) => Math.abs(a.y - b.y) > 1 ? a.y - b.y : a.x - b.x).map(({ text, x, end }) => ({ text, x, end })))
}
type Observation = { environment: TextRenderingEnvironment; artifacts: Array<{ stage: 'actual-native-export' | 'diagnostic-indent-removed'; pptxSha256: string; pdfSha256: string; pdf: string; pages: Array<{ paragraphs: Array<{ text: string; tabs: Array<{ positionHundredthMm: number; alignment: string; decimalCharacter: string }> }> }> }> }
const targets = []
for (const locale of ['en-US', 'de-DE', 'fr-FR']) {
  const targetDirectory = join(directory, locale)
  await mkdir(targetDirectory, { recursive: true })
  const manifest = join(targetDirectory, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ directory: targetDirectory, locale, artifacts: [{ stage: 'actual-native-export', input: nativePath }, { stage: 'diagnostic-indent-removed', input: diagnosticPath }] }))
  await run('/usr/bin/python3', [helper, manifest], { timeout: 60000 })
  const observation = JSON.parse(await readFile(join(targetDirectory, 'observations.json'), 'utf8')) as Observation
  if (observation.environment.configurationSha256 !== await digest(join(targetDirectory, 'initial-configuration.xcu'))) throw new Error('Configuration evidence changed.')
  const artifacts = []
  for (const artifact of observation.artifacts) {
    const diagnostic = artifact.stage === 'diagnostic-indent-removed'
    if (artifact.pptxSha256 !== await digest(diagnostic ? diagnosticPath : nativePath) || artifact.pdfSha256 !== await digest(artifact.pdf) || dirname(artifact.pdf) !== targetDirectory) throw new Error('Rendered artifact identity changed.')
    const pages = await parseWords(artifact.pdf)
    if (pages.length !== cases.length || artifact.pages.length !== cases.length) throw new Error('Rendered or imported page count changed.')
    const results = cases.map((entry, index) => {
      const expectedPositions = locale === 'en-US' ? entry.period : entry.comma
      const expectedWords = entry.diagnosticWords ?? entry.text.split(/[\t\n]+/)
      const expected = expectedWords.map((text, at) => ({ text, x: expectedPositions[at]!, ...(entry.ends ? { end: entry.ends[at]! } : {}) }))
      // In the actual output this LO version resets stops on explicit indent=0.
      const known = diagnostic ? undefined : entry.text.split('\n').flatMap(line => line.split('\t').flatMap((text, at) => text ? [{ text, x: 40 + at * 72 }] : []))
      const observed = pages[index]!, paragraphs = artifact.pages[index]!.paragraphs
      const importedText = paragraphs.map(paragraph => paragraph.text).join('\n')
      const same = (words: Word[]) => words.length === observed.length && words.every((word, at) => word.text === observed[at]!.text && Math.abs(word.x - observed[at]!.x) <= 0.25 && (word.end === undefined || Math.abs(word.end - observed[at]!.end!) <= 0.25))
      const importedTabs = paragraphs.flatMap(paragraph => paragraph.tabs)
      return { id: entry.id, page: index + 1, sourceText: entry.text, sourceRuns: entry.runs ?? [{ text: entry.text }], importedText, importedTabs, expected, ...(known ? { known } : {}), observed,
        status: importedText !== entry.text ? 'unexpected' : same(expected) ? 'matched' : known && same(known) ? 'known-difference' : 'unexpected',
      }
    })
    artifacts.push({ stage: artifact.stage, pptxSha256: artifact.pptxSha256, pdfSha256: artifact.pdfSha256, pageCount: pages.length, cases: results })
  }
  targets.push({ environment: observation.environment, artifacts })
  console.log(`${locale}: ${artifacts.map(artifact => `${artifact.stage} ${artifact.cases.filter(entry => entry.status === 'matched').length} matched, ${artifact.cases.filter(entry => entry.status === 'known-difference').length} known, ${artifact.cases.filter(entry => entry.status === 'unexpected').length} unexpected`).join('; ')}`)
}
const report = DecimalTabEvidenceV1Schema.parse({ version: 1, generatedAt: new Date().toISOString(), sourcePptxSha256: await digest(nativePath), sourceConvention: { status: 'unknown', reason: 'drawingml-has-no-decimal-separator' }, comparisonBasis: 'target-application-probe', tolerancePoints: 0.25,
  reproducers: await Promise.all([['tests/e2e/scripts/decimal-compatibility.ts', fileURLToPath(import.meta.url)], ['tests/e2e/scripts/lib/libreoffice-text-probe.py', helper]].map(async ([path, file]) => ({ path, sha256: await digest(file!) }))), targets })
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
if (report.targets.some(target => target.artifacts.some(artifact => artifact.cases.some(entry => entry.status === 'unexpected')))) process.exitCode = 1
