import {
  cssDash,
  cssFontFamilies,
  cssFontWeight,
  cssPixels,
  cssTextAlign,
  compositeHtmlColor,
  firstVisibleGradientColor,
  multiplyAlpha,
  parseCssLinearGradient,
  parseCssColor,
} from './css'
import {
  captureUniformBorder,
  hasVisibleBackdropFilter,
  parseBoxShadow,
  recognizeShape,
} from './capture-style'
import {
  applyTextTransform,
  DEFAULT_EXCLUDES,
  elementSource,
  IGNORED_TAGS,
  isImageElement,
  isRenderedElement,
  isUnsupportedMedia,
  isVisibleRoot,
  matchesAnySelector,
  pseudoText,
} from './dom'
import {
  isUsefulBox,
  normalizeDomRect,
  roundTo,
} from './geometry'
import { SLIDEV_OVERVIEW_ROOT_SELECTOR } from './slidev'
import {
  inlineSvgPaint,
  htmlElementToSvgDataUrl,
  maskToSvgDataUrl,
  resourceToDataUrl,
  svgToDataUrl,
} from './svg'
import { resolveSlidevCaptureTheme } from './themes'
import type { SlidevCaptureTheme } from './themes/types'
import {
  fontSafeLineBox,
  measureTextAdvance,
  mergeTextGrapheme,
  textGraphemeRanges,
} from './text-layout'
import {
  averageScale,
  mergeTransform,
  nonZeroRotation,
  type TransformMetrics,
} from './transform'
import {
  HTML_SNAPSHOT_VERSION,
  type HtmlBox,
  type HtmlCaptureOptions,
  type HtmlColor,
  type HtmlConversionWarning,
  type HtmlDeckSnapshot,
  type HtmlElementSource,
  type HtmlImageElement,
  type HtmlGradient,
  type HtmlLineElement,
  type HtmlShapeElement,
  type HtmlSlideElement,
  type HtmlSlideSnapshot,
  type HtmlTextElement,
  type HtmlTextStyle,
  type SlidevCaptureOptions,
} from './types'

export {
  normalizeSlidevPageNumber,
  SLIDEV_OVERVIEW_ROOT_SELECTOR,
} from './slidev'

interface CaptureContext {
  root: HTMLElement
  rootRect: DOMRect
  rootScaleX: number
  rootScaleY: number
  width: number
  height: number
  options: Required<
    Pick<
      HtmlCaptureOptions,
      'embedImages' | 'includePseudoElements' | 'precision'
    >
  > &
    HtmlCaptureOptions
  excludes: string[]
  elements: HtmlSlideElement[]
  warnings: HtmlConversionWarning[]
  nextOrder: number
  theme?: SlidevCaptureTheme
}

const RESOURCE_READY_TIMEOUT_MS = 15_000
const SLIDE_CAPTURE_CONCURRENCY = 4

async function waitWithTimeout(operation: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    operation,
    new Promise<void>((resolveTimeout) => {
      timer = setTimeout(resolveTimeout, RESOURCE_READY_TIMEOUT_MS)
    }),
  ])
  if (timer) clearTimeout(timer)
}

/** Waits for fonts, images, caller state, and two stable rendering frames. */
export async function waitForHtmlReady(
  root: HTMLElement,
  ready?: () => void | Promise<void>,
): Promise<void> {
  await ready?.()
  if (document.fonts) await waitWithTimeout(document.fonts.ready)
  const images = [...root.querySelectorAll('img')]
  await waitWithTimeout(
    Promise.all(
      images.map(async (image) => {
        if (image.complete) return
        try {
          await image.decode()
        } catch {
          // Capture records an image warning later if the asset is still unavailable.
        }
      }),
    ),
  )
  await nextFrame()
  await nextFrame()
}

