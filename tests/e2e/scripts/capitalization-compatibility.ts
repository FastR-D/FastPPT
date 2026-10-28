/** Actual native export plus an independent, generic CSS reference (not capture QA). */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import { TextRenderingEnvironmentSchema } from '@fastppt/presentation-ir'

type Case = { id: string; font: string; cap: 'none' | 'all' | 'small'; language: string; text: string; upper: string; knownUpper: string; observationOnly?: boolean }
type Glyph = { text: string; origin: [number, number]; box: number[]; font: string; size: number }
const specimens = [
  { id: 'basic', language: 'en-US', text: 'Abc xyz 123', upper: 'ABC XYZ 123', knownUpper: 'ABC XYZ 123' },
  { id: 'sharp-s', language: 'de-DE', text: 'Straße', upper: 'STRASSE', knownUpper: 'STRAẞE' },
  { id: 'turkish', language: 'tr-TR', text: 'i ı I İ', upper: 'İ I I İ', knownUpper: 'İ I I İ' },
  { id: 'greek', language: 'el-GR', text: 'άδικος', upper: 'ΑΔΙΚΟΣ', knownUpper: 'ΆΔΙΚΟΣ' },
  { id: 'ligature', language: 'de-DE', text: 'ﬃ', upper: 'FFI', knownUpper: 'F' },
]
const cases: Case[] = ['Liberation Serif', 'EB Garamond 12'].flatMap(font => (['none', 'all', 'small'] as const).flatMap(cap => specimens.map(specimen => ({ ...specimen, id: `${font}-${cap}-${specimen.id}`, font, cap }))))
cases.push(...(['none', 'all', 'small'] as const).map(cap => ({ id: `mixed-${cap}`, font: 'Liberation Serif', cap, language: 'en-US', text: 'Abc中文ß', upper: 'ABC中文SS', knownUpper: 'ABC中文ẞ', observationOnly: true })),
  { id: 'empty', font: 'Liberation Serif', cap: 'all', language: 'en-US', text: '', upper: '', knownUpper: '' },
  { id: 'soft-break', font: 'Liberation Serif', cap: 'small', language: 'en-US', text: 'Abc\nxyz', upper: 'ABC\nXYZ', knownUpper: 'ABC\nXYZ', observationOnly: true },
  { id: 'missing-font', font: 'FastPPT Missing Capitalization Probe', cap: 'all', language: 'en-US', text: 'Straße', upper: 'STRASSE', knownUpper: 'STRAẞE', observationOnly: true })
const directory = resolve(process.argv[2] ?? '/tmp/fastppt-capitalization-compatibility'), run = promisify(execFile)
const helper = fileURLToPath(new URL('./lib/libreoffice-text-probe.py', import.meta.url))
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
await mkdir(directory, { recursive: true })
const fontResult = await run('python3', ['-c', `
import json,hashlib,subprocess
from fontTools.ttLib import TTFont
result=[]
for requested in ['Liberation Serif','EB Garamond 12']:
 path=subprocess.check_output(['fc-match','-f','%{file}',requested],text=True);font=TTFont(path);cmap=font.getBestCmap()
 features=sorted(set(r.FeatureTag for r in font['GSUB'].table.FeatureList.FeatureRecord)) if 'GSUB' in font else []
 result.append({'requested':requested,'path':path,'sha256':hashlib.sha256(open(path,'rb').read()).hexdigest(),'postscript':font['name'].getDebugName(6),'features':features,'sourceGlyphs':{c:cmap.get(ord(c)) for c in 'AbcxyzßiıIİάδικοςﬃ中文'}})
print(json.dumps(result))
`])
const fonts = JSON.parse(fontResult.stdout) as Array<{ requested: string; path: string; sha256: string; postscript: string; features: string[]; sourceGlyphs: Record<string, string | null> }>
const base = { fontSizePx: 20, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 60, letterSpacingPx: 0, color: { hex: '112233', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr' }
const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: cases.map((entry, index) => {
  const style = { ...base, fontFamily: entry.font, capitalization: entry.cap, language: entry.language }
  return { version: 1, id: String(index + 1), width: 959.976, height: 539.9865, warnings: [], elements: [{ id: 'body', kind: 'text', source: { tag: 'div', path: 'body', anchor: 'body' }, box: { x: 40, y: 40, width: 500, height: 300 }, order: 0, zIndex: 0, opacity: 1, style, text: entry.text, paragraphs: [{ level: 1, style, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs: entry.text ? [{ text: entry.text, style }] : [] }] }] }
}) })
const native = join(directory, 'capitalization-native.pptx')
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
  for tag in ['a:pPr/a:defRPr','a:endParaRPr']:assert ps[0].find(tag,ns).get('cap')==c['cap']
  actual=''
  for n in ps[0]:
   if n.tag in ['{'+ns['a']+'}r','{'+ns['a']+'}br']:
    r=n.find('a:rPr',ns);assert r.get('cap')==c['cap'];assert r.get('sz')=='2000'
    if n.tag=='{'+ns['a']+'}br':actual+='\\n'
    else:
     actual+=n.findtext('a:t','',ns);assert r.get('lang')==c['language']
  assert actual==c['text']
