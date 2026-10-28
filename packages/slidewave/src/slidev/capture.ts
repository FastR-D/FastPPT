import { parseNativeGeometry } from '../primitives/native-geometry.js'
import { captureTable, UnsupportedTableError } from './capture-table.js'
import { clipImageBox, type ImageClip } from './image-clipping.js'
import { readSourceCapitalization } from '../primitives/text-capitalization.mjs'
import { readSourceKerning } from '../primitives/text-kerning.mjs'
import { readSourceBaseline } from '../primitives/text-baseline.mjs'
import { readTextDecorationContract } from '../primitives/text-decoration.mjs'
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
import { captureTextParagraphs } from './capture-text-box.js'
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
  type HtmlTableElement,
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

  if (options.snapshotVersion !== undefined && options.snapshotVersion !== 1 && options.snapshotVersion !== 2) throw new TypeError('Unsupported capture snapshot version; expected 1 or 2.')
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
    version: options.snapshotVersion ?? HTML_SNAPSHOT_VERSION,
    id: options.id ?? (root.id || root.dataset.slidevPage || 'slide'),
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
    version: options.snapshotVersion ?? HTML_SNAPSHOT_VERSION,
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
  const geometryMetadata = element.getAttribute('data-fastppt-geometry')
  if (geometryMetadata !== null) {
    const geometry = parseNativeGeometry(geometryMetadata)
    if (Math.abs(transform.rotation)>0.01 || Math.abs(transform.scaleX-transform.scaleY)>0.001) throw new Error('Native geometry must use baked coordinates and uniform viewport scaling')
    const box=normalizeRect(element.getBoundingClientRect(),context)
    const paintChildren=[...element.children].filter((child):child is HTMLElement=>child instanceof HTMLElement)
    const fillStyle=geometry.fill!=='none'&&paintChildren[0]?getComputedStyle(paintChildren[0]):undefined
    const strokeStyle=geometry.stroke!=='none'&&paintChildren.length?getComputedStyle(paintChildren[paintChildren.length-1]!):undefined
    // CSS paint is editable. Metadata provides geometry and a fallback paint;
    // changing an authored HTML color/alpha must also change the exported shape.
    const fill=geometry.fill==='none'?undefined:parseCssColor(fillStyle?.backgroundColor ?? geometry.fill)
    const stroke=geometry.stroke==='none'?undefined:parseCssColor(strokeStyle?.backgroundColor ?? geometry.stroke)
    if(geometry.fill!=='none'&&!fill || geometry.stroke!=='none'&&!stroke)throw new Error('Invalid native geometry paint color')
    emit<HtmlShapeElement>(context,{
      id:`${path}:native-geometry`,kind:'shape',shape:'freeform',geometry:{paths:geometry.paths,fillRule:geometry.fillRule},box,source,zIndex,opacity,
      ...(fill?{fill:multiplyAlpha(fill,opacity*(fillStyle?numericOpacity(fillStyle.opacity):geometry.fillOpacity??1))}:{}),
      ...(stroke&&geometry.strokeWidthRatio>0?{stroke:{color:multiplyAlpha(stroke,opacity*(strokeStyle?numericOpacity(strokeStyle.opacity):geometry.strokeOpacity??1)),widthPx:box.width*geometry.strokeWidthRatio}}:{}),
    })
    return // Child CSS polygons/line segments are implementation, not duplicate objects.
  }
  let tableFallbackStart: number | undefined
  if (element instanceof HTMLTableElement && context.options.snapshotVersion === 2) {
    const id = source.anchor ? `table:${source.anchor}` : `${path}:table`
    try {
      if (Math.abs(transform.rotation) > 0.01 || Math.abs(transform.scaleX - transform.scaleY) > 0.001) throw new UnsupportedTableError('Native tables require unrotated, uniformly scaled geometry.')
      for (let ancestor = element.parentElement; ancestor && context.root.contains(ancestor); ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor), clip = ancestor.getBoundingClientRect(), bounds = element.getBoundingClientRect()
        if ((css.overflowX !== 'visible' && (bounds.left < clip.left - 1 || bounds.right > clip.right + 1)) || (css.overflowY !== 'visible' && (bounds.top < clip.top - 1 || bounds.bottom > clip.bottom + 1))) throw new UnsupportedTableError('An ancestor clips the table; native replacement would reveal hidden content.')
      }
      const captured = captureTable(element, {
        id, opacity,
        normalize: rect => normalizeRect(rect, context),
        textStyle: (node, alpha) => captureTextStyle(getComputedStyle(node), node, alpha, transform),
        scaleX: transform.scaleX, scaleY: transform.scaleY,
        excluded: node => matchesAnySelector(node, context.excludes),
      })
      emit<HtmlTableElement>(context, { ...captured, id, kind: 'table', opacity, zIndex, source })
      if (element.caption) await visitElement(context, element.caption, `${path}/caption`, opacity, zIndex, transform)
      return
    } catch (error) {
      if (!(error instanceof UnsupportedTableError)) throw error
      warn(context, 'unsupported-table', `Native table ${id}: ${error.message} Falling back to fragments; table structure is not preserved.`, id)
      tableFallbackStart = context.elements.length
    }
  }
  if (element.hasAttribute('data-fastppt-text-box')) {
    if (Math.abs(transform.rotation) > 0.01 || Math.abs(transform.scaleX - transform.scaleY) > 0.001) throw new Error('Explicit text boxes require unrotated, uniformly scaled geometry.')
    const paragraphs = captureTextParagraphs(element, {
      scale: averageScale(transform), opacity,
      style: (node, alpha) => captureTextStyle(getComputedStyle(node), node, alpha, transform),
      excluded: node => matchesAnySelector(node, context.excludes),
    })
    const owner = element.parentElement?.hasAttribute('data-fastppt-source-text-frame') ? element.parentElement : undefined
    if (owner && [...owner.childNodes].some(node => node !== element && (node instanceof Text ? !!node.data.trim() : node instanceof Element && isRenderedElement(node, getComputedStyle(node), context.rootRect)))) throw new Error('A source text frame must contain only its explicit text box.')
    const frameStyle = owner ? getComputedStyle(owner) : undefined
    if (owner && frameStyle) {
      const rect = normalizeRect(element.getBoundingClientRect(), context)
      const frame = normalizeRect(owner.getBoundingClientRect(), context)
      const left = cssPixels(frameStyle.paddingLeft) * transform.scaleX
      const right = cssPixels(frameStyle.paddingRight) * transform.scaleX
      if (['marginTop', 'marginRight', 'marginBottom', 'marginLeft'].some(key => cssPixels(style[key as keyof CSSStyleDeclaration] as string) !== 0) || Math.abs(rect.x - frame.x - left) > 1 || Math.abs(rect.width - (frame.width - left - right)) > 1) throw new Error('Explicit text box must fill the source frame content width without extra margins.')
    }
    const verticalAlign = frameStyle?.justifyContent === 'center' ? 'middle' : frameStyle?.justifyContent === 'flex-end' ? 'bottom' : 'top'
    const textFrame = frameStyle ? {
      insetsPx: { left: cssPixels(frameStyle.paddingLeft) * transform.scaleX, right: cssPixels(frameStyle.paddingRight) * transform.scaleX, top: cssPixels(frameStyle.paddingTop) * transform.scaleY, bottom: cssPixels(frameStyle.paddingBottom) * transform.scaleY },
      wrap: frameStyle.whiteSpace !== 'pre',
    } : undefined
    emit<HtmlTextElement>(context, {
      id: `${path}:text-box`, kind: 'text',
      text: paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n'),
      style: paragraphs[0]!.style, paragraphs,
      box: normalizeRect((owner ?? element).getBoundingClientRect(), context),
      ...(textFrame ? { textFrame } : {}),
      opacity, zIndex, source, verticalAlign,
    })
    return
  }
  if (element.hasAttribute('data-fastppt-tab')) throw new Error('Source tabs require an explicit data-fastppt-text-box frame.')
  const bulletProperties = element.getAttribute('data-fastppt-bullet')
  if (element.hasAttribute('data-fastppt-bullet-marker') || bulletProperties !== null && (JSON.parse(bulletProperties) as { bullet?: { kind?: unknown } } | null)?.bullet?.kind !== 'none') throw new Error('Source paragraph bullets require an explicit data-fastppt-text-box frame.')
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
    if (tableFallbackStart !== undefined) markTableFragments(context, tableFallbackStart, source.anchor ? `table:${source.anchor}` : `${path}:table`)
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
    capturedBorder = await captureBackground(
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
    await capturePseudo(
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
  } else if (captureScriptText(context, element, path, opacity, zIndex, transform)) {
    // Source-layout script spans stay one editable text shape per authored run.
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
    await capturePseudo(
      context,
      element,
      'after',
      source,
      opacity,
      zIndex,
      transform,
    )
  }
  if (tableFallbackStart !== undefined) markTableFragments(context, tableFallbackStart, source.anchor ? `table:${source.anchor}` : `${path}:table`)
}

