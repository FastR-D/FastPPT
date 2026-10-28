import { z } from 'zod'
import { TextRenderingEnvironmentSchema } from './text-environment.js'

const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const artifactPath = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !/[\\:]/.test(path) &&
      ![...path].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) &&
      path
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..'),
    'Render artifacts must use portable paths inside the evidence directory.',
  )
const artifact = z.object({ path: artifactPath, sha256 }).strict()
const environmentFile = z.object({ path: z.string().min(1), sha256 }).strict()

/** File paths identify the recorded renderer environment. They are not artifact
 * download paths, and an archive verifier must never open them implicitly. */
export const PptxRenderFontInventoryV1Schema = z
  .object({
    version: z.literal(1),
    fontconfigVersion: z.string().min(1),
    variables: z
      .object({
        FONTCONFIG_FILE: z.string().nullable(),
        FONTCONFIG_PATH: z.string().nullable(),
        FC_LANG: z.string().nullable(),
      })
      .strict(),
    files: z.array(environmentFile).min(1),
    configurations: z.array(environmentFile).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of ['files', 'configurations'] as const)
      if (
        new Set(value[key].map((file) => file.path)).size !== value[key].length
      )
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Environment file paths must be unique.',
        })
  })

/** The first independent adapter proves that the exact PPTX was rendered. It
 * does not yet measure the author's content-block line or rectangle semantics.
 * Numeric metrics are deliberately disallowed until a provider implements them. */
export const PptxRenderEvidenceV1Schema = z
  .object({
    version: z.literal(1),
    source: z.literal('libreoffice-pdf'),
    createdAt: z.iso.datetime(),
    pptxSha256: sha256,
    rulesDigest: sha256,
    environment: TextRenderingEnvironmentSchema,
    environmentDigest: sha256,
    fontInventory: artifact,
    configuration: artifact,
    observations: artifact,
    rendererScript: artifact,
    rendererDependencies: z.array(artifact).min(1),
    rasterizer: z
      .object({
        name: z.literal('pdftoppm'),
        version: z.string().min(1),
        arguments: z.array(z.string()),
      })
      .strict(),
    pdf: artifact,
    pageMapping: z.literal('presentation-order'),
    pages: z
      .array(
        z
          .object({
            index: z.number().int().positive(),
            part: artifactPath,
            slideId: z.string().min(1).optional(),
            image: artifact
              .extend({
                width: z.number().int().positive(),
                height: z.number().int().positive(),
              })
              .strict(),
            metrics: z
              .object({
                textLines: z
                  .object({
                    definition: z.literal(
                      'fastppt.content-block-text-lines.v1',
                    ),
                    status: z.literal('unverified'),
                    reason: z.string().min(1),
                  })
                  .strict(),
                density: z
                  .object({
                    definition: z.literal('fastppt.content-rectangle-union.v1'),
                    status: z.literal('unverified'),
                    reason: z.string().min(1),
                  })
                  .strict(),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.configuration.sha256 !== value.environment.configurationSha256)
      ctx.addIssue({
        code: 'custom',
        path: ['configuration'],
        message:
          'Renderer configuration digest differs from the observed environment.',
      })
    if (
      value.environment.locale.requested !== value.environment.locale.observed
    )
      ctx.addIssue({
        code: 'custom',
        path: ['environment'],
        message: 'Renderer locale was not confirmed.',
      })
    if (value.pages.some((page, index) => page.index !== index + 1))
      ctx.addIssue({
        code: 'custom',
        path: ['pages'],
        message: 'Rendered pages must be complete and ordered.',
      })
    const ids = value.pages.flatMap((page) =>
      page.slideId ? [page.slideId] : [],
    )
    if (
      new Set(ids).size !== ids.length ||
      new Set(value.pages.map((page) => page.part)).size !== value.pages.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['pages'],
        message: 'Rendered page identities must be unique.',
      })
    const artifacts = [
      value.fontInventory,
      value.configuration,
      value.observations,
      value.rendererScript,
      ...value.rendererDependencies,
      value.pdf,
      ...value.pages.map((page) => page.image),
    ]
    if (new Set(artifacts.map((file) => file.path)).size !== artifacts.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Render artifact paths must be unique.',
      })
  })

export type PptxRenderEvidenceV1 = z.infer<typeof PptxRenderEvidenceV1Schema>
export type PptxRenderFontInventoryV1 = z.infer<
  typeof PptxRenderFontInventoryV1Schema
>
