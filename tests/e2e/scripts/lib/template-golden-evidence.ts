import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  readPptxRuleEvidence,
  verifyPptxRenderEvidence,
} from '@fastppt/pptx-import'
import { MasterSnapshotV1Schema } from '@fastppt/presentation-ir'
import {
  evaluateThemeRules,
  loadThemeRegistry,
  ThemeRulesDocumentSchema,
  themeRulesDigest,
} from '@fastppt/theme-registry'

/** Verify a retained run from its files, not just a previous success label.
 * This is integrity verification, not a signature or visual-compliance claim. */
export async function verifyTemplateGolden(directory: string) {
  const root = await realpath(directory)
  const report = JSON.parse(
    await readFile(join(root, 'report.json'), 'utf8'),
  ) as {
    version: number
    fixture: string
    automatedChecks: string
    pages: number
    sourceSha256: string
    pptxSha256: string
    themeDigest: string
    renderEnvironmentDigest: string
    artifacts: Array<{ path: string; sha256: string }>
  }
  assert.equal(
    report.version,
    2,
    'Replay the fixture to produce the version 2 render binding',
  )
  assert.equal(report.fixture, 'single-master')
  assert.equal(report.automatedChecks, 'passed')
  assert.equal(report.pages, 2)
  assert.ok(Array.isArray(report.artifacts) && report.artifacts.length > 0)
  const names = new Set<string>()
  for (const artifact of report.artifacts) {
    assert.equal(typeof artifact.path, 'string')
    assert.ok(
      !isAbsolute(artifact.path) &&
        !artifact.path.split(/[\\/]/).includes('..'),
    )
    assert.ok(!names.has(artifact.path), `Duplicate artifact: ${artifact.path}`)
    names.add(artifact.path)
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/)
    const path = await realpath(resolve(root, artifact.path))
    const offset = relative(root, path)
    assert.ok(
      offset && !offset.startsWith('..') && !isAbsolute(offset),
      'Artifact escaped the run directory',
    )
    assert.equal(
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
      artifact.sha256,
      `Artifact changed: ${artifact.path}`,
    )
  }
  for (const path of [
    'source.pptx',
    'expected.json',
    'analysis.json',
    'theme-lock.json',
    'snapshot.json',
    'browser-measurements.json',
    'exported.pptx',
    'export-analysis.json',
    'export-report.json',
    'pipeline-source.json',
    'read-back.json',
    'render-readback.json',
    'rendered/pptx/render-evidence.json',
    'rendered/pptx/font-inventory.json',
    'rendered/pptx/initial-configuration.xcu',
    'rendered/pptx/renderer.py',
    'rendered/pptx/libreoffice-text-probe.py',
    'rendered/pptx/observations.json',
    'rendered/pptx/actual-native-export.pdf',
    ...[1, 2].flatMap((page) => [
      `rendered/browser/slide-${page}.png`,
      `rendered/pptx/slide-${page}.png`,
    ]),
  ])
    assert.ok(names.has(path), `Evidence is missing from inventory: ${path}`)
  const expected = JSON.parse(
    await readFile(join(root, 'expected.json'), 'utf8'),
  ) as { sourceSha256: string; pages: Array<{ id: string }> }
  assert.equal(report.sourceSha256, expected.sourceSha256)
  assert.equal(
    createHash('sha256')
      .update(await readFile(join(root, 'source.pptx')))
      .digest('hex'),
    report.sourceSha256,
  )
  const actual = await readPptxRuleEvidence(
    await readFile(join(root, 'exported.pptx')),
  )
  assert.equal(actual.sha256, report.pptxSha256)
  assert.deepEqual(
    actual.slides.map((slide) => slide.slideId),
    expected.pages.map((page) => page.id),
  )
  const saved = JSON.parse(
    await readFile(join(root, 'read-back.json'), 'utf8'),
  ) as { slides: unknown; sha256: string; rules: unknown; rulesDigest: string }
  assert.deepEqual(saved.slides, actual.slides)
  assert.equal(saved.sha256, actual.sha256)
  const rules = ThemeRulesDocumentSchema.parse(saved.rules)
  assert.equal(themeRulesDigest(rules), saved.rulesDigest)
  assert.deepEqual(
    evaluateThemeRules({
      document: rules,
      phase: 'readback',
      slides: actual.slides.map((slide) => ({
        index: slide.index,
        layout: slide.layout,
        fixedObjects: slide.fixedObjects,
      })),
    }),
    [],
  )
  const lock = MasterSnapshotV1Schema.parse(
    JSON.parse(await readFile(join(root, 'theme-lock.json'), 'utf8')),
  )
  assert.equal(lock.digest, report.themeDigest)
  assert.equal(
    (await loadThemeRegistry(join(root, 'generated-theme'))).resolve(
      lock.themeId,
    ).contentDigest,
    lock.digest,
  )
  const observed = JSON.parse(
    await readFile(join(root, 'rendered/pptx/observations.json'), 'utf8'),
  ) as {
    artifacts: Array<{
      pptxSha256: string
      pdfSha256: string
      pages: unknown[]
    }>
  }
  assert.equal(observed.artifacts.length, 1)
  assert.equal(observed.artifacts[0]!.pptxSha256, actual.sha256)
  assert.equal(
    observed.artifacts[0]!.pdfSha256,
    createHash('sha256')
      .update(
        await readFile(join(root, 'rendered/pptx/actual-native-export.pdf')),
      )
      .digest('hex'),
  )
  assert.equal(observed.artifacts[0]!.pages.length, report.pages)
  const rendered = await verifyPptxRenderEvidence({
    bytes: await readFile(join(root, 'exported.pptx')),
    rulesDigest: themeRulesDigest(rules),
    environmentDigest: report.renderEnvironmentDigest,
    directory: join(root, 'rendered/pptx'),
    evidence: JSON.parse(
      await readFile(join(root, 'rendered/pptx/render-evidence.json'), 'utf8'),
    ),
  })
  const renderedReadback = JSON.parse(
    await readFile(join(root, 'render-readback.json'), 'utf8'),
  ) as { render: unknown; sha256: string; issues: unknown[] }
  assert.deepEqual(renderedReadback.render, rendered)
  assert.equal(renderedReadback.sha256, actual.sha256)
  assert.deepEqual(renderedReadback.issues, [])
  return {
    status: 'verified',
    pages: report.pages,
    artifacts: names.size,
    pptxSha256: actual.sha256,
  }
}
