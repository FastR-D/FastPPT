import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  PptxRenderEvidenceV1Schema,
  type PptxRenderEvidenceV1,
} from '@fastppt/presentation-ir'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import {
  pptxRenderEnvironmentDigest,
  verifyPptxRenderEvidence,
  type VerifyPptxRenderEvidenceInput,
} from '../src/render-evidence.js'
import { readPptxRuleEvidence } from '../src/rule-evidence.js'

const hash = (value: Uint8Array | string) =>
  createHash('sha256').update(value).digest('hex')
let directory: string
let input: VerifyPptxRenderEvidenceInput
let evidence: PptxRenderEvidenceV1

// Small synthetic receipts isolate integrity failures. The golden runner covers
// real LibreOffice/PDF/PNG production; these fixtures make no rendering claim.
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'fastppt-render-evidence-'))
  const snapshot = HtmlDeckSnapshotSchema.parse({
    version: 1,
    source: 'html',
    warnings: [],
    slides: [1, 2].map((index) => ({
      version: 1,
      id: `stable-${index}`,
      width: 100,
      height: 100,
      elements: [],
      warnings: [],
    })),
  })
  const output = join(directory, 'deck.pptx')
  await writeEditablePptx(snapshot, output, { embedFonts: false })
  const bytes = await readFile(output)
  const actual = await readPptxRuleEvidence(bytes)
  const file = async (path: string, value: string | Uint8Array) => {
    await writeFile(join(directory, path), value)
    return { path, sha256: hash(value) }
  }
  const configuration = await file('configuration.xcu', '<configuration/>')
  const environment = {
    application: {
      name: 'LibreOffice',
      version: 'test',
      commandVersion: 'test',
    },
    platform: { system: 'Linux', release: 'test', architecture: 'x86_64' },
    locale: {
      requested: 'en-US',
      observed: 'en-US',
      ui: 'en-US',
      decimalSeparator: '.',
      decimalSeparatorAsLocale: true,
    },
    configurationSha256: configuration.sha256,
  }
  const fontInventory = await file(
    'fonts.json',
    JSON.stringify({
      version: 1,
      fontconfigVersion: 'test',
      variables: {
        FONTCONFIG_FILE: null,
        FONTCONFIG_PATH: null,
        FC_LANG: null,
      },
      files: [{ path: '/recorded-only/font.ttf', sha256: hash('font') }],
      configurations: [
        { path: '/recorded-only/fonts.conf', sha256: hash('font config') },
      ],
    }),
  )
  const rendererScript = await file(
    'renderer.py',
    '# synthetic producer fixture',
  )
  const rendererDependencies = [
    await file('text-probe.py', '# synthetic dependency fixture'),
  ]
  const pdf = await file('output.pdf', '%PDF-1.7\nsynthetic integrity fixture')
  const observations = await file(
    'observations.json',
    JSON.stringify({
      environment,
      fontInventorySha256: fontInventory.sha256,
      rendererScriptSha256: rendererScript.sha256,
      rendererDependenciesSha256: rendererDependencies.map(
        (file) => file.sha256,
      ),
      artifacts: [
        {
          stage: 'actual-native-export',
          pptxSha256: actual.sha256,
          pdfSha256: pdf.sha256,
          pages: [{}, {}],
        },
      ],
    }),
  )
  const target = {
    environment,
    fontInventory,
    rendererScript,
    rendererDependencies,
    rasterizer: {
      name: 'pdftoppm' as const,
      version: 'test',
      arguments: ['-png'],
    },
  }
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=',
    'base64',
  )
  evidence = PptxRenderEvidenceV1Schema.parse({
    version: 1,
    source: 'libreoffice-pdf',
    createdAt: new Date().toISOString(),
    pptxSha256: actual.sha256,
    rulesDigest: hash('rules'),
    ...target,
    environmentDigest: pptxRenderEnvironmentDigest(target),
    configuration,
    observations,
    pdf,
    pageMapping: 'presentation-order',
    pages: await Promise.all(
      actual.slides.map(async (slide) => ({
        index: slide.index,
        part: slide.part,
        slideId: slide.slideId,
        image: {
          ...(await file(`page-${slide.index}.png`, png)),
          width: 1,
          height: 1,
        },
        metrics: {
          textLines: {
            definition: 'fastppt.content-block-text-lines.v1',
            status: 'unverified',
            reason: 'No line provider.',
          },
          density: {
            definition: 'fastppt.content-rectangle-union.v1',
            status: 'unverified',
            reason: 'No density provider.',
          },
        },
      })),
    ),
  })
  input = {
    bytes,
    rulesDigest: evidence.rulesDigest,
    environmentDigest: evidence.environmentDigest,
    directory,
    evidence,
  }
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

