import { textCapitalizationCss } from './text-capitalization.mjs'
import { sourceKerningRuntime } from './text-kerning.mjs'
import { decimalTabProfiles, validateDecimalTab, validateTextTabs, resolveTextTab, sourceTabFields, measureTabField, measureDecimalTabOffset, sourceTabContext, syncSourceTabs } from './text-tabs.mjs'
import { autoNumberSchemes, formatAutoNumber, nextNumberingMarker } from './text-numbering.mjs'
import { sourceBulletContext, syncSourceBulletGeometry } from './text-bullet-layout.mjs'
import { sourceTextDecorations, textDecorationLine } from './text-decoration.mjs'

// Standalone generated themes cannot import FastPPT runtime packages. Keep this
// routing aligned with Slidewave's DrawingML font collector (font-script.ts).
export function scriptTextRuns(text) {
  const runs = []
  let preceding = 'latin'
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const { segment } of segmenter.segment(text)) {
    const character = [...segment][0]
    const point = character.codePointAt(0)
    let script = 'latin'
    if (/\p{Script=Inherited}/u.test(character)) script = preceding
    else if (
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u.test(
        character,
      ) ||
      (point >= 0x3000 && point <= 0x303f) ||
      (point >= 0xff00 && point <= 0xffef)
    )
      script = 'ea'
    else if (
      /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}]/u.test(
        character,
      )
    )
      script = 'cs'
    preceding = script
    if (runs.at(-1)?.script === script) runs.at(-1).text += segment
    else runs.push({ script, text: segment })
  }
  return runs
}

export function resolveSourceTextStyle(style, level) {
  const { levels, ...base } = style
  const entry = levels?.find((item) => item.level === level)
  const local = entry?.textStyle
  const fontFamilies =
    local?.fontFamily !== undefined
      ? local.fontFamilies
      : { ...base.fontFamilies, ...local?.fontFamilies }
  return {
    ...base,
    ...local,
    ...(base.fontFamilies ||
    local?.fontFamilies ||
    local?.fontFamily !== undefined
      ? { fontFamilies }
      : {}),
    ...(base.paragraph || entry?.paragraph
      ? { paragraph: { ...base.paragraph, ...entry?.paragraph } }
      : {}),
  }
}

export function sourceParagraphCss(style, canvasWidth) {
  const units = (emu) => `${(emu / canvasWidth) * 100}cqw`
  const spacing = (value) =>
    value.unit === 'points'
      ? units(value.value * 12700)
      : `${value.value / 100}em`
  const paragraph = style.paragraph ?? {}
  const marker = ['character', 'auto-number'].includes(paragraph.bullet?.kind)
  return {
    fontFamily: style.fontFamily ? JSON.stringify(style.fontFamily) : 'inherit',
    fontSize:
      style.fontSize === undefined ? 'inherit' : units(style.fontSize * 12700),
    fontWeight: style.bold ? '700' : '400',
    fontStyle: style.italic ? 'italic' : 'normal',
    letterSpacing: units((style.letterSpacing ?? 0) * 12700),
    ...(style.color ? { color: `#${style.color}` } : {}),
    textAlign: paragraph.align ?? 'left',
    direction: paragraph.direction ?? 'ltr',
    overflowWrap: 'break-word',
    tabSize: units(paragraph.defaultTabSize ?? 914400),
    marginLeft: units(paragraph.marginLeft ?? 0),
    marginRight: units(paragraph.marginRight ?? 0),
    textIndent: marker ? '0' : units(paragraph.indent ?? 0),
    ...(marker ? { position: 'relative' } : {}),
    marginTop: paragraph.spaceBefore ? spacing(paragraph.spaceBefore) : '0',
    marginBottom: paragraph.spaceAfter ? spacing(paragraph.spaceAfter) : '0',
    lineHeight: paragraph.lineSpacing
      ? paragraph.lineSpacing.unit === 'points'
        ? units(paragraph.lineSpacing.value * 12700)
        : String(paragraph.lineSpacing.value / 100)
      : '1.2',
    padding: '0',
    border: '0',
    minHeight: '1lh',
    flex: '0 0 auto',
  }
}

