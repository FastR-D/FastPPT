import { textCapitalizationCompatibility } from '../primitives/text-capitalization.mjs'
import { textKerningCompatibility } from '../primitives/text-kerning.mjs'
import { textBaselineCompatibility } from '../primitives/text-baseline.mjs'
import { nextNumberingMarker } from '../primitives/text-numbering.mjs'
import { textBulletCompatibility } from '../primitives/text-bullet.js'
import { textLetterSpacingCompatibility } from '../primitives/text-letter-spacing.mjs'
import { decimalTabCompatibility } from '../primitives/text-tabs.mjs'
import { validateTextTabLayout } from '../primitives/text-tab-layout.js'
import type { Fill, Layout, Shadow, Size } from '../types.js'
import { cssFontFamilies } from './font-family.js'
import { fontScript } from '../fonts/font-script.js'
import type { CapturedNativeParagraph } from '../server/text-paragraphs.js'
import {
  NodePresentation,
  type PresentationTableCell,
  type NodePresentationSlide,
} from '../server/presentation.js'
import {
  gradientSvgDataUrl,
  preciseRoundedRectSvgDataUrl,
} from './render-svg.js'
import type {
  HtmlDeckRenderOptions,
  HtmlRenderOptions,
  HtmlRenderResult,
} from './render-types.js'
import {
  HTML_SNAPSHOT_VERSIONS,
  type HtmlTableElement,
  type HtmlObjectRenderReport,
  type HtmlBox,
  type HtmlColor,
  type HtmlConversionWarning,
  type HtmlDeckSnapshot,
  type HtmlImageElement,
  type HtmlLineElement,
  type HtmlShapeElement,
  type HtmlSlideElement,
  type HtmlSlideSnapshot,
  type HtmlTextElement,
  type HtmlTextStyle,
} from '../snapshot-types.js'
import { HtmlDeckSnapshotSchema, HtmlTableElementSchema } from '../snapshot.js'

const GENERIC_FONTS: Record<string, string> = {
  'sans-serif': 'Arial',
  serif: 'Times New Roman',
  monospace: 'Consolas',
  cursive: 'Comic Sans MS',
  fantasy: 'Impact',
  'system-ui': 'Arial',
  'ui-monospace': 'JetBrains Mono NL',
}

const BUILTIN_FONT_MAP: Record<string, string> = {
  arial: 'Arial',
  consolas: 'Consolas',
  'courier new': 'Courier New',
  'fira code': 'Fira Code',
  'helvetica neue': 'Arial',
  inter: 'Inter',
  'microsoft yahei': 'Microsoft YaHei',
  'noto sans cjk sc': 'Noto Sans CJK SC',
  'noto sans mono cjk sc': 'Noto Sans Mono CJK SC',
  'source han sans': 'Source Han Sans SC',
  'source han sans sc': 'Source Han Sans SC',
  'times new roman': 'Times New Roman',
  'ui-monospace': 'JetBrains Mono NL',
}

interface RenderMetrics {
  xScale: number
  yScale: number
  pointScale: number
  precision: number
}

export interface HtmlDeckRenderResult extends HtmlRenderResult {
  presentation: NodePresentation
}

