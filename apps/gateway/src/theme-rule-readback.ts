import {
  readPptxRuleEvidence,
  verifyPptxRenderEvidence,
  type VerifyPptxRenderEvidenceInput,
} from '@fastppt/pptx-import'
import {
  evaluateThemeRules,
  themeRulesDigest,
  type ThemeRulesDocument,
  type ThemeRuleSlide,
} from '@fastppt/theme-registry'
import type { ExportJob, SlidewaveSnapshot } from '@fastppt/protocol'

type Readback = NonNullable<NonNullable<ExportJob['themeRules']>['readback']>
const placeholderTypes = new Set([
  'title',
  'ctrTitle',
  'subTitle',
  'body',
  'obj',
  'pic',
])

export async function evaluateExportReadback(
  bytes: Uint8Array,
  document: ThemeRulesDocument,
  snapshot: SlidewaveSnapshot,
  renderInput?: Omit<VerifyPptxRenderEvidenceInput, 'bytes' | 'rulesDigest'>,
): Promise<Readback> {
  const evidence = await readPptxRuleEvidence(bytes)
  if (evidence.slides.length !== snapshot.slides.length)
    throw new Error(
      `PPTX readback found ${evidence.slides.length} slides; captured ${snapshot.slides.length}`,
    )
  for (const [index, slide] of evidence.slides.entries())
    if (
      slide.slideId !== undefined &&
      slide.slideId !== snapshot.slides[index]?.id
    )
      throw new Error(
        `PPTX slide order differs from captured identity at slide ${index + 1}`,
      )
  const slides: ThemeRuleSlide[] = evidence.slides.map((slide) => ({
    index: slide.index,
    layout: slide.layout,
    master: slide.master,
    ...(slide.placeholders
      ? {
          placeholders: slide.placeholders.filter((item) =>
            placeholderTypes.has(item.type),
          ) as NonNullable<ThemeRuleSlide['placeholders']>,
        }
      : {}),
    ...(slide.fixedObjects ? { fixedObjects: slide.fixedObjects } : {}),
  }))
  const issues = evaluateThemeRules({ document, slides, phase: 'readback' })
  const render = renderInput
    ? await verifyPptxRenderEvidence({
        ...renderInput,
        bytes,
        rulesDigest: themeRulesDigest(document),
      })
    : undefined
  return {
    source: 'pptx-xml',
    sha256: evidence.sha256,
    checkedAt: new Date().toISOString(),
    status: issues.some((issue) => issue.severity === 'error')
      ? 'failed'
      : issues.length
        ? 'issues'
        : 'passed',
    issues,
    ...(render ? { render } : {}),
    slides: evidence.slides.map((slide) => ({
      index: slide.index,
      part: slide.part,
      ...(slide.slideId ? { slideId: slide.slideId } : {}),
      ...(slide.layoutPart ? { layoutPart: slide.layoutPart } : {}),
      ...(slide.layout ? { layout: slide.layout } : {}),
      ...(slide.masterPart ? { masterPart: slide.masterPart } : {}),
      ...(slide.master ? { master: slide.master } : {}),
    })),
  }
}
