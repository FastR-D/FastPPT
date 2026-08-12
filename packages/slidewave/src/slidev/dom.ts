import type { HtmlElementSource } from './types'

export const IGNORED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'NOSCRIPT',
  'META',
  'LINK',
])

export const DEFAULT_EXCLUDES = [
  '.slidev-vclick-hidden',
  '.slidev-vclick-hidden-explicitly',
  '[data-slidev-export-ignore]',
]

export function elementSource(
  element: Element,
  path: string,
): HtmlElementSource {
  const className =
    typeof element.className === 'string'
      ? element.className || undefined
      : undefined
  return {
    tag: element.tagName.toLowerCase(),
    path,
    ...(className === undefined ? {} : { className }),
  }
}

export function matchesAnySelector(
  element: HTMLElement,
  selectors: string[],
): boolean {
  return selectors.some((selector) => {
    try {
      return element.matches(selector)
    } catch {
      return false
    }
  })
}

export function isRenderedElement(
  element: HTMLElement,
  style: CSSStyleDeclaration,
  rootRect: DOMRectReadOnly,
): boolean {
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse'
  )
    return false
  const rect = element.getBoundingClientRect()
  const hasText = Boolean(element.textContent?.trim())
  if (rect.width <= 0 || (rect.height <= 0 && !hasText)) return false
  return (
    rect.right > rootRect.left &&
    rect.left < rootRect.right &&
    rect.bottom > rootRect.top &&
    rect.top < rootRect.bottom
  )
}

export function isVisibleRoot(root: HTMLElement): boolean {
  const style = getComputedStyle(root)
  const rect = root.getBoundingClientRect()
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    numericOpacity(style.opacity) > 0 &&
    rect.width > 0 &&
    rect.height > 0
  )
}

export function isImageElement(
  element: HTMLElement,
): element is HTMLImageElement {
  return element instanceof HTMLImageElement
}

export function isUnsupportedMedia(element: HTMLElement): boolean {
  return (
    element instanceof HTMLVideoElement ||
    element instanceof HTMLAudioElement ||
    element instanceof HTMLIFrameElement ||
    element instanceof HTMLEmbedElement ||
    element instanceof HTMLObjectElement
  )
}

export function applyTextTransform(value: string, transform: string): string {
  if (transform === 'uppercase') return value.toUpperCase()
  if (transform === 'lowercase') return value.toLowerCase()
  if (transform === 'capitalize')
    return value.replace(/\b\p{L}/gu, (character) => character.toUpperCase())
  return value
}

export function pseudoText(
  value: string,
  element: HTMLElement,
  pseudo?: 'before' | 'after',
): string {
  if (!value || value === 'none' || value === 'normal' || value === '""')
    return ''
  const counter = /counter\(\s*([\w-]+)(?:\s*,\s*[^)]+)?\s*\)/.exec(value)
  if (counter) return resolveCssCounter(element, counter[1]!, pseudo)
  return value.replace(/^['"]|['"]$/g, '').replace(/\\A/g, '\n')
}

function resolveCssCounter(
  element: HTMLElement,
  name: string,
  pseudo?: 'before' | 'after',
): string {
  const siblings = [...(element.parentElement?.children ?? [])].filter(
    (candidate): candidate is HTMLElement => candidate instanceof HTMLElement,
  )
  const index = siblings.indexOf(element)
  const start = counterResetValue(element, name)
  let value = start
  for (const sibling of siblings.slice(0, index + 1)) {
    const increment = counterIncrementValue(sibling, name, pseudo)
    if (increment !== undefined) value += increment
  }

  // Ordered lists commonly rely on the browser's implicit counter instead of
  // declaring counter-increment in computed CSS.
  if (value === start && element instanceof HTMLLIElement)
    value =
      start +
      siblings
        .filter((sibling) => sibling instanceof HTMLLIElement)
        .indexOf(element) +
      1
  return String(value)
}

function counterResetValue(element: HTMLElement | null, name: string): number {
  let current = element
  while (current) {
    const tokens = getComputedStyle(current).counterReset.split(/\s+/)
    const index = tokens.indexOf(name)
    if (index >= 0) {
      const value = Number.parseInt(tokens[index + 1] ?? '0', 10)
      return Number.isFinite(value) ? value : 0
    }
    current = current.parentElement
  }
  return 0
}

function counterIncrementValue(
  element: HTMLElement,
  name: string,
  pseudo?: 'before' | 'after',
): number | undefined {
  const style = pseudo
    ? getComputedStyle(element, `::${pseudo}`)
    : getComputedStyle(element)
  const tokens = style.counterIncrement.split(/\s+/)
  const index = tokens.indexOf(name)
  if (index < 0) return undefined
  const value = Number.parseInt(tokens[index + 1] ?? '1', 10)
  return Number.isFinite(value) ? value : 1
}

function numericOpacity(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 1
}
