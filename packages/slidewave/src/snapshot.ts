import { z } from 'zod'

export type * from './snapshot-types.js'
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
  pseudo: z.enum(['before', 'after']).optional(),
})

const HtmlElementBaseSchema = z.object({
  id: z.string().min(1),
  box: HtmlBoxSchema,
  order: z.number().int().nonnegative(),
  zIndex: z.number(),
  opacity: z.number().min(0).max(1),
  source: HtmlElementSourceSchema,
})

const HtmlShapeElementSchema = HtmlElementBaseSchema.extend({
  kind: z.literal('shape'),
  shape: z.enum(['rect', 'roundRect', 'ellipse', 'chevron']),
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

const HtmlTextElementSchema = HtmlElementBaseSchema.extend({
  kind: z.literal('text'),
  text: z.string(),
  metrics: z
    .object({
      advancePx: z.number().nonnegative(),
      graphemeCount: z.number().int().nonnegative(),
    })
    .optional(),
  style: z.object({
    fontFamily: z.string(),
    fontSizePx: z.number().positive(),
    fontWeight: z.number(),
    fontStyle: z.enum(['normal', 'italic']),
    lineHeightPx: z.number().positive(),
    letterSpacingPx: z.number(),
    color: HtmlColorSchema,
    align: z.enum(['left', 'center', 'right', 'justify']),
    decoration: z.array(z.enum(['underline', 'line-through'])),
    direction: z.enum(['ltr', 'rtl']),
    language: z.string().optional(),
  }),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  rotation: z.number().optional(),
  hyperlink: z.string().optional(),
})

const HtmlImageElementSchema = HtmlElementBaseSchema.extend({
  kind: z.literal('image'),
  data: z.string().optional(),
  path: z.string().optional(),
  alt: z.string().optional(),
  rotation: z.number().optional(),
})

const HtmlConversionWarningSchema = z.object({
  code: z.enum([
    'image-embed-failed',
    'unsupported-background-image',
    'unsupported-backdrop-filter',
    'unsupported-clip-path',
    'unsupported-mask',
    'unsupported-media',
    'unsupported-transform',
    'unsupported-border-style',
    'unresolved-font',
    'invalid-snapshot',
  ]),
  message: z.string(),
  elementId: z.string().optional(),
})

export const HtmlDeckSnapshotSchema = z.object({
  version: z.literal(1),
  source: z.enum(['slidev', 'html']),
  slides: z
    .array(
      z.object({
        version: z.literal(1),
        id: z.string().min(1),
        width: z.number().positive(),
        height: z.number().positive(),
        elements: z.array(
          z.discriminatedUnion('kind', [
            HtmlShapeElementSchema,
            HtmlLineElementSchema,
            HtmlTextElementSchema,
            HtmlImageElementSchema,
          ]),
        ),
        warnings: z.array(HtmlConversionWarningSchema),
      }),
    )
    .min(1)
    .max(500),
  warnings: z.array(HtmlConversionWarningSchema),
}) as unknown as z.ZodType<HtmlDeckSnapshot>
