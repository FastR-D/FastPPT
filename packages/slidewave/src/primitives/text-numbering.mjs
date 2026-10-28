export const autoNumberSchemes = [
  'arabicPeriod',
  'arabicParenR',
  'arabicParenBoth',
  'arabicPlain',
  'alphaLcPeriod',
  'alphaUcPeriod',
  'alphaLcParenR',
  'alphaUcParenR',
  'alphaLcParenBoth',
  'alphaUcParenBoth',
  'romanLcPeriod',
  'romanUcPeriod',
  'romanLcParenR',
  'romanUcParenR',
  'romanLcParenBoth',
  'romanUcParenBoth',
]

export function formatAutoNumber(scheme, value) {
  if (
    !autoNumberSchemes.includes(scheme) ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 32767
  )
    throw new Error('Unsupported automatic number scheme or value.')
  let text = String(value)
  if (scheme.startsWith('alpha')) {
    text = ''
    for (let number = value; number > 0; number = Math.floor((number - 1) / 26))
      text = String.fromCharCode(65 + ((number - 1) % 26)) + text
  } else if (scheme.startsWith('roman')) {
    text = ''
    let number = value
    for (const [amount, symbol] of [
      [1000, 'M'],
      [900, 'CM'],
      [500, 'D'],
      [400, 'CD'],
      [100, 'C'],
      [90, 'XC'],
      [50, 'L'],
      [40, 'XL'],
      [10, 'X'],
      [9, 'IX'],
      [5, 'V'],
      [4, 'IV'],
      [1, 'I'],
    ]) {
      while (number >= amount) {
        text += symbol
        number -= amount
      }
    }
  }
  if (scheme.includes('Lc')) text = text.toLowerCase()
  if (scheme.endsWith('Period')) return text + '.'
  if (scheme.endsWith('ParenBoth')) return '(' + text + ')'
  if (scheme.endsWith('ParenR')) return text + ')'
  return text
}

/** One state per native text frame. Missing/empty paragraphs never consume a number.
 * Input bullet.startAt is a stable template seed; restartAt is local page intent.
 * Do not feed raw pPr startAt values back into this function: the output omits
 * startAt on continuations and is intended for native XML serialization only. */
export function nextNumberingMarker(state, paragraph) {
  const { level, bullet, visible, restartAt } = paragraph
  if (!Number.isInteger(level) || level < 1 || level > 9)
    throw new Error('Invalid numbering level.')
  if (
    restartAt !== undefined &&
    (bullet?.kind !== 'auto-number' ||
      !Number.isSafeInteger(restartAt) ||
      restartAt < 1 ||
      restartAt > 32767)
  )
    throw new Error(
      'A numbering restart requires an automatic list and a value from 1 to 32767.',
    )
  if (!visible)
    return {
      label: bullet?.kind === 'character' ? bullet.character : '',
      bullet:
        bullet?.kind === 'auto-number'
          ? {
              kind: 'auto-number',
              scheme: bullet.scheme,
              ...(restartAt === undefined ? {} : { startAt: restartAt }),
            }
          : bullet,
      ...(restartAt === undefined ? {} : { review: 'explicit-restart' }),
    }
  // Plain text is an interruption, not a new list item, even at a shallower level.
  if (!bullet || bullet.kind === 'none') return { label: '', bullet }
  for (const key of state.keys()) if (key > level) state.delete(key)
  if (bullet.kind !== 'auto-number') {
    if (bullet?.kind === 'character') state.delete(level)
    return {
      label: bullet?.kind === 'character' ? bullet.character : '',
      bullet,
    }
  }
  const seed = bullet.startAt ?? 1,
    previous = state.get(level)
  const fresh =
    !previous || previous.scheme !== bullet.scheme || previous.seed !== seed
  const value = restartAt ?? (fresh ? seed : previous.next)
  const label = formatAutoNumber(bullet.scheme, value)
  state.set(level, { scheme: bullet.scheme, seed, next: value + 1 })
  return {
    label,
    value,
    bullet: {
      kind: 'auto-number',
      scheme: bullet.scheme,
      ...(fresh || restartAt !== undefined ? { startAt: value } : {}),
    },
    // OOXML preserves the explicit start. Target applications have different
    // restart handling; keep this evidence distinct from structural validity.
    ...((restartAt !== undefined && !fresh) ||
    (previous && previous.scheme === bullet.scheme && previous.seed !== seed)
      ? { review: 'explicit-restart' }
      : {}),
  }
}

/** Collection-only superset: counter/restart interpretation varies by client.
 * Collect the complete small alphabet so font subsetting cannot drop numbers. */
export function autoNumberGlyphs(scheme) {
  if (!autoNumberSchemes.includes(scheme)) return ''
  const alphabet = scheme.startsWith('alpha')
    ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    : scheme.startsWith('roman')
      ? 'IVXLCDM'
      : '0123456789'
  const glyphs = scheme.includes('Lc') ? alphabet.toLowerCase() : alphabet
  return (
    glyphs +
    (scheme.endsWith('Period')
      ? '.'
      : scheme.endsWith('ParenBoth')
        ? '()'
        : scheme.endsWith('ParenR')
          ? ')'
          : '')
  )
}
