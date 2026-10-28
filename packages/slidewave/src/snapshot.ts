import { NativePathsSchema } from './primitives/native-geometry.js'
import { z } from 'zod'
import { validateDecimalTab, type DecimalTab } from './primitives/text-tabs.mjs'
import { validateTextTabLayout } from './primitives/text-tab-layout.js'
import { autoNumberSchemes } from './primitives/text-numbering.mjs'
import { isBulletCharacter } from './primitives/text-bullet.js'
import { isTextLanguage } from './primitives/text-language.mjs'

export type * from './snapshot-types.js'
export { HTML_SNAPSHOT_VERSIONS } from './snapshot-types.js'
import type { HtmlDeckSnapshot } from './snapshot-types.js'

const HtmlBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
})

const HtmlColorSchema = z.object({
  hex: z.string().regex(/^[0-9a-f]{6}$/i),
  alpha: z.number().min(0).max(1),
})

const HtmlElementSourceSchema = z.object({
  tag: z.string(),
  path: z.string(),
  className: z.string().optional(),
  anchor: z.string().min(1).optional(),
  nativeLayoutObject: z.object({ scope: z.enum(['layout', 'master']).optional(), layout: z.string().min(1), name: z.string().min(1) }).optional(),
  role: z.literal('slide-background').optional(),
  pseudo: z.enum(['before', 'after']).optional(),
})

const HtmlElementBaseSchema = z.object({
  id: z.string().min(1),
  box: HtmlBoxSchema,
  order: z.number().int().nonnegative(),
  zIndex: z.number(),
  opacity: z.number().min(0).max(1),
  source: HtmlElementSourceSchema,
  structure: z.object({ kind: z.literal('table'), ownerId: z.string().min(1), requiredRepresentation: z.literal('native-table') }).strict().optional(),
})

const HtmlShapeElementSchema = HtmlElementBaseSchema.extend({
  kind: z.literal('shape'),
  shape: z.enum(['rect', 'roundRect', 'ellipse', 'chevron', 'freeform']),
  geometry: NativePathsSchema.optional(),
  preciseRadius: z.boolean().optional(),
  fill: HtmlColorSchema.optional(),
  gradient: z
    .object({
      angle: z.number(),
      stops: z.array(z.object({ offset: z.number(), color: HtmlColorSchema })),
    })
    .optional(),
  stroke: z
    .object({
      color: HtmlColorSchema,
      widthPx: z.number().nonnegative(),
      dash: z.enum(['solid', 'dash', 'dot']).optional(),
    })
    .optional(),
  radiusPx: z.number().nonnegative().optional(),
  rotation: z.number().optional(),
  shadow: z
    .object({
      color: HtmlColorSchema,
      blurPx: z.number().nonnegative(),
      offsetPx: z.number(),
      angle: z.number(),
    })
    .optional(),
})

const HtmlLineElementSchema = HtmlElementBaseSchema.extend({
  kind: z.literal('line'),
  x2: z.number(),
  y2: z.number(),
  color: HtmlColorSchema,
  widthPx: z.number().nonnegative(),
  dash: z.enum(['solid', 'dash', 'dot']).optional(),
})

const HtmlTextStyleSchema = z.object({
  fontFamily: z.string(),
  fontFamilies: z.object({ latin: z.string().trim().min(1).optional(), ea: z.string().trim().min(1).optional(), cs: z.string().trim().min(1).optional() }).strict().optional(),
  fontSizePx: z.number().positive(),
  fontWeight: z.number(),
  fontStyle: z.enum(['normal', 'italic']),
  lineHeightPx: z.number().positive(),
  letterSpacingPx: z.number(),
  capitalization: z.enum(['none', 'all', 'small']).optional(),
  kerningThresholdPx: z.number().nonnegative().optional(),
  baselinePercent: z.number().min(-2147483.648).max(2147483.647).optional(),
  color: HtmlColorSchema,
  align: z.enum(['left', 'center', 'right', 'justify']),
  decoration: z.array(z.enum(['underline', 'line-through'])),
  direction: z.enum(['ltr', 'rtl']),
  language: z.string().refine(isTextLanguage, 'Invalid text language identifier.').optional(),
  alternativeLanguage: z.string().refine(isTextLanguage, 'Invalid text language identifier.').optional(),
})