function markTableFragments(context: CaptureContext, start: number, ownerId: string): void {
  for (const element of context.elements.slice(start)) element.structure ??= { kind: 'table', ownerId, requiredRepresentation: 'native-table' }
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

async function captureBackground(
  context: CaptureContext,
  element: HTMLElement,
  style: CSSStyleDeclaration,
  source: HtmlElementSource,
  opacity: number,
  zIndex: number,
  transform: TransformMetrics,
): Promise<boolean> {
  let fill = parseCssColor(style.backgroundColor)
  let gradient: HtmlGradient | undefined
  let backgroundData: string | undefined
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
      const url = cssBackgroundUrl(backgroundImage)
      if (url) {
        try {
          backgroundData = backgroundImageSvgDataUrl(
            await resourceToDataUrl(url),
            style.backgroundSize,
            style.backgroundPosition,
          )
        } catch (error) {
          warn(
            context,
            'image-embed-failed',
            `CSS background image could not be embedded: ${errorMessage(error)}`,
            source.path,
          )
        }
      }
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
  if (
    (!fill || fill.alpha <= 0) &&
    !gradient &&
    !backgroundData &&
    !shadow &&
    !stroke
  )
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
      source: element === context.root || element === context.root.querySelector('.slidev-layout') ? { ...source, role: 'slide-background' } : source,
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
    if (backgroundData) {
      emit<HtmlImageElement>(context, {
        id: `${source.path}:background-image-${index}`,
        kind: 'image',
        box,
        zIndex,
        opacity,
        source,
        data: backgroundData,
        alt: '',
        ...rotationProperty(transform),
      })
    }
    emittedStroke ||= Boolean(stroke)
  }
  return emittedStroke
}

