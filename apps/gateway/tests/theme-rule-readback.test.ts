import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  writeEditablePptx,
  type NativeMasterLayout,
} from '@fastppt/slidewave/server'
import {
  ThemeRulesDocumentSchema,
  themeRulesDigest,
} from '@fastppt/theme-registry'
import type {
  SlidewaveSnapshot,
  ThemeRuleExceptionBinding,
  ThemeRuleException,
} from '@fastppt/protocol'
import {
  ExportJobManager,
  type EditablePptxExporter,
  type ExportDeckInput,
} from '../src/export-jobs.js'
import { evaluateExportReadback } from '../src/theme-rule-readback.js'
import {
  ThemeRuleExceptionStore,
  ruleExceptionState,
  ruleOptionsDigest,
} from '../src/theme-rule-exceptions.js'

const snapshot: SlidewaveSnapshot = {
  version: 1,
  source: 'html',
  warnings: [],
  slides: [
    {
      version: 1,
      id: 'stable-one',
      width: 100,
      height: 100,
      elements: [],
      warnings: [],
    },
  ],
}
const definitions: NativeMasterLayout[] = [
  {
    name: 'cover',
    masterId: 'brand',
    placeholders: [
      { index: 0, type: 'title', x: 1, y: 1, width: 100, height: 100 },
    ],
    masterObjects: {
      objects: [{ name: 'Logo', x: 0, y: 0, width: 10, height: 10 }],
    },
  },
]
const document = ThemeRulesDocumentSchema.parse({
  version: 1,
  rules: [
    {
      id: 'layout.first',
      kind: 'first-layout',
      layout: 'cover',
      severity: 'error',
    },
    {
      id: 'master.brand',
      kind: 'required-master',
      master: 'brand',
      severity: 'error',
    },
    {
      id: 'slot.title',
      kind: 'required-placeholder',
      layout: 'cover',
      type: 'title',
      index: 0,
      severity: 'error',
    },
    {
      id: 'logo.brand',
      kind: 'fixed-object',
      owner: 'master',
      name: 'Logo',
      severity: 'error',
    },
  ],
})
const directories: string[] = []
const managers: ExportJobManager[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'fastppt-rule-readback-'))
  directories.push(path)
  return path
}
class RealExporter implements EditablePptxExporter {
  constructor(readonly actual = definitions) {}
  getStatus() {
    return Promise.resolve({
      status: 'available' as const,
      version: 'actual writer fixture',
    })
  }
  async export(input: ExportDeckInput) {
    const result = await writeEditablePptx(input.snapshot, input.outputPath, {
      embedFonts: false,
      masterLayoutDefinitions: this.actual,
      slideLayouts: ['cover'],
    })
    return { ...result, outputPath: input.outputPath }
  }
}
async function run(rules = document, actual = definitions, review = false) {
  const outputRoot = await directory()
  const manager = new ExportJobManager({
    outputRoot,
    exporter: new RealExporter(actual),
  })
  managers.push(manager)
  const job = manager.enqueue({
    deckId: 'deck',
    outputName: 'result.pptx',
    review,
    ruleDocument: rules,
    themeRules: {
      revision: 'revision-one',
      digest: themeRulesDigest(rules),
      stage: 'pre-export',
      issues: [],
    },
  })
  manager.submitSnapshot(job.id, snapshot)
  await vi.waitFor(() =>
    expect(['completed', 'review-required', 'failed']).toContain(
      manager.get(job.id)?.status,
    ),
  )
  return { manager, id: job.id, outputRoot }
}

it('reuses the rule evaluator on actual PPTX structures and persists the artifact hash across restart', async () => {
  const { manager, id, outputRoot } = await run()
  expect(manager.get(id)).toMatchObject({
    status: 'completed',
    themeRules: {
      stage: 'post-export',
      readback: {
        source: 'pptx-xml',
        status: 'passed',
        issues: [],
        slides: [{ slideId: 'stable-one', layout: 'cover', master: 'brand' }],
      },
    },
  })
  const artifact = await manager.download(id)
  const report = await evaluateExportReadback(
    await readFile(artifact.path),
    document,
    snapshot,
  )
  expect(report.sha256).toBe(manager.get(id)?.themeRules?.readback?.sha256)
  await manager.dispose()
  const restored = new ExportJobManager({
    outputRoot,
    exporter: new RealExporter(),
  })
  managers.push(restored)
  await vi.waitFor(() => expect(restored.get(id)?.status).toBe('completed'))
  expect(restored.get(id)?.themeRules?.readback).toEqual(
    manager.get(id)?.themeRules?.readback,
  )
  await writeFile(artifact.path, 'changed after validation')
  await expect(restored.download(id)).rejects.toThrow('stale')
  expect(restored.get(id)?.error?.code).toBe('EXPORT_RULE_ARTIFACT_STALE')
})