const HtmlTextElementSchema = HtmlElementBaseSchema.extend({
  kind: z.literal('text'),
  text: z.string(),
  paragraphLevel: z.number().int().min(1).max(9).optional(),
  textFrame: z.object({
    insetsPx: z.object({ left: z.number().nonnegative(), right: z.number().nonnegative(), top: z.number().nonnegative(), bottom: z.number().nonnegative() }).strict(),
    wrap: z.boolean(),
  }).strict().optional(),
  paragraphs: z.array(z.object({
    tabLayout: z.object({ version: z.literal(1), text: z.string(), lines: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), breakBefore: z.enum(['paragraph', 'soft', 'automatic']), box: HtmlBoxSchema.strict().optional(), tabs: z.array(z.number().int().nonnegative()) }).strict()).min(1) }).strict().superRefine((value, ctx) => { try { validateTextTabLayout(value, value.text) } catch (error) { ctx.addIssue({ code: 'custom', message: (error as Error).message }) } }).optional(),
    decimalTab: z.custom<DecimalTab>(value => { try { validateDecimalTab(value); return true } catch { return false } }, 'Invalid decimal tab convention.').nullable().optional(),
    defaultTabSizePx: z.number().finite().nonnegative().optional(),
    tabStopsPx: z.array(z.object({ position: z.number().finite(), align: z.enum(['left', 'center', 'right', 'decimal']) }).strict()).max(1024).refine(stops => stops.every((stop, index) => index === 0 || stop.position > stops[index - 1]!.position), 'Tab positions must strictly increase.').optional(),
    bullet: z.discriminatedUnion('kind', [z.object({ kind: z.literal('none') }).strict(), z.object({ kind: z.literal('character'), character: z.string().refine(isBulletCharacter) }).strict(), z.object({ kind: z.literal('auto-number'), scheme: z.enum(autoNumberSchemes), startAt: z.number().int().min(1).max(32767).optional() }).strict()]).optional(),
    numberingRestart: z.number().int().min(1).max(32767).optional(),
    bulletFont: z.discriminatedUnion('kind', [z.object({ kind: z.literal('text') }).strict(), z.object({ kind: z.literal('font'), fontFamily: z.string().trim().min(1) }).strict()]).optional(),
    bulletColor: z.discriminatedUnion('kind', [z.object({ kind: z.literal('text') }).strict(), z.object({ kind: z.literal('color'), color: z.string().regex(/^[0-9a-fA-F]{6}$/) }).strict()]).optional(),
    bulletSize: z.discriminatedUnion('kind', [z.object({ kind: z.literal('text') }).strict(), z.object({ kind: z.literal('pixels'), value: z.number().positive() }).strict(), z.object({ kind: z.literal('percent'), value: z.number().min(25).max(400) }).strict()]).optional(),
    level: z.number().int().min(1).max(9),
    style: HtmlTextStyleSchema,
    marginLeftPx: z.number().nonnegative(),
    marginRightPx: z.number().nonnegative(),
    indentPx: z.number(),
    spaceBeforePx: z.number().nonnegative(),
    spaceAfterPx: z.number().nonnegative(),
    runs: z.array(z.object({ text: z.string(), style: HtmlTextStyleSchema, hyperlink: z.string().optional() })),
  }).refine(paragraph => paragraph.numberingRestart === undefined || paragraph.bullet?.kind === 'auto-number', { message: 'A numbering restart requires an automatic list.', path: ['numberingRestart'] })).min(1).optional(),
  metrics: z.object({ advancePx: z.number().nonnegative(), graphemeCount: z.number().int().nonnegative() }).optional(),
  style: HtmlTextStyleSchema,
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  rotation: z.number().optional(),
  hyperlink: z.string().optional(),
})

const HtmlImageElementSchema = HtmlElementBaseSchema.extend({
  kind: z.literal('image'),
  data: z.string().optional(),
  path: z.string().optional(),
  assetKey: z.string().optional(),
  alt: z.string().optional(),
  rotation: z.number().optional(),
  crop: z.object({
    left: z.number().min(0).max(1),
    top: z.number().min(0).max(1),
    right: z.number().min(0).max(1),
    bottom: z.number().min(0).max(1),
  }).strict().refine(
    crop => crop.left + crop.right < 1 && crop.top + crop.bottom < 1,
    'Image crop must leave a positive visible area.',
  ).optional(),
})