function cssBackgroundUrl(backgroundImage: string): string | undefined {
  const match = /url\(\s*(["']?)(.*?)\1\s*\)/i.exec(backgroundImage)
  return match?.[2]
}

function backgroundImageSvgDataUrl(
  data: string,
  size: string,
  position: string,
): string {
  const fit = size.includes('contain') ? 'meet' : 'slice'
  const horizontal = position.includes('left')
    ? 'xMin'
    : position.includes('right')
      ? 'xMax'
      : 'xMid'
  const vertical = position.includes('top')
    ? 'YMin'
    : position.includes('bottom')
      ? 'YMax'
      : 'YMid'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><image href="${data.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" width="100" height="100" preserveAspectRatio="${horizontal}${vertical} ${fit}"/></svg>`
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
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

/** Collapse only the generated font-routing wrapper, preserving its source run. */
function paragraphLevel(element: Element): number | undefined {
  const value = element.closest('[data-fastppt-text-level]')?.getAttribute('data-fastppt-text-level')
  if (value === undefined || value === null) return undefined
  if (!/^[1-9]$/.test(value)) throw new Error('Source paragraph level must be between 1 and 9.')
  return Number(value)
}

function captureScriptText(
  context: CaptureContext,
  element: HTMLElement,
  path: string,
  opacity: number,
  zIndex: number,
  transform: TransformMetrics,
): boolean {
  if (element.tagName !== 'SPAN' || !element.hasAttribute('data-fastppt-script-text')) return false
  const style = getComputedStyle(element)
  if (!['pre', 'pre-wrap', 'break-spaces'].includes(style.whiteSpace)) return false
  const base = captureTextStyle(style, element, opacity, transform)
  // Source decorations live on leaves so authored cancellation can work.
  // A generated script group may still be one editable run when every leaf
  // has the same validated style; do not mistake its undecorated wrapper for
  // an instruction to discard or split those decorations.
  const first = element.firstElementChild
  if (style.textDecorationLine === 'none' && first?.hasAttribute('data-fastppt-text-decoration-run') && [...element.childNodes].every(child => child instanceof HTMLSpanElement))
    base.decoration = captureTextStyle(getComputedStyle(first), first, opacity, transform).decoration
  if (first?.hasAttribute('data-fastppt-text-capitalization-run')) base.capitalization = readSourceCapitalization(first)
  if (first?.hasAttribute('data-fastppt-text-baseline-run')) base.baselinePercent = readSourceBaseline(first)!.baselinePercent
  if (first?.hasAttribute('data-fastppt-text-kerning')) base.kerningThresholdPx = readSourceKerning(first)!.thresholdPx * averageScale(transform)
  const fontFamilies: NonNullable<HtmlTextStyle['fontFamilies']> = {}
  const comparable = (value: HtmlTextStyle) => JSON.stringify(Object.fromEntries(Object.entries({ ...value, fontFamily: '' }).sort(([left], [right]) => left.localeCompare(right))))
  for (const child of element.childNodes) {
    if (child instanceof Text) continue
    if (!(child instanceof HTMLSpanElement) || [...child.childNodes].some(node => !(node instanceof Text))) return false
    const script = child.getAttribute('data-fastppt-font-script')
    if (script !== 'latin' && script !== 'ea' && script !== 'cs') return false
    const computed = getComputedStyle(child)
    if (
      computed.display !== 'inline' || computed.visibility !== 'visible' ||
      Number(computed.opacity) !== 1 || computed.transform !== 'none' ||
      (computed.position !== 'static' && !readSourceBaseline(child)) || computed.verticalAlign !== 'baseline' ||
      computed.whiteSpace !== style.whiteSpace || (base.capitalization === undefined && computed.textTransform !== style.textTransform) ||
      computed.backgroundImage !== 'none' || parseCssColor(computed.backgroundColor)?.alpha ||
      computed.boxShadow !== 'none' || computed.filter !== 'none' ||
      computed.clipPath !== 'none' || computed.maskImage !== 'none' ||
      ['before', 'after'].some(pseudo => !['none', 'normal', '""', "''"].includes(getComputedStyle(child, `::${pseudo}`).content)) ||
      ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'].some(property => parseFloat(computed[property as keyof CSSStyleDeclaration] as string) !== 0) ||
      comparable(captureTextStyle(computed, child, opacity, transform)) !== comparable(base)
    ) return false
    const face = cssFontFamilies(computed.fontFamily)[0]
    if (!face || (fontFamilies[script] && fontFamilies[script] !== face)) return false
    fontFamilies[script] = face
  }
  const text = base.capitalization === undefined ? applyTextTransform(element.textContent ?? '', style.textTransform) : element.textContent ?? ''
  if (!text.trim()) return true
  const box = normalizeRect(element.getBoundingClientRect(), context)
  if (!isUsefulBox(box)) return false
  // The routing wrapper is generated below the original content element.
  const source = elementSource(element.parentElement ?? element, path)
  emit<HtmlTextElement>(context, {
    id: `${path}:script-text`, kind: 'text', text,
    box: fontSafeLineBox(box, base.lineHeightPx, context.options.precision),
    zIndex, opacity, source, style: { ...base, fontFamilies },
    paragraphLevel: paragraphLevel(element),
    ...rotationProperty(transform),
    ...(element.closest('a')?.href ? { hyperlink: element.closest('a')!.href } : {}),
  })
  return true
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
  const baseline = readSourceBaseline(parent)
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
    const rects = [...range.getClientRects()].filter(candidate => candidate.width > 0 && candidate.height > 0)
    if (textStyle.capitalization !== undefined && rects.length > 1) throw new Error('A displayed capitalized grapheme crosses line boxes; use an explicit text frame.')
    const rect = rects[0]
    if (!rect) continue
    const box = normalizeRect(rect, context)
    if (baseline) box.y += baseline.shiftPx * transform.scaleY
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
    const value = textStyle.capitalization === undefined ? applyTextTransform(fragment.text, style.textTransform) : fragment.text
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
    if (textStyle.capitalization !== undefined && adjustment?.text !== undefined && adjustment.text !== value) throw new Error('Theme text replacement conflicts with original capitalization text.')
    const text = adjustment?.text ?? value
    if (!text.trim()) continue
    const measuredAdvance =
      textStyle.capitalization === undefined ? measureTextAdvance(text, style) * averageScale(transform) : fragment.box.width
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
      paragraphLevel: paragraphLevel(parent),
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
  const clips: ImageClip[] = []
  for (let ancestor = image.parentElement; ancestor && context.root.contains(ancestor); ancestor = ancestor.parentElement) {
    const css = getComputedStyle(ancestor)
    const clipsX = /^(hidden|clip|scroll|auto)$/.test(css.overflowX)
    const clipsY = /^(hidden|clip|scroll|auto)$/.test(css.overflowY)
    if (!clipsX && !clipsY) continue
    const rect = ancestor.getBoundingClientRect()
    // Overflow clips at the padding box, inside borders and scrollbars.
    const scaleX = ancestor.offsetWidth ? rect.width / ancestor.offsetWidth : 1
    const scaleY = ancestor.offsetHeight ? rect.height / ancestor.offsetHeight : 1
    clips.push({
      box: normalizeRect({
        left: rect.left + ancestor.clientLeft * scaleX,
        top: rect.top + ancestor.clientTop * scaleY,
        width: ancestor.clientWidth * scaleX,
        height: ancestor.clientHeight * scaleY,
      } as DOMRectReadOnly, context),
      x: clipsX,
      y: clipsY,
    })
  }
  const visible = clipImageBox(box, clips)
  if (!visible) return
  // An axis-aligned source rectangle cannot represent a rotated clipping mask.
  const rotated = nonZeroRotation(transform.rotation) !== undefined
  if (rotated && visible.crop) warn(context, 'unsupported-transform', 'Overflow clipping of rotated images cannot be represented as a native source rectangle.', source.path)
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
    box: rotated ? box : visible.box,
    zIndex,
    opacity,
    source,
    ...(data ? { data } : {}),
    ...(path ? { path } : {}),
    assetKey: src,
    alt: image.alt,
    ...(!rotated && visible.crop ? { crop: visible.crop } : {}),
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

async function capturePseudo(
  context: CaptureContext,
  element: HTMLElement,
  pseudo: 'before' | 'after',
  parentSource: HtmlElementSource,
  opacity: number,
  zIndex: number,
  transform: TransformMetrics,
): Promise<void> {
  const style = getComputedStyle(element, `::${pseudo}`)
  const content = pseudoText(style.content, element, pseudo)
  const fill = parseCssColor(style.backgroundColor)
  const backgroundImage = style.backgroundImage
  const gradient = /gradient\(/i.test(backgroundImage)
    ? parseCssLinearGradient(backgroundImage) ?? undefined
    : undefined
  let backgroundData: string | undefined
  if (backgroundImage && backgroundImage !== 'none' && !gradient) {
    const url = cssBackgroundUrl(backgroundImage)
    if (url) {
      try {
        backgroundData = backgroundImageSvgDataUrl(
          await resourceToDataUrl(url),
          style.backgroundSize,
          style.backgroundPosition,
        )
      } catch (error) {
        warn(
          context,
          'image-embed-failed',
          `Pseudo-element background image could not be embedded: ${errorMessage(error)}`,
          `${parentSource.path}::${pseudo}`,
        )
      }
    }
  }
  const maskImage = style.maskImage || style.webkitMaskImage
  if (
    !content &&
    (!fill || fill.alpha <= 0) &&
    !gradient &&
    !backgroundData &&
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
  } else if ((fill && fill.alpha > 0) || gradient) {
    emit<HtmlShapeElement>(context, {
      id: `${source.path}:background`,
      kind: 'shape',
      shape: recognizeShape(style, box),
      box,
      zIndex,
      opacity,
      source,
      ...(fill ? { fill: multiplyAlpha(fill, opacity) } : {}),
      ...(gradient
        ? {
            gradient: {
              ...gradient,
              stops: gradient.stops.map((stop) => ({
                ...stop,
                color: multiplyAlpha(stop.color, opacity),
              })),
            },
          }
        : {}),
      radiusPx: cssPixels(style.borderTopLeftRadius) * averageScale(transform),
    })
  }

  if (backgroundData) {
    emit<HtmlImageElement>(context, {
      id: `${source.path}:background-image`,
      kind: 'image',
      box,
      zIndex,
      opacity,
      source,
      data: backgroundData,
      alt: '',
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
  const baseline = readSourceBaseline(element)
  const kerning = readSourceKerning(element)
  const capitalization = readSourceCapitalization(element)
  if (capitalization === undefined && (element.hasAttribute('data-fastppt-text-baseline-run') || element.hasAttribute('data-fastppt-font-script')) && (style.textTransform !== 'none' || style.fontVariantCaps !== 'normal')) throw new Error('Source capitalization requires an explicit original-text contract.')
  if (!kerning && style.fontKerning === 'none' && (element.hasAttribute('data-fastppt-text-level') || element.hasAttribute('data-fastppt-text-baseline-run'))) throw new Error('Source text with disabled kerning requires an explicit threshold contract.')
  if (baseline?.baselinePercent && (Math.abs(transform.rotation) > 0.01 || Math.abs(transform.scaleX - transform.scaleY) > 0.001)) throw new Error('Source baseline requires unrotated, uniformly scaled text.')
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
  const sourceRun = readTextDecorationContract(element, 'data-fastppt-text-decoration-run')
  const sourceDefaults = readTextDecorationContract(element, 'data-fastppt-text-decoration-defaults')
  if (sourceRun) {
    for (const [key, line] of [['underline', 'underline'], ['strike', 'line-through']] as const)
      if (decoration.includes(line) !== (sourceRun[key] === true)) throw new Error('Source text decoration differs from its displayed run.')
    if (decoration.length && (style.textDecorationStyle !== 'solid' || style.textDecorationColor !== style.color || style.textDecorationThickness !== 'auto' || style.textUnderlineOffset !== 'auto' || style.textDecorationSkipInk !== 'none')) throw new Error('Source text decoration has unsupported line style, color or geometry.')
    if (/overline|blink/.test(style.textDecorationLine)) throw new Error('Unsupported source text decoration.')
  }
  if (sourceDefaults) {
    if (!element.hasAttribute('data-fastppt-text-level') && element.tagName !== 'BR') throw new Error('Text decoration defaults require a paragraph or soft break.')
    for (const [key, line] of [['underline', 'underline'], ['strike', 'line-through']] as const)
      if (sourceDefaults[key] && !decoration.includes(line)) decoration.push(line)
  }
  const language =
    element.closest('[lang]')?.getAttribute('lang') ??
    document.documentElement.getAttribute('lang') ??
    undefined
  const alternativeLanguage = element.closest('[data-fastppt-alt-lang]')?.getAttribute('data-fastppt-alt-lang') ?? undefined
  const directionContract = element.closest('[data-fastppt-text-direction]')?.getAttribute('data-fastppt-text-direction')
  if (directionContract !== undefined && directionContract !== null && (!['ltr', 'rtl'].includes(directionContract) || directionContract !== style.direction)) throw new Error('Source paragraph direction differs from its displayed text.')

  return {
    fontFamily: cssFontFamilies(style.fontFamily).join(', ') || 'Arial',
    fontSizePx: fontSize,
    ...(capitalization === undefined ? {} : { capitalization }),
    ...(kerning ? { kerningThresholdPx: kerning.thresholdPx * scale } : {}),
    ...(baseline ? { baselinePercent: baseline.baselinePercent } : {}),
    fontWeight: cssFontWeight(style.fontWeight),
    fontStyle:
      style.fontStyle === 'italic' || style.fontStyle === 'oblique'
        ? 'italic'
        : 'normal',
    lineHeightPx: lineHeight,
    letterSpacingPx: cssPixels(style.letterSpacing) * averageScale(transform),
    color,
    align: cssTextAlign(style.textAlign, style.direction),
    decoration,
    direction: style.direction === 'rtl' ? 'rtl' : 'ltr',
    ...(language === undefined ? {} : { language }),
    ...(alternativeLanguage === undefined ? {} : { alternativeLanguage }),
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
  canvasContext.fontKerning = style.fontKerning as CanvasFontKerning
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
