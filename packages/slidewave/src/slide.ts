import { normalizeHex } from './utils/color'
import { blobToPng } from './primitives/blob'
import { gradientBgToPng, gradientSvg } from './primitives/gradientBg'
import { gradientTextToPng } from './primitives/gradientText'
import { glassToPng } from './primitives/glass'
import { noiseGradientToPng } from './primitives/noiseGradient'
import { isometricGridToPng } from './primitives/isometricGrid'
import { codeBlockToPng } from './primitives/codeBlock'
import { iconToPng } from './primitives/icon'
import { prepareEditorialChart } from './primitives/editorialChart'
import {
  dotGridToPng,
  stripesToPng,
  waveDividerToPng,
} from './primitives/patterns'
import { progressRingToPng } from './primitives/progressRing'
import { sparklineToPng } from './primitives/sparkline'
import {
  halftoneToPng,
  gridPaperToPng,
  checkerToPng,
  radialBurstToPng,
  noiseTextureToPng,
  auroraGradientToPng,
} from './primitives/visualPack'
import {
  barRaceToPng,
  radarChartToPng,
  heatmapToPng,
  funnelToPng,
} from './primitives/dataVizPack'
import {
  neonGlowToPng,
  liquidGradientToPng,
  holoFoilToPng,
  particleFieldToPng,
  cinematicBarsToPng,
  glitchBandsToPng,
  duotoneToPng,
  gradientMeshToPng,
} from './primitives/ultraVisual'
import {
  sankeyToPng,
  treemapToPng,
  bubbleChartToPng,
  ganttChartToPng,
  orgChartToPng,
  waterfallChartToPng,
  calendarHeatmapToPng,
} from './primitives/advancedCharts'
import * as layoutPack from './primitives/layoutPack'
import { generateGrainPng, svgToPngDataUrl, inchesToPx } from './utils/svg'
import { pick } from './theme'
import {
  validateRect,
  validateText,
  validateColor,
  validateGradient,
  safeRun,
} from './validate'
import { cachedRaster } from './cache'
import { OperationQueue } from './internal/operationQueue'
import type { OperationCommit } from './internal/operationQueue'
import { normalizeFill } from './internal/normalizeFill'
import type { Pres } from './pres'
import type {
  BackgroundOptions,
  BadgeOptions,
  BlobOptions,
  CalloutOptions,
  ChartOptions,
  CodeBlockOptions,
  ComparisonTableOptions,
  ConnectorOptions,
  DotGridOptions,
  FeatureCardOptions,
  GlassOptions,
  GradientRectOptions,
  GradientTextOptions,
  GrainOptions,
  IconOptions,
  ImageOptions,
  IsometricGridOptions,
  LineOptions,
  LogoCloudOptions,
  NoiseGradientOptions,
  PrimitiveOptions,
  ProgressBarOptions,
  ProgressRingOptions,
  RectOptions,
  SparklineOptions,
  StatCardOptions,
  StepFlowOptions,
  StripesOptions,
  TeamCardOptions,
  TextOptions,
  TimelineOptions,
  Theme,
  WaveDividerOptions,
  KpiGridOptions,
} from './types'

/**
 * Slidewave Slide — wrapper around a pptxgenjs slide.
 *
 * Architecture:
 *   - Every operation is placed in an internal queue (_queue).
 *   - Raster primitives (blob, grain, glass, gradient, and so on)
 *     begin rasterizing IMMEDIATELY and in parallel.
 *   - At flush time (triggered by pres.save, toBlob, or flush), Promise.all
 *     waits for every raster operation in parallel, then commits operations
 *     in insertion order to preserve z-order.
 *
 *   → Benefit: on a slide with N raster primitives, render time drops from
 *     O(N) to O(the slowest primitive) because raster operations run in parallel.
 *
 * Global theme:
 *   - Primitives obtain default values from pres.theme.
 *   - An explicit option override always takes priority.
 *
 * Validation:
 *   - Every primitive validates its inputs (coordinates, fontSize, and so on).
 *   - Suspicious values produce non-blocking console warnings.
 *
 * All coordinates use inches, following the pptxgenjs standard.
 * A wide 16:9 slide is 13.333 × 7.5 inches.
 */
export class Slide {
  /** @internal */ declare _slide: any
  /** @internal */ declare _pres: Pres
  /** @internal */ declare _ops: any[]
  /** @internal */ declare _background: any
  /** @internal */ declare _queue: OperationQueue

  constructor(pptxSlide: any, pres: Pres) {
    this._slide = pptxSlide
    this._pres = pres
    this._ops = [] // visual operation log for the SVG preview renderer
    this._background = null
    this._queue = new OperationQueue()
  }

  raw() {
    return this._slide
  }

  /** Read-only access to the current Pres theme. */
  get theme(): Partial<Theme> {
    return this._pres && this._pres._theme ? this._pres._theme : {}
  }

  // ─────────────────────────────────────────────────────────────
  //   INTERNAL QUEUE
  // ─────────────────────────────────────────────────────────────

  /** Enqueues a synchronous operation with no raster work. */
  /** @internal */
  _enqueue(commit: OperationCommit) {
    this._queue.enqueue(commit)
  }

  /** Enqueues an async operation: raster work starts immediately and commits on flush. */
  /** @internal */
  _enqueueAsync<T>(rasterPromise: Promise<T>, commit: OperationCommit) {
    this._queue.enqueueAfter(rasterPromise, commit)
  }

  /**
   * Flushes the queue: waits for all rasters in parallel with Promise.all,
   * then commits each operation in insertion order.
   */
  /** @internal */
  async _flush() {
    await this._queue.flush()
  }

  // ─────────────────────────────────────────────────────────────
  //   BACKGROUND
  // ─────────────────────────────────────────────────────────────