`, native, join(directory, 'cases.json')])
await writeFile(join(directory, 'manifest.json'), JSON.stringify({ directory, locale: 'en-US', artifacts: [{ stage: 'actual-native-export', input: native }] }))
await run('/usr/bin/python3', [helper, join(directory, 'manifest.json')], { timeout: 60000 })
const observation = JSON.parse(await readFile(join(directory, 'observations.json'), 'utf8')) as { environment: unknown; artifacts: Array<{ pptxSha256: string; pdfSha256: string; pdf: string; pages: Array<{ paragraphs: Array<{ text: string }> }> }> }
const environment = TextRenderingEnvironmentSchema.parse(observation.environment), artifact = observation.artifacts[0]!
if (observation.artifacts.length !== 1 || environment.application.version !== '7.3.7.2' || environment.locale.observed !== 'en-US' || environment.configurationSha256 !== await hash(join(directory, 'initial-configuration.xcu')) || artifact.pptxSha256 !== await hash(native) || artifact.pdfSha256 !== await hash(artifact.pdf)) throw new Error('Application or artifact identity changed.')

// This deliberately bypasses the FastPPT capture pipeline. It establishes the
// browser's display behavior before deciding how to model that pipeline.
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-proxy-server'] })
const browserVersion = browser.version(), browserPdf = join(directory, 'browser-css-reference.pdf')
let browserCases: Array<{ textContent: string; innerText: string; widthPoints: number; withoutSynthesisWidthPoints: number; variant: string; transform: string; synthesis: string }>
try {
  const page = await browser.newPage()
  await page.setContent('<style>@page{size:960pt 540pt;margin:0}body{margin:0}section{position:relative;width:960pt;height:540pt;break-after:page}section:last-child{break-after:auto}span{position:absolute;left:40pt;top:40pt;font-size:20pt;line-height:60pt;white-space:pre;color:#112233}</style>')
  await page.evaluate(cases => {
    for (const entry of cases) {
      const section = document.createElement('section'), text = document.createElement('span')
      text.textContent = entry.text; text.lang = entry.language
      text.style.fontFamily = JSON.stringify(entry.font)
      text.style.textTransform = entry.cap === 'all' ? 'uppercase' : 'none'
      text.style.fontVariantCaps = entry.cap === 'small' ? 'small-caps' : 'normal'
      section.append(text); document.body.append(section)
    }
  }, cases)
  await page.evaluate(() => document.fonts.ready)
  browserCases = await page.locator('span').evaluateAll(elements => elements.map(element => {
    const css = getComputedStyle(element), text = element as HTMLElement
    const result = { textContent: text.textContent ?? '', innerText: text.innerText, widthPoints: text.getBoundingClientRect().width * 0.75, withoutSynthesisWidthPoints: 0, variant: css.fontVariantCaps, transform: css.textTransform, synthesis: css.fontSynthesis }
    text.style.fontSynthesis = 'none'
    result.withoutSynthesisWidthPoints = text.getBoundingClientRect().width * 0.75
    text.style.fontSynthesis = ''
    return result
  }))
  await page.pdf({ path: browserPdf, preferCSSPageSize: true })
} finally { await browser.close() }
const extracted = await run('python3', ['-c', `
import pymupdf,json,sys
def extract(path):
 with pymupdf.open(path) as document:
  return [[{'text':c['c'],'origin':c['origin'],'box':c['bbox'],'font':s['font'],'size':s['size']} for b in page.get_text('rawdict',flags=pymupdf.TEXTFLAGS_RAWDICT|pymupdf.TEXT_INHIBIT_SPACES)['blocks'] if 'lines' in b for l in b['lines'] for s in l['spans'] for c in s['chars']] for page in document]