/** Captures one fully rendered HTML/Slidev canvas into a serializable snapshot. */
export async function captureHtmlSlide(
  root: HTMLElement,
  options: HtmlCaptureOptions = {},
): Promise<HtmlSlideSnapshot> {
  if (!(root instanceof HTMLElement)) {
    throw new TypeError('captureHtmlSlide requires an HTMLElement root')
  }

  if (options.waitForReady !== false) {
    await waitForHtmlReady(root, options.ready)
  }

  const rootRect = root.getBoundingClientRect()
  const width = options.canvasWidth ?? (root.offsetWidth || rootRect.width)
  const height = options.canvasHeight ?? (root.offsetHeight || rootRect.height)
  if (
    rootRect.width <= 0 ||
    rootRect.height <= 0 ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('Cannot capture an HTML slide with zero width or height')
  }

  const theme = resolveSlidevCaptureTheme(root, options.theme)
  const context: CaptureContext = {
    root,
    rootRect,
    rootScaleX: rootRect.width / width,
    rootScaleY: rootRect.height / height,
    width,
    height,
    options: {
      ...options,
      embedImages: options.embedImages !== false,
      includePseudoElements: options.includePseudoElements !== false,
      precision: options.precision ?? 4,
    },
    excludes: [...DEFAULT_EXCLUDES, ...(options.excludeSelectors ?? [])],
    elements: [],
    warnings: [],
    nextOrder: 0,
    ...(theme ? { theme } : {}),
  }

  await visitElement(
    context,
    root,
    'root',
    1,
    0,
    { scaleX: 1, scaleY: 1, rotation: 0 },
    true,
  )

  return {
    version: HTML_SNAPSHOT_VERSION,
    id: options.id ?? root.id ?? root.dataset.slidevPage ?? 'slide',
    width: round(width, context),
    height: round(height, context),
    elements: context.elements,
    warnings: context.warnings,
  }
}

/** Captures the Slidev pages currently rendered by the viewer or export view. */
export async function captureSlidevDeck(
  options: SlidevCaptureOptions = {},
): Promise<HtmlDeckSnapshot> {
  const selector = options.rootSelector ?? '.slidev-page'
  const candidates = options.roots
    ? [...options.roots]
    : [...document.querySelectorAll<HTMLElement>(selector)]
  const roots = candidates.filter(
    (root) => options.includeHiddenRoots || isVisibleRoot(root),
  )

  if (roots.length === 0) {
    throw new Error(`No rendered Slidev pages matched "${selector}"`)
  }

  if (options.waitForReady !== false) {
    await waitForHtmlReady(document.body, options.ready)
  }

  let completedSlides = 0
  const slides = new Array<HtmlSlideSnapshot>(roots.length)
  let nextSlideIndex = 0
  const captureNextSlide = async (): Promise<void> => {
    for (;;) {
      const index = nextSlideIndex++
      const root = roots[index]
      if (!root) return
      slides[index] = await captureHtmlSlide(root, {
        ...options,
        waitForReady: false,
        id:
          root.dataset.slidevPage ??
          root.className.match(/slidev-page-(\d+)/)?.[1] ??
          `slide-${index + 1}`,
      })
      completedSlides += 1
      options.onSlideCaptured?.(completedSlides, roots.length)
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(SLIDE_CAPTURE_CONCURRENCY, roots.length) },
      () => captureNextSlide(),
    ),
  )

  return {
    version: HTML_SNAPSHOT_VERSION,
    source: 'slidev',
    slides,
    warnings: slides.flatMap((slide) => slide.warnings),
  }
}

/** Captures every slide rendered in Slidev's overview (open it with the `o` shortcut). */
export async function captureSlidevOverview(
  options: SlidevCaptureOptions = {},
): Promise<HtmlDeckSnapshot> {
  return captureSlidevDeck({
    ...options,
    rootSelector: options.rootSelector ?? SLIDEV_OVERVIEW_ROOT_SELECTOR,
  })
}