it('blocks a missing exported fixed object even when pre-export rules passed', async () => {
  const { manager, id, outputRoot } = await run(document, [
    { ...definitions[0]!, masterObjects: { objects: [] } },
  ])
  expect(manager.get(id)).toMatchObject({
    status: 'failed',
    themeRules: {
      issues: [],
      readback: {
        status: 'failed',
        issues: [
          {
            ruleId: 'logo.brand',
            code: 'THEME_RULE_FIXED_OBJECT_MISSING',
            status: 'violation',
          },
        ],
      },
    },
  })
  await expect(manager.download(id)).rejects.toThrow('not available')
  await expect(
    readFile(join(outputRoot, id, 'result.pptx')),
  ).rejects.toMatchObject({ code: 'ENOENT' })
})

it('does not substitute browser measurements for unavailable PPTX render evidence', async () => {
  const rules = ThemeRulesDocumentSchema.parse({
    version: 1,
    rules: [
      ...document.rules,
      {
        id: 'body.lines',
        kind: 'max-text-lines',
        value: 12,
        severity: 'error',
      },
    ],
  })
  const { manager, id } = await run(rules)
  expect(manager.get(id)).toMatchObject({
    status: 'failed',
    themeRules: {
      readback: {
        issues: [
          { ruleId: 'body.lines', status: 'unverified', severity: 'error' },
        ],
      },
    },
  })
})

it('keeps warning-level unavailable evidence visible without blocking publication', async () => {
  const rules = ThemeRulesDocumentSchema.parse({
    version: 1,
    rules: [
      ...document.rules,
      {
        id: 'body.density',
        kind: 'max-density',
        value: 0.5,
        severity: 'warning',
      },
    ],
  })
  const { manager, id } = await run(rules)
  expect(manager.get(id)).toMatchObject({
    status: 'completed',
    themeRules: {
      readback: {
        status: 'issues',
        issues: [
          { ruleId: 'body.density', status: 'unverified', severity: 'warning' },
        ],
      },
    },
  })
})

it('requires readback for the current artifact before approving a held export', async () => {
  const { manager, id, outputRoot } = await run(document, definitions, true)
  expect(manager.get(id)?.status).toBe('review-required')
  await writeFile(
    join(outputRoot, id, '.result.pptx.partial.pptx'),
    'changed during review',
  )
  await expect(manager.review(id, true)).rejects.toThrow('stale')
  expect(manager.get(id)?.status).toBe('failed')
})

it('rejects a mismatched rule document before queuing or capturing', async () => {
  const manager = new ExportJobManager({
    outputRoot: await directory(),
    exporter: new RealExporter(),
  })
  managers.push(manager)
  expect(() =>
    manager.enqueue({
      deckId: 'deck',
      outputName: 'test.pptx',
      ruleDocument: document,
      themeRules: {
        revision: 'one',
        digest: 'different',
        stage: 'pre-export',
        issues: [],
      },
    }),
  ).toThrow('digest')
})

it('refuses publication when a restored rule document no longer matches its report', async () => {
  const { manager, id, outputRoot } = await run()
  await manager.dispose()
  const path = join(outputRoot, id, 'job.json')
  const persisted = JSON.parse(await readFile(path, 'utf8'))
  persisted.ruleDocument.rules = []
  await writeFile(path, JSON.stringify(persisted))
  const restored = new ExportJobManager({
    outputRoot,
    exporter: new RealExporter(),
  })
  managers.push(restored)
  await vi.waitFor(() => expect(restored.get(id)?.status).toBe('completed'))
  await expect(restored.download(id)).rejects.toThrow('stale')
})