  addBackground(opts: BackgroundOptions = {}) {
    const color = pick(opts.color, undefined, null)
    const gradient = opts.gradient
    const { width, height } = this._pres.size()

    if (color && !gradient) {
      validateColor(color, 'background')
      const hex = normalizeHex(color)
      this._enqueue(() => {
        this._slide.background = { color: hex }
        this._background = { color: hex }
      })
      return this
    }

    if (gradient) {
      validateGradient(gradient, 'background')
      const rasterPromise = safeRun(
        () =>
          cachedRaster('bg', gradient, width, height, () =>
            gradientBgToPng(gradient, width, height),
          ),
        'addBackground',
      )
      this._enqueueAsync(rasterPromise, async () => {
        const png = await rasterPromise
        if (!png) return
        const base64 = png.split(',')[1]
        this._slide.background = { data: 'image/png;base64,' + base64 }
        this._background = { image: png }
      })
      return this
    }

    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   TEXT
  // ─────────────────────────────────────────────────────────────

  /**
   * @param {string|array} text
   * @param {object} opts
   *   x, y, w, h (inches)
   *   fontFace, fontSize, color, bold, italic, underline
   *   align: 'left'|'center'|'right', valign: 'top'|'middle'|'bottom'
   *   charSpacing (pt)  ← letter spacing in POINTS
   *   lineSpacingMultiple (ex 1.1, 1.4)
   *   shadow, glow, outline
   */
  addText(text: string | any[], opts: TextOptions = {} as TextOptions) {
    validateRect(opts, 'addText')
    validateText(opts, 'addText')
    validateColor(opts.color, 'addText.color')

    const theme = this.theme
    const { color, fontFace, ...rest } = opts
    const resolvedOpts = {
      ...rest,
      fontFace: pick(fontFace, theme.fontBody, undefined),
      color: normalizeHex(pick(color, theme.text, '#000000')),
    }

    this._enqueue(() => {
      this._slide.addText(text, resolvedOpts)
      this._ops.push({
        kind: 'text',
        text,
        opts: {
          ...opts,
          fontFace: resolvedOpts.fontFace,
          color: resolvedOpts.color,
        },
      })
    })
    return this
  }

  addGradientText(
    text: string,
    opts: GradientTextOptions = {} as GradientTextOptions,
  ) {
    validateRect(opts, 'addGradientText')
    const theme = this.theme
    const {
      x,
      y,
      w,
      h,
      fontFamily,
      fontSize,
      fontWeight,
      fontStyle,
      gradient,
      angle,
      letterSpacing,
      lineHeight,
      align,
    } = opts

    const resolvedGradient = gradient || theme.gradient
    const resolvedAngle = pick(angle, theme.gradientAngle, 135)
    validateGradient(resolvedGradient, 'addGradientText.gradient')

    const gtParams = {
      text,
      fontFamily: pick(fontFamily, theme.fontDisplay, undefined),
      fontSize: fontSize || Math.round(h * 96),
      fontWeight,
      fontStyle,
      gradient: resolvedGradient,
      angle: resolvedAngle,
      letterSpacing,
      lineHeight,
      align,
    }
    const rasterPromise = safeRun(
      () =>
        cachedRaster('gradientText', gtParams, w, h, () =>
          gradientTextToPng(gtParams, w, h),
        ),
      'addGradientText',
    )

    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   NATIVE SHAPES
  // ─────────────────────────────────────────────────────────────

  addRect(opts: RectOptions = {} as RectOptions) {
    validateRect(opts, 'addRect')
    validateColor(opts.fill, 'addRect.fill')

    const theme = this.theme
    const {
      x,
      y,
      w,
      h,
      fill,
      borderColor,
      borderWidth = 0,
      radius = 0,
      shadow,
      rotate,
    } = opts

    const resolvedFill = pick(fill, theme.primary, '#000000')
    const shapeType = radius > 0 ? 'roundRect' : 'rect'
    const shapeOpts: any = {
      x,
      y,
      w,
      h,
      fill: normalizeFill(resolvedFill),
      line: borderColor
        ? { color: normalizeHex(borderColor), width: borderWidth }
        : { type: 'none' },
      rectRadius: radius,
      rotate,
    }

    if (shadow) {
      shapeOpts.shadow = {
        type: shadow.type || 'outer',
        blur: shadow.blur ?? 10,
        offset: shadow.offset ?? 4,
        angle: shadow.angle ?? 90,
        color: normalizeHex(shadow.color || '#000000'),
        opacity: shadow.opacity ?? 0.4,
      }
    }

    this._enqueue(() => {
      this._slide.addShape(
        this._pres._pptx.ShapeType[shapeType] || shapeType,
        shapeOpts,
      )
      this._ops.push({
        kind: 'rect',
        x,
        y,
        w,
        h,
        fill: resolvedFill,
        borderColor,
        borderWidth,
        radius,
        shadow,
        rotate,
      })
    })
    return this
  }

  addShape(type: string, opts: PrimitiveOptions = {}) {
    validateRect(opts, 'addShape')
    const { fill, ...rest } = opts
    this._enqueue(() => {
      const ShapeType = this._pres._pptx.ShapeType
      const resolved = ShapeType[type] || type
      this._slide.addShape(resolved, {
        ...rest,
        fill: fill ? normalizeFill(fill) : undefined,
      })
      this._ops.push({ kind: 'shape', type, opts: { ...opts } })
    })
    return this
  }

  addLine(opts: LineOptions = {} as LineOptions) {
    const {
      x1,
      y1,
      x2,
      y2,
      color = '#000000',
      width = 1,
      transparency,
      dash = 'solid',
    } = opts
    validateColor(color, 'addLine.color')
    const x = Math.min(x1, x2)
    const y = Math.min(y1, y2)
    const deltaX = Math.abs(x2 - x1)
    const deltaY = Math.abs(y2 - y1)
    const isPoint = deltaX === 0 && deltaY === 0
    const w = isPoint ? 0.01 : deltaX
    const h = isPoint ? 0.01 : deltaY

    this._enqueue(() => {
      const ShapeType = this._pres._pptx.ShapeType
      this._slide.addShape(ShapeType.line, {
        x,
        y,
        w,
        h,
        line: {
          color: normalizeHex(color),
          width,
          transparency,
          dashType: dash === 'dot' ? 'sysDot' : dash,
        },
        flipV: y2 < y1,
        flipH: x2 < x1,
      })
      this._ops.push({
        kind: 'line',
        x1,
        y1,
        x2,
        y2,
        color,
        width,
        transparency,
        dash,
      })
    })
    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   IMAGE
  // ─────────────────────────────────────────────────────────────

  addImage(opts: ImageOptions = {} as ImageOptions) {
    validateRect(opts, 'addImage')
    this._enqueue(() => {
      this._slide.addImage(opts)
      const { x, y, w, h, data, path } = opts
      this._ops.push({ kind: 'image', x, y, w, h, data: data || path })
    })
    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   RASTER PRIMITIVES (parallel)
  // ─────────────────────────────────────────────────────────────

  addBlob(opts: BlobOptions = {} as BlobOptions) {
    validateRect(opts, 'addBlob')
    const { x, y, w, h, ...rest } = opts
    const rasterPromise = safeRun(
      () => cachedRaster('blob', rest, w, h, () => blobToPng(rest, w, h)),
      'addBlob',
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  addGradientRect(opts: GradientRectOptions = {} as GradientRectOptions) {
    validateRect(opts, 'addGradientRect')
    const { x, y, w, h, ...gradOpts } = opts
    validateGradient(gradOpts.colors || gradOpts.gradient, 'addGradientRect')
    const rasterPromise = safeRun(
      () =>
        cachedRaster('gradientRect', gradOpts, w, h, async () => {
          const svg = gradientSvg({ ...gradOpts })
          return svgToPngDataUrl(svg, inchesToPx(w), inchesToPx(h))
        }),
      'addGradientRect',
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  addGrain(opts: GrainOptions = {} as GrainOptions) {
    validateRect(opts, 'addGrain')
    const { x, y, w, h, opacity = 0.08, monochrome = true } = opts
    const rasterPromise = safeRun(
      () =>
        cachedRaster('grain', { opacity, monochrome }, w, h, async () => {
          const wPx = inchesToPx(w)
          const hPx = inchesToPx(h)
          return generateGrainPng(wPx, hPx, opacity, monochrome)
        }),
      'addGrain',
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  addGlassCard(opts: GlassOptions = {} as GlassOptions) {
    validateRect(opts, 'addGlassCard')
    const { x, y, w, h, ...rest } = opts
    const rasterPromise = safeRun(
      () => cachedRaster('glass', rest, w, h, () => glassToPng(rest, w, h)),
      'addGlassCard',
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  addNoiseGradient(opts: NoiseGradientOptions = {} as NoiseGradientOptions) {
    validateRect(opts, 'addNoiseGradient')
    const { x, y, w, h, ...rest } = opts
    const rasterPromise = safeRun(
      () =>
        cachedRaster('noiseGradient', rest, w, h, () =>
          noiseGradientToPng(rest, w, h),
        ),
      'addNoiseGradient',
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  addIsometricGrid(opts: IsometricGridOptions = {} as IsometricGridOptions) {
    validateRect(opts, 'addIsometricGrid')
    const { x, y, w, h, ...rest } = opts
    const rasterPromise = safeRun(
      () =>
        cachedRaster('isoGrid', rest, w, h, () =>
          isometricGridToPng(rest, w, h),
        ),
      'addIsometricGrid',
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  addCodeBlock(opts: CodeBlockOptions = {} as CodeBlockOptions) {
    validateRect(opts, 'addCodeBlock')
    const { x, y, w, h, ...rest } = opts
    const rasterPromise = safeRun(
      () =>
        cachedRaster('codeBlock', rest, w, h, () => codeBlockToPng(rest, w, h)),
      'addCodeBlock',
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  addIcon(opts: IconOptions = {} as IconOptions) {
    validateRect(opts, 'addIcon')
    const { x, y, w, h, size, ...rest } = opts
    const side = size ?? Math.min(w, h)
    const finalW = size ?? w
    const finalH = size ?? h
    const rasterPromise = safeRun(
      () =>
        cachedRaster('icon', rest, side, side, () =>
          iconToPng(rest, side, side),
        ),
      'addIcon',
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w: finalW, h: finalH })
      this._ops.push({ kind: 'image', x, y, w: finalW, h: finalH, data: png })
    })
    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   CHART (native, editable PPT object)
  // ─────────────────────────────────────────────────────────────

  addChart(opts: ChartOptions = {} as ChartOptions) {
    validateRect(opts, 'addChart')
    this._enqueue(() => {
      const { chartType, chartData, chartOpts } = prepareEditorialChart(
        this._pres,
        opts,
      )
      this._slide.addChart(chartType, chartData, chartOpts)
      this._ops.push({
        kind: 'chart',
        x: opts.x,
        y: opts.y,
        w: opts.w,
        h: opts.h,
        chartType: opts.type || 'bar',
        data: chartData,
        title: opts.title,
        palette: opts.palette,
      })
    })
    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   DECORATIVE PATTERNS
  // ─────────────────────────────────────────────────────────────

  addDotGrid(opts: DotGridOptions = {} as DotGridOptions) {
    validateRect(opts, 'addDotGrid')
    const { x, y, w, h, ...rest } = opts
    const rasterPromise = safeRun(
      () => cachedRaster('dotGrid', rest, w, h, () => dotGridToPng(rest, w, h)),
      'addDotGrid',
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  addStripes(opts: StripesOptions = {} as StripesOptions) {
    validateRect(opts, 'addStripes')
    const { x, y, w, h, ...rest } = opts
    const rasterPromise = safeRun(
      () => cachedRaster('stripes', rest, w, h, () => stripesToPng(rest, w, h)),
      'addStripes',
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  addWaveDivider(opts: WaveDividerOptions = {} as WaveDividerOptions) {
    validateRect(opts, 'addWaveDivider')
    const { x, y, w, h, ...rest } = opts
    const rasterPromise = safeRun(
      () =>
        cachedRaster('waveDivider', rest, w, h, () =>
          waveDividerToPng(rest, w, h),
        ),
      'addWaveDivider',
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   DATA VIZ RASTER
  // ─────────────────────────────────────────────────────────────

  addProgressRing(opts: ProgressRingOptions = {} as ProgressRingOptions) {
    validateRect(opts, 'addProgressRing')
    const { x, y, w, h, ...rest } = opts
    const rasterPromise = safeRun(
      () =>
        cachedRaster('progressRing', rest, w, h, () =>
          progressRingToPng(rest, w, h),
        ),
      'addProgressRing',
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  addSparkline(opts: SparklineOptions = {} as SparklineOptions) {
    validateRect(opts, 'addSparkline')
    const { x, y, w, h, ...rest } = opts
    const rasterPromise = safeRun(
      () =>
        cachedRaster('sparkline', rest, w, h, () => sparklineToPng(rest, w, h)),
      'addSparkline',
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   NATIVE COMPONENTS (editable)
  // ─────────────────────────────────────────────────────────────

  addBadge(opts: BadgeOptions = {} as BadgeOptions) {
    validateRect(opts, 'addBadge')
    const theme = this.theme
    const {
      text = '',
      x,
      y,
      w = 1.2,
      h = 0.35,
      bg,
      color,
      borderColor = null,
      borderWidth = 0,
      fontSize = 11,
      fontFace,
      bold = true,
      charSpacing = 2,
      radius = null,
    } = opts
    const resolvedBg = pick(bg, theme.primary, '#6366f1')
    const resolvedColor = pick(color, theme.text, '#ffffff')
    const resolvedFont = pick(fontFace, theme.fontBody, 'system-ui, sans-serif')
    const rad = radius ?? h / 2

    this.addRect({
      x,
      y,
      w,
      h,
      fill: resolvedBg,
      radius: rad,
      borderColor,
      borderWidth,
    })
    this._enqueue(() => {
      this._slide.addText(text, {
        x,
        y,
        w,
        h,
        fontFace: resolvedFont,
        fontSize,
        bold,
        color: normalizeHex(resolvedColor),
        align: 'center',
        valign: 'middle',
        charSpacing,
      })
      this._ops.push({
        kind: 'text',
        text,
        opts: {
          x,
          y,
          w,
          h,
          fontFace: resolvedFont,
          fontSize,
          bold,
          color: resolvedColor,
          align: 'center',
          valign: 'middle',
          charSpacing,
        },
      })
    })
    return this
  }

  addProgressBar(opts: ProgressBarOptions = {} as ProgressBarOptions) {
    validateRect(opts, 'addProgressBar')
    const theme = this.theme
    const {
      x,
      y,
      w,
      h = 0.18,
      value = 0.5,
      trackColor,
      fillColor,
      radius = null,
      label = false,
      labelColor,
      labelFontSize = 10,
    } = opts
    const resolvedTrack = pick(trackColor, theme.surface, '#1f2937')
    const resolvedFill = pick(fillColor, theme.primary, '#6366f1')
    const resolvedLabel = pick(labelColor, theme.text, '#ffffff')
    const v = Math.max(0, Math.min(1, value))
    const rad = radius ?? h / 2
    const labelW = label ? 0.55 : 0
    const barW = w - labelW

    this.addRect({ x, y, w: barW, h, fill: resolvedTrack, radius: rad })
    if (v > 0) {
      this.addRect({
        x,
        y,
        w: Math.max(barW * v, h),
        h,
        fill: resolvedFill,
        radius: rad,
      })
    }
    if (label) {
      this._enqueue(() => {
        this._slide.addText(`${Math.round(v * 100)}%`, {
          x: x + barW + 0.05,
          y: y - labelFontSize / 144,
          w: labelW,
          h: h + 0.1,
          fontFace: 'system-ui, sans-serif',
          fontSize: labelFontSize,
          bold: true,
          color: normalizeHex(resolvedLabel),
          align: 'left',
          valign: 'middle',
        })
      })
    }
    return this
  }

  addTimeline(opts: TimelineOptions = {} as TimelineOptions) {
    const theme = this.theme
    const {
      x,
      y,
      w,
      steps = [],
      lineColor,
      lineWidth = 1,
      dotSize = 0.18,
      accentColor,
      labelColor,
      sublabelColor = '#6b7280',
      fontFace,
      fontSize = 12,
      sublabelFontSize = 10,
    } = opts
    if (!steps.length) return this
    const resolvedLine = pick(lineColor, theme.border, '#374151')
    const resolvedAccent = pick(accentColor, theme.primary, '#6366f1')
    const resolvedLabel = pick(labelColor, theme.text, '#0b0b0f')
    const resolvedFont = pick(fontFace, theme.fontBody, 'system-ui, sans-serif')

    const pad = dotSize / 2
    this.addLine({
      x1: x + pad,
      y1: y,
      x2: x + w - pad,
      y2: y,
      color: resolvedLine,
      width: lineWidth,
    })
    const gap = steps.length === 1 ? 0 : (w - dotSize) / (steps.length - 1)
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      const cx = x + i * gap
      const dotColor = s.color || resolvedAccent
      this._enqueue(() => {
        this._slide.addShape(this._pres._pptx.ShapeType.ellipse, {
          x: cx,
          y: y - dotSize / 2,
          w: dotSize,
          h: dotSize,
          fill: { type: 'solid', color: normalizeHex(dotColor) },
          line: { type: 'none' },
        })
        this._slide.addText(s.label || '', {
          x: cx - 1,
          y: y + dotSize / 2 + 0.08,
          w: 2,
          h: 0.3,
          fontFace: resolvedFont,
          fontSize,
          bold: true,
          color: normalizeHex(resolvedLabel),
          align: 'center',
          valign: 'top',
        })
        if (s.sublabel) {
          this._slide.addText(s.sublabel, {
            x: cx - 1,
            y: y + dotSize / 2 + 0.42,
            w: 2,
            h: 0.3,
            fontFace: resolvedFont,
            fontSize: sublabelFontSize,
            color: normalizeHex(sublabelColor),
            align: 'center',
            valign: 'top',
          })
        }
        this._ops.push({
          kind: 'circle',
          cx,
          cy: y,
          r: dotSize / 2,
          fill: dotColor,
        })
        this._ops.push({
          kind: 'text',
          text: s.label || '',
          opts: {
            x: cx - 1,
            y: y + dotSize / 2 + 0.08,
            w: 2,
            h: 0.3,
            fontFace: resolvedFont,
            fontSize,
            bold: true,
            color: resolvedLabel,
            align: 'center',
          },
        })
      })
    }
    return this
  }

  addConnector(opts: ConnectorOptions = {} as ConnectorOptions) {
    const {
      x1,
      y1,
      x2,
      y2,
      color = '#0b0b0f',
      width = 1.5,
      headSize = 0.18,
    } = opts
    validateColor(color, 'addConnector')
    const dx = x2 - x1,
      dy = y2 - y1
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len,
      uy = dy / len
    const lineEndX = x2 - ux * (headSize * 0.8)
    const lineEndY = y2 - uy * (headSize * 0.8)

    this.addLine({ x1, y1, x2: lineEndX, y2: lineEndY, color, width })

    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90
    this._enqueue(() => {
      const ShapeType = this._pres._pptx.ShapeType
      this._slide.addShape(ShapeType.triangle, {
        x: x2 - headSize / 2,
        y: y2 - headSize / 2,
        w: headSize,
        h: headSize,
        fill: { type: 'solid', color: normalizeHex(color) },
        line: { type: 'none' },
        rotate: angleDeg,
      })
      this._ops.push({
        kind: 'arrowhead',
        x: x2,
        y: y2,
        size: headSize,
        angle: angleDeg,
        color,
      })
    })
    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   addTable — native table (editable in PowerPoint)
  // ─────────────────────────────────────────────────────────────

  /**
   * Native editorial table.
   *
   *   s.addTable({
   *     x: 1, y: 1, w: 10,
   *     headers: ['Metric', 'Q1', 'Q2', 'Change'],
   *     rows: [
   *       ['Revenue', '$1.2M', '$1.4M', '+16%'],
   *       ['Users',   '45k',   '52k',   '+15%'],
   *     ],
   *     style: 'editorial' | 'minimal' | 'grid' | 'striped',
   *   })
   *
   * Fine-grained overrides: headerBg, headerColor, rowBg, altRowBg, rowColor,
   *                borderColor, fontFace, fontSize, headerFontSize,
   *                colW (array of widths in inches), rowH
   */
  addTable(opts: PrimitiveOptions = {}) {
    validateRect(opts, 'addTable')
    const theme = this.theme
    const {
      x,
      y,
      w,
      h,
      headers = [],
      rows = [],
      style = 'editorial',
      headerBg,
      headerColor,
      rowBg,
      altRowBg,
      rowColor,
      borderColor,
      borderWidth,
      fontFace,
      fontSize = 12,
      headerFontSize,
      colW,
      rowH,
      align = 'left',
      valign = 'middle',
    } = opts

    // Style presets
    const presets = {
      editorial: {
        headerBg: theme.primary || '#7C3AED',
        headerColor: '#FFFFFF',
        rowBg: 'FFFFFF',
        altRowBg: 'FAFAFA',
        rowColor: theme.text || '#1A1A1A',
        borderColor: theme.border || 'E5E7EB',
        borderWidth: 0.5,
      },
      minimal: {
        headerBg: 'FFFFFF',
        headerColor: theme.text || '#1A1A1A',
        rowBg: 'FFFFFF',
        altRowBg: 'FFFFFF',
        rowColor: theme.textDim || '#52525B',
        borderColor: 'E5E7EB',
        borderWidth: 0,
      },
      grid: {
        headerBg: theme.surface || '#F3F4F6',
        headerColor: theme.text || '#111827',
        rowBg: 'FFFFFF',
        altRowBg: 'FFFFFF',
        rowColor: theme.text || '#111827',
        borderColor: 'D1D5DB',
        borderWidth: 0.75,
      },
      striped: {
        headerBg: theme.primary || '#7C3AED',
        headerColor: '#FFFFFF',
        rowBg: 'FFFFFF',
        altRowBg: 'F9FAFB',
        rowColor: theme.text || '#1A1A1A',
        borderColor: 'FFFFFF',
        borderWidth: 0,
      },
    }
    const preset = presets[style] || presets.editorial

    const resHeaderBg = normalizeHex(pick(headerBg, preset.headerBg, '#7C3AED'))
    const resHeaderColor = normalizeHex(
      pick(headerColor, preset.headerColor, '#FFFFFF'),
    )
    const resRowBg = normalizeHex(pick(rowBg, preset.rowBg, '#FFFFFF'))
    const resAltRowBg = normalizeHex(pick(altRowBg, preset.altRowBg, '#FAFAFA'))
    const resRowColor = normalizeHex(pick(rowColor, preset.rowColor, '#1A1A1A'))
    const resBorderColor = normalizeHex(
      pick(borderColor, preset.borderColor, 'E5E7EB'),
    )
    const resBorderW = pick(borderWidth, preset.borderWidth, 0.5)
    const resFontFace = pick(
      fontFace,
      theme.fontBody,
      'Inter, system-ui, sans-serif',
    )
    const resHeaderFS = pick(headerFontSize, fontSize + 1, 13)

    const border =
      resBorderW > 0
        ? { type: 'solid', pt: resBorderW, color: resBorderColor }
        : { type: 'none' }

    // Build pptxgenjs rows : each cell = { text, options }
    const tableRows = []

    if (headers.length) {
      tableRows.push(
        headers.map((h) => ({
          text: String(h),
          options: {
            bold: true,
            fill: { color: resHeaderBg },
            color: resHeaderColor,
            fontFace: resFontFace,
            fontSize: resHeaderFS,
            align,
            valign,
            border,
          },
        })),
      )
    }

    rows.forEach((row, i) => {
      const bg = i % 2 === 0 ? resRowBg : resAltRowBg
      tableRows.push(
        row.map((cell) => {
          const isObj = cell && typeof cell === 'object' && 'text' in cell
          const cellText = isObj ? cell.text : String(cell ?? '')
          const cellOpts = isObj ? cell.options || {} : {}
          return {
            text: cellText,
            options: {
              fill: { color: bg },
              color: resRowColor,
              fontFace: resFontFace,
              fontSize,
              align,
              valign,
              border,
              ...cellOpts,
            },
          }
        }),
      )
    })

    const tableOpts: any = {
      x,
      y,
      w,
      colW,
      rowH,
      fontFace: resFontFace,
      fontSize,
      border,
      autoPage: false,
    }
    if (h !== undefined) tableOpts.h = h

    this._enqueue(() => {
      this._slide.addTable(tableRows, tableOpts)
      this._ops.push({
        kind: 'table',
        x,
        y,
        w,
        h,
        headers,
        rows,
        headerBg: resHeaderBg,
        headerColor: resHeaderColor,
        rowBg: resRowBg,
        altRowBg: resAltRowBg,
        rowColor: resRowColor,
        borderColor: resBorderColor,
        fontFace: resFontFace,
        fontSize,
      })
    })
    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   addQuote — editorial quotation
  // ─────────────────────────────────────────────────────────────

  /**
   * Block quotation with a decorative quote mark and attribution.
   *
   *   s.addQuote({
   *     x: 2, y: 2, w: 9, h: 3,
   *     text: 'The best way to predict the future is to invent it.',
   *     author: 'Alan Kay',
   *     role: 'Computer Scientist',
   *     style: 'classic' | 'pullquote' | 'minimal',
   *   })
   */
  addQuote(opts: PrimitiveOptions = {}) {
    validateRect(opts, 'addQuote')
    const theme = this.theme
    const {
      x,
      y,
      w,
      h,
      text = '',
      author = '',
      role = '',
      style = 'classic',
      quoteColor,
      textColor,
      authorColor,
      roleColor,
      fontFace,
      authorFontFace,
      fontSize,
    } = opts

    const resQuoteColor = pick(quoteColor, theme.primary, '#7C3AED')
    const resTextColor = pick(textColor, theme.text, '#1A1A1A')
    const resAuthorColor = pick(authorColor, theme.text, '#1A1A1A')
    const resRoleColor = pick(roleColor, theme.textDim, '#6B7280')
    const resFont = pick(fontFace, theme.fontDisplay, 'Georgia, serif')
    const resAuthorFont = pick(
      authorFontFace,
      theme.fontBody,
      'Inter, system-ui, sans-serif',
    )
    const resFontSize = pick(
      fontSize,
      undefined,
      Math.max(18, Math.min(36, (h || 3) * 8)),
    )

    // Layout by style.
    if (style === 'pullquote') {
      this.addRect({
        x,
        y,
        w: 0.08,
        h,
        fill: resQuoteColor,
      })
      const bodyOpts = {
        x: x + 0.3,
        y,
        w: w - 0.3,
        h: h - 0.8,
        fontFace: resFont,
        fontSize: resFontSize,
        italic: true,
        color: normalizeHex(resTextColor),
        align: 'left',
        valign: 'middle',
        lineSpacingMultiple: 1.25,
      }
      this._enqueue(() => {
        const body = `"${text}"`
        this._slide.addText(body, bodyOpts)
        this._ops.push({ kind: 'text', text: body, opts: bodyOpts })
        if (author) {
          const attr = role ? `— ${author}, ${role}` : `— ${author}`
          const attrOpts = {
            x: x + 0.3,
            y: y + h - 0.6,
            w: w - 0.3,
            h: 0.5,
            fontFace: resAuthorFont,
            fontSize: 14,
            bold: true,
            color: normalizeHex(resAuthorColor),
            align: 'left',
            valign: 'top',
          }
          this._slide.addText(attr, attrOpts)
          this._ops.push({ kind: 'text', text: attr, opts: attrOpts })
        }
      })
      return this
    }

    if (style === 'minimal') {
      const bodyOpts = {
        x,
        y,
        w,
        h: h - 0.6,
        fontFace: resFont,
        fontSize: resFontSize,
        italic: true,
        color: normalizeHex(resTextColor),
        align: 'left',
        valign: 'top',
        lineSpacingMultiple: 1.3,
      }
      this._enqueue(() => {
        this._slide.addText(text, bodyOpts)
        this._ops.push({ kind: 'text', text, opts: bodyOpts })
        if (author) {
          const authorOpts = {
            x,
            y: y + h - 0.55,
            w,
            h: 0.3,
            fontFace: resAuthorFont,
            fontSize: 13,
            bold: true,
            color: normalizeHex(resAuthorColor),
            align: 'left',
            valign: 'top',
          }
          this._slide.addText(author, authorOpts)
          this._ops.push({ kind: 'text', text: author, opts: authorOpts })
          if (role) {
            const roleOpts = {
              x,
              y: y + h - 0.25,
              w,
              h: 0.25,
              fontFace: resAuthorFont,
              fontSize: 11,
              color: normalizeHex(resRoleColor),
              align: 'left',
              valign: 'top',
            }
            this._slide.addText(role, roleOpts)
            this._ops.push({ kind: 'text', text: role, opts: roleOpts })
          }
        }
      })
      return this
    }

    // style === 'classic': large decorative quote mark.
    const quoteMarkSize = Math.min(w * 0.3, h * 0.6, 2.5)
    const markOpts = {
      x,
      y: y - quoteMarkSize * 0.15,
      w: quoteMarkSize,
      h: quoteMarkSize,
      fontFace: resFont,
      fontSize: quoteMarkSize * 100,
      bold: true,
      color: normalizeHex(resQuoteColor),
      align: 'left',
      valign: 'top',
    }
    const bodyOpts = {
      x: x + quoteMarkSize * 0.4,
      y: y + 0.2,
      w: w - quoteMarkSize * 0.4,
      h: h - 0.9,
      fontFace: resFont,
      fontSize: resFontSize,
      italic: true,
      color: normalizeHex(resTextColor),
      align: 'left',
      valign: 'middle',
      lineSpacingMultiple: 1.25,
    }
    this._enqueue(() => {
      this._slide.addText('\u201C', markOpts)
      this._ops.push({ kind: 'text', text: '\u201C', opts: markOpts })
      this._slide.addText(text, bodyOpts)
      this._ops.push({ kind: 'text', text, opts: bodyOpts })
      if (author) {
        const authorOpts = {
          x: x + quoteMarkSize * 0.4,
          y: y + h - 0.65,
          w: w - quoteMarkSize * 0.4,
          h: 0.3,
          fontFace: resAuthorFont,
          fontSize: 14,
          bold: true,
          color: normalizeHex(resAuthorColor),
          align: 'left',
          valign: 'top',
        }
        this._slide.addText(author, authorOpts)
        this._ops.push({ kind: 'text', text: author, opts: authorOpts })
        if (role) {
          const roleOpts = {
            x: x + quoteMarkSize * 0.4,
            y: y + h - 0.35,
            w: w - quoteMarkSize * 0.4,
            h: 0.3,
            fontFace: resAuthorFont,
            fontSize: 11,
            color: normalizeHex(resRoleColor),
            align: 'left',
            valign: 'top',
          }
          this._slide.addText(role, roleOpts)
          this._ops.push({ kind: 'text', text: role, opts: roleOpts })
        }
      }
    })
    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   addDivider — section divider
  // ─────────────────────────────────────────────────────────────

  /**
   * Section divider with multiple variants.
   *
   *   s.addDivider({ x: 2, y: 3.75, w: 9, variant: 'line' })
   *   s.addDivider({ x: 2, y: 3.75, w: 9, variant: 'labeled', label: 'Chapter II' })
   *   s.addDivider({ x: 2, y: 3.75, w: 9, variant: 'double' })
   *   s.addDivider({ x: 2, y: 3.75, w: 9, variant: 'dots', count: 5 })
   */
  addDivider(opts: PrimitiveOptions = {}) {
    const theme = this.theme
    const {
      x,
      y,
      w,
      variant = 'line',
      label,
      color,
      thickness = 1,
      labelColor,
      labelBg,
      fontFace,
      fontSize = 11,
      labelPadding = 0.15,
      count = 5,
      gap = 0.05,
    } = opts
    const resColor = pick(color, theme.border, '#6B7280')
    const resLabelColor = pick(labelColor, theme.text, '#1A1A1A')
    const resFont = pick(
      fontFace,
      theme.fontBody,
      'Inter, system-ui, sans-serif',
    )

    if (variant === 'line') {
      this.addLine({
        x1: x,
        y1: y,
        x2: x + w,
        y2: y,
        color: resColor,
        width: thickness,
      })
      return this
    }

    if (variant === 'double') {
      this.addLine({
        x1: x,
        y1: y - 0.04,
        x2: x + w,
        y2: y - 0.04,
        color: resColor,
        width: thickness,
      })
      this.addLine({
        x1: x,
        y1: y + 0.04,
        x2: x + w,
        y2: y + 0.04,
        color: resColor,
        width: thickness,
      })
      return this
    }

    if (variant === 'dots') {
      const size = 0.08
      const totalGap = gap * (count - 1)
      const startX = x + (w - (count * size + totalGap)) / 2
      for (let i = 0; i < count; i++) {
        const cx = startX + i * (size + gap)
        this._enqueue(() => {
          this._slide.addShape(this._pres._pptx.ShapeType.ellipse, {
            x: cx,
            y: y - size / 2,
            w: size,
            h: size,
            fill: { type: 'solid', color: normalizeHex(resColor) },
            line: { type: 'none' },
          })
          this._ops.push({
            kind: 'circle',
            cx: cx + size / 2,
            cy: y,
            r: size / 2,
            fill: resColor,
          })
        })
      }
      return this
    }

    if (variant === 'labeled' && label) {
      // Approximate label-width heuristic.
      const labelW =
        Math.max(0.5, label.length * fontSize * 0.011) + labelPadding * 2
      const labelH = fontSize * 0.025 + 0.2
      const leftEnd = x + (w - labelW) / 2
      const rightStart = leftEnd + labelW
      const cy = y
      // Left line.
      this.addLine({
        x1: x,
        y1: cy,
        x2: leftEnd,
        y2: cy,
        color: resColor,
        width: thickness,
      })
      // Right line.
      this.addLine({
        x1: rightStart,
        y1: cy,
        x2: x + w,
        y2: cy,
        color: resColor,
        width: thickness,
      })
      // Label
      this._enqueue(() => {
        if (labelBg) {
          this._slide.addShape(this._pres._pptx.ShapeType.rect, {
            x: leftEnd,
            y: cy - labelH / 2,
            w: labelW,
            h: labelH,
            fill: { type: 'solid', color: normalizeHex(labelBg) },
            line: { type: 'none' },
          })
        }
        this._slide.addText(label, {
          x: leftEnd,
          y: cy - labelH / 2,
          w: labelW,
          h: labelH,
          fontFace: resFont,
          fontSize,
          bold: true,
          color: normalizeHex(resLabelColor),
          align: 'center',
          valign: 'middle',
          charSpacing: 3,
        })
        this._ops.push({
          kind: 'text',
          text: label,
          opts: {
            x: leftEnd,
            y: cy - labelH / 2,
            w: labelW,
            h: labelH,
            fontFace: resFont,
            fontSize,
            bold: true,
            color: resLabelColor,
            align: 'center',
            valign: 'middle',
          },
        })
      })
      return this
    }

    // Fallback
    this.addLine({
      x1: x,
      y1: y,
      x2: x + w,
      y2: y,
      color: resColor,
      width: thickness,
    })
    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   addAvatar — circle with initials or an image
  // ─────────────────────────────────────────────────────────────

  /**
   * Circular avatar.
   *
   *   s.addAvatar({ x: 1, y: 1, size: 0.8, initials: 'JD', bg: '#7C3AED' })
   *   s.addAvatar({ x: 1, y: 1, size: 0.8, image: 'data:image/...' })
   *
   * Options: size, initials, image, bg, color, fontFace, fontSize,
   *          borderColor, borderWidth, name, role (shown to the right when provided)
   */
  addAvatar(opts: PrimitiveOptions = {}) {
    validateRect(
      { x: opts.x, y: opts.y, w: opts.size, h: opts.size },
      'addAvatar',
    )
    const theme = this.theme
    const {
      x,
      y,
      size = 0.8,
      initials,
      image,
      bg,
      color,
      fontFace,
      fontSize,
      borderColor,
      borderWidth = 0,
      name,
      role,
      nameColor,
      roleColor,
    } = opts

    const resBg = pick(bg, theme.primary, '#7C3AED')
    const resColor = pick(color, theme.text, '#FFFFFF')
    const resFont = pick(
      fontFace,
      theme.fontBody,
      'Inter, system-ui, sans-serif',
    )
    const resNameColor = pick(nameColor, theme.text, '#1A1A1A')
    const resRoleColor = pick(roleColor, theme.textDim, '#6B7280')
    const resFontSize = pick(fontSize, undefined, Math.round(size * 38))

    this._enqueue(() => {
      const ShapeType = this._pres._pptx.ShapeType
      // Background circle.
      const bgOpts = {
        x,
        y,
        w: size,
        h: size,
        fill: { type: 'solid', color: normalizeHex(resBg) },
        line:
          borderWidth > 0 && borderColor
            ? { color: normalizeHex(borderColor), width: borderWidth }
            : { type: 'none' },
      }
      this._slide.addShape(ShapeType.ellipse, bgOpts)
      this._ops.push({
        kind: 'circle',
        cx: x + size / 2,
        cy: y + size / 2,
        r: size / 2,
        fill: resBg,
      })

      if (image) {
        // Circular image through rounding.
        this._slide.addImage({
          data: image.startsWith('data:') ? image : undefined,
          path: image.startsWith('data:') ? undefined : image,
          x,
          y,
          w: size,
          h: size,
          rounding: true,
        })
        this._ops.push({ kind: 'image', x, y, w: size, h: size, data: image })
      } else if (initials) {
        this._slide.addText(initials.toUpperCase(), {
          x,
          y,
          w: size,
          h: size,
          fontFace: resFont,
          fontSize: resFontSize,
          bold: true,
          color: normalizeHex(resColor),
          align: 'center',
          valign: 'middle',
          charSpacing: 1,
        })
        this._ops.push({
          kind: 'text',
          text: initials.toUpperCase(),
          opts: {
            x,
            y,
            w: size,
            h: size,
            fontFace: resFont,
            fontSize: resFontSize,
            bold: true,
            color: resColor,
            align: 'center',
            valign: 'middle',
          },
        })
      }

      // Optional name and role on the right.
      if (name) {
        const textX = x + size + 0.15
        const textW = 3.0
        this._slide.addText(name, {
          x: textX,
          y: y + 0.05,
          w: textW,
          h: size / 2,
          fontFace: resFont,
          fontSize: Math.round(size * 18),
          bold: true,
          color: normalizeHex(resNameColor),
          align: 'left',
          valign: 'middle',
        })
        this._ops.push({
          kind: 'text',
          text: name,
          opts: {
            x: textX,
            y: y + 0.05,
            w: textW,
            h: size / 2,
            fontFace: resFont,
            bold: true,
            color: resNameColor,
            align: 'left',
          },
        })
        if (role) {
          this._slide.addText(role, {
            x: textX,
            y: y + size / 2,
            w: textW,
            h: size / 2 - 0.05,
            fontFace: resFont,
            fontSize: Math.round(size * 14),
            color: normalizeHex(resRoleColor),
            align: 'left',
            valign: 'middle',
          })
          this._ops.push({
            kind: 'text',
            text: role,
            opts: {
              x: textX,
              y: y + size / 2,
              w: textW,
              h: size / 2 - 0.05,
              fontFace: resFont,
              color: resRoleColor,
              align: 'left',
            },
          })
        }
      }
    })
    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   VISUAL PACK (raster)
  // ─────────────────────────────────────────────────────────────

  addHalftone(opts: PrimitiveOptions = {}) {
    return this._rasterImage('halftone', opts, halftoneToPng, 'addHalftone')
  }
  addGridPaper(opts: PrimitiveOptions = {}) {
    return this._rasterImage('gridPaper', opts, gridPaperToPng, 'addGridPaper')
  }
  addCheckerPattern(opts: PrimitiveOptions = {}) {
    return this._rasterImage('checker', opts, checkerToPng, 'addCheckerPattern')
  }
  addRadialBurst(opts: PrimitiveOptions = {}) {
    return this._rasterImage(
      'radialBurst',
      opts,
      radialBurstToPng,
      'addRadialBurst',
    )
  }
  addNoiseTexture(opts: PrimitiveOptions = {}) {
    return this._rasterImage(
      'noiseTexture',
      opts,
      noiseTextureToPng,
      'addNoiseTexture',
    )
  }
  addAuroraGradient(opts: PrimitiveOptions = {}) {
    return this._rasterImage(
      'auroraGradient',
      opts,
      auroraGradientToPng,
      'addAuroraGradient',
    )
  }

  // ─────────────────────────────────────────────────────────────
  //   DATA VIZ PACK (raster)
  // ─────────────────────────────────────────────────────────────

  addBarRace(opts: PrimitiveOptions = {}) {
    return this._rasterImage('barRace', opts, barRaceToPng, 'addBarRace')
  }
  addRadarChart(opts: PrimitiveOptions = {}) {
    return this._rasterImage(
      'radarChart',
      opts,
      radarChartToPng,
      'addRadarChart',
    )
  }
  addHeatmap(opts: PrimitiveOptions = {}) {
    return this._rasterImage('heatmap', opts, heatmapToPng, 'addHeatmap')
  }
  addFunnel(opts: PrimitiveOptions = {}) {
    return this._rasterImage('funnel', opts, funnelToPng, 'addFunnel')
  }

  // ─────────────────────────────────────────────────────────────
  //   ULTRA VISUAL PACK (raster)
  // ─────────────────────────────────────────────────────────────

  addNeonGlow(opts: PrimitiveOptions = {}) {
    return this._rasterImage('neonGlow', opts, neonGlowToPng, 'addNeonGlow')
  }
  addLiquidGradient(opts: PrimitiveOptions = {}) {
    return this._rasterImage(
      'liquidGradient',
      opts,
      liquidGradientToPng,
      'addLiquidGradient',
    )
  }
  addHoloFoil(opts: PrimitiveOptions = {}) {
    return this._rasterImage('holoFoil', opts, holoFoilToPng, 'addHoloFoil')
  }
  addParticleField(opts: PrimitiveOptions = {}) {
    return this._rasterImage(
      'particleField',
      opts,
      particleFieldToPng,
      'addParticleField',
    )
  }
  addCinematicBars(opts: PrimitiveOptions = {}) {
    return this._rasterImage(
      'cinematicBars',
      opts,
      cinematicBarsToPng,
      'addCinematicBars',
    )
  }
  addGlitchBands(opts: PrimitiveOptions = {}) {
    return this._rasterImage(
      'glitchBands',
      opts,
      glitchBandsToPng,
      'addGlitchBands',
    )
  }
  addDuotone(opts: PrimitiveOptions = {}) {
    return this._rasterImage('duotone', opts, duotoneToPng, 'addDuotone')
  }
  addGradientMesh(opts: PrimitiveOptions = {}) {
    return this._rasterImage(
      'gradientMesh',
      opts,
      gradientMeshToPng,
      'addGradientMesh',
    )
  }

  // ─────────────────────────────────────────────────────────────
  //   ADVANCED CHARTS PACK (raster)
  // ─────────────────────────────────────────────────────────────

  addSankeyDiagram(opts: PrimitiveOptions = {}) {
    return this._rasterImage('sankey', opts, sankeyToPng, 'addSankeyDiagram')
  }
  addTreemap(opts: PrimitiveOptions = {}) {
    return this._rasterImage('treemap', opts, treemapToPng, 'addTreemap')
  }
  addBubbleChart(opts: PrimitiveOptions = {}) {
    return this._rasterImage(
      'bubbleChart',
      opts,
      bubbleChartToPng,
      'addBubbleChart',
    )
  }
  addGanttChart(opts: PrimitiveOptions = {}) {
    return this._rasterImage('gantt', opts, ganttChartToPng, 'addGanttChart')
  }
  addOrgChart(opts: PrimitiveOptions = {}) {
    return this._rasterImage('orgChart', opts, orgChartToPng, 'addOrgChart')
  }
  addWaterfallChart(opts: PrimitiveOptions = {}) {
    return this._rasterImage(
      'waterfall',
      opts,
      waterfallChartToPng,
      'addWaterfallChart',
    )
  }
  addCalendarHeatmap(opts: PrimitiveOptions = {}) {
    return this._rasterImage(
      'calendarHeatmap',
      opts,
      calendarHeatmapToPng,
      'addCalendarHeatmap',
    )
  }

  /** Internal helper that places a raster PNG at (x, y, w, h). */
  /** @internal */
  _rasterImage(
    cacheKey: string,
    opts: PrimitiveOptions,
    toPng: (
      options: PrimitiveOptions,
      width: number,
      height: number,
    ) => Promise<string>,
    label: string,
  ) {
    validateRect(opts, label)
    const { x, y, w, h, ...rest } = opts
    const rasterPromise = safeRun(
      () => cachedRaster(cacheKey, rest, w, h, () => toPng(rest, w, h)),
      label,
    )
    this._enqueueAsync(rasterPromise, async () => {
      const png = await rasterPromise
      if (!png) return
      this._slide.addImage({ data: png, x, y, w, h })
      this._ops.push({ kind: 'image', x, y, w, h, data: png })
    })
    return this
  }

  // ─────────────────────────────────────────────────────────────
  //   LAYOUT PACK (native composites, editable in PowerPoint)
  // ─────────────────────────────────────────────────────────────

  addStatCard(opts: StatCardOptions = {}) {
    layoutPack.addStatCard(this, opts)
    return this
  }

  addKPIGrid(opts: KpiGridOptions = {}) {
    layoutPack.addKpiGrid(this, opts)
    return this
  }

  addCallout(opts: CalloutOptions = {}) {
    layoutPack.addCallout(this, opts)
    return this
  }

  addFeatureCard(opts: FeatureCardOptions = {}) {
    layoutPack.addFeatureCard(this, opts)
    return this
  }

  addStepFlow(opts: StepFlowOptions = {}) {
    layoutPack.addStepFlow(this, opts)
    return this
  }

  addComparisonTable(opts: ComparisonTableOptions = {}) {
    layoutPack.addComparisonTable(this, opts)
    return this
  }

  addLogoCloud(opts: LogoCloudOptions = {}) {
    layoutPack.addLogoCloud(this, opts)
    return this
  }

  addTeamCard(opts: TeamCardOptions = {}) {
    layoutPack.addTeamCard(this, opts)
    return this
  }
}
