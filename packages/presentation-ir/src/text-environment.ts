import { z } from 'zod'

const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const separator = z.string().refine(value => [...value].length === 1 && !/[\p{C}\p{Z}]/u.test(value), 'A decimal separator must be one visible Unicode character.')
const word = z.object({ text: z.string(), x: z.number().finite(), end: z.number().finite().optional() }).strict()

/** A bounded declaration for browser layout, not an Office compatibility claim.
 * Profile IDs are pinned to measured report targets by Slidewave's portable
 * text-tabs helper. Cross-package tests enforce the same accepted values. */
export const DecimalTabSchema = z.object({
  separator: z.enum(['.', ',']),
  provenance: z.literal('user-declared'),
  reason: z.string().refine(value => !!value.trim(), 'A declaration reason is required.'),
  targetProfile: z.enum(['libreoffice-7.3.7.2-linux-en-US', 'libreoffice-7.3.7.2-linux-de-DE', 'libreoffice-7.3.7.2-linux-fr-FR']),
}).strict().refine(value => value.separator === (value.targetProfile === 'libreoffice-7.3.7.2-linux-en-US' ? '.' : ','), 'Separator does not match the measured target profile.')
export const DecimalTabDeclarationV1Schema = z.object({ version: z.literal(1), sourcePptxSha256: sha256, decimalTab: DecimalTabSchema }).strict()
export type DecimalTab = z.infer<typeof DecimalTabSchema>

/** A PPTX tab stop has no separator attribute. A renderer's locale is evidence
 * about that renderer, not an extracted declaration from the source file. */
export const DecimalTabSourceConventionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unknown'), reason: z.literal('drawingml-has-no-decimal-separator') }).strict(),
  z.object({ status: z.literal('declared'), separator, provenance: z.literal('user-declared'), reason: z.string().trim().min(1) }).strict(),
])

export const TextRenderingEnvironmentSchema = z.object({
  application: z.object({ name: z.string().min(1), version: z.string().min(1), commandVersion: z.string().min(1) }).strict(),
  platform: z.object({ system: z.string().min(1), release: z.string().min(1), architecture: z.string().min(1) }).strict(),
  locale: z.object({ requested: z.string().min(1), observed: z.string().min(1), ui: z.string().min(1), decimalSeparator: separator, decimalSeparatorAsLocale: z.boolean() }).strict(),
  configurationSha256: sha256,
}).strict()

const DecimalProbeCaseSchema = z.object({
  id: z.string().min(1), page: z.number().int().positive(),
  sourceText: z.string(), sourceRuns: z.array(z.object({ text: z.string(), language: z.string().optional() }).strict()),
  expected: z.array(word), known: z.array(word).optional(), observed: z.array(word),
  importedText: z.string(),
  importedTabs: z.array(z.object({ positionHundredthMm: z.number().int(), alignment: z.enum(['LEFT', 'CENTER', 'RIGHT', 'DECIMAL', 'DEFAULT']), decimalCharacter: separator }).strict()),
  status: z.enum(['matched', 'known-difference', 'unexpected']),
}).strict().refine(value => value.sourceRuns.map(run => run.text).join('') === value.sourceText, 'Probe runs must preserve the source text.')

const DecimalProbeArtifactSchema = z.object({
  stage: z.enum(['actual-native-export', 'diagnostic-indent-removed']),
  pptxSha256: sha256, pdfSha256: sha256,
  pageCount: z.number().int().positive(),
  cases: z.array(DecimalProbeCaseSchema).min(1),
}).strict().superRefine((value, ctx) => {
  if (value.pageCount !== value.cases.length || value.cases.some((entry, index) => entry.page !== index + 1) || new Set(value.cases.map(entry => entry.id)).size !== value.cases.length)
    ctx.addIssue({ code: 'custom', message: 'Probe pages must be complete, unique and in artifact order.' })
})

/** This is a bounded compatibility observation, never a publication approval.
 * Diagnostic output remains separate even when it matches every probe. */
export const DecimalTabEvidenceV1Schema = z.object({
  version: z.literal(1), generatedAt: z.iso.datetime(),
  sourcePptxSha256: sha256, sourceConvention: DecimalTabSourceConventionSchema,
  comparisonBasis: z.literal('target-application-probe'),
  reproducers: z.array(z.object({ path: z.string().min(1), sha256 }).strict()).min(1),
  tolerancePoints: z.number().positive().max(0.25),
  targets: z.array(z.object({ environment: TextRenderingEnvironmentSchema, artifacts: z.array(DecimalProbeArtifactSchema).length(2) }).strict()).min(1),
}).strict().superRefine((value, ctx) => {
  for (const [targetIndex, target] of value.targets.entries()) {
    const actual = target.artifacts.find(artifact => artifact.stage === 'actual-native-export')
    const diagnostic = target.artifacts.find(artifact => artifact.stage === 'diagnostic-indent-removed')
    if (!actual || !diagnostic || actual.pptxSha256 !== value.sourcePptxSha256 || diagnostic.pptxSha256 === value.sourcePptxSha256)
      ctx.addIssue({ code: 'custom', path: ['targets', targetIndex, 'artifacts'], message: 'Actual and diagnostic artifacts must retain distinct source identities.' })
    const baseline = value.targets[0]?.artifacts.find(artifact => artifact.stage === 'actual-native-export')
    const identity = (artifact: NonNullable<typeof actual>) => artifact.cases.map(entry => ({ id: entry.id, page: entry.page, sourceText: entry.sourceText, sourceRuns: entry.sourceRuns }))
    if (actual && diagnostic && (JSON.stringify(identity(actual)) !== JSON.stringify(identity(diagnostic)) || (baseline && JSON.stringify(identity(actual)) !== JSON.stringify(identity(baseline)))))
      ctx.addIssue({ code: 'custom', path: ['targets', targetIndex, 'artifacts'], message: 'Every target and stage must observe the same source probe pages.' })
    if (target.environment.locale.requested !== target.environment.locale.observed)
      ctx.addIssue({ code: 'custom', path: ['targets', targetIndex, 'environment'], message: 'The requested application locale was not confirmed.' })
    for (const [artifactIndex, artifact] of target.artifacts.entries()) for (const [caseIndex, entry] of artifact.cases.entries()) {
      const matches = (expected: typeof entry.expected) => expected.length === entry.observed.length && expected.every((word, index) => {
        const observed = entry.observed[index]!
        return word.text === observed.text && Math.abs(word.x - observed.x) <= value.tolerancePoints && (word.end === undefined || (observed.end !== undefined && Math.abs(word.end - observed.end) <= value.tolerancePoints))
      })
      const status = entry.sourceText !== entry.importedText ? 'unexpected' : matches(entry.expected) ? 'matched' : entry.known && matches(entry.known) ? 'known-difference' : 'unexpected'
      if (entry.status !== status) ctx.addIssue({ code: 'custom', path: ['targets', targetIndex, 'artifacts', artifactIndex, 'cases', caseIndex, 'status'], message: 'Probe status does not match the recorded text and geometry.' })
    }
  }
})
export type DecimalTabEvidenceV1 = z.infer<typeof DecimalTabEvidenceV1Schema>
export type TextRenderingEnvironment = z.infer<typeof TextRenderingEnvironmentSchema>
