import { createHash } from 'node:crypto'
import { z } from 'zod'

const ruleId = z.string().regex(/^[a-z][a-z0-9.-]*$/)
const layoutId = z.string().regex(/^[a-z][a-z0-9-]*$/)

const ruleBase = z.object({
  id: ruleId,
  severity: z.enum(['error', 'warning', 'needs-human']).default('warning'),
  message: z.string().min(1).optional(),
  provenance: z
    .enum(['extracted', 'derived', 'inferred', 'generated', 'user-overridden'])
    .optional(),
})

const placeholderType = z.enum([
  'title',
  'ctrTitle',
  'subTitle',
  'body',
  'obj',
  'pic',
])
const fixedObjectOwner = z.enum(['master', 'layout'])

/**
 * Machine-readable rules are deliberately small and structural in v1.  The
 * Markdown rule file remains the authoring guidance for an Agent; this
 * contract is the part that Gateway can enforce without interpreting prose.
 */
export const ThemeRuleSchema = z.discriminatedUnion('kind', [
  ruleBase.extend({ kind: z.literal('first-layout'), layout: layoutId }),
  ruleBase.extend({ kind: z.literal('last-layout'), layout: layoutId }),
  ruleBase.extend({ kind: z.literal('required-layout'), layout: layoutId }),
  ruleBase.extend({
    kind: z.literal('forbidden-layout'),
    layout: layoutId,
  }),
  ruleBase.extend({
    kind: z.literal('allowed-layouts'),
    layouts: z.array(layoutId).min(1),
  }),
  ruleBase.extend({
    kind: z.literal('layout-position'),
    layout: layoutId,
    positions: z.array(z.enum(['first', 'last'])).min(1),
  }),
  ruleBase.extend({
    kind: z.literal('max-slides'),
    value: z.number().int().positive(),
  }),
  ruleBase.extend({
    kind: z.literal('required-master'),
    master: z.string().min(1),
  }),
  ruleBase.extend({
    kind: z.literal('allowed-masters'),
    masters: z.array(z.string().min(1)).min(1),
  }),
  ruleBase.extend({
    kind: z.literal('required-placeholder'),
    layout: layoutId,
    type: placeholderType,
    index: z.number().int().nonnegative(),
  }),
  ruleBase.extend({
    kind: z.literal('required-token'),
    token: z.string().min(1),
  }),
  ruleBase.extend({
    kind: z.literal('forbidden-token'),
    token: z.string().min(1),
  }),
  ruleBase.extend({
    kind: z.literal('max-text-lines'),
    value: z.number().int().positive(),
    layout: layoutId.optional(),
  }),
  ruleBase.extend({
    kind: z.literal('max-density'),
    value: z.number().min(0).max(1),
    layout: layoutId.optional(),
  }),
  ruleBase.extend({
    kind: z.literal('fixed-object'),
    name: z.string().min(1),
    owner: fixedObjectOwner,
    allowOverride: z.boolean().default(false),
  }),
])

export const ThemeRulesDocumentSchema = z.object({
  version: z.literal(1),
  rules: z.array(ThemeRuleSchema).default([]),
})

export type ThemeRule = z.infer<typeof ThemeRuleSchema>
export type ThemeRulesDocument = z.infer<typeof ThemeRulesDocumentSchema>

/** Evidence needed by the current V1 evaluator. This describes its actual
 * boundaries; it neither skips phases nor turns missing evidence into a pass. */
export function themeRuleEvidenceRequirements(document: ThemeRulesDocument) {
  return document.rules.map((rule) => {
    const measurement =
      rule.kind === 'max-text-lines' || rule.kind === 'max-density'
    const token =
      rule.kind === 'required-token' || rule.kind === 'forbidden-token'
    return {
      ruleId: rule.id,
      source: `agent/theme-rules.json#${rule.id}`,
      provenance: rule.provenance ?? 'unspecified',
      authoring:
        measurement || token
          ? ('browser-measurement' as const)
          : ('compiled-structure' as const),
      approval:
        rule.kind === 'layout-position'
          ? ('not-applicable' as const)
          : measurement || token || rule.kind === 'max-slides'
            ? ('unverified' as const)
            : ('catalog-structure' as const),
      readback: {
        evidence: token
          ? ('output-token-mapping' as const)
          : measurement
            ? ('pptx-render' as const)
            : ('pptx-xml' as const),
        providerAvailable: !measurement && !token,
      },
    }
  })
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  return value
}

/** Stable semantic digest used to invalidate reports when rule content changes. */
export function themeRulesDigest(document: ThemeRulesDocument): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(document)))
    .digest('hex')
}

