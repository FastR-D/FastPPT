/** DrawingML baseline is a signed, thousandths-of-a-percent relative offset. */
export function validateTextBaseline(value) {
  const percent = value.baselinePercent
  if (percent !== undefined && (!Number.isFinite(percent) || percent < -2147483.648 || percent > 2147483.647))
    throw new Error('Invalid text baselinePercent; expected finite DrawingML percentage.')
}

export function parseSourceBaseline(value) {
  if (typeof value !== 'string') return undefined
  const lexical = value.trim()
  const percent = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(lexical)
  if (!percent && !/^[+-]?\d+$/.test(lexical)) return undefined
  const baselinePercent = percent ? Number(lexical.slice(0, -1)) : Number(lexical) / 1000
  try { validateTextBaseline({ baselinePercent }) } catch { return undefined }
  return baselinePercent
}

export const textBaselineCompatibility = 'Source baseline percentage and font size are preserved. LibreOffice 7.3.7.2 reduces tested nonzero-baseline glyphs to about 58%, truncates fractional offsets to whole percents, and can change line placement and wrapping; the browser keeps the declared font size. Verify the actual file in the target application.'

/** Validate a generated leaf's actual displacement before accepting its native
 * percentage. Defaults on paragraphs/BR do not move the container itself. */
export function readSourceBaseline(element) {
  const run = element.getAttribute('data-fastppt-text-baseline-run')
  const defaults = element.getAttribute('data-fastppt-text-baseline-defaults')
  if (run === null && defaults === null) return undefined
  if (run !== null && defaults !== null) throw new Error('Conflicting source baseline contracts.')
  const baselinePercent = JSON.parse(run ?? defaults)
  validateTextBaseline({ baselinePercent })
  if (typeof baselinePercent !== 'number') throw new Error('Invalid source baseline contract.')
  if (run === null) {
    if (!element.hasAttribute('data-fastppt-text-level') && element.tagName !== 'BR') throw new Error('Baseline defaults require a paragraph or soft break.')
    return { baselinePercent, shiftPx: 0 }
  }
  const css = element.ownerDocument.defaultView.getComputedStyle(element)
  const size = parseFloat(css.fontSize), shiftPx = size * baselinePercent / 100
  if (element.tagName !== 'SPAN' || [...element.childNodes].some(node => node.nodeType !== 3) ||
      css.position !== 'relative' || css.verticalAlign !== 'baseline' ||
      !['inline', 'inline-block'].includes(css.display) || css.transform !== 'none' ||
      css.translate !== 'none' || css.rotate !== 'none' || css.scale !== 'none' ||
      !Number.isFinite(size) || size <= 0 || !Number.isFinite(parseFloat(css.top)) ||
      Math.abs(parseFloat(css.top) + shiftPx) > 0.025 ||
      !['auto', '0px'].includes(css.left) || !['auto', '0px'].includes(css.right) ||
      (css.bottom !== 'auto' && Math.abs(parseFloat(css.bottom) - shiftPx) > 0.025))
    throw new Error('Source baseline differs from its displayed run geometry.')
  return { baselinePercent, shiftPx }
}
