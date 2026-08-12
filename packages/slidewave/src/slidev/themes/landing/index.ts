import { centeredTextBox, roundTo } from '../../geometry'
import { normalizeSlidevPageNumber } from '../../slidev'
import type { HtmlBox, HtmlGradient } from '../../types'
import type {
  SlidevCaptureTheme,
  ThemeHighlightCaptureResult,
  ThemeTextCaptureAdjustment,
  ThemeTextCaptureContext,
} from '../types'

const HINT_BACKGROUND_CLASS = 'bg-gray-100/50'

export const landingTheme: SlidevCaptureTheme = {
  name: 'landing',
  matches: (root) =>
    Boolean(
      root.querySelector('.page-number') &&
      root.querySelector('.bg-primary, [class*="whu-"]'),
    ),
  adjustText: adjustLandingText,
  isTextHighlight: ({ element, gradient }) => isLandingMark(element, gradient),
  captureTextHighlight: ({ box, gradient, precision }) =>
    createLandingHighlightBand(box, gradient, precision),
}

export function landingHintOpticalOffset(fontSizePx: number): number {
  return fontSizePx >= 18 ? fontSizePx / 12 : 0
}

export function createLandingHighlightBand(
  box: HtmlBox,
  gradient: HtmlGradient,
  precision = 4,
): ThemeHighlightCaptureResult {
  const visible = gradient.stops.reduce((best, stop) =>
    stop.color.alpha > best.color.alpha ? stop : best,
  )
  const top = box.y + box.height * 0.54
  const height = box.height * 0.3
  return {
    box: {
      x: box.x,
      y: roundTo(top, precision),
      width: box.width,
      height: roundTo(height, precision),
    },
    fill: {
      ...visible.color,
      alpha: Math.min(0.45, visible.color.alpha * 0.45),
    },
    radiusPx: Math.min(2, height / 2),
  }
}

function adjustLandingText(
  context: ThemeTextCaptureContext,
): ThemeTextCaptureAdjustment | undefined {
  const pageNumber = context.parent.closest('.page-number')
  if (pageNumber && typeof pageNumber.getBoundingClientRect === 'function') {
    const text = normalizeSlidevPageNumber(context.text, context.slideId)
    return {
      text,
      box: context.measureReplacementBox(pageNumber as HTMLElement, text),
    }
  }

  const hintContainer = closestHintContainer(context.parent)
  const paperTitleContainer =
    context.parent.tagName === 'SUP'
      ? undefined
      : closestPaperTitleContainer(context.parent)
  const container = hintContainer ?? paperTitleContainer
  if (!container) return undefined
  const parentBox = context.rect(context.parent)
  if (parentBox.height > context.style.lineHeightPx * 1.5) return undefined

  const icon = hintContainer ? hintIcon(container) : undefined
  const iconBox = icon ? context.rect(icon) : undefined
  const textBox = iconBox
    ? {
        ...context.box,
        y: roundTo(
          iconBox.y + (iconBox.height - context.box.height) / 2,
          context.precision,
        ),
      }
    : centeredTextBox(
        context.box,
        parentBox,
        context.rect(container),
        context.style,
        hintContainer ? landingHintOpticalOffset(context.style.fontSizePx) : 0,
        context.precision,
      )

  return {
    box: textBox,
    verticalAlign: 'middle',
  }
}

function hintIcon(container: HTMLElement): HTMLElement | undefined {
  return [...container.children].find(
    (child): child is HTMLElement =>
      'classList' in child &&
      child.classList.contains('text-primary') &&
      child.classList.contains('shrink-0'),
  )
}

function closestHintContainer(element: HTMLElement): HTMLElement | undefined {
  let current: HTMLElement | null = element
  while (current) {
    const style = getComputedStyle(current)
    if (
      current.classList.contains(HINT_BACKGROUND_CLASS) &&
      style.display === 'flex' &&
      style.alignItems === 'center'
    ) {
      return current
    }
    current = current.parentElement
  }
  return undefined
}

function closestPaperTitleContainer(
  element: HTMLElement,
): HTMLElement | undefined {
  let current: HTMLElement | null = element
  while (current) {
    if (
      current.classList.contains('bg-primary') &&
      current.classList.contains('text-lg') &&
      current.classList.contains('flex-center') &&
      current.parentElement?.classList.contains('overflow-hidden')
    ) {
      return current
    }
    current = current.parentElement
  }
  return undefined
}

function isLandingMark(element: HTMLElement, gradient: HtmlGradient): boolean {
  if (
    element.tagName !== 'SPAN' ||
    gradient.angle !== 180 ||
    gradient.stops.length < 3
  )
    return false
  const classes = element.className
  const isThemeMark =
    typeof classes === 'string' &&
    (/\bd-mark-/.test(classes) ||
      (classes.includes('bg-gradient-to-b') &&
        classes.includes('from-transparent')))
  if (!isThemeMark) return false
  const first = gradient.stops[0]
  const last = gradient.stops.at(-1)
  return (
    first!.color.alpha === 0 &&
    last?.color.alpha === 0 &&
    gradient.stops.some((stop) => stop.color.alpha > 0)
  )
}