async function visitElement(
  context: CaptureContext,
  element: HTMLElement,
  path: string,
  parentOpacity: number,
  parentZIndex: number,
  parentTransform: TransformMetrics,
  isRoot = false,
): Promise<void> {
  if (!isRoot && matchesAnySelector(element, context.excludes)) return
  if (IGNORED_TAGS.has(element.tagName)) return

  const style = getComputedStyle(element)
  if (!isRenderedElement(element, style, context.rootRect)) return

  const opacity = clamp(parentOpacity * numericOpacity(style.opacity))
  if (opacity <= 0) return
  const zIndex =
    style.zIndex === 'auto'
      ? parentZIndex
      : parentZIndex + numericZIndex(style.zIndex)
  const transform = isRoot
    ? parentTransform
    : mergeTransform(parentTransform, style)
  const source = elementSource(element, path)
  if (
    !isRoot &&
    context.theme?.captureAsGroup?.({
      root: context.root,
      element,
      rootScaleX: context.rootScaleX,
      rootScaleY: context.rootScaleY,
    })
  ) {
    await captureGroupedElement(
      context,
      element,
      source,
      opacity,
      zIndex,
      transform,
    )
    return
  }
  const maskImage = style.maskImage || style.webkitMaskImage
  let capturedBorder = false

  if (maskImage && maskImage !== 'none') {
    captureMask(
      context,
      element,
      style,
      maskImage,
      source,
      opacity,
      zIndex,
      transform,
    )
  } else {
    capturedBorder = captureBackground(
      context,
      element,
      style,
      source,
      opacity,
      zIndex,
      transform,
    )
  }
  if (!capturedBorder) {
    captureBorders(context, element, style, source, opacity, zIndex, transform)
  }

  if (context.options.includePseudoElements) {
    capturePseudo(
      context,
      element,
      'before',
      source,
      opacity,
      zIndex,
      transform,
    )
  }

  if (isImageElement(element)) {
    await captureImage(context, element, source, opacity, zIndex, transform)
  } else if (element instanceof SVGSVGElement) {
    captureSvg(context, element, source, opacity, zIndex, transform)
  } else if (element instanceof HTMLCanvasElement) {
    captureCanvas(context, element, source, opacity, zIndex, transform)
  } else if (!isUnsupportedMedia(element)) {
    let elementIndex = 0
    let textIndex = 0
    for (const child of element.childNodes) {
      const childPath =
        child instanceof Text
          ? `${path}#text-${textIndex++}`
          : `${path}/${child.nodeName.toLowerCase()}-${elementIndex++}`
      try {
        if (child instanceof Text) {
          captureTextNode(context, child, childPath, opacity, zIndex, transform)
        } else if (child instanceof HTMLElement) {
          await visitElement(
            context,
            child,
            childPath,
            opacity,
            zIndex,
            transform,
          )
        } else if (child instanceof SVGSVGElement) {
          captureSvg(
            context,
            child,
            elementSource(child, childPath),
            opacity,
            zIndex,
            transform,
          )
        }
      } catch (error) {
        warn(
          context,
          'invalid-snapshot',
          `Element changed or could not be captured: ${errorMessage(error)}`,
          childPath,
        )
      }
    }
  } else {
    warn(
      context,
      'unsupported-media',
      `${element.tagName.toLowerCase()} is not editable and was skipped`,
      source.path,
    )
  }

  if (context.options.includePseudoElements) {
    capturePseudo(context, element, 'after', source, opacity, zIndex, transform)
  }
}

async function captureGroupedElement(
  context: CaptureContext,
  element: HTMLElement,
  source: HtmlElementSource,
  opacity: number,
  zIndex: number,
  transform: TransformMetrics,
): Promise<void> {
  const rect = element.getBoundingClientRect()
  const adjustment = context.theme?.adjustGroupedCapture?.({
    root: context.root,
    element,
    rootScaleX: context.rootScaleX,
    rootScaleY: context.rootScaleY,
  })
  const renderedWidth = adjustment?.width ?? rect.width
  const renderedHeight = adjustment?.height ?? rect.height
  const box = normalizeRect(
    {
      left: rect.left,
      top: rect.top,
      width: renderedWidth,
      height: renderedHeight,
    } as DOMRectReadOnly,
    context,
  )
  if (!isUsefulBox(box)) return
  try {
    const data = htmlElementToSvgDataUrl(
      element,
      Math.max(1, renderedWidth),
      Math.max(1, renderedHeight),
      adjustment?.style,
    )
    emit<HtmlImageElement>(context, {
      id: `${source.path}:group`,
      kind: 'image',
      box,
      zIndex,
      opacity,
      source,
      data,
      ...rotationProperty(transform),
    })
  } catch (error) {
    warn(
      context,
      'image-embed-failed',
      `Grouped theme element could not be captured: ${errorMessage(error)}`,
      source.path,
    )
  }
}

