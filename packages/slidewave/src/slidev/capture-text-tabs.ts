import { readSourceBaseline } from '../primitives/text-baseline.mjs'
import { resolveTextTab, sourceTabContext, sourceTabFields, measureTabField, measureDecimalTabOffset } from '../primitives/text-tabs.mjs'
import type { HtmlTextParagraph } from '../snapshot-types.js'
import { validateTextTabLayout, type TextTabLayout } from '../primitives/text-tab-layout.js'

/** Verify displayed spacers before retaining literal tabs in the native body. */
export function captureTextTabs(element: HTMLElement, paragraph: HtmlTextParagraph, scale: number): void {
  const markers = [...element.querySelectorAll<HTMLElement>('[data-fastppt-tab]')]
    .filter(marker => marker.getClientRects().length && getComputedStyle(marker).visibility === 'visible')
  const raw = element.getAttribute('data-fastppt-tabs')
  const fail = (reason: string): never => { throw new Error(`Text tabs at level ${paragraph.level}: ${reason}.`) }
  if (!raw) {
    if (markers.length) fail('missing paragraph contract')
    return
  }
  if (element.hasAttribute('data-fastppt-tab-error')) fail(element.getAttribute('data-fastppt-tab-error')!)
  const context = sourceTabContext(element)
  if (context.contract.decimalTab !== undefined) paragraph.decimalTab = context.contract.decimalTab
  if (context.contract.defaultTabSize !== undefined || markers.length) paragraph.defaultTabSizePx = context.defaultSize * scale
  if (context.contract.tabStops !== undefined) paragraph.tabStopsPx = context.stops.map(stop => ({ ...stop, position: stop.position * scale }))
  if (!markers.length) return
  if (context.css.textAlign !== 'left' || context.css.direction !== 'ltr') fail('only left-aligned, left-to-right paragraphs are currently measured')
  if (!['pre', 'pre-wrap'].includes(context.css.whiteSpace) || context.css.wordBreak !== 'normal' || context.css.hyphens === 'auto') fail('tab wrapping requires ordinary word breaks without automatic hyphenation')
  const fields = sourceTabFields(element)
  if (fields.length !== markers.length) fail('visible tab fields do not match the measured spacers')
  for (const field of fields) {
    const marker = field.marker
    if (marker.tagName !== 'SPAN' || marker.children.length || marker.textContent !== '\t' || marker.hasAttribute('id') || marker.hasAttribute('data-fastppt-group')) fail('tab spacer content or identity changed')
    const css = getComputedStyle(marker), rect = marker.getBoundingClientRect()
    if (css.display !== 'inline-block' || css.tabSize !== '0' || css.whiteSpace !== 'pre' || parseFloat(css.textIndent) !== 0 || css.verticalAlign !== 'baseline') fail('tab spacer layout changed')
    const cursor = (rect.left - context.rect.left) / context.scale
    const expected = resolveTextTab(cursor, context.defaultSize, context.stops, measureTabField(field, context.scale), context.contract.decimalTab ? measureDecimalTabOffset(field, context.scale, context.contract.decimalTab.separator) : undefined).width
    if (Math.abs(rect.width / context.scale - expected) > 0.2 || Math.abs(parseFloat(css.width) - expected) > 0.2) fail('tab width differs from the next stop')
    if ((context.css.whiteSpace === 'pre' && rect.right > context.rect.right + 0.5) || rect.left < context.rect.left + Math.min(0, parseFloat(context.css.textIndent)) * context.scale - 0.5) fail('tab stop exceeds paragraph bounds')
  }
  const layout: TextTabLayout = { version: 1, text: '', lines: [] }
  let offset = 0, top = -Infinity, bottom = Infinity, previousRight = -Infinity, previousTop = -Infinity
  let line: TextTabLayout['lines'][number] = { start: 0, end: 0, breakBefore: 'paragraph', tabs: [] }
  const flush = (reason: 'soft' | 'automatic') => {
    layout.lines.push(line)
    line = { start: offset, end: offset, breakBefore: reason, tabs: [] }
    top = -Infinity; bottom = Infinity; previousRight = -Infinity; previousTop = -Infinity
  }
  const append = (text: string, rect?: DOMRect, tab = false, owner?: Element) => {
    if (rect) {
      const shift = owner ? (readSourceBaseline(owner)?.shiftPx ?? 0) * context.scale : 0
      const nominalTop = rect.top + shift, nominalBottom = rect.bottom + shift
      const backwards = rect.left < previousRight - context.scale
      const newRow = Math.min(bottom, nominalBottom) <= Math.max(top, nominalTop) || (backwards && nominalTop > previousTop + 0.5 * context.scale)
      if (newRow && line.box) {
        if (context.css.whiteSpace === 'pre') fail('unexpected automatic line in a non-wrapping paragraph')
        if (context.css.overflowWrap !== 'break-word') fail('automatic tab wrapping requires measured long-word breaking')
        flush('automatic')
      } else if (backwards) fail('tab line contains backwards text flow')
      const factor = scale / context.scale
      const box = { x: (rect.left - context.rect.left) * factor, y: (rect.top - context.rect.top) * factor, width: rect.width * factor, height: rect.height * factor }
      const previous = line.box
      if (previous) {
        const x = Math.min(previous.x, box.x), y = Math.min(previous.y, box.y)
        line.box = { x, y, width: Math.max(previous.x + previous.width, box.x + box.width) - x, height: Math.max(previous.y + previous.height, box.y + box.height) - y }
      } else line.box = box
      top = Math.max(top, nominalTop); bottom = Math.min(bottom, nominalBottom); previousRight = rect.right; previousTop = nominalTop
    }
    if (tab) line.tabs.push(offset)
    layout.text += text; offset += text.length; line.end = offset
    if (text === '\n') flush('soft')
  }
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const walk = (node: Node): void => {
    if (node instanceof HTMLElement) {
      const css = getComputedStyle(node)
      if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0 || node.hasAttribute('data-fastppt-bullet-marker')) return
      if (node.hasAttribute('data-fastppt-tab')) { append('\t', node.getBoundingClientRect(), true, node); return }
      if (node.tagName === 'BR') { append('\n'); return }
      for (const child of node.childNodes) walk(child)
    } else if (node instanceof Text && node.data) {
      for (const { segment, index } of segmenter.segment(node.data)) {
        if (segment === '\n') { append(segment); continue }
        const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + segment.length)
        const rects = [...range.getClientRects()].filter(rect => rect.height > 0)
        if (rects.length !== 1) fail('each text cluster requires one measured line box')
        append(segment, rects[0], false, node.parentElement ?? undefined)
      }
    }
  }
  walk(element); layout.lines.push(line)
  validateTextTabLayout(layout, paragraph.runs.map(run => run.text).join(''))
  paragraph.tabLayout = layout
  const bodyTabCount = paragraph.runs.reduce((sum, run) => sum + (run.text.match(/\t/g)?.length ?? 0), 0)
  if (bodyTabCount !== markers.length) fail('visible tab characters do not match the measured spacers')
}
