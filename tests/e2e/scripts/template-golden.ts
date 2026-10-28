/** Replays a frozen source package through extraction, standalone Slidev,
 * native export, actual ZIP readback and an independent LibreOffice render.
 * Results persist in a new directory; expectations are never rewritten. */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium, expect, type Browser } from '@playwright/test'
import {
  analyzePptx,
  readPptxRuleEvidence,
  pptxRenderEnvironmentDigest,
} from '@fastppt/pptx-import'
import {
  MasterSnapshotV1Schema,
  NativeMasterLayoutSchema,
  TextRenderingEnvironmentSchema,
  PptxRenderEvidenceV1Schema,
} from '@fastppt/presentation-ir'
import {
  HtmlDeckSnapshotSchema,
  type HtmlDeckSnapshot,
} from '@fastppt/slidewave/snapshot'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import {
  evaluateThemeRules,
  loadThemeRegistry,
  ThemeRulesDocumentSchema,
  themeRulesDigest,
} from '@fastppt/theme-registry'
import JSZip from 'jszip'
import { verifyTemplateGolden } from './lib/template-golden-evidence.js'
import { evaluateExportReadback } from '@fastppt/gateway/theme-rule-readback'

const run = promisify(execFile)
const repository = fileURLToPath(new URL('../../..', import.meta.url))
const fixture = join(repository, 'tests/golden/pptx-template/single-master')
const artifactRoot = resolve(
  process.argv[2] ?? join(repository, 'tests/golden/pptx-template/artifacts'),
)
await mkdir(artifactRoot, { recursive: true })
const directory = await mkdtemp(join(artifactRoot, 'single-master-'))
const digest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex')
const hash = async (path: string) => digest(await readFile(path))
const json = (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value, null, 2) + '\n')
async function files(root: string, prefix = ''): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    if (['node_modules', '.git'].includes(entry.name)) continue
    const path = join(prefix, entry.name)
    if (entry.isDirectory()) result.push(...(await files(root, path)))
    else if (entry.isFile()) result.push(path)
  }
  return result.sort()
}
type Fixture = {
  version: number
  sourceSha256: string
  font: string
  canvas: { width: number; height: number }
  placeholders: Array<{
    index: number
    type: string
    x: number
    y: number
    width: number
    height: number
  }>
  fixedObjects: Array<{
    name: string
    x: number
    y: number
    width: number
    height: number
    fill: string
  }>
  pages: Array<{ id: string; title: string; paragraphs: string[] }>
}
const expected = JSON.parse(
  await readFile(join(fixture, 'expected.json'), 'utf8'),
) as Fixture
const hostRequire = createRequire(
  join(repository, 'packages/slidev-host/package.json'),
)
let server: ReturnType<typeof spawn> | undefined
let browser: Browser | undefined
let serverOutput = ''
const startedAt = new Date().toISOString()
const checks: string[] = []
try {
  const zip = new JSZip()
  const sourceParts = await files(join(fixture, 'source-package'))
  for (const path of sourceParts)
    zip.file(path, await readFile(join(fixture, 'source-package', path)), {
      date: new Date('2000-01-01T00:00:00Z'),
      createFolders: false,
    })
  const sourceBytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'STORE',
    platform: 'DOS',
  })
  assert.equal(
    digest(sourceBytes),
    expected.sourceSha256,
    'Frozen source package changed; review the input and expectations explicitly.',
  )
  const source = join(directory, 'source.pptx')
  await writeFile(source, sourceBytes)
  await json(join(directory, 'expected.json'), expected)
  const analysis = await analyzePptx(sourceBytes)
  assert.equal(analysis.sourceHash, expected.sourceSha256)
  assert.equal(analysis.sourceGraph?.slides.length, 1)
  await json(join(directory, 'analysis.json'), analysis)
  const themeRoot = join(directory, 'generated-theme')
  await mkdir(themeRoot)
  await run(
    process.execPath,
    [
      join(repository, 'scripts/extract-theme.mjs'),
      source,
      '--name',
      'golden-single-master',
      '--out',
      themeRoot,
      '--analysis',
      join(directory, 'analysis.json'),
    ],
    { timeout: 60_000 },
  )
  const theme = join(themeRoot, 'slidev-theme-golden-single-master')
  const definitions = NativeMasterLayoutSchema.array().parse(
    JSON.parse(
      await readFile(join(theme, 'agent/native-layouts.json'), 'utf8'),
    ),
  )
  assert.equal(definitions.length, 1, 'Expected one complete reachable layout')
  const layout = definitions[0]!
  assert.deepEqual(layout.canvas, expected.canvas)
  assert.deepEqual(
    layout.placeholders.map(({ index, type, x, y, width, height }) => ({
      index,
      type,
      x,
      y,
      width,
      height,
    })),
    expected.placeholders,
  )
  assert.deepEqual(
    layout.fixedObjects?.map(({ name, x, y, width, height, fill }) => ({
      name,
      x,
      y,
      width,
      height,
      fill,
    })),
    expected.fixedObjects,
  )
  checks.push(
    'source hash, reachable layout, placeholder geometry and fixed object match frozen expectations',
  )
  const registry = await loadThemeRegistry(themeRoot)
  const registered = registry.resolve('slidev-theme-golden-single-master')
  const lock = MasterSnapshotV1Schema.parse({
    version: 1,
    themeId: registered.manifest.id,
    digest: registered.contentDigest,
    fonts: [expected.font],
    colors: { accent1: '00A98F' },
    masters: [
      {
        id: layout.masterId ?? 'default',
        layouts: [layout.name],
        placeholders: ['title', 'body'],
      },
    ],
    layoutDefinitions: definitions,
    unsupported: [],
  })
  await json(join(directory, 'theme-lock.json'), lock)

  // Exact installed font evidence; font substitution is not silently accepted.
  const fontMatch = (
    await run('fc-match', ['-f', '%{family}\n%{file}', expected.font])
  ).stdout
    .trim()
    .split('\n')
  assert.ok(
    fontMatch[0]?.split(',').includes(expected.font),
    `Missing required font: ${expected.font}`,
  )
  const fontPath = fontMatch[1]!
  const fontEvidence = {
    requested: expected.font,
    resolved: fontMatch[0],
    file: fontPath,
    sha256: await hash(fontPath),
  }
  await mkdir(join(theme, 'node_modules/@fastppt'), { recursive: true })
  await symlink(
    join(repository, 'packages/fonts'),
    join(theme, 'node_modules/@fastppt/fonts'),
  )
  const escape = (text: string) =>
    text.replace(
      /[&<>]/g,
      (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[value]!,
    )
  const slides = expected.pages
    .map(
      (page, index) =>
        `${index ? '---\n' : '---\ntheme: slidev-theme-golden-single-master\ncanvasWidth: 960\naspectRatio: 16/9\n'}layout: ${layout.name}\nfastpptId: ${page.id}\n---\n\n::ph-0::\n\n<div id="title" data-fastppt-text-box><p>${escape(page.title)}</p></div>\n\n::ph-1::\n\n<div id="body" data-fastppt-text-box>${page.paragraphs.map((text) => `<p>${escape(text)}</p>`).join('')}</div>\n`,
    )
    .join('\n')
  const entry = join(directory, 'slides.md')
  await writeFile(entry, slides)
  // The same Slidev server transforms capture.ts; no fixture gateway or copied
  // layout is involved. Paths are serialized as JS data, not shell fragments.
  await writeFile(
    join(directory, 'vite.config.ts'),
    `export default ${JSON.stringify({ server: { strictPort: true, fs: { allow: [repository, directory] } } })}\n`,
  )
  const port = 4336
  server = spawn(
    process.execPath,
    [
      hostRequire.resolve('@slidev/cli/bin/slidev.mjs'),
      entry,
      '--theme',
      theme,
      '--port',
      String(port),
    ],
    { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  server.stdout?.on('data', (data: Buffer) => {
    serverOutput += data.toString()
  })
  server.stderr?.on('data', (data: Buffer) => {
    serverOutput += data.toString()
  })
  server.on('error', (error) => {
    serverOutput += String(error)
  })
  await expect
    .poll(
      async () => {
        if (server!.exitCode !== null || server!.signalCode !== null)
          throw new Error(`Slidev stopped: ${serverOutput}`)
        try {
          return (
            await fetch(`http://127.0.0.1:${port}/`, {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        } catch {
          return false
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  browser = await chromium.launch({
    ...(existsSync('/usr/bin/google-chrome')
      ? { executablePath: '/usr/bin/google-chrome' }
      : {}),
    args: ['--no-proxy-server'],
  })
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
  const snapshot: HtmlDeckSnapshot = {
    version: 1,
    source: 'slidev',
    warnings: [],
    slides: [],
  }
  const measurements: unknown[] = []
  await mkdir(join(directory, 'rendered/browser'), { recursive: true })
  for (const [index, content] of expected.pages.entries()) {
    await page.goto(`http://127.0.0.1:${port}/${index + 1}`)
    const root = page.locator('.source-layout:visible')
    await expect(root.locator('#title')).toHaveText(content.title)
    await expect(root.locator('#body p')).toHaveText(content.paragraphs)
    const evidence = await root.evaluate(async (element, repositoryPath) => {
      const captureUrl = `/@fs${repositoryPath}/packages/slidewave/src/slidev/capture.ts`
      const measurementUrl = `/@fs${repositoryPath}/packages/slidewave/src/browser/rule-measurement.ts`
      const { captureHtmlSlide } = (await import(captureUrl)) as {
        captureHtmlSlide: (root: HTMLElement) => Promise<unknown>
      }
      const { measureThemeRules } = (await import(measurementUrl)) as {
        measureThemeRules: (root: HTMLElement, slide: number) => unknown
      }
      const captured = await captureHtmlSlide(element as HTMLElement)
      return {
        captured,
        measurement: measureThemeRules(element as HTMLElement, 1),
      }
    }, repository)
    const captured = HtmlDeckSnapshotSchema.parse({
      version: 1,
      source: 'slidev',
      warnings: [],
      slides: [evidence.captured],
    }).slides[0]!
    captured.id = content.id
    assert.deepEqual(captured.warnings, [])
    for (const [anchor, text] of [
      ['title', content.title],
      ['body', content.paragraphs.join('\n')],
    ]) {
      const objects = captured.elements.filter(
        (element) => element.source.anchor === anchor,
      )
      assert.equal(
        objects.length,
        1,
        `${anchor} must capture as one editable shape`,
      )
      assert.equal(
        objects[0]?.kind === 'text' ? objects[0].text : undefined,
        text,
      )
    }
    snapshot.slides.push(captured)
    measurements.push({ slide: index + 1, evidence: evidence.measurement })
    await root.screenshot({
      path: join(directory, `rendered/browser/slide-${index + 1}.png`),
      animations: 'disabled',
    })
  }
  await json(join(directory, 'snapshot.json'), snapshot)
  await json(join(directory, 'browser-measurements.json'), measurements)
  checks.push(
    'standalone generated theme captures each authored title/body as one native text object',
  )

  const output = join(directory, 'exported.pptx')
  const result = await writeEditablePptx(snapshot, output, {
    embedFonts: false,
    policy: 'strict-editable',
    masterLayoutDefinitions: lock.layoutDefinitions!,
    slideLayouts: snapshot.slides.map(() => layout.name),
    placeholderBindings: expected.pages.flatMap((_, index) =>
      ['title', 'body'].map((target, slot) => ({
        slide: index + 1,
        target,
        index: slot,
        geometry: 'layout' as const,
        textStyle: 'layout' as const,
        textBody: 'layout' as const,
      })),
    ),
  })
  assert.equal(result.qa.ok, true)
  await json(join(directory, 'export-report.json'), result)
  const bytes = await readFile(output)
  const readback = await readPptxRuleEvidence(bytes)
  assert.equal(readback.sha256, digest(bytes))
  assert.deepEqual(
    readback.slides.map((slide) => slide.slideId),
    expected.pages.map((page) => page.id),
  )
  assert.deepEqual(
    readback.slides.map((slide) => slide.layout),
    expected.pages.map(() => layout.name),
  )
  assert.equal(
    new Set(readback.slides.map((slide) => slide.masterPart)).size,
    1,
  )
  for (const slide of readback.slides)
    assert.deepEqual(
      slide.placeholders?.map(({ index, type }) => ({ index, type })),
      expected.placeholders.map(({ index, type }) => ({ index, type })),
    )
  const rules = ThemeRulesDocumentSchema.parse({
    version: 1,
    rules: [
      {
        id: 'golden.layout',
        kind: 'allowed-layouts',
        layouts: [layout.name],
        severity: 'error',
      },
      {
        id: 'golden.brand',
        kind: 'fixed-object',
        name: 'Brand rule',
        owner: 'layout',
        allowOverride: false,
        severity: 'error',
      },
    ],
  })
  const issues = evaluateThemeRules({
    document: rules,
    phase: 'readback',
    slides: readback.slides.map((slide) => ({
      index: slide.index,
      layout: slide.layout!,
      fixedObjects: slide.fixedObjects,
    })),
  })
  assert.deepEqual(issues, [])
  await json(join(directory, 'read-back.json'), {
    ...readback,
    rules,
    rulesDigest: themeRulesDigest(rules),
    issues,
  })
  const exportedAnalysis = await analyzePptx(bytes)
  await json(join(directory, 'export-analysis.json'), exportedAnalysis)
  type TextParts = Array<{
    part: string
    objects: Array<{ text?: { paragraphs: Array<{ text: string }> } }>
  }>
  const textParts = exportedAnalysis.extractedFeatures
    .sourceObjects as TextParts
  for (const [index, slide] of exportedAnalysis.sourceGraph!.slides.entries()) {
    const text = textParts
      .find((item) => item.part === slide.part)!
      .objects.flatMap(
        (object) =>
          object.text?.paragraphs
            .map((paragraph) => paragraph.text)
            .filter(Boolean) ?? [],
      )
    assert.deepEqual(text, [
      expected.pages[index]!.title,
      ...expected.pages[index]!.paragraphs,
    ])
  }
  checks.push(
    'actual PPTX retains original paragraphs, page order, one master, both placeholders and inherited brand rule',
  )

  const renderDirectory = join(directory, 'rendered/pptx')
  await mkdir(renderDirectory, { recursive: true })
  await json(join(renderDirectory, 'manifest.json'), {
    directory: renderDirectory,
    locale: 'en-US',
    artifacts: [{ stage: 'actual-native-export', input: output }],
  })
  const helper = join(
    repository,
    'tests/e2e/scripts/lib/libreoffice-render-probe.py',
  )
  await run(
    '/usr/bin/python3',
    [helper, join(renderDirectory, 'manifest.json')],
    { timeout: 120_000 },
  )
  const observations = JSON.parse(
    await readFile(join(renderDirectory, 'observations.json'), 'utf8'),
  ) as {
    environment: unknown
    artifacts: Array<{
      pptxSha256: string
      pdfSha256: string
      pdf: string
      pages: Array<{ paragraphs: Array<{ text: string }> }>
    }>
  }
  const environment = TextRenderingEnvironmentSchema.parse(
    observations.environment,
  )
  const artifact = observations.artifacts[0]!
  assert.equal(observations.artifacts.length, 1)
  assert.equal(
    environment.configurationSha256,
    await hash(join(renderDirectory, 'initial-configuration.xcu')),
  )
  assert.equal(artifact.pptxSha256, await hash(output))
  assert.equal(artifact.pdfSha256, await hash(artifact.pdf))
  assert.equal(artifact.pages.length, expected.pages.length)
  for (const [index, content] of expected.pages.entries())
    assert.deepEqual(
      artifact.pages[index]!.paragraphs.map((paragraph) => paragraph.text),
      [content.title, ...content.paragraphs],
    )
  await run(
    'pdftoppm',
    [
      '-png',
      '-scale-to-x',
      '960',
      '-scale-to-y',
      '540',
      artifact.pdf,
      join(renderDirectory, 'slide'),
    ],
    { timeout: 30_000 },
  )
  const pngs = (await readdir(renderDirectory)).filter((file) =>
    /^slide-\d+\.png$/.test(file),
  )
  assert.equal(pngs.length, expected.pages.length)
  await run(
    '/usr/bin/python3',
    [helper, '--check-fonts', join(renderDirectory, 'font-inventory.json')],
    { timeout: 120_000 },
  )
  await run(
    'pdftotext',
    ['-bbox-layout', artifact.pdf, join(renderDirectory, 'text-boxes.html')],
    { timeout: 15_000 },
  )
  checks.push(
    'independent LibreOffice opens actual output read-only, preserves paragraphs and renders every page',
  )
  await copyFile(helper, join(renderDirectory, 'renderer.py'))
  const textProbe = join(
    repository,
    'tests/e2e/scripts/lib/libreoffice-text-probe.py',
  )
  await copyFile(textProbe, join(renderDirectory, 'libreoffice-text-probe.py'))
  const fileEvidence = async (path: string) => ({
    path,
    sha256: await hash(join(renderDirectory, path)),
  })
  const target = {
    environment,
    fontInventory: await fileEvidence('font-inventory.json'),
    rendererScript: await fileEvidence('renderer.py'),
    rendererDependencies: [await fileEvidence('libreoffice-text-probe.py')],
    rasterizer: {
      name: 'pdftoppm' as const,
      version: (await run('pdftoppm', ['-v'])).stderr.trim(),
      arguments: [
        '-png',
        '-scale-to-x',
        '960',
        '-scale-to-y',
        '540',
        'actual-native-export.pdf',
        'slide',
      ],
    },
  }
  const renderEnvironmentDigest = pptxRenderEnvironmentDigest(target)
  const renderEvidence = PptxRenderEvidenceV1Schema.parse({
    version: 1,
    source: 'libreoffice-pdf',
    createdAt: new Date().toISOString(),
    pptxSha256: readback.sha256,
    rulesDigest: themeRulesDigest(rules),
    ...target,
    environmentDigest: renderEnvironmentDigest,
    configuration: await fileEvidence('initial-configuration.xcu'),
    observations: await fileEvidence('observations.json'),
    pdf: await fileEvidence('actual-native-export.pdf'),
    pageMapping: 'presentation-order',
    pages: await Promise.all(
      readback.slides.map(async (slide) => ({
        index: slide.index,
        part: slide.part,
        slideId: slide.slideId,
        image: {
          ...(await fileEvidence(`slide-${slide.index}.png`)),
          width: 960,
          height: 540,
        },
        metrics: {
          textLines: {
            definition: 'fastppt.content-block-text-lines.v1',
            status: 'unverified',
            reason:
              'PDF text and UNO paragraphs do not establish content-block rendered line counts.',
          },
          density: {
            definition: 'fastppt.content-rectangle-union.v1',
            status: 'unverified',
            reason:
              'Raster output has no content-object roles or rectangle union measurement.',
          },
        },
      })),
    ),
  })
  await json(join(renderDirectory, 'render-evidence.json'), renderEvidence)
  // Exercise the production gate on the actual independent rendering, while
  // keeping structural success separate from unavailable layout measurements.
  const renderedReadback = await evaluateExportReadback(
    bytes,
    rules,
    snapshot,
    {
      directory: renderDirectory,
      environmentDigest: renderEnvironmentDigest,
      evidence: renderEvidence,
    },
  )
  assert.equal(renderedReadback.status, 'passed')
  assert.deepEqual(renderedReadback.render, renderEvidence)
  await json(join(directory, 'render-readback.json'), renderedReadback)
  checks.push(
    'production readback verifies PPTX hash, rules, page identities, font environment and per-page render artifacts',
  )
  const pipelineSources = [
    'packages/slidewave/src',
    'packages/pptx-import/src',
    'packages/presentation-ir/src',
    'packages/theme-registry/src',
    'scripts/lib',
  ]
  const pipelineFiles = [
    'scripts/extract-theme.mjs',
    ...(await Promise.all(
      pipelineSources.map(async (base) =>
        (await files(join(repository, base))).map((path) => join(base, path)),
      ),
    ).then((groups) => groups.flat())),
  ]
  await json(
    join(directory, 'pipeline-source.json'),
    await Promise.all(
      pipelineFiles.map(async (path) => ({
        path,
        sha256: await hash(join(repository, path)),
      })),
    ),
  )
  const artifacts = await Promise.all(
    (await files(directory)).map(async (path) => ({
      path,
      sha256: await hash(join(directory, path)),
    })),
  )
  const tools = await Promise.all(
    [
      'packages/slidewave/package.json',
      'packages/pptx-import/package.json',
      'packages/slidev-host/package.json',
      'pnpm-lock.yaml',
    ].map(async (path) => ({
      path,
      sha256: await hash(join(repository, path)),
    })),
  )
  await json(join(directory, 'report.json'), {
    version: 2,
    fixture: 'single-master',
    status: 'partial',
    automatedChecks: 'passed',
    pages: snapshot.slides.length,
    startedAt,
    completedAt: new Date().toISOString(),
    checks,
    sourceSha256: expected.sourceSha256,
    pptxSha256: digest(bytes),
    themeDigest: lock.digest,
    fontEvidence,
    browser: { name: 'Chromium', version: browser.version() },
    environment,
    renderEnvironmentDigest,
    tools,
    reproducers: [
      {
        path: relative(repository, fileURLToPath(import.meta.url)),
        sha256: await hash(fileURLToPath(import.meta.url)),
      },
      { path: relative(repository, helper), sha256: await hash(helper) },
      { path: relative(repository, textProbe), sha256: await hash(textProbe) },
    ],
    artifacts,
    visualComparison: 'unverified',
    applicationEditing: {
      PowerPoint: 'unverified',
      WPS: 'unverified',
      Keynote: 'unverified',
    },
    limitations: [
      'Synthetic fixed source covers one reachable layout and two authored pages.',
      'Text readback and rendered images do not prove pixel equality, line metrics or target-application editing.',
      'Fonts are required locally; this fixture does not claim font embedding or substitution fidelity.',
    ],
  })
  console.log(
    JSON.stringify({ directory, ...(await verifyTemplateGolden(directory)) }),
  )
} catch (error) {
  await json(join(directory, 'report.json'), {
    version: 1,
    fixture: 'single-master',
    status: 'failed',
    startedAt,
    completedAt: new Date().toISOString(),
    checks,
    error: error instanceof Error ? error.stack : String(error),
  })
  console.error(`Golden artifacts retained: ${directory}`)
  throw error
} finally {
  await browser?.close()
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise<void>((resolveStop) =>
      server!.once('exit', () => resolveStop()),
    )
    server.kill('SIGTERM')
    const timer = setTimeout(() => server?.kill('SIGKILL'), 5000)
    await stopped
    clearTimeout(timer)
  }
  await writeFile(join(directory, 'slidev.log'), serverOutput)
}