/** Renders one captured HTML canvas into native, editable PowerPoint objects. */
export function renderHtmlSlide(
  snapshot: HtmlSlideSnapshot,
  slide: NodePresentationSlide,
  options: HtmlRenderOptions = {},
): HtmlRenderResult {
  assertSlideSnapshot(snapshot)

  const target = slide['_pres'].size()
  const metrics: RenderMetrics = {
    xScale: target.width / snapshot.width,
    yScale: target.height / snapshot.height,
    pointScale:
      Math.sqrt(
        (target.width / snapshot.width) * (target.height / snapshot.height),
      ) * 72,
    precision: options.precision ?? 5,
  }
  const warnings = [...snapshot.warnings]
  const elements = [...snapshot.elements].sort(
    (left, right) => left.zIndex - right.zIndex || left.order - right.order,
  )
  let renderedElementCount = 0
  const objects: HtmlObjectRenderReport[] = []

  for (const element of elements) {
    const operationStart = slide._ops.length
    const textFrameStart = slide._textFrames.length
    let failure: string | undefined
    try {
      const diagram = options.diagramReplacements?.get(element.id)
      if (diagram) {
        slide.addDiagram(diagram, {
          x: element.box.x * metrics.xScale,
          y: element.box.y * metrics.yScale,
          width: element.box.width * metrics.xScale,
          height: element.box.height * metrics.yScale,
        })
      } else if (element === elements[0] && element.kind === 'shape' && element.source.role === 'slide-background'
        && !element.source.anchor && !element.source.pseudo && element.shape === 'rect'
        && element.fill?.alpha === 1 && element.opacity === 1 && !element.gradient
        && !element.stroke && !element.shadow && !element.rotation && !element.radiusPx
        && Math.abs(element.box.x) < 0.01 && Math.abs(element.box.y) < 0.01
        && Math.abs(element.box.width - snapshot.width) < 0.01 && Math.abs(element.box.height - snapshot.height) < 0.01) {
        slide.setBackground(element.fill.hex)
      } else renderElement(slide, element, metrics, options, warnings)
      renderedElementCount += 1
    } catch (cause) {
      failure = errorMessage(cause)
      warnings.push({
        code: 'invalid-snapshot',
        message: `Slide ${snapshot.id} element could not be rendered: ${errorMessage(cause)}`,
        elementId: element.id,
      })
    }
    const operations = slide._ops.slice(operationStart)
    const images = operations.filter((operation) => operation.kind === 'image')
    const imageCount = images.length
    const imageKinds = { vector: 0, raster: 0, unknown: 0 }
    for (const image of images) {
      // Embedded MIME takes precedence over the source filename, which may describe a pre-rasterized asset.
      const mime = image.data?.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase()
      const extension = typeof image.path === 'string' ? image.path.split(/[?#]/)[0]?.split('.').at(-1)?.toLowerCase() : undefined
      if (mime === 'image/svg+xml' || (!image.data && extension === 'svg')) imageKinds.vector += 1
      else if ((mime && /^image\/(png|jpeg|jpg|gif|webp|bmp|tiff)$/.test(mime)) || (!image.data && extension && /^(png|jpeg|jpg|gif|webp|bmp|tiff)$/.test(extension))) imageKinds.raster += 1
      else imageKinds.unknown += 1
    }
    const nativeCount = operations.length - imageCount
    const styles = element.kind === 'table' ? element.cells.flatMap(cell => [cell.style, ...cell.runs.map(run => run.style)]) : element.kind === 'text' ? [element.style, ...(element.paragraphs?.flatMap(paragraph => [paragraph.style, ...paragraph.runs.map(run => run.style)]) ?? [])] : []
    const requestedFonts = [...new Set(styles.flatMap(style => [...cssFontFamilies(style.fontFamily), ...Object.values(style.fontFamilies ?? {}).filter((face): face is string => !!face)]))]
    if (element.kind === 'text') for (const paragraph of element.paragraphs ?? []) if ((paragraph.bullet?.kind === 'character' || paragraph.bullet?.kind === 'auto-number') && paragraph.bulletFont?.kind === 'font' && !requestedFonts.includes(paragraph.bulletFont.fontFamily)) requestedFonts.push(paragraph.bulletFont.fontFamily)
    const emittedFonts = [...new Set(operations.flatMap((operation) => operation.kind === 'text'
      ? [operation.opts.fontFace, ...(operation.runs ?? []).map((run) => run.options?.fontFace)].filter((face): face is string => typeof face === 'string' && face.length > 0)
      : operation.kind === 'table' ? operation.rows.flatMap(row => row.flatMap(cell => [cell.options.fontFace, ...cell.text.map(run => run.options?.fontFace)].filter((face): face is string => typeof face === 'string' && !!face))) : []))]
    for (const frame of slide._textFrames.slice(textFrameStart)) for (const value of frame.paragraphs) {
      const paragraph = value.style.paragraph
      if ((paragraph?.bullet?.kind === 'character' || paragraph?.bullet?.kind === 'auto-number') && paragraph.bulletFont?.kind === 'font' && !emittedFonts.includes(paragraph.bulletFont.fontFamily)) emittedFonts.push(paragraph.bulletFont.fontFamily)
    }
    const fonts = styles.length ? {
      requested: requestedFonts,
      emitted: emittedFonts,
      substituted: emittedFonts.some((face) => !requestedFonts.some((requested) => requested.toLowerCase() === face.toLowerCase())),
    } : undefined
    objects.push({
      slideId: snapshot.id,
      elementId: element.id,
      source: element.source,
      kind: element.kind,
      nativeCount,
      imageCount,
      imageKinds,
      ...(fonts ? { fonts } : {}),
      ...(element.kind === 'text' && textRenderBox(element) !== element.box ? {
        layoutRepair: { source: element.box, proposed: textRenderBox(element), applied: options.textGeometry === 'expand-measured' },
      } : {}),
      status: failure || operations.length === 0 ? 'missing' : imageCount ? (nativeCount ? 'mixed' : 'image') : 'native',
      editableRequired: options.diagramReplacements?.has(element.id) || element.kind !== 'image' || !!element.structure,
      ...(element.kind === 'table' || element.structure ? {
        semanticKind: 'table' as const,
        requiredRepresentation: 'native-table' as const,
        representation: element.kind === 'table' && operations.some(op => op.kind === 'table') ? 'native-table' as const : imageCount ? 'image' as const : 'native-shapes' as const,
        semanticPreserved: element.kind === 'table' && !element.structure && !failure && operations.some(op => op.kind === 'table'),
        structureOwnerId: element.structure?.ownerId ?? element.id,
        ...(element.kind === 'table' ? { childIds: element.cells.map(cell => cell.id), pptxObjectName: tableObjectName(element) } : {}),
        verification: { structure: 'unverified' as const, visual: 'unverified' as const, application: 'unverified' as const },
      } : {}),
      reasons: element.structure ? ['Table structure was replaced by fragments; native cell and row editing is unavailable.'] : failure ? [failure] : imageCount && element.kind !== 'image' ? ['Source geometry was emitted as an image.'] : warnings.filter(warning => warning.elementId === element.id && ['numbering-compatibility', 'text-tab-compatibility', 'text-bullet-compatibility', 'text-letter-spacing-compatibility', 'text-baseline-compatibility', 'text-kerning-compatibility', 'text-capitalization-compatibility'].includes(warning.code)).map(warning => warning.message),
    })
  }

  for (const [index, warning] of snapshot.warnings.entries()) {
    if (!['image-embed-failed', 'unsupported-media', 'invalid-snapshot', 'unsupported-table'].includes(warning.code)) continue
    if (warning.code === 'unsupported-table' && objects.some(object => object.structureOwnerId === warning.elementId)) continue
    const related = objects.filter((object) => object.elementId === warning.elementId || object.source.path === warning.elementId)
    if (related.some((object) => object.status === 'missing')) continue
    // A failed embed can still resolve to a usable local image path.
    if (warning.code === 'image-embed-failed' && related.some((object) => object.kind === 'image' && object.status !== 'missing')) continue
    objects.push({
      slideId: snapshot.id,
      elementId: `capture-failure:${index}:${warning.elementId ?? 'unknown'}`,
      source: { tag: 'capture-failure', path: warning.elementId ?? 'unknown' },
      kind: 'image', nativeCount: 0, imageCount: 0,
      imageKinds: { vector: 0, raster: 0, unknown: 0 },
      status: 'missing', editableRequired: true, reasons: [warning.message],
    })
  }
  return { warnings, objects, elementCount: renderedElementCount }
}

/** Creates a presentation from a serializable deck snapshot. */
export function htmlDeckToPresentation(
  snapshot: HtmlDeckSnapshot,
  options: HtmlDeckRenderOptions = {},
): HtmlDeckRenderResult {
  assertDeckSnapshot(snapshot)
  if (snapshot.version === 2) HtmlDeckSnapshotSchema.parse(snapshot)
  const first = snapshot.slides[0]
  if (first && !options.layout) {
    const ratio = first.width / first.height
    if (snapshot.slides.some((slide) => Math.abs(slide.width / slide.height - ratio) > 0.00001))
      throw new Error('Mixed slide aspect ratios require an explicit target layout; implicit stretching is disabled.')
  }
  const themeFont = snapshot.slides.flatMap((slide) => slide.elements).find((element): element is HtmlTextElement => element.kind === 'text')?.style.fontFamily.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '')
  const selectedThemeFont = options.themeFont ?? themeFont
  const presentation = new NodePresentation({
    layout: options.layout ?? inferLayout(snapshot.slides[0]),
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.author === undefined ? {} : { author: options.author }),
    ...(options.master ? { master: true } : {}),
    ...(selectedThemeFont ? { themeFont: selectedThemeFont } : {}),
  })
  const warnings: HtmlConversionWarning[] = []
  let elementCount = 0
  const objects: HtmlObjectRenderReport[] = []

  for (const htmlSlide of snapshot.slides) {
    const slide = presentation.addSlide()
    const note = options.notes?.[presentation._slides.length - 1]
    if (note) slide.addNotes(note)
    const replacements = options.slideDiagramReplacements?.get(htmlSlide.id)
    const result = renderHtmlSlide(htmlSlide, slide, { ...options, ...(replacements ? { diagramReplacements: replacements } : {}) })
    warnings.push(...result.warnings)
    objects.push(...result.objects)
    elementCount += result.elementCount
  }

  warnings.push(...snapshot.warnings)
  return {
    presentation,
    warnings: uniqueWarnings(warnings),
    objects,
    elementCount,
  }
}

