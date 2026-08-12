import type { Fill, Layout, Shadow } from '../types.js'
import { cssFontFamilies } from './font-family.js'
import {
  NodePresentation,
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
  HTML_SNAPSHOT_VERSION,
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
} from '../snapshot-types.js'

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

  for (const element of elements) {
    try {
      renderElement(slide, element, metrics, options, warnings)
      renderedElementCount += 1
    } catch (cause) {
      warnings.push({
        code: 'invalid-snapshot',
        message: `Slide ${snapshot.id} element could not be rendered: ${errorMessage(cause)}`,
        elementId: element.id,
      })
    }
  }

  return { warnings, elementCount: renderedElementCount }
}

/** Creates a presentation from a serializable deck snapshot. */
export function htmlDeckToPresentation(
  snapshot: HtmlDeckSnapshot,
  options: HtmlDeckRenderOptions = {},
): HtmlDeckRenderResult {
  assertDeckSnapshot(snapshot)
  const presentation = new NodePresentation({
    layout: options.layout ?? inferLayout(snapshot.slides[0]),
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.author === undefined ? {} : { author: options.author }),
  })
  const warnings: HtmlConversionWarning[] = []
  let elementCount = 0

  for (const htmlSlide of snapshot.slides) {
    const slide = presentation.addSlide()
    const result = renderHtmlSlide(htmlSlide, slide, options)
    warnings.push(...result.warnings)
    elementCount += result.elementCount
  }

  warnings.push(...snapshot.warnings)
  return {
    presentation,
    warnings: uniqueWarnings(warnings),
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
  } else {
    renderImage(slide, element, metrics)
  }
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
  const box = scaleBox(textRenderBox(element), metrics)
  const fontFace = resolveFont(element.style.fontFamily, options)
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

  slide.addText(textRuns(element.text, element.style.fontFamily, options), {
    x: box.x,
    y: box.y,
    w: Math.max(0.01, box.width),
    h: Math.max(0.01, box.height),
    fontFace: fontFace || options.fallbackFont || 'Arial',
    fontSize: round(fontSize, metrics),
    color: element.style.color.hex,
    transparency: transparency(element.style.color),
    bold: element.style.fontWeight >= 600,
    italic: element.style.fontStyle === 'italic',
    underline: element.style.decoration.includes('underline'),
    strike: element.style.decoration.includes('line-through'),
    align: element.style.align,
    valign:
      element.verticalAlign ??
      (element.box.height > element.style.lineHeightPx * 1.25
        ? 'middle'
        : 'top'),
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
    rotate: element.rotation,
    rtlMode: element.style.direction === 'rtl',
    lang: element.style.language,
    hyperlink: element.hyperlink ? { url: element.hyperlink } : undefined,
    isTextBox: true,
  })
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
  slide.addImage({
    ...(element.data
      ? { data: element.data }
      : element.path
        ? { path: element.path }
        : {}),
    x: box.x,
    y: box.y,
    w: Math.max(0.01, box.width),
    h: Math.max(0.01, box.height),
    ...(element.rotation === undefined ? {} : { rotate: element.rotation }),
    transparency: round((1 - element.opacity) * 100, metrics),
  })
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
): string | Array<{ text: string; options: { fontFace: string } }> {
  const families = cssFontFamilies(fontFamily)
  const latinFont = resolveFont(fontFamily, options)
  if (!latinFont || families.length < 2 || !containsCjk(text)) return text
  const cjkFamily = families.find((family, index) => {
    if (index === 0) return false
    return /(?:cjk|han|hei|song|ming|kai|yahei|gothic|meiryo)/i.test(family)
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

function inferLayout(slide: HtmlSlideSnapshot | undefined): Layout {
  if (!slide) return 'LAYOUT_WIDE'
  const ratio = slide.width / slide.height
  if (Math.abs(ratio - 4 / 3) < 0.02) return 'LAYOUT_4x3'
  if (Math.abs(ratio - 16 / 10) < 0.02) return 'LAYOUT_16x10'
  return 'LAYOUT_WIDE'
}

function assertSlideSnapshot(snapshot: HtmlSlideSnapshot): void {
  if (
    snapshot?.version !== HTML_SNAPSHOT_VERSION ||
    !Number.isFinite(snapshot.width) ||
    !Number.isFinite(snapshot.height) ||
    snapshot.width <= 0 ||
    snapshot.height <= 0 ||
    !Array.isArray(snapshot.elements)
  ) {
    throw new TypeError(
      `Unsupported or invalid HTML slide snapshot; expected version ${HTML_SNAPSHOT_VERSION}`,
    )
  }
}

function assertDeckSnapshot(snapshot: HtmlDeckSnapshot): void {
  if (
    snapshot?.version !== HTML_SNAPSHOT_VERSION ||
    !Array.isArray(snapshot.slides)
  ) {
    throw new TypeError(
      `Unsupported or invalid HTML deck snapshot; expected version ${HTML_SNAPSHOT_VERSION}`,
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