it('preserves unverified render findings after an explicit exception and rechecks revocation after restart', async () => {
  const rules = ThemeRulesDocumentSchema.parse({
    version: 1,
    rules: [
      ...document.rules,
      {
        id: 'body.lines',
        kind: 'max-text-lines',
        value: 12,
        severity: 'error',
      },
    ],
  })
  const failed = await run(rules)
  const issue = failed.manager.get(failed.id)!.themeRules!.readback!.issues[0]!
  const outputRoot = await directory()
  const binding: ThemeRuleExceptionBinding = {
    deckId: 'deck',
    revision: 'revision-one',
    themeId: 'theme',
    themeDigest: 'theme-digest',
    ruleDigest: themeRulesDigest(rules),
    masterDigest: 'master-digest',
    profileDigest: null,
    optionsDigest: ruleOptionsDigest(),
    authoredDigest: 'a'.repeat(64),
  }
  const store = new ThemeRuleExceptionStore((deckId) =>
    join(outputRoot, `${deckId}-exceptions.json`),
  )
  const exception = await store.approve('deck', () =>
    Promise.resolve({
      binding,
      phase: 'readback',
      issue,
      reason: 'User reviewed the exported text separately.',
    }),
  )
  const verify = async () => {
    const live = (await store.list('deck')).find(
      (entry) => entry.id === exception.id,
    )
    if (!live || ruleExceptionState(live, binding) !== 'active')
      throw new Error('Rule exception revoked')
  }
  const manager = new ExportJobManager({
    outputRoot,
    exporter: new RealExporter(),
    verifyRuleContext: verify,
  })
  managers.push(manager)
  const enqueue = (exceptions: ThemeRuleException[], review = false) =>
    manager.enqueue({
      deckId: 'deck',
      outputName: 'excepted.pptx',
      review,
      ruleDocument: rules,
      themeRules: {
        revision: binding.revision,
        digest: binding.ruleDigest,
        binding,
        exceptions,
        stage: 'pre-export',
        issues: [],
      },
    })
  const job = enqueue([exception])
  manager.submitSnapshot(job.id, snapshot)
  await vi.waitFor(() => expect(manager.get(job.id)?.status).toBe('completed'))
  expect(manager.get(job.id)?.themeRules?.readback).toMatchObject({
    status: 'issues',
    issues: [
      {
        status: 'unverified',
        severity: 'error',
        exception: { id: exception.id },
      },
    ],
  })
  await manager.download(job.id)
  const held = enqueue([exception], true)
  manager.submitSnapshot(held.id, snapshot)
  await vi.waitFor(() =>
    expect(manager.get(held.id)?.status).toBe('review-required'),
  )
  await manager.dispose()
  const restored = new ExportJobManager({
    outputRoot,
    exporter: new RealExporter(),
    verifyRuleContext: verify,
  })
  managers.push(restored)
  await restored.ready()
  await restored.download(job.id)
  await store.revoke('deck', exception.id)
  await expect(restored.review(held.id, true)).rejects.toThrow('revoked')
  await expect(restored.download(job.id)).rejects.toThrow('revoked')
  expect(restored.get(job.id)?.error?.code).toBe('EXPORT_RULE_CONTEXT_STALE')
  restored.retry(job.id)
  await vi.waitFor(() => expect(restored.get(job.id)?.status).toBe('failed'))
  expect(restored.get(job.id)?.themeRules?.readback).toBeUndefined()
  expect(restored.get(job.id)?.error?.message).toContain('revoked')
})

it('does not let an exception bypass an unreadable PPTX artifact', async () => {
  const outputRoot = await directory()
  class DamagedExporter extends RealExporter {
    override async export(input: ExportDeckInput) {
      const result = await super.export(input)
      await writeFile(input.outputPath, 'broken ZIP')
      return result
    }
  }
  const binding: ThemeRuleExceptionBinding = {
    deckId: 'deck',
    revision: 'revision-one',
    themeId: 'theme',
    themeDigest: 'theme',
    ruleDigest: themeRulesDigest(document),
    masterDigest: null,
    profileDigest: null,
    optionsDigest: ruleOptionsDigest(),
    authoredDigest: 'a'.repeat(64),
  }
  const store = new ThemeRuleExceptionStore(() =>
    join(outputRoot, 'exceptions.json'),
  )
  const exception = await store.approve('deck', () =>
    Promise.resolve({
      binding,
      phase: 'readback',
      issue: {
        ruleId: 'logo.brand',
        code: 'THEME_RULE_FIXED_OBJECT_MISSING',
        status: 'violation',
        severity: 'error',
        message: 'Logo missing',
      },
      reason: 'Specific rule only.',
    }),
  )
  const manager = new ExportJobManager({
    outputRoot,
    exporter: new DamagedExporter(),
    verifyRuleContext: () => Promise.resolve(),
  })
  managers.push(manager)
  const job = manager.enqueue({
    deckId: 'deck',
    outputName: 'damaged.pptx',
    ruleDocument: document,
    themeRules: {
      revision: binding.revision,
      digest: binding.ruleDigest,
      binding,
      exceptions: [exception],
      stage: 'pre-export',
      issues: [],
    },
  })
  manager.submitSnapshot(job.id, snapshot)
  await vi.waitFor(() => expect(manager.get(job.id)?.status).toBe('failed'))
  expect(manager.get(job.id)?.themeRules?.readback?.error).toBeTruthy()
  await expect(manager.download(job.id)).rejects.toThrow('not available')
  const missing = new ExportJobManager({
    outputRoot: await directory(),
    exporter: new RealExporter(),
    verifyRuleContext: () => Promise.resolve(),
  })
  managers.push(missing)
  const missingJob = missing.enqueue({
    deckId: 'deck',
    outputName: 'missing.pptx',
    ruleDocument: document,
    themeRules: {
      revision: binding.revision,
      digest: binding.ruleDigest,
      binding,
      exceptions: [exception],
      stage: 'pre-export',
      issues: [],
    },
  })
  const lost = structuredClone(snapshot)
  lost.slides[0]!.elements = [
    {
      id: 'missing',
      kind: 'image',
      box: { x: 0, y: 0, width: 10, height: 10 },
      order: 0,
      zIndex: 0,
      opacity: 1,
      source: { tag: 'img', path: 'root/missing' },
    },
  ]
  missing.submitSnapshot(missingJob.id, lost)
  await vi.waitFor(() =>
    expect(missing.get(missingJob.id)?.status).toBe('failed'),
  )
  expect(missing.get(missingJob.id)?.themeRules?.readback).toBeUndefined()
  await expect(missing.download(missingJob.id)).rejects.toThrow('not available')
})
