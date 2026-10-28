/** Actual exporter -> LibreOffice PDF -> extracted labels. Run manually where LO
 * and pdftotext are installed. Known differences remain evidence, never a pass. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import { autoNumberSchemes } from '../../../packages/slidewave/src/primitives/text-numbering.mjs'
import type { TextBullet } from '../../../packages/slidewave/src/primitives/text-bullet.js'

const run = promisify(execFile)
const directory = resolve(
  process.argv[2] ?? '/tmp/fastppt-numbering-compatibility',
)
await mkdir(directory, { recursive: true })
const style = {
  fontFamily: 'Liberation Sans',
  fontSizePx: 20,
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeightPx: 30,
  letterSpacingPx: 0,
  color: { hex: '112233', alpha: 1 },
  align: 'left',
  decoration: [],
  direction: 'ltr',
}
type Row = {
  text: string
  level?: number
  restart?: number
  bullet?: TextBullet
}
type Case = {
  name: string
  rows: Row[]
  intended: string[]
  observedDifference?: string[]
}
const cases: Case[] = [
  {
    name: 'nesting-empty-and-plain',
    rows: [
      { text: 'A' },
      { text: 'B' },
      { text: 'C', level: 2 },
      { text: 'Plain', bullet: { kind: 'none' } },
      { text: 'D', level: 2 },
      { text: 'E' },
      { text: 'F', level: 2 },
      { text: '' },
      { text: 'G' },
    ],
    intended: ['5. A', '6. B', '3. C', 'Plain', '4. D', '7. E', '3. F', '8. G'],
  },
  {
    name: 'restart-after-continuation',
    rows: [
      { text: 'A' },
      { text: 'B' },
      { text: 'C', restart: 2 },
      { text: 'D' },
      { text: 'E', restart: 5 },
      { text: 'F' },
    ],
    intended: ['5. A', '6. B', '2. C', '3. D', '5. E', '6. F'],
  },
  {
    name: 'restart-at-one',
    rows: [
      { text: 'A' },
      { text: 'B' },
      { text: 'C', restart: 1 },
      { text: 'D' },
    ],
    intended: ['5. A', '6. B', '1. C', '2. D'],
    observedDifference: ['5. A', '6. B', '7. C', '8. D'],
  },
  {
    name: 'adjacent-identical-starts',
    rows: [{ text: 'A' }, { text: 'B', restart: 5 }, { text: 'C' }],
    intended: ['5. A', '5. B', '6. C'],
    observedDifference: ['5. A', '6. B', '7. C'],
  },
  {
    name: 'character-interruption',
    rows: [
      { text: 'A' },
      { text: 'Char', bullet: { kind: 'character', character: '•' } },
      { text: 'B' },
      { text: 'C' },
    ],
    intended: ['5. A', '• Char', '5. B', '6. C'],
  },
]
const formatted27 = [
  '27.',
  '27)',
  '(27)',
  '27',
  'aa.',
  'AA.',
  'aa)',
  'AA)',
  '(aa)',
  '(AA)',
  'xxvii.',
  'XXVII.',
  'xxvii)',
  'XXVII)',
  '(xxvii)',
  '(XXVII)',
]
for (const [index, scheme] of autoNumberSchemes.entries())
  cases.push({
    name: scheme,
    rows: [
      { text: 'Format', bullet: { kind: 'auto-number', scheme, startAt: 27 } },
    ],
    intended: [`${formatted27[index]} Format`],
  })
const snapshot = HtmlDeckSnapshotSchema.parse({
  version: 1,
  source: 'html',
  warnings: [],
  slides: cases.map((entry, index) => {
    const paragraphs = entry.rows.map((row) => ({
      level: row.level ?? 1,
      style,
      marginLeftPx: 120 * (row.level ?? 1),
      marginRightPx: 0,
      indentPx: -110,
      spaceBeforePx: 0,
      spaceAfterPx: 0,
      bullet: row.bullet ?? {
        kind: 'auto-number',
        scheme: 'arabicPeriod',
        startAt: row.level === 2 ? 3 : 5,
      },
      numberingRestart: row.restart,
      runs: row.text ? [{ text: row.text, style }] : [],
    }))
    return {
      version: 1,
      id: String(index + 1),
      width: 960,
      height: 540,
      warnings: [],
      elements: [
        {
          kind: 'text',
          id: 'body',
          source: { tag: 'div', path: 'body' },
          order: 0,
          zIndex: 0,
          opacity: 1,
          box: { x: 40, y: 40, width: 880, height: 460 },
          style,
          paragraphs,
          text: entry.rows.map((row) => row.text).join('\n'),
        },
      ],
    }
  }),
})
const pptx = join(directory, 'numbering.pptx'),
  pdf = join(directory, 'numbering.pdf')
// Clear generated evidence before export so any failure leaves no stale report.
for (const path of [
  pdf,
  join(directory, 'report.json'),
  join(directory, 'numbering.txt'),
])
  await rm(path, { force: true })
const exported = await writeEditablePptx(snapshot, pptx, { embedFonts: false })
const version = (await run('libreoffice', ['--version'])).stdout.trim()
await run(
  'libreoffice',
  [
    `-env:UserInstallation=${pathToFileURL(join(directory, 'profile')).href}`,
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    directory,
    pptx,
  ],
  { timeout: 60000 },
)
const extracted = (await run('pdftotext', ['-layout', pdf, '-'])).stdout
await writeFile(join(directory, 'numbering.txt'), extracted)
const pages = extracted
  .split('\f')
  .map((page) =>
    page
      .split('\n')
      .map((line) => line.trim().replace(/\s+/g, ' '))
      .filter(Boolean),
  )
  .filter((page) => page.length)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const results = cases.map((entry, index) => ({
  name: entry.name,
  page: index + 1,
  intended: entry.intended,
  observed: pages[index],
  status: same(entry.intended, pages[index])
    ? 'matched'
    : entry.observedDifference && same(entry.observedDifference, pages[index])
      ? 'known-difference'
      : 'unexpected',
}))
const digest = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
const report = {
  reproducer: 'tests/e2e/scripts/numbering-compatibility.ts',
  reproducerSha256: await digest(fileURLToPath(import.meta.url)),
  renderer: version,
  generatedAt: new Date().toISOString(),
  pptxSha256: await digest(pptx),
  pdfSha256: await digest(pdf),
  applicationScope:
    'LibreOffice PDF export only; no PowerPoint/WPS/Keynote editing or save/reopen claims.',
  pageCount: pages.length,
  warnings: exported.warnings,
  results,
}
await writeFile(
  join(directory, 'report.json'),
  JSON.stringify(report, null, 2) + '\n',
)
console.log(
  JSON.stringify(
    {
      directory,
      renderer: version,
      pages: pages.length,
      matched: results.filter((result) => result.status === 'matched').length,
      knownDifferences: results
        .filter((result) => result.status === 'known-difference')
        .map((result) => result.name),
      unexpected: results.filter((result) => result.status === 'unexpected'),
    },
    null,
    2,
  ),
)
if (
  pages.length !== cases.length ||
  results.some((result) => result.status === 'unexpected')
)
  process.exitCode = 1
