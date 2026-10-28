/** DrawingML display capitalization never changes the editable source string. */
export function validateTextCapitalization(value) {
  if (value.capitalization !== undefined && !['none', 'all', 'small'].includes(value.capitalization))
    throw new Error('Invalid text capitalization; expected none, all or small.')
}

export function textCapitalizationCss(capitalization) {
  return { textTransform: capitalization === 'all' ? 'uppercase' : 'none', fontVariantCaps: capitalization === 'small' ? 'small-caps' : 'normal' }
}

/** Only an explicit leaf contract permits capturing the original CSS source. */
export function readSourceCapitalization(element) {
  const run = element.getAttribute('data-fastppt-text-capitalization-run')
  const defaults = element.getAttribute('data-fastppt-text-capitalization-defaults')
  if (run === null && defaults === null) return undefined
  if (run !== null && defaults !== null) throw new Error('Conflicting source capitalization contracts.')
  const capitalization = JSON.parse(run ?? defaults)
  validateTextCapitalization({ capitalization })
  if (typeof capitalization !== 'string') throw new Error('Invalid source capitalization contract.')
  if (run === null) {
    if (!element.hasAttribute('data-fastppt-text-level') && element.tagName !== 'BR') throw new Error('Capitalization defaults require a paragraph or soft break.')
    if ([...element.childNodes].some(node => node.nodeType === 3 && node.textContent.length)) throw new Error('Capitalization defaults require projected text leaves.')
    return capitalization
  }
  const css = element.ownerDocument.defaultView.getComputedStyle(element)
  const expected = textCapitalizationCss(capitalization)
  if (element.tagName !== 'SPAN' || [...element.childNodes].some(node => node.nodeType !== 3) ||
      css.textTransform !== expected.textTransform || css.fontVariantCaps !== expected.fontVariantCaps ||
      (capitalization === 'small' && css.fontSynthesisSmallCaps && css.fontSynthesisSmallCaps !== 'auto') ||
      css.fontFeatureSettings !== 'normal' || css.fontVariationSettings !== 'normal' ||
      css.fontVariantLigatures !== 'normal' || css.fontVariantNumeric !== 'normal' ||
      css.fontVariantEastAsian !== 'normal' || css.fontVariantPosition !== 'normal')
    throw new Error('Source capitalization differs from its displayed run style.')
  return capitalization
}

export const textCapitalizationCompatibility = 'Original text and DrawingML capitalization are preserved. Unicode case mapping, language and small-cap glyphs differ between applications; LibreOffice 7.3.7.2 displays tested small caps as full capitals and maps sharp s to capital sharp s. Verify the actual file in the target application.'