/** Resource limits apply before allocating or rendering a grid. */
export const HtmlTableElementSchema = HtmlElementBaseSchema.extend({
  kind: z.literal('table'),
  columnWidthsPx: z.array(z.number().min(0.1).max(20000)).min(1).max(100),
  rowHeightsPx: z.array(z.number().min(0.1).max(20000)).min(1).max(200),
  cells: z.array(z.object({
    id: z.string().min(1).max(1024),
    row: z.number().int().min(0).max(199),
    column: z.number().int().min(0).max(99),
    header: z.boolean(),
    text: z.string().max(100000),
    style: HtmlTextStyleSchema,
    runs: z.array(z.object({ text: z.string().max(100000), style: HtmlTextStyleSchema, hyperlink: z.string().optional() }).strict()).max(10000),
    fill: HtmlColorSchema.optional(),
    borders: z.array(z.object({ color: HtmlColorSchema, widthPx: z.number().min(0).max(100) }).strict()).length(4),
    insetsPx: z.object({ top: z.number().min(0).max(20000), right: z.number().min(0).max(20000), bottom: z.number().min(0).max(20000), left: z.number().min(0).max(20000) }).strict(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']),
  }).strict()).min(1).max(5000),
}).strict().superRefine((table, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (table.box.width <= 0 || table.box.height <= 0 || table.box.width > 20000 || table.box.height > 20000) fail('Table frame dimensions must be positive and within the geometry budget.')
  const columns = table.columnWidthsPx.length
  const rows = table.rowHeightsPx.length
  if (rows * columns !== table.cells.length) fail('Table must contain a complete rectangular grid.')
  const occupied = new Set<string>(), ids = new Set<string>()
  let length = 0
  for (const cell of table.cells) {
    const key = `${cell.row}:${cell.column}`
    if (cell.row >= rows || cell.column >= columns || occupied.has(key) || ids.has(cell.id)) fail('Table cell coordinates and IDs must be unique and within the grid.')
    occupied.add(key); ids.add(cell.id)
    if (cell.runs.map(run => run.text).join('') !== cell.text) fail('Table cell text must match its rich runs.')
    length += cell.text.length
    if (cell.insetsPx.left + cell.insetsPx.right >= (table.columnWidthsPx[cell.column] ?? 0) || cell.insetsPx.top + cell.insetsPx.bottom >= (table.rowHeightsPx[cell.row] ?? 0)) fail('Table insets must leave positive content space.')
  }
  if (length > 200000) fail('Table text exceeds the capture budget.')
  if (Math.abs(table.columnWidthsPx.reduce((a, b) => a + b, 0) - table.box.width) > 1 || Math.abs(table.rowHeightsPx.reduce((a, b) => a + b, 0) - table.box.height) > 1) fail('Table row and column dimensions must match its frame.')
})

const HtmlConversionWarningSchema = z.object({
  code: z.enum([
    'unsupported-table',
    'image-embed-failed',
    'unsupported-background-image',
    'unsupported-backdrop-filter',
    'unsupported-clip-path',
    'unsupported-mask',
    'unsupported-media',
    'unsupported-transform',
    'unsupported-border-style',
    'unresolved-font',
    'unembedded-font',
    'font-subset-failed',
    'invalid-snapshot',
    'numbering-compatibility',
    'text-tab-compatibility',
    'text-letter-spacing-compatibility',
    'text-capitalization-compatibility',
    'text-kerning-compatibility',
  'text-baseline-compatibility',
    'text-bullet-compatibility',
  ]),
  message: z.string(),
  elementId: z.string().optional(),
})

export const HtmlDeckSnapshotSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  source: z.enum(['slidev', 'html']),
  slides: z
    .array(
      z.object({
        version: z.union([z.literal(1), z.literal(2)]),
        id: z.string().min(1),
        width: z.number().positive(),
        height: z.number().positive(),
        elements: z.array(
          z.discriminatedUnion('kind', [
            HtmlShapeElementSchema,
            HtmlLineElementSchema,
            HtmlTextElementSchema,
            HtmlImageElementSchema,
            HtmlTableElementSchema,
          ]),
        ),
        warnings: z.array(HtmlConversionWarningSchema),
      }),
    )
    .min(1)
    .max(500),
  warnings: z.array(HtmlConversionWarningSchema),
}).superRefine((deck, ctx) => {
  for (const [index, slide] of deck.slides.entries()) {
    if (slide.version !== deck.version) ctx.addIssue({ code: 'custom', path: ['slides', index, 'version'], message: 'Deck and slide snapshot versions must match.' })
    if (deck.version === 1 && slide.elements.some(element => element.kind === 'table' || element.structure)) ctx.addIssue({ code: 'custom', path: ['slides', index, 'elements'], message: 'Structured elements require snapshot V2.' })
    const ids = slide.elements.map(element => element.id)
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['slides', index, 'elements'], message: 'Element IDs must be unique per slide.' })
  }
}) as unknown as z.ZodType<HtmlDeckSnapshot>
