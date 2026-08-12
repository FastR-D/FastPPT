import { centeredTextBox, roundTo } from '../../geometry'
import { normalizeSlidevPageNumber } from '../../slidev'
import type { SlidevCaptureTheme, ThemeTextCaptureContext } from '../types'

const GROUP_SELECTORS = ['.katex', '.ustc-section-bar']

export const academyTheme: SlidevCaptureTheme = {
  name: 'academy',
  matches: (root) =>
    Boolean(
      root.querySelector(
        '.ustc-section-bar, .cover-logo[src*="ustc"], .callout, .numbered-list',
      ),
    ),
  captureAsGroup: ({ element }) =>
    GROUP_SELECTORS.some((selector) => element.matches(selector)),
  adjustText: adjustUstcText,
  adjustBackgroundBox: ({ element, box, precision }) => {
    if (!isInlineCode(element)) return undefined
    return inlineCodeBox(box, precision)
  },
  adjustGroupedCapture: ({ element, rootScaleY }) => {
    if (!element.matches('.ustc-section-bar')) return undefined
    const rootFontSize =
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
      16
    const remHeight =
      element.classList.contains('is-minimal') ||
      element.classList.contains('is-labels')
        ? 1.5
        : 2
    const height = remHeight * rootFontSize * rootScaleY
    return { height, style: { height: `${height}px` } }
  },
}

function adjustUstcText(context: ThemeTextCaptureContext) {
  const footerRight = context.parent.closest(
    '.footer-right',
  ) as HTMLElement | null
  if (
    footerRight &&
    typeof footerRight.getBoundingClientRect === 'function' &&
    /^\s*\d+\s*\/\s*\d+\s*$/.test(context.text)
  ) {
    const text = normalizeSlidevPageNumber(context.text, context.slideId)
    return {
      text,
      box: context.measureReplacementBox(footerRight, text),
      align: 'right' as const,
      verticalAlign: 'middle' as const,
    }
  }

  if (context.parent.classList.contains('numbered-list-marker-text')) {
    const marker = context.parent.closest(
      '.numbered-list-marker',
    ) as HTMLElement | null
    if (!marker || typeof marker.getBoundingClientRect !== 'function')
      return undefined
    const markerBox = context.rect(marker)
    const opticalOffset = markerBox.height * 0.04
    return {
      box: {
        ...markerBox,
        y: roundTo(markerBox.y - opticalOffset, context.precision),
        height: markerBox.height,
      },
      align: 'center' as const,
      verticalAlign: 'middle' as const,
    }
  }

  const footnoteRef = context.parent.closest(
    '.footnote-ref',
  ) as HTMLElement | null
  if (footnoteRef && typeof footnoteRef.getBoundingClientRect === 'function') {
    const parentBox = context.rect(context.parent)
    return {
      box: {
        ...context.box,
        y: roundTo(
          parentBox.y - context.style.fontSizePx * 0.12,
          context.precision,
        ),
        height: roundTo(
          Math.max(context.style.lineHeightPx, context.style.fontSizePx * 1.1),
          context.precision,
        ),
      },
      verticalAlign: 'middle' as const,
    }
  }

  const footnotes = context.parent.closest('.footnotes') as HTMLElement | null
  if (footnotes && typeof footnotes.getBoundingClientRect === 'function') {
    return {
      box: {
        ...context.box,
        height: roundTo(
          Math.max(context.box.height, context.style.lineHeightPx),
          context.precision,
        ),
      },
      verticalAlign: 'middle' as const,
    }
  }

  const tocArrow = context.parent.closest('.toc-arrow') as HTMLElement | null
  if (tocArrow && typeof tocArrow.getBoundingClientRect === 'function') {
    const item = tocArrow.closest('.toc-item') as HTMLElement | null
    if (item && typeof item.getBoundingClientRect === 'function') {
      return {
        box: centeredTextBox(
          context.rect(tocArrow),
          context.rect(tocArrow),
          context.rect(item),
          context.style,
          0,
          context.precision,
        ),
        align: 'center' as const,
        verticalAlign: 'middle' as const,
      }
    }
  }

  const takeaway = context.parent.closest('.takeaway') as HTMLElement | null
  if (takeaway && typeof takeaway.getBoundingClientRect === 'function') {
    return {
      box: centeredTextBox(
        context.box,
        context.rect(context.parent),
        context.rect(takeaway),
        context.style,
        0,
        context.precision,
      ),
      verticalAlign: 'middle' as const,
    }
  }

  const container = closestCenteredFlexContainer(context.parent)
  if (!container) return undefined
  return {
    box: centeredTextBox(
      context.box,
      context.rect(context.parent),
      context.rect(container),
      context.style,
      0,
      context.precision,
    ),
    verticalAlign: 'middle' as const,
  }
}

function isInlineCode(element: HTMLElement): boolean {
  return element.tagName === 'CODE' && !element.closest('.slidev-code, pre')
}

function inlineCodeBox(
  box: { x: number; y: number; width: number; height: number },
  precision: number,
) {
  const inset = Math.min(1.25, box.height * 0.06)
  return {
    ...box,
    y: roundTo(box.y + inset, precision),
    height: roundTo(Math.max(0.01, box.height - inset * 2), precision),
  }
}

function closestCenteredFlexContainer(
  element: HTMLElement,
): HTMLElement | undefined {
  let current: HTMLElement | null = element
  while (current) {
    if (typeof getComputedStyle !== 'function') return undefined
    const style = getComputedStyle(current)
    if (
      (style.display === 'flex' || style.display === 'inline-flex') &&
      style.alignItems === 'center'
    )
      return current
    current = current.parentElement
  }
  return undefined
}
