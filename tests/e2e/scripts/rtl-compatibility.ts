/** Real native RTL export and LibreOffice readback evidence.
 * The source string remains logical; direction is proved by XML and application observations.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import { TextRenderingEnvironmentSchema } from '@fastppt/presentation-ir'

type Case = { id: string; text: string; language: string; direction: 'rtl' | 'ltr'; align: 'left' | 'center' | 'right'; known?: string }
const cases: Case[] = [
  { id: 'arabic-mixed-right', text: 'مرحبا بالعالم 123 ABC', language: 'ar-SA', direction: 'rtl', align: 'right' },
  { id: 'hebrew-mixed-center', text: 'שלום עולם 123 ABC', language: 'he-IL', direction: 'rtl', align: 'center' },
  { id: 'hebrew-latin-left', text: 'אבג ABC 123 (x)', language: 'en-US', direction: 'rtl', align: 'left' },
  { id: 'explicit-ltr-arabic', text: 'مرحبا 123 ABC', language: 'ar-SA', direction: 'ltr', align: 'left' },
  { id: 'bidi-controls', text: '\u202Babc 123\u202C', language: 'en-US', direction: 'rtl', align: 'right', known: '\u202Babc 123\u202C' },
]
const directory = resolve(process.argv[2] ?? '/tmp/fastppt-rtl-compatibility')
const run = promisify(execFile)
const helper = fileURLToPath(new URL('./lib/libreoffice-text-probe.py', import.meta.url))
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
await mkdir(directory, { recursive: true })
const styles = cases.map(entry => ({ fontFamily: entry.language === 'ar-SA' ? 'Noto Sans Arabic' : entry.language === 'he-IL' ? 'Noto Sans Hebrew' : 'DejaVu Sans', fontSizePx: 24, fontWeight: 400, fontStyle: 'normal' as const, lineHeightPx: 34, letterSpacingPx: 0, color: { hex: '112233', alpha: 1 }, align: entry.align, decoration: [] as Array<'underline' | 'line-through'>, direction: entry.direction, language: entry.language }))
const snapshot = HtmlDeckSnapshotSchema.parse({
  version: 1,
  source: 'html',
  warnings: [],
  slides: cases.map((entry, index) => {
    const style = styles[index]!
    return {
      version: 1,
      id: entry.id,
      width: 960,
      height: 540,
      warnings: [],
      elements: [{
        id: entry.id,
        kind: 'text',
        source: { tag: 'div', path: entry.id, anchor: entry.id },
        box: { x: 40, y: 40, width: 880, height: 180 },
        order: 0,
        zIndex: 0,
        opacity: 1,
        text: entry.text,
        style,
        paragraphs: [{ level: 1, style, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs: [{ text: entry.text, style }] }],
      }],
    }
  }),
})

const native = join(directory, 'rtl-native.pptx')
await writeEditablePptx(snapshot, native, { embedFonts: false })
const slidePaths = (await run('unzip', ['-Z1', native])).stdout.split('\n').filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
const slideXml = await Promise.all(slidePaths.map(path => run('unzip', ['-p', native, path]).then(result => result.stdout)))
if (slideXml.length !== cases.length || slideXml.some((part, index) => !part.includes(`rtl="${cases[index]!.direction === 'rtl' ? '1' : '0'}"`) || !part.includes(cases[index]!.text))) throw new Error('RTL XML evidence is missing.')
await writeFile(join(directory, 'cases.json'), JSON.stringify(cases, null, 2))
await writeFile(join(directory, 'manifest.json'), JSON.stringify({ directory, locale: 'en-US', artifacts: [{ stage: 'actual-native-export', input: native }] }))
await run('/usr/bin/python3', [helper, join(directory, 'manifest.json')], { timeout: 60000 })
const observation = JSON.parse(await readFile(join(directory, 'observations.json'), 'utf8')) as { environment: unknown; artifacts: Array<{ stage: string; pptxSha256: string; pdfSha256: string; pdf: string; pages: Array<{ paragraphs: Array<{ text: string }> }> }> }
const environment = TextRenderingEnvironmentSchema.parse(observation.environment), artifact = observation.artifacts[0]!
if (environment.locale.observed !== 'en-US' || artifact.pptxSha256 !== await hash(native) || artifact.pdfSha256 !== await hash(artifact.pdf)) throw new Error('Application or artifact identity changed.')
const imported = artifact.pages.map(page => page.paragraphs.map(paragraph => paragraph.text).join('\n'))
const results = cases.map((entry, index) => ({ page: index + 1, source: entry, importedText: imported[index], sourcePreserved: imported[index] === entry.text, status: imported[index] === entry.text ? 'observed' : 'unexpected' }))
const report = { version: 1, generatedAt: new Date().toISOString(), comparisonBasis: 'target-application-probe', browserPixelEquivalence: 'unverified', sourcePptxSha256: artifact.pptxSha256, environment, xml: { directionAttributes: slideXml.flatMap(part => part.match(/rtl="[01]"/g) ?? []).length, rtlParagraphs: slideXml.flatMap(part => part.match(/rtl="1"/g) ?? []).length, sourceTextPresent: cases.every((entry, index) => slideXml[index]!.includes(entry.text)) }, artifacts: [{ stage: artifact.stage, pptxSha256: artifact.pptxSha256, pdfSha256: artifact.pdfSha256, pageCount: cases.length, cases: results }], limitations: ['Logical text and paragraph direction are verified from the editable XML and UNO readback.', 'Unicode bidi controls and mixed scripts are observations of LibreOffice 7.3.7.2.', 'RTL bullets, tabs, vertical text, columns, autofit and PowerPoint/WPS/Keynote edit acceptance are not claimed.'], reproducers: [{ path: 'tests/e2e/scripts/rtl-compatibility.ts', sha256: await hash(fileURLToPath(import.meta.url)) }, { path: 'tests/e2e/scripts/lib/libreoffice-text-probe.py', sha256: await hash(helper) }] }
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ pages: results.length, sourcePreserved: results.filter(result => result.sourcePreserved).length, unexpected: results.filter(result => result.status === 'unexpected').length, rtlParagraphs: report.xml.rtlParagraphs }))
if (results.some(result => result.status === 'unexpected')) process.exitCode = 1