// The marker follows the first visible run; changing text or resizing a source
// layout must update it without inserting the symbol into authored body text.
export function syncSourceBullet(paragraph, state = new Map()) {
  const computed = (element) =>
    paragraph.ownerDocument.defaultView.getComputedStyle(element)
  const marker = [...paragraph.children].find((child) =>
    child.hasAttribute('data-fastppt-bullet-marker'),
  )
  // Hidden paragraphs are absent from capture and must not consume a number.
  for (let element = paragraph; element; element = element.parentElement) {
    const css = computed(element)
    if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0) return
  }
  const properties = JSON.parse(paragraph.getAttribute('data-fastppt-bullet') ?? '{}')
  const walker = paragraph.ownerDocument.createTreeWalker(paragraph, 4)
  let first
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || marker?.contains(node)) continue
    let visible = true
    for (
      let element = node.parentElement;
      element && paragraph.contains(element);
      element = element.parentElement
    ) {
      const css = computed(element)
      if (
        css.display === 'none' ||
        css.visibility !== 'visible' ||
        Number(css.opacity) === 0
      )
        visible = false
    }
    if (visible) {
      first = node.parentElement
      break
    }
  }
  const restart = paragraph.getAttribute('data-fastppt-numbering-restart')
  try {
    if (restart !== null && !/^[1-9]\d*$/.test(restart)) throw new Error('Invalid numbering restart.')
    const result = nextNumberingMarker(state, { level: Number(paragraph.getAttribute('data-fastppt-text-level')), bullet: properties.bullet, visible: !!first, restartAt: restart === null ? undefined : Number(restart) })
    if (marker) {
      const label = marker.querySelector(':scope > [data-fastppt-bullet-label]')
      if (label) label.textContent = result.label
    }
    paragraph.removeAttribute('data-fastppt-numbering-error')
  } catch (error) {
    paragraph.setAttribute('data-fastppt-numbering-error', error.message)
  }
  if (!marker) return
  marker.style.visibility = first ? 'visible' : 'hidden'
  const css = computed(first ?? paragraph)
  marker.style.fontFamily =
    properties.bulletFont.kind === 'font'
      ? JSON.stringify(properties.bulletFont.fontFamily)
      : css.fontFamily
  if (properties.bulletSize.kind !== 'points')
    marker.style.fontSize =
      parseFloat(css.fontSize) *
        (properties.bulletSize.kind === 'percent'
          ? properties.bulletSize.value / 100
          : 1) +
      'px'
  marker.style.color =
    properties.bulletColor.kind === 'color'
      ? '#' + properties.bulletColor.color
      : css.color
  marker.style.fontWeight = css.fontWeight
  marker.style.fontStyle = css.fontStyle
  marker.style.lineHeight = css.lineHeight
}