function renderElement(
  slide: NodePresentationSlide,
  element: HtmlSlideElement,
  metrics: RenderMetrics,
  options: HtmlRenderOptions,
  warnings: HtmlConversionWarning[],
): void {
  if (element.kind === 'shape') {
    renderShape(slide, element, metrics)
  } else if (element.kind === 'line') {
    renderLine(slide, element, metrics)
  } else if (element.kind === 'text') {
    renderText(slide, element, metrics, options, warnings)
  } else if (element.kind === 'table') {
    renderTable(slide, element, metrics, options)
  } else {
    renderImage(slide, element, metrics)
  }
}

function tableObjectName(element: HtmlTableElement): string {
  return `fastppt:${element.source.anchor ?? `table:${element.id}`}`
}

function renderTable(slide: NodePresentationSlide, element: HtmlTableElement, metrics: RenderMetrics, options: HtmlRenderOptions): void {
  HtmlTableElementSchema.parse(element)
  const box = scaleBox(element.box, metrics)
  const canvas = slide._pres.size()
  if (box.x < -0.01 || box.y < -0.01 || box.x + box.width > canvas.width + 0.01 || box.y + box.height > canvas.height + 0.01) throw new Error('Native table exceeds the source slide; automatic pagination is disabled.')
  const pt = (value: number) => round(value * metrics.pointScale, metrics)
  const textOptions = (style: HtmlTextStyle): Record<string, unknown> => ({
    fontFace: resolveFont(style.fontFamily, options) ?? 'Arial', fontSize: pt(style.fontSizePx),
    bold: style.fontWeight >= 600, italic: style.fontStyle === 'italic',
    color: style.color.hex, transparency: transparency(style.color),
    underline: style.decoration.includes('underline'), strike: style.decoration.includes('line-through'),
    charSpacing: pt(style.letterSpacingPx), lineSpacing: pt(style.lineHeightPx),
    lang: style.language, altLang: style.alternativeLanguage,
    capitalization: style.capitalization, baselinePercent: style.baselinePercent,
    kerningThreshold: style.kerningThresholdPx === undefined ? undefined : pt(style.kerningThresholdPx),
    rtlMode: style.direction === 'rtl', breakLine: false,
  })
  const rows: PresentationTableCell[][] = element.rowHeightsPx.map(() => [])
  for (const cell of element.cells) {
    const runs = cell.runs.flatMap(run => {
      const segmented = textRuns(run.text, run.style.fontFamily, options, run.style.fontFamilies)
      return (typeof segmented === 'string' ? [{ text: segmented }] : segmented).map(segment => ({ text: segment.text, options: { ...textOptions(run.style), ...('options' in segment ? segment.options : {}), ...(run.hyperlink ? { hyperlink: { url: run.hyperlink } } : {}) } }))
    })
    rows[cell.row]![cell.column] = {
      text: runs.length ? runs : [{ text: '', options: textOptions(cell.style) }],
      options: {
        ...textOptions(cell.style), align: cell.style.align, valign: cell.verticalAlign,
        fill: cell.fill ? colorFill(cell.fill) : { type: 'solid', color: 'FFFFFF', transparency: 100 },
        border: cell.borders.map(border => ({ color: border.color.hex, pt: pt(border.widthPx), type: border.widthPx === 0 || border.color.alpha === 0 ? 'none' : 'solid' })),
        // Writer has a legacy >=1 switch for cell margins; exact geometry is restored after serialization.
        margin: [cell.insetsPx.top, cell.insetsPx.right, cell.insetsPx.bottom, cell.insetsPx.left].map(pt),
      },
    }
  }
  let headerRows = 0
  while (headerRows < rows.length && element.cells.filter(cell => cell.row === headerRows).every(cell => cell.header)) headerRows++
  slide.addTable(rows, {
    x: box.x, y: box.y, w: box.width, h: box.height,
    colW: element.columnWidthsPx.map(value => x(value, metrics)), rowH: element.rowHeightsPx.map(value => y(value, metrics)),
    autoPage: false, margin: 0, border: { type: 'none' },
    objectName: tableObjectName(element),
    // Private data stays in operation records, never in the transport contract.
    insets: element.cells.map(cell => ({ row: cell.row, column: cell.column, values: [cell.insetsPx.left, cell.insetsPx.right, cell.insetsPx.top, cell.insetsPx.bottom].map(value => Math.round(value * metrics.pointScale * 12700)) })),
  }, headerRows)
}

