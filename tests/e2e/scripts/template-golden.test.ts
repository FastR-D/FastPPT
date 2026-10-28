import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { evaluateExportReadback } from '@fastppt/gateway/theme-rule-readback'
import {
  verifyPptxRenderEvidence,
  pptxRenderEnvironmentDigest,
} from '@fastppt/pptx-import'
import { PptxRenderEvidenceV1Schema } from '@fastppt/presentation-ir'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import {
  evaluateThemeRules,
  ThemeRulesDocumentSchema,
  themeRulesDigest,
} from '@fastppt/theme-registry'
import { verifyTemplateGolden } from './lib/template-golden-evidence.js'

await test('retained golden evidence rejects changed, missing and stale artifacts', async () => {
  const source = process.env.FASTPPT_GOLDEN_RUN
  assert.ok(
    source,
    'Set FASTPPT_GOLDEN_RUN to a completed template-golden.ts run',
  )
  await verifyTemplateGolden(source)
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-golden-integrity-'))
  try {
    await cp(source, directory, {
      recursive: true,
      filter: (path) => !path.split('/').includes('node_modules'),
    })
    const image = join(directory, 'rendered/pptx/slide-1.png')
    const original = await readFile(image)
    await writeFile(image, Buffer.concat([original, Buffer.from('changed')]))
    await assert.rejects(verifyTemplateGolden(directory), /Artifact changed/)
    await writeFile(image, original)
    const path = join(directory, 'report.json')
    const report = JSON.parse(await readFile(path, 'utf8')) as {
      pptxSha256: string
      artifacts: Array<{ path: string }>
    }
    const originalReport = JSON.stringify(report)
    const originalHash = report.pptxSha256
    report.pptxSha256 = '0'.repeat(64)
    await writeFile(path, JSON.stringify(report))
    await assert.rejects(verifyTemplateGolden(directory), /AssertionError/)
    await writeFile(path, originalReport)
    await rm(image)
    await assert.rejects(verifyTemplateGolden(directory), /ENOENT/)
    await writeFile(image, original)
    report.pptxSha256 = originalHash
    report.artifacts = report.artifacts.filter(
      (artifact) => artifact.path !== 'rendered/pptx/slide-1.png',
    )
    await writeFile(path, JSON.stringify(report))
    await assert.rejects(verifyTemplateGolden(directory), /Evidence is missing/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

await test('actual rendering retains metric uncertainty and rejects stale target bindings', async () => {
  const source = process.env.FASTPPT_GOLDEN_RUN
  assert.ok(
    source,
    'Set FASTPPT_GOLDEN_RUN to a completed template-golden.ts run',
  )
  const directory = join(source, 'rendered/pptx')
  const evidence = PptxRenderEvidenceV1Schema.parse(
    JSON.parse(await readFile(join(directory, 'render-evidence.json'), 'utf8')),
  )
  const bytes = await readFile(join(source, 'exported.pptx'))
  const input = {
    directory,
    bytes,
    rulesDigest: evidence.rulesDigest,
    environmentDigest: evidence.environmentDigest,
    evidence,
  }
  await verifyPptxRenderEvidence(input)
  const reordered = structuredClone(evidence)
  reordered.pages.reverse().forEach((page, index) => {
    page.index = index + 1
  })
  await assert.rejects(
    verifyPptxRenderEvidence({ ...input, evidence: reordered }),
    /page identity/,
  )
  const staleTarget = structuredClone(evidence)
  staleTarget.fontInventory.sha256 = 'a'.repeat(64)
  staleTarget.environmentDigest = pptxRenderEnvironmentDigest(staleTarget)
  await assert.rejects(
    verifyPptxRenderEvidence({ ...input, evidence: staleTarget }),
    /selected target/,
  )
  await assert.rejects(
    verifyPptxRenderEvidence({ ...input, rulesDigest: 'b'.repeat(64) }),
    /stale rule digest/,
  )

  const document = ThemeRulesDocumentSchema.parse({
    version: 1,
    rules: [
      {
        id: 'golden.lines',
        kind: 'max-text-lines',
        value: 12,
        severity: 'error',
      },
      {
        id: 'golden.density',
        kind: 'max-density',
        value: 0.7,
        severity: 'error',
      },
    ],
  })
  const measurements = JSON.parse(
    await readFile(join(source, 'browser-measurements.json'), 'utf8'),
  ) as Array<{
    slide: number
    evidence: { textLines: number; density: number }
  }>
  assert.deepEqual(
    evaluateThemeRules({
      document,
      phase: 'export',
      slides: measurements.map((measurement) => ({
        index: measurement.slide,
        layout: 'default',
        ...measurement.evidence,
      })),
    }),
    [],
    'The actual browser measurement passes these limits',
  )
  // A trusted producer may issue a fresh binding for another rule document,
  // but the same actual render still supplies no line/density measurement.
  const report = await evaluateExportReadback(
    bytes,
    document,
    HtmlDeckSnapshotSchema.parse(
      JSON.parse(await readFile(join(source, 'snapshot.json'), 'utf8')),
    ),
    {
      directory,
      environmentDigest: evidence.environmentDigest,
      evidence: { ...evidence, rulesDigest: themeRulesDigest(document) },
    },
  )
  assert.equal(report.status, 'failed')
  assert.ok(report.render)
  assert.equal(report.issues.length, evidence.pages.length * 2)
  assert.ok(
    report.issues.every(
      (issue) => issue.status === 'unverified' && issue.severity === 'error',
    ),
  )
})
