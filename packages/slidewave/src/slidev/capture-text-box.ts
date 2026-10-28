import { readSourceCapitalization } from '../primitives/text-capitalization.mjs'
import { readSourceBaseline } from '../primitives/text-baseline.mjs'
import { captureTextTabs } from './capture-text-tabs.js'
import type { HtmlTextParagraph, HtmlTextStyle } from '../snapshot-types.js'
import { applyTextTransform } from './dom.js'
import { parseCssColor } from './css.js'
import { captureTextBullet } from './capture-text-bullet.js'

/** Only an explicit, ordinary-flow text frame may replace its descendant shapes. */
export function captureTextParagraphs(
  root: HTMLElement,
  options: {
    scale: number
    opacity: number
    style: (element: HTMLElement, opacity: number) => HtmlTextStyle
    excluded: (element: HTMLElement) => boolean
  },
): HtmlTextParagraph[] {
  const paragraphs: HtmlTextParagraph[] = []
  const numbering = new Map<number, { scheme: string; seed: number; next: number }>()
  const anchor = root.getAttribute('data-fastppt-group') ?? root.id
  const fail = (element: Element, reason: string): never => {
    throw new Error(
      `Explicit text box ${anchor || root.tagName.toLowerCase()}: ${reason} at ${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}.`,
    )
  }
  if (root.tagName !== 'DIV')
    fail(root, 'text frame must be a div containing paragraphs')
  const frame = root.getBoundingClientRect()
  const viewportScale = frame.width / parseFloat(getComputedStyle(root).width)
  if (!Number.isFinite(viewportScale) || viewportScale <= 0)
    fail(root, 'text frame must have a positive width')
  const textStyle = (element: HTMLElement, opacity: number): HtmlTextStyle => {
    const style = options.style(element, opacity)
    // Text decorations propagate visually through inline descendants, although
    // getComputedStyle on a generated script span reports only its own value.
    for (
      let parent = element.parentElement;
      parent && root.contains(parent);
      parent = parent.parentElement
    ) {
      const ancestor = getComputedStyle(parent)
      if (ancestor.textDecorationLine !== 'none' && ancestor.textDecorationColor !== getComputedStyle(element).color)
        fail(element, 'inherited decoration color differs from the run color')
      style.decoration = [
        ...new Set([
          ...style.decoration,
          ...getComputedStyle(parent).textDecorationLine.split(/\s+/).filter((line): line is 'underline' | 'line-through' => line === 'underline' || line === 'line-through'),
        ]),
      ]
    }
    return style
  }
  const walk = (
    node: Node,
    paragraph: HtmlTextParagraph | undefined,
    opacity: number,
  ): void => {
    if (node instanceof Text) {
      if (!node.data) return
      if (!paragraph) {
        if (node.data.trim())
          fail(node.parentElement!, 'text needs a projected paragraph')
        return
      }
      const parent = node.parentElement!
      const css = getComputedStyle(parent)
      const text = readSourceCapitalization(parent) === undefined ? applyTextTransform(node.data, css.textTransform) : node.data
      if (text.includes('\r') || (text.includes('\t') && !parent.hasAttribute('data-fastppt-tab')))
        fail(parent, 'tabs require measured source spacers; carriage returns are not supported')
      paragraph.runs.push({
        text,
        style: textStyle(parent, opacity),
        ...(parent.closest('a')?.href
          ? { hyperlink: parent.closest('a')!.href }
          : {}),
      })
      return
    }
    if (node.nodeType === Node.COMMENT_NODE) return
    if (!(node instanceof HTMLElement))
      fail(root, 'non-HTML content cannot be merged')
    const element = node as HTMLElement
    if (element.hasAttribute('data-fastppt-bullet-marker') || element.hasAttribute('data-fastppt-bullet-anchor')) {
      if (
        !paragraph ||
        !element.parentElement?.hasAttribute('data-fastppt-text-level')
      )
        fail(element, 'bullet marker must be a direct paragraph child')
      return // The complete marker is checked after its paragraph's visible runs.
    }
    if (options.excluded(element)) return
    const css = getComputedStyle(element)
    if (
      css.display === 'none' ||
      css.visibility !== 'visible' ||
      Number(css.opacity) === 0
    )
      return
    const localOpacity =
      element === root ? opacity : opacity * Number(css.opacity)
    const ownAnchor = element.getAttribute('data-fastppt-group') ?? element.id
    if (element !== root && ownAnchor && ownAnchor !== anchor)
      fail(element, 'independent anchors cannot share one native shape')
    if (element !== root && element.hasAttribute('data-fastppt-text-box'))
      fail(element, 'nested text frames are not supported')
    if (
      ![
        'DIV',
        'P',
        'H1',
        'H2',
        'H3',
        'H4',
        'H5',
        'H6',
        'UL',
        'OL',
        'LI',
        'SPAN',
        'STRONG',
        'B',
        'EM',
        'I',
        'U',
        'S',
        'DEL',
        'A',
        'BR',
      ].includes(element.tagName)
    )
      fail(element, 'unsupported text content')
    if (
      (css.position !== 'static' &&
        !(element.hasAttribute('data-fastppt-text-baseline-run') && readSourceBaseline(element)) &&
        !(
          element.hasAttribute('data-fastppt-bullet') &&
          element.hasAttribute('data-fastppt-text-level') &&
          element.querySelector(':scope > [data-fastppt-bullet-marker]') &&
          css.position === 'relative'
        )) ||
      css.transform !== 'none' ||
      css.float !== 'none' ||
      !['normal', '1'].includes(css.zoom) ||
      !['ltr', 'rtl'].includes(css.direction) ||
      css.writingMode !== 'horizontal-tb' ||
      (css.unicodeBidi !== 'normal' && !(css.unicodeBidi === 'isolate' && (element === root || !paragraph)))
    )
      fail(
        element,
        'positioned, transformed, vertical or inline bidi formatting cannot be merged',
      )
    if (
      css.overflowX !== 'visible' ||
      css.overflowY !== 'visible' ||
      css.columnCount !== 'auto' ||
      css.order !== '0' ||
      css.textOverflow !== 'clip' ||
      css.mixBlendMode !== 'normal'
    )
      fail(element, 'clipped, reordered or multi-column text is not supported')
    if (!['pre', 'pre-wrap', 'break-spaces'].includes(css.whiteSpace))
      fail(element, 'whitespace must be preserved')
    if (
      !['normal', '0px'].includes(css.wordSpacing) ||
      (css.fontVariantCaps !== 'normal' && readSourceCapitalization(element) !== 'small')
    )
      fail(element, 'word spacing and font variants are not supported')
    if (
      css.backgroundImage !== 'none' ||
      parseCssColor(css.backgroundColor)?.alpha ||
      css.boxShadow !== 'none' ||
      css.textShadow !== 'none' ||
      css.filter !== 'none' ||
      css.clipPath !== 'none' ||
      css.maskImage !== 'none'
    )
      fail(element, 'visual effects cannot be merged into text')
    if (
      css.textDecorationLine !== 'none' &&
      (css.textDecorationStyle !== 'solid' ||
        css.textDecorationColor !== css.color ||
        css.textDecorationThickness !== 'auto' ||
        css.textUnderlineOffset !== 'auto' ||
        /overline|blink/.test(css.textDecorationLine))
    )
      fail(element, 'unsupported text decoration')
    if (
      [
        'borderTopWidth',
        'borderRightWidth',
        'borderBottomWidth',
        'borderLeftWidth',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
      ].some(
        (key) =>
          parseFloat(css[key as keyof CSSStyleDeclaration] as string) !== 0,
      )
    )
      fail(element, 'borders and padding require separate geometry')
    if (
      ['before', 'after', 'marker'].some(
        (pseudo) =>
          !['none', 'normal', '""', "''"].includes(
            getComputedStyle(element, `::${pseudo}`).content,
          ),
      )
    )
      fail(element, 'generated content cannot be merged')
    if (css.listStyleType !== 'none' && css.display === 'list-item')
      fail(element, 'list markers need a native bullet contract')
    if (
      ['UL', 'OL', 'LI'].includes(element.tagName) &&
      css.listStyleType !== 'none'
    )
      fail(element, 'list markers need a native bullet contract')
    const level = element.getAttribute('data-fastppt-text-level')
    if (level !== null) {
      if (paragraph || !/^[1-9]$/.test(level))
        fail(element, 'invalid or nested paragraph level')
      if (
        !['block', 'flex'].includes(css.display) ||
        css.alignSelf !== 'auto' ||
        css.flexGrow !== '0' ||
        css.flexShrink !== '0'
      )
        fail(element, 'paragraph geometry cannot be represented')
      const rect = element.getBoundingClientRect()
      if (
        Math.abs(
          rect.left - frame.left - parseFloat(css.marginLeft) * viewportScale,
        ) > 1 ||
        Math.abs(
          rect.right -
            frame.right +
            parseFloat(css.marginRight) * viewportScale,
        ) > 1
      )
        fail(
          element,
          'paragraph width must match the text frame and its margins',
        )
      const size = (
        key:
          | 'marginLeft'
          | 'marginRight'
          | 'textIndent'
          | 'marginTop'
          | 'marginBottom',
      ) => parseFloat(css[key]) * options.scale
      paragraph = {
        level: Number(level),
        style: textStyle(element, localOpacity),
        marginLeftPx: size('marginLeft'),
        marginRightPx: size('marginRight'),
        indentPx: size('textIndent'),
        spaceBeforePx: size('marginTop'),
        spaceAfterPx: size('marginBottom'),
        runs: [],
      }
      if (
        [
          paragraph.marginLeftPx,
          paragraph.marginRightPx,
          paragraph.spaceBeforePx,
          paragraph.spaceAfterPx,
        ].some((value) => !Number.isFinite(value) || value < 0) ||
        !Number.isFinite(paragraph.indentPx)
      )
        fail(element, 'paragraph spacing must be finite and nonnegative')
      paragraphs.push(paragraph)
    } else if (
      element !== root &&
      ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'].some(
        (key) =>
          parseFloat(css[key as keyof CSSStyleDeclaration] as string) !== 0,
      )
    )
      fail(element, 'container or inline margins cannot be merged')
    if (element.tagName === 'BR') {
      if (!paragraph) fail(element, 'soft break needs a paragraph')
      paragraph!.runs.push({
        text: '\n',
        style: textStyle(element, localOpacity),
      })
      return
    }
    if (
      paragraph &&
      level === null &&
      element !== root &&
      ((css.display !== 'inline' && !(element.hasAttribute('data-fastppt-tab') && css.display === 'inline-block')) || css.verticalAlign !== 'baseline')
    )
      fail(element, 'inline run geometry cannot be represented')
    if (
      !paragraph &&
      (css.display !== 'flex' ||
        css.flexDirection !== 'column' ||
        !['0px', 'normal'].includes(css.rowGap) ||
        (css.justifyContent !== 'normal' &&
          css.justifyContent !== 'flex-start') ||
        !['normal', 'stretch'].includes(css.alignItems))
    )
      fail(element, 'paragraph containers must use column flow without gaps')
    for (const child of element.childNodes) walk(child, paragraph, localOpacity)
    if (level !== null && paragraph!.style.direction === 'rtl' && element.hasAttribute('data-fastppt-bullet') && JSON.parse(element.getAttribute('data-fastppt-bullet')!).bullet?.kind !== 'none') fail(element, 'RTL bullets require measured marker geometry')
    if (level !== null) captureTextTabs(element, paragraph!, options.scale)
    if (level !== null)
      captureTextBullet(element, paragraph!, {
        ...options,
        numbering,
        opacity: localOpacity,
        style: textStyle,
      })
  }
  walk(root, undefined, options.opacity)
  if (!paragraphs.length) fail(root, 'no projected paragraphs')
  return paragraphs
}