function renderShape(
  slide: NodePresentationSlide,
  element: HtmlShapeElement,
  metrics: RenderMetrics,
): void {
  const box = scaleBox(element.box, metrics)
  const type = element.shape === 'roundRect' ? 'roundRect' : element.shape
  const line = element.stroke
    ? {
        color: element.stroke.color.hex,
        transparency: transparency(element.stroke.color),
        width: round(
          Math.max(0.1, element.stroke.widthPx * metrics.pointScale),
          metrics,
        ),
        dashType:
          element.stroke.dash === 'dot' ? 'sysDot' : element.stroke.dash,
      }
    : { type: 'none' }
  const common = {
    x: box.x,
    y: box.y,
    w: box.width,
    h: box.height,
    ...(element.rotation === undefined ? {} : { rotate: element.rotation }),
    ...pptxObjectName(element),
  }

  if (element.shape === 'freeform') {
    if (!element.geometry) throw new Error('Native freeform is missing geometry')
    slide.addFreeform(element.geometry, { ...common, fill: colorFill(element.fill), line, shadow: shapeShadow(element, metrics) })
    return
  }

  if (element.preciseRadius && element.shape === 'roundRect') {
    if (element.shadow) {
      slide.addShape(type, {
        ...common,
        fill: colorFill(
          element.fill ??
            element.gradient?.stops[0]?.color ?? { hex: 'FFFFFF', alpha: 0.01 },
        ),
        line: { type: 'none' },
        shadow: shapeShadow(element, metrics),
      })
    }
    slide.addImage({
      data: preciseRoundedRectSvgDataUrl(element),
      ...common,
    })
    return
  }

  if (!element.gradient) {
    slide.addShape(type, {
      ...common,
      fill: colorFill(element.fill),
      line,
      shadow: shapeShadow(element, metrics),
    })
    return
  }

  if (element.shadow) {
    slide.addShape(type, {
      ...common,
      fill: colorFill(element.fill ?? element.gradient.stops[0]?.color),
      line: { type: 'none' },
      shadow: shapeShadow(element, metrics),
    })
  }
  slide.addImage({
    data: gradientSvgDataUrl(element),
    ...common,
  })
  if (element.stroke) {
    slide.addShape(type, {
      ...common,
      fill: { type: 'none' },
      line,
    })
  }
}

function renderLine(
  slide: NodePresentationSlide,
  element: HtmlLineElement,
  metrics: RenderMetrics,
): void {
  slide.addLine({
    x1: x(element.box.x, metrics),
    y1: y(element.box.y, metrics),
    x2: x(element.x2, metrics),
    y2: y(element.y2, metrics),
    color: element.color.hex,
    transparency: transparency(element.color),
    width: round(Math.max(0.1, element.widthPx * metrics.pointScale), metrics),
    ...(element.dash === undefined ? {} : { dash: element.dash }),
  })
}