export interface ThemeRuleSlide {
  index: number
  layout?: string | undefined
  master?: string | undefined
  placeholders?:
    | readonly { index: number; type: z.infer<typeof placeholderType> }[]
    | undefined
  tokens?: readonly string[] | undefined
  textLines?: number | undefined
  density?: number | undefined
  fixedObjects?:
    | readonly {
        name: string
        owner: z.infer<typeof fixedObjectOwner>
        overridden?: boolean | undefined
      }[]
    | undefined
}

export interface ThemeRuleIssue {
  ruleId: string
  severity: 'error' | 'warning' | 'needs-human'
  code: string
  message: string
  slide?: number
  status: 'violation' | 'unverified'
  source: string
  suggestedFix: string
  locator: {
    layout?: string
    master?: string
    placeholderIndex?: number
    objectName?: string
    token?: string
  }
}

export interface ThemeRuleEvaluationInput {
  document: ThemeRulesDocument
  slides: readonly ThemeRuleSlide[]
  phase?: 'approval' | 'validate' | 'quality' | 'export' | 'readback'
}

function issue(
  rule: ThemeRule,
  code: string,
  message: string,
  slide?: number,
  unverified = false,
  phase: ThemeRuleEvaluationInput['phase'] = 'validate',
): ThemeRuleIssue {
  return {
    ruleId: rule.id,
    severity:
      unverified && !['export', 'readback'].includes(phase)
        ? 'needs-human'
        : rule.severity,
    code,
    message: rule.message ? `${rule.message} ${message}` : message,
    ...(slide === undefined ? {} : { slide }),
    status: unverified ? 'unverified' : 'violation',
    source: `agent/theme-rules.json#${rule.id}`,
    locator: {
      ...('layout' in rule && rule.layout ? { layout: rule.layout } : {}),
      ...('master' in rule ? { master: rule.master } : {}),
      ...('index' in rule ? { placeholderIndex: rule.index } : {}),
      ...('name' in rule ? { objectName: rule.name } : {}),
      ...('token' in rule ? { token: rule.token } : {}),
    },
    suggestedFix: unverified
      ? phase === 'readback'
        ? 'Review the exported PPTX and provide the missing render or template evidence; browser measurements do not verify PPTX rendering.'
        : phase === 'approval'
          ? 'Review missing native definitions in the selected catalog; verify page count and rendered content after authoring a deck.'
          : 'Refresh the native layout snapshot and run browser quality inspection for this slide.'
      : rule.kind === 'max-text-lines' || rule.kind === 'max-density'
        ? 'Reduce the content or choose a layout with more capacity.'
        : rule.kind === 'fixed-object'
          ? 'Restore the required inherited object and remove any unapproved page override.'
          : rule.kind === 'required-placeholder'
            ? `Add ${rule.type} placeholder ${rule.index} to layout ${rule.layout} and refresh the snapshot.`
            : rule.kind === 'required-token' || rule.kind === 'forbidden-token'
              ? 'Update the page CSS custom properties to satisfy this theme rule.'
              : 'Update the selected layouts or master assignments to satisfy this theme rule.',
  }
}