function captureBackground(
  context: CaptureContext,
  element: HTMLElement,
  style: CSSStyleDeclaration,
  source: HtmlElementSource,
  opacity: number,
  zIndex: number,
  transform: TransformMetrics,
): boolean {
  let fill = parseCssColor(style.backgroundColor)
  let gradient: HtmlGradient | undefined
  let cleanTextHighlight = false
  const backgroundImage = style.backgroundImage
  if (backgroundImage && backgroundImage !== 'none') {
    if (/gradient\(/i.test(backgroundImage)) {
      gradient = parseCssLinearGradient(backgroundImage) ?? undefined
      cleanTextHighlight = Boolean(
        gradient &&
        context.theme?.isTextHighlight?.({
          root: context.root,
          element,
          gradient,
        }),
      )
      if (!gradient) fill = firstVisibleGradientColor(backgroundImage) ?? fill
      warn(
        context,
        'unsupported-background-image',
        cleanTextHighlight
          ? 'CSS text highlight was simplified as an editable translucent band'
          : gradient
            ? 'CSS gradient was preserved as an SVG background layer with editable content, border, and shadow'
            : 'CSS gradient was approximated with an editable solid fill',
        source.path,
      )
    } else {
      warn(
        context,
        'unsupported-background-image',
        'CSS background image was skipped; use an <img> for editable image output',
        source.path,
      )
    }
  }

  const hasBackdropFilter = hasVisibleBackdropFilter(style)
  if (hasBackdropFilter) {
    warn(
      context,
      'unsupported-backdrop-filter',
      'Backdrop filter was omitted and translucent colors were composited against the captured backdrop',
      source.path,
    )
  }

  const shadow = parseBoxShadow(style.boxShadow, opacity, transform)
  const stroke = captureUniformBorder(style, opacity, transform)
  if ((!fill || fill.alpha <= 0) && !gradient && !shadow && !stroke)
    return false
  if (fill) fill = multiplyAlpha(fill, opacity)
  if (gradient) {
    gradient = {
      ...gradient,
      stops: gradient.stops.map((stop) => ({
        ...stop,
        color: multiplyAlpha(stop.color, opacity),
      })),
    }
  }
  if (hasBackdropFilter) {
    const backdrop = captureBackdropColor(context, element)
    if (fill && fill.alpha < 1) fill = compositeHtmlColor(fill, backdrop)
    if (gradient) {
      gradient = {
        ...gradient,
        stops: gradient.stops.map((stop) => ({
          ...stop,
          color: compositeHtmlColor(stop.color, backdrop),
        })),
      }
    }
  }

  const rects = [...element.getClientRects()]
  let emittedStroke = false
  for (const [index, rect] of rects.entries()) {
    const measuredBox = normalizeRect(rect, context)
    const box =
      context.theme?.adjustBackgroundBox?.({
        root: context.root,
        element,
        box: measuredBox,
        precision: context.options.precision,
      }) ?? measuredBox
    if (!isUsefulBox(box)) continue
    if (cleanTextHighlight && gradient && context.theme?.captureTextHighlight) {
      const highlight = context.theme.captureTextHighlight({
        root: context.root,
        element,
        gradient,
        box,
        precision: context.options.precision,
      })
      emit<HtmlShapeElement>(context, {
        id: `${source.path}:background-${index}`,
        kind: 'shape',
        shape: 'roundRect',
        box: highlight.box,
        zIndex,
        opacity,
        source,
        fill: highlight.fill,
        ...(highlight.radiusPx === undefined
          ? {}
          : { radiusPx: highlight.radiusPx }),
      })
      continue
    }
    const clipPath = style.clipPath
    const inheritedRadius = clippedTopRadius(element, box, context, transform)
    const ownRadius =
      cssPixels(style.borderTopLeftRadius) * averageScale(transform)
    const shape = inheritedRadius > 0 ? 'roundRect' : recognizeShape(style, box)
    if (clipPath !== 'none' && shape !== 'chevron') {
      warn(
        context,
        'unsupported-clip-path',
        `Clip path "${clipPath}" was approximated as an editable rectangle`,
        source.path,
      )
    }
    if (
      !stroke &&
      fill &&
      fill.alpha > 0 &&
      !shadow &&
      !nonZeroRotation(transform.rotation)
    ) {
      if (
        captureThinFillLine(context, box, fill, source, opacity, zIndex, index)
      )
        continue
    }
    emit<HtmlShapeElement>(context, {
      id: `${source.path}:background-${index}`,
      kind: 'shape',
      shape,
      box,
      zIndex,
      opacity,
      source,
      ...(fill && fill.alpha > 0 ? { fill } : {}),
      ...(gradient ? { gradient } : {}),
      ...(stroke ? { stroke } : {}),
      radiusPx: inheritedRadius || ownRadius,
      preciseRadius: Boolean(
        ownRadius > 0 && style.overflow === 'hidden' && stroke,
      ),
      ...rotationProperty(transform),
      ...(shadow ? { shadow } : {}),
    })
    emittedStroke ||= Boolean(stroke)
  }
  return emittedStroke
}

/** Recreates the rounded top edge that overflow-hidden applies to a full-width header child. */
function clippedTopRadius(
  element: HTMLElement,
  box: HtmlBox,
  context: CaptureContext,
  transform: TransformMetrics,
): number {
  const parent = element.parentElement
  if (!parent) return 0
  const parentStyle = getComputedStyle(parent)
  if (parentStyle.overflow !== 'hidden') return 0
  const radius =
    cssPixels(parentStyle.borderTopLeftRadius) * averageScale(transform)
  if (radius <= 0) return 0

  const parentBox = normalizeRect(parent.getBoundingClientRect(), context)
  const inset = cssPixels(parentStyle.borderTopWidth) * averageScale(transform)
  const expectedTop = parentBox.y + inset
  const expectedWidth = Math.max(0, parentBox.width - inset * 2)
  if (
    Math.abs(box.y - expectedTop) > 1.5 ||
    Math.abs(box.width - expectedWidth) > 2
  )
    return 0
  return Math.max(0, radius - inset)
}

function captureBackdropColor(
  context: CaptureContext,
  element: HTMLElement,
): HtmlColor {
  const ancestors: HTMLElement[] = []
  let current = element.parentElement
  while (current) {
    ancestors.push(current)
    if (current === context.root) break
    current = current.parentElement
  }

  let backdrop: HtmlColor = { hex: 'FFFFFF', alpha: 1 }
  for (const ancestor of ancestors.reverse()) {
    const color = parseCssColor(getComputedStyle(ancestor).backgroundColor)
    if (color && color.alpha > 0) backdrop = compositeHtmlColor(color, backdrop)
  }
  return backdrop
}

function captureThinFillLine(
  context: CaptureContext,
  box: HtmlBox,
  color: HtmlColor,
  source: HtmlElementSource,
  opacity: number,
  zIndex: number,
  index: number,
): boolean {
  const vertical = box.width <= 2 && box.height >= box.width * 4
  const horizontal = box.height <= 2 && box.width >= box.height * 4
  if (!vertical && !horizontal) return false

  const x1 = vertical ? box.x + box.width / 2 : box.x
  const y1 = horizontal ? box.y + box.height / 2 : box.y
  emit<HtmlLineElement>(context, {
    id: `${source.path}:background-${index}`,
    kind: 'line',
    box: { x: round(x1, context), y: round(y1, context), width: 0, height: 0 },
    x2: round(vertical ? x1 : box.x + box.width, context),
    y2: round(horizontal ? y1 : box.y + box.height, context),
    zIndex,
    opacity,
    source,
    color,
    widthPx: round(vertical ? box.width : box.height, context),
    dash: 'solid',
  })
  return true
}

function captureBorders(
  context: CaptureContext,
  element: HTMLElement,
  style: CSSStyleDeclaration,
  source: HtmlElementSource,
  opacity: number,
  zIndex: number,
  transform: TransformMetrics,
): void {
  const box = normalizeRect(element.getBoundingClientRect(), context)
  if (!isUsefulBox(box)) return
  const sides = [
    [
      'top',
      style.borderTopWidth,
      style.borderTopStyle,
      style.borderTopColor,
      box.x,
      box.y,
      box.x + box.width,
      box.y,
    ],
    [
      'right',
      style.borderRightWidth,
      style.borderRightStyle,
      style.borderRightColor,
      box.x + box.width,
      box.y,
      box.x + box.width,
      box.y + box.height,
    ],
    [
      'bottom',
      style.borderBottomWidth,
      style.borderBottomStyle,
      style.borderBottomColor,
      box.x,
      box.y + box.height,
      box.x + box.width,
      box.y + box.height,
    ],
    [
      'left',
      style.borderLeftWidth,
      style.borderLeftStyle,
      style.borderLeftColor,
      box.x,
      box.y,
      box.x,
      box.y + box.height,
    ],
  ] as const

  for (const [
    side,
    widthValue,
    borderStyle,
    colorValue,
    x1,
    y1,
    x2,
    y2,
  ] of sides) {
    const widthPx = cssPixels(widthValue) * averageScale(transform)
    const color = parseCssColor(colorValue)
    if (widthPx <= 0 || borderStyle === 'none' || !color || color.alpha <= 0)
      continue
    if (!['solid', 'dashed', 'dotted'].includes(borderStyle)) {
      warn(
        context,
        'unsupported-border-style',
        `Border style "${borderStyle}" was approximated`,
        source.path,
      )
    }
    emit<HtmlLineElement>(context, {
      id: `${source.path}:border-${side}`,
      kind: 'line',
      box: {
        x: round(x1, context),
        y: round(y1, context),
        width: 0,
        height: 0,
      },
      x2: round(x2, context),
      y2: round(y2, context),
      zIndex,
      opacity,
      source,
      color: multiplyAlpha(color, opacity),
      widthPx: round(widthPx, context),
      dash: cssDash(borderStyle),
    })
  }
}

function captureTextNode(
  context: CaptureContext,
  node: Text,
  path: string,
  opacity: number,
  zIndex: number,
  transform: TransformMetrics,
): void {
  const parent = node.parentElement
  if (!parent || !node.data || !node.data.trim()) return
  const style = getComputedStyle(parent)
  const textStyle = captureTextStyle(style, parent, opacity, transform)
  const source = elementSource(parent, path)
  const range = document.createRange()
  const fragments: Array<{
    text: string
    box: HtmlBox
    advancePx: number
    graphemeCount: number
  }> = []

  for (const grapheme of textGraphemeRanges(node.data)) {
    range.setStart(node, grapheme.start)
    range.setEnd(node, grapheme.end)
    const rect = [...range.getClientRects()].find(
      (candidate) => candidate.width > 0 && candidate.height > 0,
    )
    if (!rect) continue
    const box = normalizeRect(rect, context)
    mergeTextGrapheme(
      fragments,
      grapheme.text,
      box,
      0,
      context.options.precision,
    )
  }
  range.detach()

  for (const [index, fragment] of fragments.entries()) {
    const value = applyTextTransform(fragment.text, style.textTransform)
    const slideId = context.options.id
    const adjustment = context.theme?.adjustText?.({
      root: context.root,
      parent,
      text: value,
      box: fragment.box,
      style: textStyle,
      ...(slideId === undefined ? {} : { slideId }),
      precision: context.options.precision,
      rect: (element) =>
        normalizeRect(element.getBoundingClientRect(), context),
      measureReplacementBox: (element, text) =>
        measureReplacementTextBox(element, text, context, transform),
    })
    const text = adjustment?.text ?? value
    if (!text.trim()) continue
    const measuredAdvance =
      measureTextAdvance(text, style) * averageScale(transform)
    const measuredBox = adjustment?.box ?? fragment.box
    emit<HtmlTextElement>(context, {
      id: `${path}:fragment-${index}`,
      kind: 'text',
      text,
      box:
        adjustment?.box ??
        fontSafeLineBox(
          measuredBox,
          textStyle.lineHeightPx,
          context.options.precision,
        ),
      zIndex,
      opacity,
      source,
      metrics: {
        advancePx: round(measuredAdvance, context),
        graphemeCount: textGraphemeRanges(text).length,
      },
      style: adjustment?.align
        ? { ...textStyle, align: adjustment.align }
        : textStyle,
      ...(adjustment?.verticalAlign
        ? { verticalAlign: adjustment.verticalAlign }
        : {}),
      ...rotationProperty(transform),
      ...(parent.closest('a')?.href
        ? { hyperlink: parent.closest('a')!.href }
        : {}),
    })
  }
}

async function captureImage(
  context: CaptureContext,
  image: HTMLImageElement,
  source: HtmlElementSource,
  opacity: number,
  zIndex: number,
  transform: TransformMetrics,
): Promise<void> {
  const src = image.currentSrc || image.src
  if (!src) return
  const box = imageContentBox(
    image,
    normalizeRect(image.getBoundingClientRect(), context),
    context,
  )
  let data: string | undefined
  let path: string | undefined
  if (context.options.embedImages) {
    try {
      data = await resourceToDataUrl(src)
    } catch (error) {
      if (!/^https?:/i.test(src)) path = src
      warn(
        context,
        'image-embed-failed',
        `Image could not be embedded: ${errorMessage(error)}`,
        source.path,
      )
    }
  } else {
    path = src
  }
  if (!data && !path) return
  emit<HtmlImageElement>(context, {
    id: `${source.path}:image`,
    kind: 'image',
    box,
    zIndex,
    opacity,
    source,
    ...(data ? { data } : {}),
    ...(path ? { path } : {}),
    alt: image.alt,
    ...rotationProperty(transform),
  })
}

function captureSvg(
  context: CaptureContext,
  svg: SVGSVGElement,
  source: HtmlElementSource,
  opacity: number,
  zIndex: number,
  transform: TransformMetrics,
): void {
  const box = normalizeRect(svg.getBoundingClientRect(), context)
  if (!isUsefulBox(box)) return
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  inlineSvgPaint(svg, clone)
  const data = svgToDataUrl(new XMLSerializer().serializeToString(clone))
  emit<HtmlImageElement>(context, {
    id: `${source.path}:svg`,
    kind: 'image',
    box,
    zIndex,
    opacity,
    source,
    data,
    ...(svg.getAttribute('aria-label')
      ? { alt: svg.getAttribute('aria-label')! }
      : {}),
    ...rotationProperty(transform),
  })
}

function captureCanvas(
  context: CaptureContext,
  canvas: HTMLCanvasElement,
  source: HtmlElementSource,
  opacity: number,
  zIndex: number,
  transform: TransformMetrics,
): void {
  try {
    emit<HtmlImageElement>(context, {
      id: `${source.path}:canvas`,
      kind: 'image',
      box: normalizeRect(canvas.getBoundingClientRect(), context),
      zIndex,
      opacity,
      source,
      data: canvas.toDataURL('image/png'),
      ...rotationProperty(transform),
    })
  } catch (error) {
    warn(
      context,
      'image-embed-failed',
      `Canvas could not be embedded: ${errorMessage(error)}`,
      source.path,
    )
  }
}

function captureMask(
  context: CaptureContext,
  element: HTMLElement,
  style: CSSStyleDeclaration,
  maskImage: string,
  source: HtmlElementSource,
  opacity: number,
  zIndex: number,
  transform: TransformMetrics,
): void {
  const color =
    parseCssColor(style.backgroundColor) ?? parseCssColor(style.color)
  const data = color ? maskToSvgDataUrl(maskImage, color.hex) : null
  if (!data) {
    warn(
      context,
      'unsupported-mask',
      'CSS mask could not be converted to an SVG image',
      source.path,
    )
    return
  }
  emit<HtmlImageElement>(context, {
    id: `${source.path}:mask`,
    kind: 'image',
    box: normalizeRect(element.getBoundingClientRect(), context),
    zIndex,
    opacity,
    source,
    data,
    ...rotationProperty(transform),
  })
}

function capturePseudo(
  context: CaptureContext,
  element: HTMLElement,
  pseudo: 'before' | 'after',
  parentSource: HtmlElementSource,
  opacity: number,
  zIndex: number,
  transform: TransformMetrics,
): void {
  const style = getComputedStyle(element, `::${pseudo}`)
  const content = pseudoText(style.content, element, pseudo)
  const fill = parseCssColor(style.backgroundColor)
  const maskImage = style.maskImage || style.webkitMaskImage
  if (
    !content &&
    (!fill || fill.alpha <= 0) &&
    (!maskImage || maskImage === 'none')
  )
    return

  const box = pseudoBox(element, style, context, transform)
  if (!isUsefulBox(box)) return
  const source: HtmlElementSource = {
    ...parentSource,
    path: `${parentSource.path}::${pseudo}`,
    pseudo,
  }

  if (maskImage && maskImage !== 'none') {
    const color = fill ?? parseCssColor(style.color)
    const data = color ? maskToSvgDataUrl(maskImage, color.hex) : null
    if (data) {
      emit<HtmlImageElement>(context, {
        id: `${source.path}:mask`,
        kind: 'image',
        box,
        zIndex,
        opacity,
        source,
        data,
      })
    } else {
      warn(
        context,
        'unsupported-mask',
        `Pseudo-element mask could not be converted`,
        source.path,
      )
    }
  } else if (fill && fill.alpha > 0) {
    emit<HtmlShapeElement>(context, {
      id: `${source.path}:background`,
      kind: 'shape',
      shape: recognizeShape(style, box),
      box,
      zIndex,
      opacity,
      source,
      fill: multiplyAlpha(fill, opacity),
      radiusPx: cssPixels(style.borderTopLeftRadius) * averageScale(transform),
    })
  }

  if (content) {
    const textStyle = captureTextStyle(style, element, opacity, transform)
    emit<HtmlTextElement>(context, {
      id: `${source.path}:text`,
      kind: 'text',
      text: content,
      box,
      zIndex,
      opacity,
      source,
      metrics: {
        advancePx: round(
          measureTextAdvance(content, style) * averageScale(transform),
          context,
        ),
        graphemeCount: textGraphemeRanges(content).length,
      },
      style: textStyle,
      verticalAlign: 'middle',
    })
  }
}

function captureTextStyle(
  style: CSSStyleDeclaration,
  element: Element,
  opacity: number,
  transform: TransformMetrics,
): HtmlTextStyle {
  const scale = averageScale(transform)
  const fontSize = cssPixels(style.fontSize, 16) * scale
  const cssLineHeight = cssPixels(style.lineHeight)
  const lineHeight = cssLineHeight > 0 ? cssLineHeight * scale : fontSize * 1.2
  const color = multiplyAlpha(
    parseCssColor(style.color) ?? { hex: '000000', alpha: 1 },
    opacity,
  )
  const decoration: HtmlTextStyle['decoration'] = []
  if (style.textDecorationLine.includes('underline'))
    decoration.push('underline')
  if (style.textDecorationLine.includes('line-through'))
    decoration.push('line-through')
  const language =
    element.closest('[lang]')?.getAttribute('lang') ??
    document.documentElement.lang ??
    undefined

  return {
    fontFamily: cssFontFamilies(style.fontFamily).join(', ') || 'Arial',
    fontSizePx: fontSize,
    fontWeight: cssFontWeight(style.fontWeight),
    fontStyle:
      style.fontStyle === 'italic' || style.fontStyle === 'oblique'
        ? 'italic'
        : 'normal',
    lineHeightPx: lineHeight,
    letterSpacingPx: cssPixels(style.letterSpacing) * averageScale(transform),
    color,
    align: cssTextAlign(style.textAlign),
    decoration,
    direction: style.direction === 'rtl' ? 'rtl' : 'ltr',
    language,
  }
}

function pseudoBox(
  element: HTMLElement,
  style: CSSStyleDeclaration,
  context: CaptureContext,
  transform: TransformMetrics,
): HtmlBox {
  const parent = normalizeRect(element.getBoundingClientRect(), context)
  const width = cssPixels(style.width, parent.width) * transform.scaleX
  const height =
    cssPixels(style.height, cssPixels(style.lineHeight, 0)) * transform.scaleY
  const left = cssPixels(style.left)
  const right = cssPixels(style.right)
  const top = cssPixels(style.top)
  const bottom = cssPixels(style.bottom)
  const x =
    style.left !== 'auto'
      ? parent.x + left * transform.scaleX
      : style.right !== 'auto'
        ? parent.x + parent.width - right * transform.scaleX - width
        : parent.x
  let y =
    style.top !== 'auto'
      ? parent.y + top * transform.scaleY
      : style.bottom !== 'auto'
        ? parent.y + parent.height - bottom * transform.scaleY - height
        : parent.y
  if (element instanceof HTMLLIElement) {
    const firstLine = firstTextLineBox(element, context)
    if (firstLine) y = firstLine.y + (firstLine.height - height) / 2
  }
  return {
    x: round(x, context),
    y: round(y, context),
    width: round(width, context),
    height: round(height, context),
  }
}

function firstTextLineBox(
  element: HTMLElement,
  context: CaptureContext,
): HtmlBox | undefined {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  )
  let current = walker.nextNode()
  while (current) {
    const node = current as Text
    const offset = node.data.search(/\S/u)
    if (offset >= 0) {
      const range = element.ownerDocument.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + 1)
      const rect = [...range.getClientRects()].find(
        (candidate) => candidate.width > 0 && candidate.height > 0,
      )
      range.detach()
      if (rect) return normalizeRect(rect, context)
    }
    current = walker.nextNode()
  }
  return undefined
}