function renderText(
  slide: NodePresentationSlide,
  element: HtmlTextElement,
  metrics: RenderMetrics,
  options: HtmlRenderOptions,
  warnings: HtmlConversionWarning[],
): void {
  if ([element.style, ...element.paragraphs?.flatMap(paragraph => [paragraph.style, ...paragraph.runs.map(run => run.style)]) ?? []].some(style => style.capitalization !== undefined && style.capitalization !== 'none')) warnings.push({ code: 'text-capitalization-compatibility', elementId: element.id, message: textCapitalizationCompatibility })
  if (element.style.kerningThresholdPx !== undefined || element.paragraphs?.some(paragraph => paragraph.style.kerningThresholdPx !== undefined || paragraph.runs.some(run => run.style.kerningThresholdPx !== undefined))) warnings.push({ code: 'text-kerning-compatibility', elementId: element.id, message: textKerningCompatibility })
  if (element.style.baselinePercent || element.paragraphs?.some(paragraph => paragraph.style.baselinePercent || paragraph.runs.some(run => run.style.baselinePercent))) warnings.push({ code: 'text-baseline-compatibility', elementId: element.id, message: textBaselineCompatibility })
  if (element.style.letterSpacingPx || element.paragraphs?.some(paragraph => paragraph.style.letterSpacingPx || paragraph.runs.some(run => run.style.letterSpacingPx))) warnings.push({ code: 'text-letter-spacing-compatibility', elementId: element.id, message: textLetterSpacingCompatibility })
  if (element.paragraphs) {
    renderTextFrame(slide, element, metrics, options, warnings)
    return
  }
  const box = scaleBox(options.textGeometry === 'expand-measured' ? textRenderBox(element) : element.box, metrics)
  const resolvedFontFace = resolveFont(element.style.fontFamily, options)
  const usesMiSansSemibold =
    !element.style.fontFamilies &&
    resolvedFontFace === 'MiSans' &&
    element.style.fontWeight >= 550 &&
    element.style.fontWeight < 650
  const fontFace = usesMiSansSemibold
    ? 'MiSans Semibold'
    : resolvedFontFace
  if (!fontFace) {
    warnings.push({
      code: 'unresolved-font',
      message: `Font "${element.style.fontFamily}" could not be resolved`,
      elementId: element.id,
    })
  }
  const fontSize = Math.max(
    options.minFontSize ?? 1,
    element.style.fontSizePx * metrics.pointScale,
  )

  slide.addText(textRuns(element.text, element.style.fontFamily, options, element.style.fontFamilies), {
    x: box.x,
    y: box.y,
    w: Math.max(0.01, box.width),
    h: Math.max(0.01, box.height),
    fontFace: fontFace || options.fallbackFont || 'Arial',
    fontSize: round(fontSize, metrics),
    color: element.style.color.hex,
    transparency: transparency(element.style.color),
    bold: !usesMiSansSemibold && element.style.fontWeight >= 600,
    italic: element.style.fontStyle === 'italic',
    underline: element.style.decoration.includes('underline'),
    strike: element.style.decoration.includes('line-through'),
    align: element.style.align,
    valign:
      element.verticalAlign ??
      (element.box.height > element.style.lineHeightPx * 1.25
        ? 'middle'
        : 'top'),
    capitalization: element.style.capitalization,
    baselinePercent: element.style.baselinePercent,
    kerningThreshold: element.style.kerningThresholdPx === undefined ? undefined : element.style.kerningThresholdPx * metrics.pointScale,
    charSpacing: round(
      element.style.letterSpacingPx * metrics.pointScale,
      metrics,
    ),
    lineSpacing: round(
      element.style.lineHeightPx * metrics.pointScale,
      metrics,
    ),
    margin: 0,
    fit: 'none',
    wrap: false,
    breakLine: false,
    ...(element.paragraphLevel === undefined ? {} : { indentLevel: element.paragraphLevel - 1 }),
    rotate: element.rotation,
    rtlMode: element.style.direction === 'rtl',
    lang: element.style.language,
    altLang: element.style.alternativeLanguage,
    hyperlink: element.hyperlink ? { url: element.hyperlink } : undefined,
    isTextBox: true,
    ...pptxObjectName(element),
  })
}