/** Evaluate structural rules against the canonical compiled slide list. */
export function evaluateThemeRules(
  input: ThemeRuleEvaluationInput,
): ThemeRuleIssue[] {
  const slides = [...input.slides].sort(
    (left, right) => left.index - right.index,
  )
  const issues: ThemeRuleIssue[] = []
  const missing = (rule: ThemeRule, evidence: string, slide?: number) =>
    issue(
      rule,
      'THEME_RULE_EVIDENCE_MISSING',
      `Cannot verify ${evidence}; current evidence is unavailable.`,
      slide,
      true,
      input.phase,
    )

  for (const rule of input.document.rules) {
    switch (rule.kind) {
      case 'first-layout': {
        if (input.phase === 'approval') {
          if (!slides.some((slide) => slide.layout === rule.layout))
            issues.push(
              issue(
                rule,
                'THEME_RULE_FIRST_LAYOUT',
                `Theme catalog does not provide required opening layout "${rule.layout}".`,
              ),
            )
          break
        }
        const first = slides[0]
        if (!first)
          issues.push(
            issue(
              rule,
              'THEME_RULE_FIRST_LAYOUT',
              `Deck has no slides; expected first layout "${rule.layout}".`,
            ),
          )
        else if (!first.layout)
          issues.push(missing(rule, 'opening layout identity', first.index))
        else if (first.layout !== rule.layout)
          issues.push(
            issue(
              rule,
              'THEME_RULE_FIRST_LAYOUT',
              `Slide 1 uses "${first.layout}"; expected "${rule.layout}".`,
              first.index,
            ),
          )
        break
      }
      case 'last-layout': {
        if (input.phase === 'approval') {
          if (!slides.some((slide) => slide.layout === rule.layout))
            issues.push(
              issue(
                rule,
                'THEME_RULE_LAST_LAYOUT',
                `Theme catalog does not provide required closing layout "${rule.layout}".`,
              ),
            )
          break
        }
        const last = slides.at(-1)
        if (!last)
          issues.push(
            issue(
              rule,
              'THEME_RULE_LAST_LAYOUT',
              `Deck has no slides; expected last layout "${rule.layout}".`,
            ),
          )
        else if (!last.layout)
          issues.push(missing(rule, 'closing layout identity', last.index))
        else if (last.layout !== rule.layout)
          issues.push(
            issue(
              rule,
              'THEME_RULE_LAST_LAYOUT',
              `Slide ${last.index} uses "${last.layout}"; expected "${rule.layout}".`,
              last.index,
            ),
          )
        break
      }
      case 'required-layout':
        if (!slides.some((slide) => slide.layout === rule.layout))
          issues.push(
            slides.some((slide) => !slide.layout)
              ? missing(rule, `required layout "${rule.layout}"`)
              : issue(
                  rule,
                  'THEME_RULE_REQUIRED_LAYOUT',
                  `Deck does not use required layout "${rule.layout}".`,
                ),
          )
        break
      case 'forbidden-layout':
        for (const slide of slides)
          if (!slide.layout)
            issues.push(missing(rule, 'layout identity', slide.index))
          else if (slide.layout === rule.layout)
            issues.push(
              issue(
                rule,
                'THEME_RULE_FORBIDDEN_LAYOUT',
                `Slide ${slide.index} uses forbidden layout "${rule.layout}".`,
                slide.index,
              ),
            )
        break
      case 'allowed-layouts':
        for (const slide of slides)
          if (!slide.layout)
            issues.push(missing(rule, 'layout identity', slide.index))
          else if (!rule.layouts.includes(slide.layout))
            issues.push(
              issue(
                rule,
                'THEME_RULE_LAYOUT_NOT_ALLOWED',
                `Slide ${slide.index} uses "${slide.layout}"; allowed layouts are ${rule.layouts.join(', ')}.`,
                slide.index,
              ),
            )
        break
      case 'layout-position':
        if (input.phase === 'approval') break
        for (const slide of slides)
          if (!slide.layout)
            issues.push(missing(rule, 'layout identity', slide.index))
          else if (
            slide.layout === rule.layout &&
            !(rule.positions.includes('first') && slide === slides[0]) &&
            !(rule.positions.includes('last') && slide === slides.at(-1))
          )
            issues.push(
              issue(
                rule,
                'THEME_RULE_LAYOUT_POSITION',
                `Slide ${slide.index} uses "${rule.layout}" outside its allowed ${rule.positions.join(' or ')} position.`,
                slide.index,
              ),
            )
        break
      case 'max-slides':
        if (input.phase === 'approval') {
          issues.push(missing(rule, 'authored deck page count'))
          break
        }
        if (slides.length > rule.value)
          issues.push(
            issue(
              rule,
              'THEME_RULE_MAX_SLIDES',
              `Deck has ${slides.length} slides; maximum is ${rule.value}.`,
            ),
          )
        break
      case 'required-master':
        if (!slides.some((slide) => slide.master === rule.master))
          issues.push(
            slides.some((slide) => slide.master === undefined)
              ? missing(rule, `required master "${rule.master}"`)
              : issue(
                  rule,
                  'THEME_RULE_MASTER_REQUIRED',
                  `Deck does not use required master "${rule.master}".`,
                ),
          )
        break
      case 'allowed-masters':
        for (const slide of slides)
          if (slide.master === undefined)
            issues.push(missing(rule, 'master assignment', slide.index))
          else if (!rule.masters.includes(slide.master))
            issues.push(
              issue(
                rule,
                'THEME_RULE_MASTER_NOT_ALLOWED',
                `Slide ${slide.index} uses ${slide.master ? `master "${slide.master}"` : 'an unverified master'}; allowed masters are ${rule.masters.join(', ')}.`,
                slide.index,
              ),
            )
        break
      case 'required-placeholder': {
        const matching = slides.filter(
          (slide) => !slide.layout || slide.layout === rule.layout,
        )
        if (input.phase === 'approval' && !matching.length)
          issues.push(
            issue(
              rule,
              'THEME_RULE_PLACEHOLDER_LAYOUT_MISSING',
              `Theme catalog does not provide layout "${rule.layout}" required for ${rule.type} placeholder ${rule.index}.`,
            ),
          )
        for (const slide of matching)
          if (!slide.layout)
            issues.push(
              missing(
                rule,
                'layout identity for placeholder contract',
                slide.index,
              ),
            )
          else if (slide.placeholders === undefined)
            issues.push(missing(rule, 'layout placeholders', slide.index))
          else if (
            !slide.placeholders.some(
              (placeholder) =>
                placeholder.index === rule.index &&
                placeholder.type === rule.type,
            )
          )
            issues.push(
              issue(
                rule,
                'THEME_RULE_PLACEHOLDER_MISSING',
                `Slide ${slide.index} does not provide ${rule.type} placeholder ${rule.index} on layout "${rule.layout}".`,
                slide.index,
              ),
            )
        break
      }
      case 'required-token':
        for (const slide of slides)
          if (input.phase === 'approval' || input.phase === 'readback')
            issues.push(
              missing(
                rule,
                input.phase === 'approval'
                  ? `authored page token "${rule.token}"`
                  : `PPTX output mapping for token "${rule.token}"`,
                slide.index,
              ),
            )
          else if (slide.tokens === undefined)
            issues.push(
              missing(rule, `computed token "${rule.token}"`, slide.index),
            )
          else if (!slide.tokens.includes(rule.token))
            issues.push(
              issue(
                rule,
                'THEME_RULE_TOKEN_REQUIRED',
                `Slide ${slide.index} does not provide required token "${rule.token}".`,
                slide.index,
              ),
            )
        break
      case 'forbidden-token':
        for (const slide of slides)
          if (input.phase === 'approval' || input.phase === 'readback')
            issues.push(
              missing(
                rule,
                input.phase === 'approval'
                  ? `authored page token "${rule.token}"`
                  : `PPTX output mapping for token "${rule.token}"`,
                slide.index,
              ),
            )
          else if (slide.tokens === undefined)
            issues.push(
              missing(rule, `computed token "${rule.token}"`, slide.index),
            )
          else if (slide.tokens.includes(rule.token))
            issues.push(
              issue(
                rule,
                'THEME_RULE_TOKEN_FORBIDDEN',
                `Slide ${slide.index} uses forbidden token "${rule.token}".`,
                slide.index,
              ),
            )
        break
      case 'max-text-lines':
        for (const slide of slides) {
          if (rule.layout && !slide.layout) {
            issues.push(
              missing(rule, 'layout identity for text line limit', slide.index),
            )
            continue
          }
          if (rule.layout && slide.layout !== rule.layout) continue
          if (input.phase === 'approval')
            issues.push(missing(rule, 'authored page text lines', slide.index))
          else if (input.phase === 'readback')
            issues.push(missing(rule, 'PPTX-rendered text lines', slide.index))
          else if (slide.textLines === undefined)
            issues.push(missing(rule, 'rendered text lines', slide.index))
          else if (slide.textLines > rule.value)
            issues.push(
              issue(
                rule,
                'THEME_RULE_TEXT_LINES',
                `Slide ${slide.index} has ${slide.textLines === undefined ? 'unverified' : slide.textLines} text lines; maximum is ${rule.value}.`,
                slide.index,
              ),
            )
        }
        break
      case 'max-density':
        for (const slide of slides) {
          if (rule.layout && !slide.layout) {
            issues.push(
              missing(rule, 'layout identity for density limit', slide.index),
            )
            continue
          }
          if (rule.layout && slide.layout !== rule.layout) continue
          if (input.phase === 'approval')
            issues.push(
              missing(rule, 'authored page content density', slide.index),
            )
          else if (input.phase === 'readback')
            issues.push(
              missing(rule, 'PPTX-rendered content density', slide.index),
            )
          else if (slide.density === undefined)
            issues.push(missing(rule, 'rendered content density', slide.index))
          else if (slide.density > rule.value)
            issues.push(
              issue(
                rule,
                'THEME_RULE_DENSITY',
                `Slide ${slide.index} has ${slide.density === undefined ? 'unverified' : slide.density} density; maximum is ${rule.value}.`,
                slide.index,
              ),
            )
        }
        break
      case 'fixed-object':
        for (const slide of slides) {
          if (slide.fixedObjects === undefined) {
            issues.push(missing(rule, 'inherited fixed objects', slide.index))
            continue
          }
          const object = slide.fixedObjects?.find(
            (candidate) =>
              candidate.name === rule.name && candidate.owner === rule.owner,
          )
          if (!object)
            issues.push(
              issue(
                rule,
                'THEME_RULE_FIXED_OBJECT_MISSING',
                `Slide ${slide.index} does not provide fixed object "${rule.name}" owned by ${rule.owner}.`,
                slide.index,
              ),
            )
          else if (object.overridden && !rule.allowOverride)
            issues.push(
              issue(
                rule,
                'THEME_RULE_FIXED_OBJECT_OVERRIDE',
                `Slide ${slide.index} overrides protected fixed object "${rule.name}".`,
                slide.index,
              ),
            )
        }
        break
    }
  }

  return issues
}