function measureReplacementTextBox(
  element: HTMLElement,
  text: string,
  context: CaptureContext,
  transform: TransformMetrics,
): HtmlBox {
  const box = normalizeRect(element.getBoundingClientRect(), context)
  const original = element.textContent?.trim() ?? text
  if (original === text) return box

  const style = getComputedStyle(element)
  const canvas = element.ownerDocument.createElement('canvas')
  const canvasContext = canvas.getContext('2d')
  if (!canvasContext) return box
  canvasContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const letterSpacing = cssPixels(style.letterSpacing)
  const textWidth = (value: string) =>
    canvasContext.measureText(value).width +
    Math.max(0, [...value].length - 1) * letterSpacing
  const width = Math.max(
    0.01,
    box.width + (textWidth(text) - textWidth(original)) * transform.scaleX,
  )
  return {
    x: round(box.x + box.width - width, context),
    y: box.y,
    width: round(width, context),
    height: box.height,
  }
}

function normalizeRect(
  rect: DOMRect | DOMRectReadOnly,
  context: CaptureContext,
): HtmlBox {
  return normalizeDomRect(rect, {
    rootRect: context.rootRect,
    rootScaleX: context.rootScaleX,
    rootScaleY: context.rootScaleY,
    precision: context.options.precision,
  })
}