function renderTextFrame(slide: NodePresentationSlide, element: HtmlTextElement, metrics: RenderMetrics, options: HtmlRenderOptions, warnings: HtmlConversionWarning[]): void {
  const paragraphs = element.paragraphs!
  if (!paragraphs.length || paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n') !== element.text) throw new Error('Text frame content does not match its paragraphs.')
  const box = scaleBox(element.box, metrics)
  const pt = (value: number) => round(value * metrics.pointScale, metrics)
  const fontSize = (style: HtmlTextStyle) => Math.max(options.minFontSize ?? 1, pt(style.fontSizePx))
  const face = (style: HtmlTextStyle) => resolveFont(style.fontFamily, options) || options.fallbackFont || 'Arial'
  const runs: Array<{ text: string; options: Record<string, unknown> }> = []
  const native: CapturedNativeParagraph[] = []
  const numbering = new Map<number, { scheme: string; seed: number; next: number }>()
  for (const paragraph of paragraphs) {
    if (paragraph.tabLayout) validateTextTabLayout(paragraph.tabLayout, paragraph.runs.map(run => run.text).join(''))
    if (!['ltr', 'rtl'].includes(paragraph.style.direction)) throw new Error('Unsupported native text frame paragraph direction.')
    if (paragraph.style.direction === 'rtl' && (paragraph.tabLayout || paragraph.runs.some(run => run.text.includes('\t')) || (paragraph.bullet && paragraph.bullet.kind !== 'none'))) throw new Error('RTL text frames with bullets or tabs are not supported.')
    const marker = nextNumberingMarker(numbering, { level: paragraph.level, bullet: paragraph.bullet, visible: paragraph.runs.some(run => !!run.text.trim()), restartAt: paragraph.numberingRestart })
    if (marker.review) warnings.push({ code: 'numbering-compatibility', elementId: element.id, message: `Paragraph ${native.length + 1}: numbering start/restart is preserved in buAutoNum; Empty paragraphs and repeated starts may be ignored; LibreOffice may continue at startAt=1. Verify numbering in the target application.` })
    if (marker.label) warnings.push({ code: 'text-bullet-compatibility', elementId: element.id, message: `Paragraph ${native.length + 1}: ${textBulletCompatibility}` })
    if (paragraph.runs.some(run => run.text.includes('\t'))) {
      if (paragraph.defaultTabSizePx === undefined) throw new Error('Text frame tabs require a measured paragraph tab contract.')
      warnings.push({ code: 'text-tab-compatibility', elementId: element.id, message: `Paragraph ${native.length + 1}: native tab stops and characters are preserved. LibreOffice 7.3.7.2 can reset stops when an indent is specified and ignore custom default spacing or an empty stop list; verify in the target application.` })
      if (paragraph.tabStopsPx?.some(stop => stop.align === 'decimal')) warnings.push({ code: 'text-tab-compatibility', elementId: element.id, message: `Paragraph ${native.length + 1}: ${decimalTabCompatibility(paragraph.decimalTab)}` })
      if (paragraph.tabLayout?.lines.some(line => line.breakBefore === 'automatic')) warnings.push({ code: 'text-tab-compatibility', elementId: element.id, message: `Paragraph ${native.length + 1}: automatic tab lines are browser measurements; native text retains the original characters and soft breaks. Font metrics and target application wrapping can change these lines. Verify the actual exported file.` })
    }
    native.push({
      level: paragraph.level,
      softBreakStyles: paragraph.runs.flatMap(run => Array.from({ length: run.text.split('\n').length - 1 }, () => ({ capitalization: run.style.capitalization, fontSize: fontSize(run.style), kerningThreshold: run.style.kerningThresholdPx === undefined ? undefined : pt(run.style.kerningThresholdPx), underline: run.style.decoration.includes('underline'), strike: run.style.decoration.includes('line-through'), letterSpacing: pt(run.style.letterSpacingPx), baselinePercent: run.style.baselinePercent ?? 0 }))),
      style: {
        capitalization: paragraph.style.capitalization,
        language: paragraph.style.language, alternativeLanguage: paragraph.style.alternativeLanguage,
        fontFamily: face(paragraph.style), fontSize: fontSize(paragraph.style), color: paragraph.style.color.hex, letterSpacing: pt(paragraph.style.letterSpacingPx), baselinePercent: paragraph.style.baselinePercent ?? 0, kerningThreshold: paragraph.style.kerningThresholdPx === undefined ? undefined : pt(paragraph.style.kerningThresholdPx),
        bold: paragraph.style.fontWeight >= 600, italic: paragraph.style.fontStyle === 'italic',
        underline: paragraph.style.decoration.includes('underline'), strike: paragraph.style.decoration.includes('line-through'),
        paragraph: {
          direction: paragraph.style.direction,
          ...(paragraph.decimalTab === undefined ? {} : { decimalTab: paragraph.decimalTab }),
          ...(paragraph.defaultTabSizePx === undefined ? {} : { defaultTabSize: Math.round(paragraph.defaultTabSizePx * metrics.xScale * 914400) }),
          ...(paragraph.tabStopsPx === undefined ? {} : { tabStops: paragraph.tabStopsPx.map(stop => ({ ...stop, position: Math.round(stop.position * metrics.xScale * 914400) })) }),
          ...(marker.bullet ? { bullet: marker.bullet } : {}),
          ...(paragraph.bulletFont ? { bulletFont: paragraph.bulletFont.kind === 'font' ? { kind: 'font', fontFamily: resolveFont(JSON.stringify(paragraph.bulletFont.fontFamily), options) || options.fallbackFont || paragraph.bulletFont.fontFamily } : paragraph.bulletFont } : {}),
          ...(paragraph.bulletColor ? { bulletColor: paragraph.bulletColor } : {}),
          ...(paragraph.bulletSize ? { bulletSize: paragraph.bulletSize.kind === 'pixels' ? { kind: 'points', value: pt(paragraph.bulletSize.value) } : paragraph.bulletSize } : {}),
          align: paragraph.style.align,
          marginLeft: Math.round(paragraph.marginLeftPx * metrics.xScale * 914400),
          marginRight: Math.round(paragraph.marginRightPx * metrics.xScale * 914400),
          indent: Math.round(paragraph.indentPx * metrics.xScale * 914400),
          lineSpacing: { unit: 'points', value: pt(paragraph.style.lineHeightPx) },
          spaceBefore: { unit: 'points', value: pt(paragraph.spaceBeforePx) },
          spaceAfter: { unit: 'points', value: pt(paragraph.spaceAfterPx) },
        },
      },
    })
    for (const run of paragraph.runs.length ? paragraph.runs : [{ text: '', style: paragraph.style }]) {
      const style = run.style
      if (style.direction !== paragraph.style.direction || /[\r]/.test(run.text)) throw new Error('Unsupported text frame run direction or whitespace.')
      for (const [index, line] of run.text.split('\n').entries()) {
        const segmented = textRuns(line, style.fontFamily, options, style.fontFamilies)
        const text = typeof segmented === 'string' || !segmented.length ? [{ text: line, options: { fontFace: face(style) } }] : segmented
        for (const [segment, value] of text.entries()) runs.push({ text: value.text, options: {
          ...value.options, fontSize: fontSize(style), color: style.color.hex, transparency: transparency(style.color),
          bold: style.fontWeight >= 600, italic: style.fontStyle === 'italic',
          underline: style.decoration.includes('underline'), strike: style.decoration.includes('line-through'),
          capitalization: style.capitalization,
          charSpacing: pt(style.letterSpacingPx), baselinePercent: style.baselinePercent ?? 0, kerningThreshold: style.kerningThresholdPx === undefined ? undefined : pt(style.kerningThresholdPx), lang: style.language, altLang: style.alternativeLanguage,
          ...(style.direction === 'rtl' ? { rtlMode: true } : {}),
          ...(run.hyperlink ? { hyperlink: { url: run.hyperlink } } : {}),
          ...(index > 0 && segment === 0 ? { softBreakBefore: true } : {}),
        } })
      }
    }
    runs.at(-1)!.options.breakLine = true
  }
  const identity = pptxObjectName(element)
  const insets = element.textFrame?.insetsPx
  slide.addTextFrame(runs, {
    x: box.x, y: box.y, w: Math.max(0.01, box.width), h: Math.max(0.01, box.height),
    objectName: identity.objectName ?? `fastppt-text-frame:${element.id}`,
    // The pinned PptxGenJS text writer consumes [left, right, bottom, top],
    // unlike its documented CSS order. Actual ZIP readback guards this mapping.
    margin: insets ? [insets.left * metrics.xScale * 72, insets.right * metrics.xScale * 72, insets.bottom * metrics.yScale * 72, insets.top * metrics.yScale * 72] : 0,
    fit: 'none', wrap: element.textFrame?.wrap ?? true, valign: element.verticalAlign ?? 'top', isTextBox: true,
  }, native)
}

function textRenderBox(element: HtmlTextElement): HtmlBox {
  const measuredWidth = element.metrics?.advancePx
  if (measuredWidth === undefined || measuredWidth <= element.box.width)
    return element.box

  const safetyWidth = measuredWidth + element.style.fontSizePx * 0.08
  const width = Math.max(element.box.width, safetyWidth)
  const difference = width - element.box.width
  if (element.style.align === 'right') {
    return { ...element.box, x: element.box.x - difference, width }
  }
  if (element.style.align === 'center') {
    return { ...element.box, x: element.box.x - difference / 2, width }
  }
  return { ...element.box, width }
}

function renderImage(
  slide: NodePresentationSlide,
  element: HtmlImageElement,
  metrics: RenderMetrics,
): void {
  if (!element.data && (!element.path || /^https?:/i.test(element.path))) {
    throw new Error('Image has no embedded data or supported local path')
  }
  const box = scaleBox(element.box, metrics)
  const crop = element.crop
  const width = crop ? box.width / (1 - crop.left - crop.right) : box.width
  const height = crop ? box.height / (1 - crop.top - crop.bottom) : box.height
  slide.addImage({
    ...(element.data
      ? { data: element.data }
      : element.path
        ? { path: element.path }
        : {}),
    x: box.x,
    y: box.y,
    w: Math.max(0.01, width),
    h: Math.max(0.01, height),
    ...(crop ? { sizing: {
      type: 'crop', x: crop.left * width, y: crop.top * height,
      w: box.width, h: box.height,
    } } : {}),
    ...(element.rotation === undefined ? {} : { rotate: element.rotation }),
    transparency: round((1 - element.opacity) * 100, metrics),
    ...pptxObjectName(element),
  })
}

function pptxObjectName(element: HtmlSlideElement): { objectName: string } | Record<string, never> {
  const anchor = element.source.anchor
  return anchor ? { objectName: `fastppt:${anchor}:${element.id}` } : {}
}

function colorFill(color: HtmlColor | undefined): Fill {
  if (!color || color.alpha <= 0) return { type: 'none' }
  return {
    type: 'solid',
    color: color.hex,
    transparency: transparency(color),
  }
}

function shapeShadow(
  element: HtmlShapeElement,
  metrics: RenderMetrics,
): Shadow | undefined {
  const shadow = element.shadow
  if (!shadow) return undefined
  return {
    type: 'outer',
    color: shadow.color.hex,
    opacity: shadow.color.alpha,
    blur: round(shadow.blurPx * metrics.pointScale, metrics),
    offset: round(shadow.offsetPx * metrics.pointScale, metrics),
    angle: round(shadow.angle, metrics),
  }
}

function resolveFont(
  fontFamily: string,
  options: HtmlRenderOptions,
): string | undefined {
  const families = cssFontFamilies(fontFamily)
  if (families.length === 0) return options.fallbackFont
  return resolveSingleFont(families[0]!, options)
}

function resolveSingleFont(
  family: string,
  options: HtmlRenderOptions,
): string {
  const key = family.toLowerCase()
  const custom = Object.entries(options.fontMap ?? {}).find(
    ([source]) => source.toLowerCase() === key,
  )?.[1]
  return custom || BUILTIN_FONT_MAP[key] || GENERIC_FONTS[key] || family
}

function textRuns(
  text: string,
  fontFamily: string,
  options: HtmlRenderOptions,
  scriptFonts?: HtmlTextElement['style']['fontFamilies'],
): string | Array<{ text: string; options: { fontFace: string } }> {
  const families = cssFontFamilies(fontFamily)
  const latinFont = resolveFont(fontFamily, options)
  if (scriptFonts) {
    const runs: Array<{ text: string; options: { fontFace: string } }> = []
    let preceding: ReturnType<typeof fontScript> = 'latin'
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      const script = fontScript([...segment][0]!, preceding)
      preceding = script
      const face = scriptFonts[script]
      const fontFace = face ? resolveSingleFont(face, options) : latinFont ?? options.fallbackFont ?? 'Arial'
      const previous = runs.at(-1)
      if (previous?.options.fontFace === fontFace) previous.text += segment
      else runs.push({ text: segment, options: { fontFace } })
    }
    return runs
  }
  if (
    !latinFont ||
    families.length < 2 ||
    !containsCjk(text) ||
    isCjkFontFamily(families[0]!)
  )
    return text
  const cjkFamily = families.find((family, index) => {
    if (index === 0) return false
    return isCjkFontFamily(family)
  })
  if (!cjkFamily) return text
  const cjkFont = resolveSingleFont(cjkFamily, options)
  const runs: Array<{ text: string; options: { fontFace: string } }> = []

  for (const character of text) {
    const fontFace = isCjkCharacter(character) ? cjkFont : latinFont
    const previous = runs.at(-1)
    if (previous?.options.fontFace === fontFace) previous.text += character
    else runs.push({ text: character, options: { fontFace } })
  }
  return runs
}

