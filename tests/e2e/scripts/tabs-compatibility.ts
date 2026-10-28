/** Real native export and separately labelled XML diagnostics. Requires
 * LibreOffice, pdftotext and Python 3. Known differences never count as matches. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'

const run = promisify(execFile)
const directory = resolve(process.argv[2] ?? '/tmp/fastppt-tabs-compatibility')
await mkdir(directory, { recursive: true })
type Case = {
  name: string
  text: string
  intended: number[]
  known?: number[]
  margin?: number
  indent?: number
  size?: number
  stops?: number[]
  align?: 'left' | 'center' | 'right' | 'decimal'
  inherited?: boolean
  diagnosticKnown?: number[]
  diagnosticIntended?: number[]
  diagnosticWords?: string[]
  diagnosticEnds?: number[]
  language?: string
  runs?: string[]
  expectationNote?: string
}
const cases: Case[] = [
  { name: 'default', text: 'A\tB\tC', intended: [40, 112, 184] },
  { name: 'margin', text: 'A\tB\tC', margin: 40, intended: [80, 152, 224] },
  {
    name: 'positive-indent',
    text: 'A\tB\tC',
    margin: 40,
    indent: 20,
    intended: [100, 152, 224],
  },
  {
    name: 'negative-indent',
    text: 'A\tB\tC',
    margin: 40,
    indent: -40,
    intended: [40, 80, 152],
    diagnosticIntended: [80, 152, 224],
  },
  {
    name: 'long-negative-indent',
    text: 'A\tB\tC',
    margin: 200,
    indent: -150,
    intended: [90, 240, 312],
    diagnosticIntended: [240, 312, 384],
  },
  { name: 'consecutive', text: 'A\t\tB', intended: [40, 184] },
  {
    name: 'explicit',
    text: 'A\tB\tC\tD',
    stops: [150, 262.5],
    intended: [40, 190, 302.5, 328],
    known: [40, 112, 184, 256],
  },
  {
    name: 'explicit-margin',
    text: 'A\tB\tC\tD',
    margin: 40,
    stops: [150, 262.5],
    intended: [80, 230, 342.5, 368],
    known: [80, 152, 224, 296],
  },
  {
    name: 'custom-default',
    text: 'A\tB\tC',
    size: 48,
    intended: [40, 88, 136],
    known: [40, 112, 184],
    diagnosticKnown: [40, 112, 184],
  },
  {
    name: 'zero-default-explicit',
    text: 'A\tB\tC',
    size: 0,
    stops: [150, 262.5],
    intended: [40, 190, 302.5],
    known: [40, 112, 184],
  },
  {
    name: 'inherited',
    text: 'A\tB',
    inherited: true,
    intended: [40, 190],
    known: [40, 112],
  },
  {
    name: 'empty-clears-inherited',
    text: 'A\tB',
    inherited: true,
    stops: [],
    intended: [40, 112],
    diagnosticKnown: [40, 190],
  },
  {
    name: 'center-diagnostic-contract',
    text: 'A\tBB',
    stops: [150],
    align: 'center',
    intended: [40, 178],
    known: [40, 112],
  },
  {
    name: 'right-diagnostic-contract',
    text: 'A\tBB',
    stops: [150],
    align: 'right',
    intended: [40, 166],
    known: [40, 112],
  },
  {
    name: 'decimal-diagnostic-contract',
    text: 'A\t12.34',
    stops: [150],
    align: 'decimal',
    intended: [40, 166],
    known: [40, 112],
  },
]
for (const align of ['center', 'right'] as const) {
  const start = align === 'center' ? 178 : 166
  cases.push(
    {
      name: `${align}-multiple`,
      text: 'A\tBB\tCC',
      stops: [150, 300],
      align,
      intended: [40, start, start + 150],
      known: [40, 112, 184],
    },
    {
      name: `${align}-empty-field`,
      text: 'A\t\tCC',
      stops: [150, 300],
      align,
      intended: [40, start + 150],
      known: [40, 184],
    },
    {
      name: `${align}-soft-break`,
      text: 'A\tBB\nX\tYY',
      stops: [150, 300],
      align,
      intended: [40, start, 40, start],
      known: [40, 112, 40, 112],
    },
    {
      name: `${align}-default-after-explicit`,
      text: 'A\tBB\tCC',
      stops: [150],
      align,
      intended: [40, start, 256],
      known: [40, 112, 184],
    },
    {
      name: `${align}-cross-run`,
      text: 'A\tBB\tCC',
      runs: ['A\tB', 'B\tC', 'C'],
      stops: [150, 300],
      align,
      intended: [40, start, start + 150],
      known: [40, 112, 184],
    },
    {
      name: `${align}-zero-default`,
      text: 'A\tBB\tCC',
      size: 0,
      stops: [150, 300],
      align,
      intended: [40, start, start + 150],
      known: [40, 112, 184],
    },
    {
      name: `${align}-clamped-long-field`,
      text: 'A\tABCDEFGHIJKLMNOPQRSTUVWX\tZ',
      stops: [150, 300],
      align,
      intended: [40, 52, 400],
      known: [40, 112, 472],
      diagnosticIntended: [40, 400],
      diagnosticWords: ['AABCDEFGHIJKLMNOPQRSTUVWX', 'Z'],
      diagnosticEnds: [340, 412],
      expectationNote:
        'The zero-width tab lets the first two runs touch; pdftotext merges them into one word. Inspect its end position as well.',
    },
  )
}
for (const language of ['de-DE', 'fr-FR']) {
  cases.push(
    {
      name: `decimal-${language}-comma-probe`,
      text: 'A\t12,34',
      stops: [150],
      align: 'decimal',
      language,
      intended: [40, 166],
      known: [40, 112],
      diagnosticKnown: [40, 130],
      expectationNote:
        'Probe of the conventional comma separator for this run language. DrawingML has no separator attribute; this expectation is not an application support claim.',
    },
    {
      name: `decimal-${language}-period-probe`,
      text: 'A\t12.34',
      stops: [150],
      align: 'decimal',
      language,
      intended: [40, 130],
      known: [40, 112],
      diagnosticKnown: [40, 166],
      expectationNote:
        'Probe of a period in a comma-decimal language. The renderer can use its own decimal convention despite the saved run language.',
    },
  )
}
const style = {
  fontFamily: 'Liberation Mono',
  fontSizePx: 20,
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeightPx: 30,
  letterSpacingPx: 0,
  color: { hex: '000000', alpha: 1 },
  align: 'left',
  decoration: [],
  direction: 'ltr',
}
// The exporter uses 13.333 inches. This exact source size makes 1 CSS px = 1 pt.
const snapshot = HtmlDeckSnapshotSchema.parse({
  version: 1,
  source: 'html',
  warnings: [],
  slides: cases.map((entry, index) => ({
    version: 1,
    id: String(index + 1),
    width: 959.976,
    height: 539.9865,
    warnings: [],
    elements: [
      {
        id: 'body',
        kind: 'text',
        source: { tag: 'div', path: 'body', anchor: 'body' },
        order: 0,
        zIndex: 0,
        opacity: 1,
        box: { x: 40, y: 40, width: 840, height: 400 },
        style,
        text: entry.text,
        paragraphs: [
          {
            level: 1,
            style,
            marginLeftPx: entry.margin ?? 0,
            marginRightPx: 0,
            indentPx: entry.indent ?? 0,
            spaceBeforePx: 0,
            spaceAfterPx: 0,
            defaultTabSizePx: entry.size ?? 72,
            ...(entry.stops === undefined
              ? {}
              : {
                  tabStopsPx: entry.stops.map((position) => ({
                    position,
                    align: entry.align ?? 'left',
                  })),
                }),
            runs: (entry.runs ?? [entry.text]).map((text) => ({
              text,
              style: {
                ...style,
                ...(entry.language ? { language: entry.language } : {}),
              },
            })),
          },
        ],
      },
    ],
  })),
})
const nativePath = join(directory, 'tabs-native.pptx'),
  diagnosticPath = join(directory, 'tabs-no-indent-diagnostic.pptx')
for (const path of [
  'report.json',
  'tabs-native.pptx',
  'tabs-native.pdf',
  'tabs-native.html',
  'tabs-no-indent-diagnostic.pptx',
  'tabs-no-indent-diagnostic.pdf',
  'tabs-no-indent-diagnostic.html',
])
  await rm(join(directory, path), { force: true })
const exported = await writeEditablePptx(snapshot, nativePath, {
  embedFonts: false,
  slideLayouts: cases.map((entry) =>
    entry.inherited ? 'inherited-tabs' : undefined,
  ),
  masterLayoutDefinitions: [
    {
      name: 'inherited-tabs',
      canvas: { width: 12191695, height: 6857829 },
      placeholders: [
        {
          index: 0,
          type: 'body',
          x: 508000,
          y: 508000,
          width: 10668000,
          height: 5080000,
          textStyle: {
            paragraph: {
              defaultTabSize: 914400,
              tabStops: [{ position: 1905000, align: 'left' }],
            },
          },
        },
      ],
    },
  ],
  placeholderBindings: cases.flatMap((entry, index) =>
    entry.inherited
      ? [
          {
            slide: index + 1,
            target: 'body',
            index: 0,
            geometry: 'page' as const,
            textStyle: 'page' as const,
          },
        ]
      : [],
  ),
})
// This variant is diagnostic only. Removing source indentation is not a fix:
// it can change layout and inheritance. Native evidence above stays untouched.
await run('python3', [
  '-c',
  `
import re, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as source, zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as output:
    for entry in source.infolist():
        data = source.read(entry.filename)
        if re.fullmatch(r'ppt/(slides|slideLayouts|slideMasters)/[^/]+\\.xml', entry.filename):
            data = re.sub(rb'\\sindent="-?\\d+"', b'', data)
        output.writestr(entry, data)
`,
  nativePath,
  diagnosticPath,
])
const version = (await run('libreoffice', ['--version'])).stdout.trim()
const digest = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
const render = async (path: string, diagnostic: boolean) => {
  await run(
    'libreoffice',
    [
      `-env:UserInstallation=${pathToFileURL(join(directory, 'profile')).href}`,
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      directory,
      path,
    ],
    { timeout: 60000 },
  )
  const pdf = path.replace(/\.pptx$/, '.pdf'),
    html = path.replace(/\.pptx$/, '.html')
  await run('pdftotext', ['-bbox-layout', pdf, html])
  const pages = [
    ...(await readFile(html, 'utf8')).matchAll(
      /<page\b[^>]*>([\s\S]*?)<\/page>/g,
    ),
  ].map((page) =>
    [
      ...page[1]!.matchAll(
        /<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([^<]*)<\/word>/g,
      ),
    ]
      .map((word) => ({
        text: word[5]!,
        x: Number(word[1]),
        y: Number(word[2]),
        end: Number(word[3]),
      }))
      .sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : a.x - b.x)),
  )
  const results = cases.map((entry, index) => {
    const words = pages[index] ?? [],
      intended = [
        ...(diagnostic
          ? (entry.diagnosticIntended ?? entry.intended)
          : entry.intended),
      ]
    // Removing nonzero first-line indentation intentionally moves the first run.
    if (diagnostic) intended[0] = 40 + (entry.margin ?? 0)
    const expectedWords =
        diagnostic && entry.diagnosticWords
          ? entry.diagnosticWords
          : entry.text.split(/[\t\n]+/),
      known = diagnostic ? entry.diagnosticKnown : entry.known
    const same = (positions: number[]) =>
      words.length === positions.length &&
      words.every(
        (word, at) =>
          word.text === expectedWords[at] &&
          Math.abs(word.x - positions[at]!) <= 0.25 &&
          (!diagnostic ||
            !entry.diagnosticEnds ||
            Math.abs(word.end - entry.diagnosticEnds[at]!) <= 0.25),
      )
    return {
      name: entry.name,
      page: index + 1,
      intended,
      observed: words,
      status: same(intended)
        ? 'matched'
        : known && same(known)
          ? 'known-difference'
          : 'unexpected',
      ...(known ? { known } : {}),
      ...(entry.language ? { language: entry.language } : {}),
      ...(entry.expectationNote
        ? { expectationNote: entry.expectationNote }
        : {}),
    }
  })
  return {
    kind: diagnostic
      ? 'diagnostic-with-indent-removed'
      : 'actual-native-export',
    pptxSha256: await digest(path),
    pdfSha256: await digest(pdf),
    pageCount: pages.length,
    results,
  }
}
const native = await render(nativePath, false),
  diagnostic = await render(diagnosticPath, true)
const report = {
  reproducer: 'tests/e2e/scripts/tabs-compatibility.ts',
  reproducerSha256: await digest(fileURLToPath(import.meta.url)),
  generatedAt: new Date().toISOString(),
  renderer: version,
  applicationScope:
    'LibreOffice PDF export only. Center/right/decimal cases probe native contracts, not browser support. XML diagnostics remove indent; they are not production output or application editing evidence.',
  tolerancePoints: 0.25,
  warnings: exported.warnings,
  native,
  diagnostic,
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
      results: [native, diagnostic].map((result) => ({
        kind: result.kind,
        pages: result.pageCount,
        matched: result.results.filter((entry) => entry.status === 'matched')
          .length,
        knownDifferences: result.results
          .filter((entry) => entry.status === 'known-difference')
          .map((entry) => entry.name),
        unexpected: result.results.filter(
          (entry) => entry.status === 'unexpected',
        ),
      })),
    },
    null,
    2,
  ),
)
if (
  [native, diagnostic].some(
    (result) =>
      result.pageCount !== cases.length ||
      result.results.some((entry) => entry.status === 'unexpected'),
  )
)
  process.exitCode = 1
