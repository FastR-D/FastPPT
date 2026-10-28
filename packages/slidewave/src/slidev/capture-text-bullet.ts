import { nextNumberingMarker } from '../primitives/text-numbering.mjs'
import type { HtmlTextParagraph, HtmlTextStyle } from '../snapshot-types.js'
import {
  validateTextBulletProperties,
  type TextBulletProperties,
} from '../primitives/text-bullet.js'
import { cssFontFamilies } from './font-family.js'
import { sourceBulletContext } from '../primitives/text-bullet-layout.mjs'

/** Capture the semantic marker only after proving it matches the displayed one. */
export function captureTextBullet(
  element: HTMLElement,
  paragraph: HtmlTextParagraph,
  options: {
    numbering: Map<number, { scheme: string; seed: number; next: number }>
    scale: number
    opacity: number
    style: (element: HTMLElement, opacity: number) => HtmlTextStyle
  },
): void {
  const raw = element.getAttribute('data-fastppt-bullet')
  const markers = [...element.children].filter((child) =>
    child.hasAttribute('data-fastppt-bullet-marker'),
  )
  const anchors = [...element.children].filter(child => child.hasAttribute('data-fastppt-bullet-anchor'))
  const fail = (reason: string): never => {
    throw new Error(`Text bullet at level ${paragraph.level}: ${reason}.`)
  }
  const restart = element.getAttribute('data-fastppt-numbering-restart')
  if (element.hasAttribute('data-fastppt-numbering-error')) fail(element.getAttribute('data-fastppt-numbering-error')!)
  if (restart !== null && !/^[1-9]\d*$/.test(restart)) fail('invalid numbering restart')
  if (raw === null) {
    if (restart !== null) fail('restart has no automatic list')
    nextNumberingMarker(options.numbering, { level: paragraph.level, visible: paragraph.runs.some(run => !!run.text.trim()) })
    if (markers.length || anchors.length) fail('marker has no paragraph contract')
    return
  }
  const properties = JSON.parse(raw) as TextBulletProperties
  if (
    !properties ||
    typeof properties !== 'object' ||
    Object.keys(properties).some(
      (key) =>
        !['bullet', 'bulletFont', 'bulletSize', 'bulletColor'].includes(key),
    )
  )
    fail('invalid properties')
  validateTextBulletProperties(properties)
  if (!properties.bullet) fail('missing bullet type')
  const expected = nextNumberingMarker(options.numbering, { level: paragraph.level, bullet: properties.bullet, visible: paragraph.runs.some(run => !!run.text.trim()), restartAt: restart === null ? undefined : Number(restart) })
  if (restart !== null) paragraph.numberingRestart = Number(restart)
  if (properties.bullet?.kind === 'none') {
    if (markers.length || anchors.length) fail('disabled bullet has a marker')
    paragraph.bullet = properties.bullet
    paragraph.bulletFont = properties.bulletFont
    paragraph.bulletColor = properties.bulletColor
    if (properties.bulletSize?.kind === 'points') {
      const canvas = Number(element.getAttribute('data-fastppt-bullet-canvas'))
      const root = element.closest('.source-layout')
      if (!root || !Number.isFinite(canvas) || canvas <= 0)
        fail('inactive point sizing needs a source canvas')
      paragraph.bulletSize = {
        kind: 'pixels',
        value:
          ((properties.bulletSize.value * 12700) / canvas) *
          parseFloat(getComputedStyle(root!).width) *
          options.scale,
      }
    } else paragraph.bulletSize = properties.bulletSize
    return
  }
  const bullet = properties.bullet!
  if (bullet.kind !== 'character' && bullet.kind !== 'auto-number') fail('unsupported bullet type')
  if (markers.length !== 1 || !(markers[0] instanceof HTMLElement))
    fail('expected one marker')
  const marker = markers[0] as HTMLElement
  // Previously generated source themes used a plain absolute marker. Preserve
  // that measured negative-indent subset while requiring probes for new geometry.
  const legacy = marker.children.length === 0 && anchors.length === 0
  const label = marker.querySelector<HTMLElement>(':scope > [data-fastppt-bullet-label]')
  const baseline = marker.querySelector<HTMLElement>(':scope > [data-fastppt-bullet-baseline]')
  if (
    marker.tagName !== 'SPAN' ||
    (!legacy && (marker.childNodes.length !== 2 || !label || !baseline ||
    marker.firstChild !== label || marker.lastChild !== baseline ||
    label.children.length || [...label.childNodes].some(node => !(node instanceof Text)))) ||
    marker.textContent !== expected.label ||
    marker.hasAttribute('id') ||
    marker.hasAttribute('data-fastppt-group')
  )
    fail('marker content or identity changed')
  if (!legacy && (anchors.length !== 1 || element.children[0] !== marker || element.children[1] !== anchors[0])) fail('expected one leading bullet anchor')
  if (element.hasAttribute('data-fastppt-bullet-error')) fail(element.getAttribute('data-fastppt-bullet-error')!)
  const css = getComputedStyle(marker),
    owner = getComputedStyle(element)
  const legacyContext = (): ReturnType<typeof sourceBulletContext> => {
    const root = element.closest('.source-layout'), canvas = Number(element.getAttribute('data-fastppt-bullet-canvas'))
    const rawIndent = element.getAttribute('data-fastppt-bullet-indent')
    if (!root || !Number.isFinite(canvas) || canvas <= 0 || rawIndent === null || !rawIndent.trim() || !Number.isFinite(Number(rawIndent))) fail('legacy bullet needs its source canvas and indent')
    const units = parseFloat(getComputedStyle(root!).width) / canvas
    const rect = element.getBoundingClientRect(), scale = rect.width / parseFloat(owner.width)
    if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(units) || units <= 0) fail('legacy bullet needs positive geometry')
    const range = document.createRange(); range.selectNodeContents(marker)
    return { marker, label: marker, anchor: element, baseline: marker, units, rect, scale, indent: Number(rawIndent) * units, advance: range.getBoundingClientRect().width / scale, prefix: 0, visible: css.visibility === 'visible' }
  }
  const context = legacy ? legacyContext() : sourceBulletContext(element)
  const first = paragraph.runs.find((run) => run.text.trim())?.style
  if (css.visibility !== (first ? 'visible' : 'hidden'))
    fail('marker visibility does not match paragraph content')
  if (
    owner.position !== 'relative' ||
    Math.abs(parseFloat(owner.textIndent) - context.prefix) > 0.1 ||
    !['left', 'center', 'right', 'justify'].includes(owner.textAlign)
  )
    fail('paragraph alignment or first-line bullet occupancy changed')
  if (!legacy && (!['pre', 'pre-wrap'].includes(owner.whiteSpace) || owner.wordBreak !== 'normal' || owner.hyphens === 'auto' || owner.overflowWrap !== 'break-word')) fail('bullet wrapping requires ordinary word breaks')
  if (legacy && (!['left', 'justify'].includes(owner.textAlign) || context.indent >= 0 || parseFloat(css.top) !== 0 || (first && context.advance > -context.indent + 1 / context.scale))) fail('legacy marker requires measured left/justified hanging geometry')
  if (
    ['top', 'right', 'bottom', 'left'].some(
      (key) =>
        !['auto', '0px'].includes(
          owner[key as keyof CSSStyleDeclaration] as string,
        ),
    )
  )
    fail('paragraph offsets cannot be represented')
  const left = parseFloat(css.left)
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(parseFloat(css.top)) ||
    css.position !== 'absolute' ||
    css.display !== 'block'
  )
    fail('marker requires measured absolute positioning')
  // Every generated child is checked before it is omitted from authored runs.
  for (const child of legacy ? [] : [context.label, context.baseline, context.anchor]) {
    const local = getComputedStyle(child)
    if (child.tagName !== 'SPAN' || child.hasAttribute('id') || child.hasAttribute('data-fastppt-group') || local.display !== 'inline' || local.position !== 'static' || local.verticalAlign !== 'baseline') fail('marker content or identity changed')
    for (const key of ['transform', 'float', 'filter', 'clipPath', 'maskImage', 'boxShadow', 'textShadow', 'backgroundImage', 'textDecorationLine'] as const)
      if (local[key] !== 'none') fail('bullet child has unsupported effects')
    if (Number(local.opacity) !== 1 || local.backgroundColor !== 'rgba(0, 0, 0, 0)' || local.direction !== 'ltr' || local.writingMode !== 'horizontal-tb' || local.mixBlendMode !== 'normal' || !['normal', '1'].includes(local.zoom) || local.overflowX !== 'visible' || local.overflowY !== 'visible') fail('bullet child layout changed')
    for (const key of ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'] as const)
      if (parseFloat(local[key]) !== 0) fail('bullet child spacing changed')
    if (['before', 'after'].some(pseudo => !['none', 'normal', '""', "''"].includes(getComputedStyle(child, `::${pseudo}`).content))) fail('bullet child has generated content')
    if (child === context.label) {
      for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantCaps', 'lineHeight', 'letterSpacing', 'wordSpacing', 'color', 'visibility', 'textTransform', 'whiteSpace'] as const)
        if (local[key] !== css[key]) fail('marker label style differs from its contract')
    } else if (child.childNodes.length || parseFloat(local.fontSize) !== 0 || parseFloat(local.lineHeight) !== 0 || local.visibility !== (child === context.anchor ? 'visible' : css.visibility) || child.getBoundingClientRect().width !== 0 || child.getBoundingClientRect().height !== 0) fail('bullet baseline probe changed')
  }
  if (
    css.transform !== 'none' ||
    css.float !== 'none' ||
    css.filter !== 'none' ||
    css.clipPath !== 'none' ||
    css.maskImage !== 'none' ||
    css.boxShadow !== 'none' ||
    css.textShadow !== 'none' ||
    css.backgroundImage !== 'none' ||
    css.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
    Number(css.opacity) !== 1 ||
    css.direction !== 'ltr' ||
    css.writingMode !== 'horizontal-tb' ||
    css.mixBlendMode !== 'normal' ||
    !['normal', '1'].includes(css.zoom)
  )
    fail('marker has unsupported effects')
  if (
    [
      'marginTop',
      'marginRight',
      'marginBottom',
      'marginLeft',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
    ].some(
      (key) =>
        parseFloat(css[key as keyof CSSStyleDeclaration] as string) !== 0,
    )
  )
    fail('marker spacing changed')
  if (
    ['before', 'after'].some(
      (pseudo) =>
        !['none', 'normal', '""', "''"].includes(
          getComputedStyle(marker, `::${pseudo}`).content,
        ),
    )
  )
    fail('marker has generated content')
  const style = options.style(marker, options.opacity)
  if (
    !['left', 'start', 'justify'].includes(css.textAlign) ||
    parseFloat(css.textIndent) !== 0 ||
    css.whiteSpace !== 'pre' ||
    css.textTransform !== 'none' ||
    css.overflowX !== 'visible' ||
    css.overflowY !== 'visible' ||
    css.columnCount !== 'auto' ||
    css.fontVariantCaps !== 'normal' ||
    !['normal', '0px'].includes(css.wordSpacing)
  )
    fail('marker layout changed')
  if (style.decoration.length || style.letterSpacingPx !== 0)
    fail('marker text decoration or spacing is unsupported')
  const origin = context.anchor.getBoundingClientRect()
  const markerRect = marker.getBoundingClientRect()
  if (first && context.prefix >= context.rect.width / context.scale) fail('bullet prefix leaves no first-line body space')
  const expectedLeft = first && !legacy ? (origin.left - context.rect.left) / context.scale + context.indent - context.prefix : context.indent
  if (Math.abs(left - expectedLeft) > 0.1 || Math.abs((markerRect.left - context.rect.left) / context.scale - expectedLeft) > 0.1 || (first && !legacy && Math.abs(origin.top - context.baseline.getBoundingClientRect().top) / context.scale > 0.1)) fail('marker position or baseline differs from its measured first line')
  const reference = first ?? paragraph.style
  if (
    style.fontWeight !== reference.fontWeight ||
    style.fontStyle !== reference.fontStyle ||
    Math.abs(style.lineHeightPx - reference.lineHeightPx) > 0.1
  )
    fail('marker emphasis or line height differs from text')
  const font = properties.bulletFont ?? { kind: 'text' }
  if (
    font.kind === 'text'
      ? style.fontFamily !== reference.fontFamily
      : cssFontFamilies(style.fontFamily)[0] !== font.fontFamily
  )
    fail('marker font differs from its contract')
  const color = properties.bulletColor ?? { kind: 'text' }
  if (
    color.kind === 'text'
      ? style.color.hex !== reference.color.hex ||
        Math.abs(style.color.alpha - reference.color.alpha) > 0.001
      : style.color.hex.toUpperCase() !== color.color.toUpperCase() ||
        style.color.alpha !== 1
  )
    fail('marker color differs from its contract')
  const size = properties.bulletSize ?? { kind: 'text' }
  if (
    Math.abs(
      style.fontSizePx -
        (size.kind === 'points' ? size.value * 12700 * context.units * options.scale : reference.fontSizePx * (size.kind === 'percent' ? size.value / 100 : 1)),
    ) > 0.1
  )
    fail('marker size differs from its contract')
  paragraph.bullet = bullet
  paragraph.bulletFont = font
  paragraph.bulletColor = color
  paragraph.bulletSize =
    size.kind === 'points' ? { kind: 'pixels', value: style.fontSizePx } : size
  // Dynamic centering and marker width must never replace the source indent.
  paragraph.indentPx = context.indent * options.scale
}