function isCjkFontFamily(family: string): boolean {
  return /(?:cjk|han|hei|song|ming|kai|yahei|gothic|meiryo|sans sc|serif sc|wenkai|misans|lxgw|source han)/i.test(
    family,
  )
}

function containsCjk(text: string): boolean {
  return [...text].some(isCjkCharacter)
}

function isCjkCharacter(character: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u.test(
    character,
  )
}

function scaleBox(box: HtmlBox, metrics: RenderMetrics): HtmlBox {
  return {
    x: x(box.x, metrics),
    y: y(box.y, metrics),
    width: x(box.width, metrics),
    height: y(box.height, metrics),
  }
}

function x(value: number, metrics: RenderMetrics): number {
  return round(value * metrics.xScale, metrics)
}

function y(value: number, metrics: RenderMetrics): number {
  return round(value * metrics.yScale, metrics)
}

function transparency(color: HtmlColor): number {
  const value = Math.max(0, Math.min(100, (1 - color.alpha) * 100))
  return Math.round(value * 1_000_000) / 1_000_000
}

function round(value: number, metrics: RenderMetrics): number {
  const factor = 10 ** metrics.precision
  return Math.round(value * factor) / factor
}

function inferLayout(slide: HtmlSlideSnapshot | undefined): Layout | Size {
  if (!slide) return 'LAYOUT_WIDE'
  const ratio = slide.width / slide.height
  return { width: 13.333, height: 13.333 / ratio }
}

