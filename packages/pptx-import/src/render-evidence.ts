import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  PptxRenderEvidenceV1Schema,
  PptxRenderFontInventoryV1Schema,
  TextRenderingEnvironmentSchema,
  type PptxRenderEvidenceV1,
} from '@fastppt/presentation-ir'
import { readPptxRuleEvidence } from './rule-evidence.js'

const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex')
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  )

/** Pin the selected target, fonts, configuration, producer and rasterizer. */
export function pptxRenderEnvironmentDigest(
  evidence: Pick<
    PptxRenderEvidenceV1,
    | 'environment'
    | 'fontInventory'
    | 'rendererScript'
    | 'rendererDependencies'
    | 'rasterizer'
  >,
): string {
  return sha256(
    canonical({
      environment: evidence.environment,
      fontInventorySha256: evidence.fontInventory.sha256,
      rendererScriptSha256: evidence.rendererScript.sha256,
      rendererDependenciesSha256: evidence.rendererDependencies.map(
        (file) => file.sha256,
      ),
      rasterizer: evidence.rasterizer,
    }),
  )
}

export interface VerifyPptxRenderEvidenceInput {
  bytes: Uint8Array
  rulesDigest: string
  /** The caller's selected target, not a value taken from an uploaded report. */
  environmentDigest: string
  directory: string
  evidence: unknown
}

/** Re-read retained artifacts and the PPTX relationship graph. This is integrity
 * verification of an internal renderer's receipt, not a signature or proof that
 * arbitrary user-supplied images were produced by an Office application. */
export async function verifyPptxRenderEvidence(
  input: VerifyPptxRenderEvidenceInput,
): Promise<PptxRenderEvidenceV1> {
  const evidence = PptxRenderEvidenceV1Schema.parse(input.evidence)
  if (evidence.pptxSha256 !== sha256(input.bytes))
    throw new Error('PPTX render evidence has a stale input hash')
  if (evidence.rulesDigest !== input.rulesDigest)
    throw new Error('PPTX render evidence has a stale rule digest')
  if (
    evidence.environmentDigest !== input.environmentDigest ||
    evidence.environmentDigest !== pptxRenderEnvironmentDigest(evidence)
  )
    throw new Error('PPTX render environment differs from the selected target')
  const actual = await readPptxRuleEvidence(input.bytes)
  if (actual.slides.length !== evidence.pages.length)
    throw new Error('PPTX render evidence has missing or extra pages')
  for (const [index, slide] of actual.slides.entries()) {
    const page = evidence.pages[index]!
    if (
      page.index !== slide.index ||
      page.part !== slide.part ||
      page.slideId !== slide.slideId
    )
      throw new Error(`PPTX render page identity differs at page ${index + 1}`)
  }
  const root = await realpath(input.directory)
  const read = async (artifact: { path: string; sha256: string }) => {
    const path = await realpath(resolve(root, artifact.path))
    const offset = relative(root, path)
    if (!offset || offset.startsWith('..') || isAbsolute(offset))
      throw new Error('PPTX render artifact escaped its evidence directory')
    const bytes = await readFile(path)
    if (sha256(bytes) !== artifact.sha256)
      throw new Error(`PPTX render artifact changed: ${artifact.path}`)
    return bytes
  }
  await read(evidence.configuration)
  await read(evidence.rendererScript)
  for (const file of evidence.rendererDependencies) await read(file)
  PptxRenderFontInventoryV1Schema.parse(
    JSON.parse((await read(evidence.fontInventory)).toString('utf8')),
  )
  const pdf = await read(evidence.pdf)
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-')))
    throw new Error('PPTX renderer did not produce a PDF')
  const observations = JSON.parse(
    (await read(evidence.observations)).toString('utf8'),
  ) as {
    environment: unknown
    fontInventorySha256?: string
    rendererScriptSha256?: string
    rendererDependenciesSha256?: string[]
    artifacts?: Array<{
      stage?: string
      pptxSha256?: string
      pdfSha256?: string
      pages?: unknown[]
    }>
  }
  if (
    canonical(
      TextRenderingEnvironmentSchema.parse(observations.environment),
    ) !== canonical(evidence.environment) ||
    observations.fontInventorySha256 !== evidence.fontInventory.sha256 ||
    observations.rendererScriptSha256 !== evidence.rendererScript.sha256 ||
    canonical(observations.rendererDependenciesSha256) !==
      canonical(evidence.rendererDependencies.map((file) => file.sha256))
  )
    throw new Error(
      'PPTX renderer observation environment differs from its receipt',
    )
  const observed = observations.artifacts?.[0]
  if (
    observations.artifacts?.length !== 1 ||
    observed?.stage !== 'actual-native-export' ||
    observed.pptxSha256 !== evidence.pptxSha256 ||
    observed.pdfSha256 !== evidence.pdf.sha256 ||
    !Array.isArray(observed.pages) ||
    observed.pages.length !== evidence.pages.length
  )
    throw new Error('PPTX renderer observations are incomplete or stale')
  for (const page of evidence.pages) {
    const png = await read(page.image)
    if (
      png.length < 33 ||
      !png
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      png.toString('ascii', 12, 16) !== 'IHDR' ||
      png.readUInt32BE(16) !== page.image.width ||
      png.readUInt32BE(20) !== page.image.height
    )
      throw new Error(
        `PPTX render image dimensions differ at page ${page.index}`,
      )
  }
  return evidence
}