print(json.dumps({'reader':{'name':'PyMuPDF','version':pymupdf.VersionBind,'inhibitSyntheticSpaces':True},'native':extract(sys.argv[1]),'browser':extract(sys.argv[2])}))
`, artifact.pdf, browserPdf])
const glyphReport = JSON.parse(extracted.stdout) as { reader: unknown; native: Glyph[][]; browser: Glyph[][] }
await writeFile(join(directory, 'glyphs.json'), JSON.stringify(glyphReport, null, 2))
if ([artifact.pages.length, glyphReport.native.length, glyphReport.browser.length, browserCases.length].some(length => length !== cases.length)) throw new Error('Rendered page count changed.')
const results = cases.map((entry, index) => {
  const glyphs = glyphReport.native[index]!, css = browserCases[index]!, importedText = artifact.pages[index]!.paragraphs.map(p => p.text).join('\n')
  const nativeDisplayText = glyphs.map(glyph => glyph.text).join(''), browserDisplayText = glyphReport.browser[index]!.map(glyph => glyph.text).join('')
  const controlIndex = cases.findIndex(other => other.font === entry.font && other.text === entry.text && other.language === entry.language && other.cap === 'all')
  const allControl = glyphReport.native[controlIndex]
  const matchesFullCapitals = !!allControl && glyphs.length === allControl.length && glyphs.every((glyph, at) => glyph.text === allControl[at]!.text && glyph.font === allControl[at]!.font && Math.abs(glyph.size - allControl[at]!.size) < 0.05 && Math.abs(glyph.origin[0] - allControl[at]!.origin[0]) < 0.05 && Math.abs(glyph.origin[1] - allControl[at]!.origin[1]) < 0.05)
  const sourcePreserved = importedText === entry.text && css.textContent === entry.text
  const expected = entry.cap === 'none' ? entry.text : entry.upper
  const status = !sourcePreserved || (entry.cap === 'all' && css.innerText !== entry.upper) ? 'unexpected'
    : entry.observationOnly || (entry.cap === 'none' && entry.text === 'ﬃ' && entry.font === 'Liberation Serif') ? 'observed-only'
      : entry.cap === 'small' ? matchesFullCapitals && nativeDisplayText === entry.knownUpper ? 'small-caps-as-full-capitals' : 'unexpected'
        : nativeDisplayText === expected ? 'display-text-matched'
          : entry.cap === 'all' && nativeDisplayText === entry.knownUpper ? 'case-mapping-difference' : 'unexpected'
  return { page: index + 1, source: entry, importedText, sourcePreserved, nativeDisplayText, browserDisplayText, genericCssReference: css, nativeGlyphs: glyphs, browserGlyphs: glyphReport.browser[index]!, ...(entry.cap === 'small' ? { allControlPage: controlIndex < 0 ? null : controlIndex + 1, matchesFullCapitals } : {}), status }
})
const smallCapsControls = ['Liberation Serif', 'EB Garamond 12'].map(font => {
  const entry = results.find(result => result.source.id === `${font}-small-basic`)!, feature = fonts.find(value => value.requested === font)!.features.includes('smcp')
  const synthesisChangesWidth = Math.abs(entry.genericCssReference.widthPoints - entry.genericCssReference.withoutSynthesisWidthPoints) > 0.5
  if (synthesisChangesWidth === feature) throw new Error('Browser small-cap synthesis control changed.')
  return { font, sourceFeatureSmcp: feature, synthesisChangesWidth, page: entry.page }
})
const report = { version: 1, generatedAt: new Date().toISOString(), comparisonBasis: 'target-application-probe', browserReference: 'generic-css; does not exercise FastPPT capture', browserPixelEquivalence: 'unverified', sourcePptxSha256: artifact.pptxSha256, environment, browser: { name: 'Chrome', version: browserVersion, pdfSha256: await hash(browserPdf) }, fonts, reader: glyphReport.reader, smallCapsControls,
  limitations: ['Display-text matches do not establish glyph, line-layout or pixel equivalence.', 'PDF small-cap extraction can retain lowercase Unicode while drawing capital glyphs; it is not an editable source readback.', 'Font synthesis controls cover the basic Latin specimen only.', 'CJK, missing fonts, missing source glyphs and soft-break small caps remain observations.', 'No generated-theme/capture, PowerPoint, WPS or Keynote acceptance is claimed.'],
  reproducers: await Promise.all([['tests/e2e/scripts/capitalization-compatibility.ts', fileURLToPath(import.meta.url)], ['tests/e2e/scripts/lib/libreoffice-text-probe.py', helper]].map(async ([path, file]) => ({ path, sha256: await hash(file!) }))),
  artifacts: [{ stage: 'actual-native-export', pptxSha256: artifact.pptxSha256, pdfSha256: artifact.pdfSha256, glyphsSha256: await hash(join(directory, 'glyphs.json')), pageCount: cases.length, cases: results }] }
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(Object.fromEntries([...new Set(results.map(entry => entry.status))].map(status => [status, results.filter(entry => entry.status === status).length]))))
for (const result of results.filter(entry => entry.status === 'unexpected')) console.log(JSON.stringify(result))
if (results.some(entry => entry.status === 'unexpected')) process.exitCode = 1