function assertSlideSnapshot(snapshot: HtmlSlideSnapshot): void {
  if (
    !HTML_SNAPSHOT_VERSIONS.includes(snapshot?.version) ||
    !Number.isFinite(snapshot.width) ||
    !Number.isFinite(snapshot.height) ||
    snapshot.width <= 0 ||
    snapshot.height <= 0 ||
    !Array.isArray(snapshot.elements) ||
    (snapshot.version === 1 && snapshot.elements.some(element => element.kind === 'table' || element.structure))
  ) {
    throw new TypeError(
      `Unsupported or invalid HTML slide snapshot; expected version 1 or 2`,
    )
  }
}

function assertDeckSnapshot(snapshot: HtmlDeckSnapshot): void {
  if (
    !HTML_SNAPSHOT_VERSIONS.includes(snapshot?.version) ||
    !Array.isArray(snapshot.slides) || snapshot.slides.some(slide => slide.version !== snapshot.version)
  ) {
    throw new TypeError(
      `Unsupported or invalid HTML deck snapshot; expected version 1 or 2`,
    )
  }
}

function uniqueWarnings(
  warnings: HtmlConversionWarning[],
): HtmlConversionWarning[] {
  const seen = new Set<string>()
  return warnings.filter((warning) => {
    const key = `${warning.code}\u0000${warning.message}\u0000${warning.elementId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