it('verifies retained artifacts and preserves unavailable measurements', async () => {
  expect(await verifyPptxRenderEvidence(input)).toEqual(evidence)
  expect(evidence.pages[0]?.metrics.textLines.status).toBe('unverified')
})

it.each(['pptx', 'rules', 'environment'] as const)(
  'rejects stale %s context',
  async (kind) => {
    if (kind === 'pptx')
      input.bytes = Buffer.concat([input.bytes, Buffer.from('changed')])
    if (kind === 'rules') input.rulesDigest = hash('new rules')
    if (kind === 'environment')
      input.environmentDigest = hash('new environment')
    await expect(verifyPptxRenderEvidence(input)).rejects.toThrow(
      /stale|target/,
    )
  },
)

it.each(['font', 'locale', 'renderer', 'dependency', 'rasterizer'] as const)(
  'rejects a changed %s even when the receipt recomputes its own digest',
  async (kind) => {
    if (kind === 'font') evidence.fontInventory.sha256 = hash('new fonts')
    if (kind === 'locale')
      evidence.environment.locale = {
        ...evidence.environment.locale,
        requested: 'de-DE',
        observed: 'de-DE',
        decimalSeparator: ',',
      }
    if (kind === 'renderer')
      evidence.rendererScript.sha256 = hash('new producer')
    if (kind === 'dependency')
      evidence.rendererDependencies[0]!.sha256 = hash('new dependency')
    if (kind === 'rasterizer') evidence.rasterizer.version = 'new version'
    evidence.environmentDigest = pptxRenderEnvironmentDigest(evidence)
    await expect(verifyPptxRenderEvidence(input)).rejects.toThrow(
      'selected target',
    )
  },
)

it('rejects reordered, missing and invented stable page identities', async () => {
  const original = structuredClone(evidence.pages)
  evidence.pages.reverse().forEach((page, index) => {
    page.index = index + 1
  })
  await expect(verifyPptxRenderEvidence(input)).rejects.toThrow('page identity')
  evidence.pages = structuredClone(original).slice(0, 1)
  await expect(verifyPptxRenderEvidence(input)).rejects.toThrow(
    'missing or extra pages',
  )
  evidence.pages = structuredClone(original)
  evidence.pages[0]!.slideId = 'invented'
  await expect(verifyPptxRenderEvidence(input)).rejects.toThrow('page identity')
})

it('rejects changed and missing render files', async () => {
  const image = join(directory, 'page-1.png')
  await writeFile(image, 'changed')
  await expect(verifyPptxRenderEvidence(input)).rejects.toThrow(
    'artifact changed',
  )
  await rm(image)
  await expect(verifyPptxRenderEvidence(input)).rejects.toMatchObject({
    code: 'ENOENT',
  })
})

it('checks PNG dimensions and raw renderer observations rather than receipt labels', async () => {
  evidence.pages[0]!.image.width = 2
  await expect(verifyPptxRenderEvidence(input)).rejects.toThrow(
    'image dimensions',
  )
  evidence.pages[0]!.image.width = 1
  const path = join(directory, evidence.observations.path)
  const observations = JSON.parse(await readFile(path, 'utf8')) as {
    artifacts: [{ pptxSha256: string }]
  }
  observations.artifacts[0].pptxSha256 = hash('different pptx')
  const content = JSON.stringify(observations)
  await writeFile(path, content)
  evidence.observations.sha256 = hash(content)
  await expect(verifyPptxRenderEvidence(input)).rejects.toThrow(
    'observations are incomplete or stale',
  )
})

it('rejects duplicate pages, path traversal, and invented numeric metrics', () => {
  const duplicate = structuredClone(evidence)
  duplicate.pages[1]!.image.path = duplicate.pages[0]!.image.path
  expect(PptxRenderEvidenceV1Schema.safeParse(duplicate).success).toBe(false)
  const escape = structuredClone(evidence)
  escape.pdf.path = '../outside.pdf'
  expect(PptxRenderEvidenceV1Schema.safeParse(escape).success).toBe(false)
  const falseMetric = structuredClone(evidence) as unknown as {
    pages: Array<{ metrics: { textLines: unknown } }>
  }
  falseMetric.pages[0]!.metrics.textLines = {
    definition: 'fastppt.content-block-text-lines.v1',
    status: 'verified',
    value: 1,
  }
  expect(PptxRenderEvidenceV1Schema.safeParse(falseMetric).success).toBe(false)
})

it('does not follow render artifact symlinks outside the retained directory', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'fastppt-render-outside-'))
  try {
    const path = join(outside, 'image.png')
    await writeFile(path, await readFile(join(directory, 'page-1.png')))
    await rm(join(directory, 'page-1.png'))
    await symlink(path, join(directory, 'page-1.png'))
    await expect(verifyPptxRenderEvidence(input)).rejects.toThrow('escaped')
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
})