export const scriptFontsSetup = `import { cloneVNode, createStaticVNode, defineComponent, h, isVNode, normalizeStyle, onMounted, onUpdated, onBeforeUnmount, Comment, Static, Text } from 'vue'
const autoNumberSchemes = ${JSON.stringify(autoNumberSchemes)}
${formatAutoNumber.toString()}
${nextNumberingMarker.toString()}
const decimalTabProfiles = ${JSON.stringify(decimalTabProfiles)}
${validateDecimalTab.toString()}
${validateTextTabs.toString()}
${resolveTextTab.toString()}
${sourceTabFields.toString()}
${measureTabField.toString()}
${measureDecimalTabOffset.toString()}
${sourceTabContext.toString()}
${syncSourceTabs.toString()}
${scriptTextRuns.toString()}
${resolveSourceTextStyle.toString()}
${sourceParagraphCss.toString()}
${textCapitalizationCss.toString()}
${sourceTextDecorations.toString()}
${textDecorationLine.toString()}
${syncSourceBullet.toString()}
${sourceBulletContext.toString()}
${syncSourceBulletGeometry.toString()}
const kerningRuntime = (${sourceKerningRuntime.toString()})()
const ScriptFonts = defineComponent({
  props: { fonts: { type: Object, default: () => ({}) }, fallback: { type: String, default: '' }, textStyle: Object, canvasWidth: Number },
  setup(props, { slots }) {
    const paragraphs = new Set()
    let observer
    const sync = () => {
      const states = new Map()
      const ordered = [...paragraphs].filter(paragraph => paragraph.isConnected).sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1)
      for (const paragraph of ordered) {
        kerningRuntime.syncSourceKerning(paragraph)
        const frame = paragraph.closest('[data-fastppt-text-box]') ?? paragraph
        if (!states.has(frame)) states.set(frame, new Map())
        syncSourceBullet(paragraph, states.get(frame))
        syncSourceBulletGeometry(paragraph)
        syncSourceTabs(paragraph)
        syncSourceBulletGeometry(paragraph, true)
      }
    }
    const observe = () => { observer?.disconnect(); for (const paragraph of paragraphs) if (paragraph.isConnected) observer?.observe(paragraph); sync() }
    onMounted(() => { observer = new ResizeObserver(sync); observe(); document.fonts?.ready.then(sync); document.fonts?.addEventListener('loadingdone', sync) })
    onUpdated(observe)
    onBeforeUnmount(() => { observer?.disconnect(); document.fonts?.removeEventListener('loadingdone', sync) })
    const textNodes = (value, context) => {
      if (props.textStyle && !context.inParagraph && !value.trim()) return []
      const style = props.textStyle ? resolveSourceTextStyle(props.textStyle, context.level) : { fontFamilies: props.fonts, fontFamily: props.fallback }
      const decorations = sourceTextDecorations(style, context.decorations)
      const capitalization = context.capitalization ?? style.capitalization ?? 'none'
      const baseline = context.baselinePercent ?? style.baselinePercent ?? 0
      const kerning = context.kerningThreshold ?? style.kerningThreshold
      const kerningProps = kerning === undefined ? {} : { 'data-fastppt-text-kerning': JSON.stringify({ threshold: kerning, canvasWidth: props.canvasWidth }) }
      const decorationProps = props.textStyle ? { 'data-fastppt-text-capitalization-run': JSON.stringify(capitalization), ...kerningProps, 'data-fastppt-text-decoration-run': JSON.stringify(decorations), 'data-fastppt-text-baseline-run': JSON.stringify(baseline) } : {}
      const decorationStyle = props.textStyle ? { ...textCapitalizationCss(capitalization), position: 'relative', top: (-Number(baseline) / 100) + 'em', verticalAlign: 'baseline', textDecorationLine: textDecorationLine(decorations), textDecorationStyle: 'solid', textDecorationColor: 'currentColor', textDecorationSkipInk: 'none' } : {}
      return value.split(/(\\t)/).filter(Boolean).map(part => part === '\\t' && props.textStyle
        ? h('span', { 'data-fastppt-tab': '', ...decorationProps, style: { ...decorationStyle, display: 'inline-block', width: '0px', tabSize: '0', whiteSpace: 'pre', textIndent: '0', verticalAlign: 'baseline', margin: '0', padding: '0', border: '0' } }, '\\t')
        : h('span', { 'data-fastppt-script-text': '' }, scriptTextRuns(part).map(run => {
          const family = style.fontFamilies?.[run.script] ?? style.fontFamily
          return family || props.textStyle ? h('span', { ...decorationProps, ...(family ? { 'data-fastppt-font-script': run.script } : {}), style: { ...decorationStyle, ...(family ? { fontFamily: JSON.stringify(family) } : {}) } }, run.text) : h(Text, run.text)
        })))
    }
    const clone = (value, properties) => {
      const node = cloneVNode(value, properties, true)
      node.dynamicChildren = null
      node.patchFlag = -2
      return node
    }
    const paragraphProps = (level, anchor, frameAnchor, noBullet, restart, context) => {
      const style = resolveSourceTextStyle(props.textStyle, level)
      if (noBullet) style.paragraph = { ...style.paragraph, bullet: { kind: 'none' } }
      style.paragraph = { ...style.paragraph, direction: context.direction ?? style.paragraph?.direction ?? 'ltr' }
      const paragraph = style.paragraph
      const properties = { bullet: paragraph.bullet ?? { kind: 'none' }, bulletFont: paragraph.bulletFont ?? { kind: 'text' }, bulletSize: paragraph.bulletSize ?? { kind: 'text' }, bulletColor: paragraph.bulletColor ?? { kind: 'text' } }
      const language = context.language ?? style.language, alternative = context.alternativeLanguage ?? style.alternativeLanguage
      return { ...(language === undefined ? {} : { lang: language }), ...(alternative === undefined ? {} : { 'data-fastppt-alt-lang': alternative }), dir: paragraph.direction, 'data-fastppt-text-direction': paragraph.direction, 'data-fastppt-text-level': String(level), 'data-fastppt-tabs': JSON.stringify({ ...(paragraph.decimalTab === undefined ? {} : { decimalTab: paragraph.decimalTab }), ...(paragraph.defaultTabSize === undefined ? {} : { defaultTabSize: paragraph.defaultTabSize }), ...(paragraph.tabStops === undefined ? {} : { tabStops: paragraph.tabStops }) }), 'data-fastppt-tab-canvas': String(props.canvasWidth), ...(restart === undefined ? {} : { 'data-fastppt-numbering-restart': String(restart) }), ...(anchor && anchor !== frameAnchor ? { 'data-fastppt-group': anchor } : {}),
        ...(paragraph.bullet ? { 'data-fastppt-bullet': JSON.stringify(properties), 'data-fastppt-bullet-canvas': String(props.canvasWidth) } : {}),
        'data-fastppt-text-decoration-defaults': JSON.stringify(sourceTextDecorations(style, context.decorations)),
        'data-fastppt-text-capitalization-defaults': JSON.stringify(context.capitalization ?? style.capitalization ?? 'none'),
        'data-fastppt-text-baseline-defaults': JSON.stringify(context.baselinePercent ?? style.baselinePercent ?? 0),
        ...((context.kerningThreshold ?? style.kerningThreshold) === undefined ? {} : { 'data-fastppt-text-kerning': JSON.stringify({ threshold: context.kerningThreshold ?? style.kerningThreshold, canvasWidth: props.canvasWidth }) }),
        ...(['character', 'auto-number'].includes(paragraph.bullet?.kind) ? { 'data-fastppt-bullet-indent': String(paragraph.indent ?? 0), 'data-fastppt-bullet-canvas': String(props.canvasWidth) } : {}),
        ref: element => { if (element) paragraphs.add(element) }, style: sourceParagraphCss(style, props.canvasWidth) }
    }
    const withMarker = (properties, children) => {
      const bullet = properties['data-fastppt-bullet'] ? JSON.parse(properties['data-fastppt-bullet']) : undefined
      if (!['character', 'auto-number'].includes(bullet?.bullet.kind)) return children
      const units = emu => (emu / props.canvasWidth * 100) + 'cqw'
      const probeStyle = { display: 'inline', fontSize: '0', lineHeight: '0', verticalAlign: 'baseline', margin: '0', padding: '0', border: '0' }
      return [h('span', { 'data-fastppt-bullet-marker': '', 'aria-hidden': 'true', style: { position: 'absolute', display: 'block', width: 'max-content', left: units(Number(properties['data-fastppt-bullet-indent'])), top: '0', margin: '0', padding: '0', border: '0', textAlign: 'left', textIndent: '0', whiteSpace: 'pre', letterSpacing: '0', textDecoration: 'none', textTransform: 'none', fontVariantCaps: 'normal', pointerEvents: 'none', ...(bullet.bulletSize.kind === 'points' ? { fontSize: units(bullet.bulletSize.value * 12700) } : {}) } }, [h('span', { 'data-fastppt-bullet-label': '' }, bullet.bullet.kind === 'character' ? bullet.bullet.character : ''), h('span', { 'data-fastppt-bullet-baseline': '', style: probeStyle })]), h('span', { 'data-fastppt-bullet-anchor': '', 'aria-hidden': 'true', style: probeStyle }), ...children]
    }
    const rewrite = (value, context = { level: 1, depth: 0, inParagraph: false }) => {
      if (Array.isArray(value)) return value.flatMap(item => rewrite(item, context))
      if (typeof value === 'string') return textNodes(value, context)
      if (!isVNode(value)) return value
      if (value.type === Text) return textNodes(String(value.children ?? ''), context)
      if (value.type === Static && typeof document !== 'undefined') {
        // Vue can hoist a complete authored list into one static HTML vnode.
        // Parse that same inert HTML before projecting its ordinary text nodes.
        const template = document.createElement('template')
        template.innerHTML = String(value.children ?? '')
        if (template.content.children.length && [...template.content.children].every(element => element.namespaceURI !== 'http://www.w3.org/1999/xhtml')) return value
        const vnode = node => node.nodeType === 3 ? h(Text, node.textContent ?? '') : node.nodeType === 8 ? h(Comment, node.textContent ?? '') : node.namespaceURI !== 'http://www.w3.org/1999/xhtml' ? createStaticVNode(node.outerHTML, 1) : h(node.tagName.toLowerCase(), Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value])), [...node.childNodes].map(vnode))
        return rewrite([...template.content.childNodes].map(vnode), context)
      }
      if (['script', 'style', 'textarea'].includes(value.type)) return value
      let node = clone(value)
      const anchor = node.props?.['data-fastppt-group'] ?? node.props?.id ?? context.anchor
      context = { ...context, anchor, ...(node.props?.lang == null ? {} : { language: node.props.lang }), ...(node.props?.['data-fastppt-alt-lang'] == null ? {} : { alternativeLanguage: node.props['data-fastppt-alt-lang'] }) }
      if (props.textStyle) {
        const decorations = { ...context.decorations }
        for (const key of ['underline', 'strike']) {
          const value = node.props?.['data-fastppt-' + key]
          if (value !== undefined && value !== null) decorations[key] = value === 'true' ? true : value === 'false' ? false : value
        }
        const rawBaseline = node.props?.['data-fastppt-baseline']
        const baselinePercent = rawBaseline === undefined || rawBaseline === null ? context.baselinePercent : typeof rawBaseline === 'number' || (typeof rawBaseline === 'string' && /^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)$/.test(rawBaseline.trim())) ? Number(rawBaseline) : rawBaseline
        const rawKerning = node.props?.['data-fastppt-kerning-threshold']
        const kerningThreshold = rawKerning === undefined || rawKerning === null ? context.kerningThreshold : typeof rawKerning === 'number' || (typeof rawKerning === 'string' && /^\\+?(?:\\d+(?:\\.\\d*)?|\\.\\d+)$/.test(rawKerning.trim())) ? Number(rawKerning) : rawKerning
        context = { ...context, direction: node.props?.dir ?? context.direction, decorations, baselinePercent, kerningThreshold, capitalization: node.props?.['data-fastppt-capitalization'] ?? context.capitalization }
        if (node.type === 'br') node.props = { ...node.props, 'data-fastppt-text-capitalization-defaults': JSON.stringify(context.capitalization ?? resolveSourceTextStyle(props.textStyle, context.level).capitalization ?? 'none'), ...((kerningThreshold ?? resolveSourceTextStyle(props.textStyle, context.level).kerningThreshold) === undefined ? {} : { 'data-fastppt-text-kerning': JSON.stringify({ threshold: kerningThreshold ?? resolveSourceTextStyle(props.textStyle, context.level).kerningThreshold, canvasWidth: props.canvasWidth }) }), 'data-fastppt-text-baseline-defaults': JSON.stringify(baselinePercent ?? resolveSourceTextStyle(props.textStyle, context.level).baselinePercent ?? 0), 'data-fastppt-text-decoration-defaults': JSON.stringify(sourceTextDecorations(resolveSourceTextStyle(props.textStyle, context.level), decorations)) }
      }
      if (props.textStyle && node.type === 'div' && node.props?.['data-fastppt-text-box'] !== undefined) {
        node.props = { ...node.props, style: normalizeStyle([{ display: 'flex', flexDirection: 'column', flex: '0 0 auto', gap: '0' }, node.props?.style]) }
        context = { ...context, frameAnchor: anchor }
      }
      if (props.textStyle && ['ul', 'ol'].includes(node.type)) {
        node.props = { ...node.props, style: normalizeStyle([node.props?.style, { margin: '0', padding: '0', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0' }]) }
        context = { ...context, depth: context.depth + 1 }
      }
      if (props.textStyle && node.type === 'li') {
        const level = Number(node.props?.['data-fastppt-level'] ?? Math.max(1, context.depth))
        const childContext = { ...context, restartSource: node.props?.['data-fastppt-start-at'] === undefined ? context.restartSource : { value: node.props['data-fastppt-start-at'] }, level, inParagraph: true, noBullet: node.props?.['data-fastppt-no-bullet'] !== undefined }
        const children = [], inline = []
        const flush = () => {
          if (inline.some(item => typeof item === 'string' ? !!item.trim() : isVNode(item) && item.type === Comment ? false : isVNode(item) && item.type === Text ? !!String(item.children ?? '').trim() : item != null)) {
            const properties = paragraphProps(level, anchor, context.frameAnchor, node.props?.['data-fastppt-no-bullet'] !== undefined, childContext.restartSource?.value, childContext)
            if (childContext.restartSource) childContext.restartSource.value = undefined
            children.push(h('div', properties, withMarker(properties, rewrite(inline.splice(0), childContext))))
          }
          else inline.length = 0
        }
        for (const item of Array.isArray(node.children) ? node.children : [node.children]) {
          if (isVNode(item) && ['ul', 'ol', 'p'].includes(item.type)) {
            flush()
            children.push(rewrite(item, childContext))
          } else inline.push(item)
        }
        flush()
        node.props = { ...node.props, style: normalizeStyle([node.props?.style, { margin: '0', padding: '0', listStyle: 'none', display: 'flex', flexDirection: 'column' }]) }
        node.children = children.flat()
        node.shapeFlag = (node.shapeFlag & ~8) | 16
        return node
      }
      if (props.textStyle && ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(node.type)) {
        const level = Number(node.props?.['data-fastppt-level'] ?? context.level)
        const properties = paragraphProps(level, anchor, context.frameAnchor, node.props?.['data-fastppt-no-bullet'] !== undefined || context.noBullet, node.props?.['data-fastppt-start-at'] ?? context.restartSource?.value, context)
        if (context.restartSource) context.restartSource.value = undefined
        node = clone(node, { ...properties, style: normalizeStyle([properties.style, node.props?.style]) })
        context = { ...context, level, inParagraph: true }
      }
      if (typeof node.type === 'string' && typeof node.children === 'string') {
        node.children = textNodes(node.children, context)
        node.shapeFlag = (node.shapeFlag & ~8) | 16
      } else if (Array.isArray(node.children)) node.children = rewrite(node.children, context)
      else if (node.children && typeof node.children === 'object') {
        node.children = Object.fromEntries(Object.entries(node.children).map(([key, child]) => [key, typeof child === 'function' ? (...args) => rewrite(child(...args), context) : child]))
      }
      if (node.props?.['data-fastppt-text-level']) {
        node.children = withMarker(node.props, Array.isArray(node.children) ? node.children : [])
        node.shapeFlag = (node.shapeFlag & ~8) | 16
      }
      return node
    }
    return () => { paragraphs.clear(); return rewrite(slots.default?.() ?? []) }
  },
})`