function imageContentBox(
  image: HTMLImageElement,
  box: HtmlBox,
  context: CaptureContext,
): HtmlBox {
  const style = getComputedStyle(image)
  if (
    style.objectFit !== 'contain' ||
    !image.naturalWidth ||
    !image.naturalHeight
  )
    return box
  const scale = Math.min(
    box.width / image.naturalWidth,
    box.height / image.naturalHeight,
  )
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  return {
    x: round(box.x + (box.width - width) / 2, context),
    y: round(box.y + (box.height - height) / 2, context),
    width: round(width, context),
    height: round(height, context),
  }
}

function emit<T extends HtmlSlideElement>(
  context: CaptureContext,
  element: Omit<T, 'order'>,
): void {
  context.elements.push({ ...element, order: context.nextOrder++ } as T)
}

function rotationProperty(
  transform: TransformMetrics,
): { rotation: number } | Record<string, never> {
  const rotation = nonZeroRotation(transform.rotation)
  return rotation === undefined ? {} : { rotation }
}

function warn(
  context: CaptureContext,
  code: HtmlConversionWarning['code'],
  message: string,
  elementId?: string,
): void {
  context.warnings.push({
    code,
    message,
    ...(elementId === undefined ? {} : { elementId }),
  })
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function round(value: number, context: CaptureContext): number {
  return roundTo(value, context.options.precision)
}

function numericOpacity(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 1
}

function numericZIndex(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
