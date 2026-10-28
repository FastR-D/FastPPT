/** Preserve identifiers verbatim. Empty explicitly means unknown; absence inherits.
 * This checks transport syntax, not installed language or locale support. */
export function isTextLanguage(value) {
  return typeof value === 'string' && value.length <= 255 && /^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|[xXiI](?:-[A-Za-z0-9]{1,8})+)?$/.test(value)
}

export function validateTextLanguages(value) {
  for (const key of ['language', 'alternativeLanguage']) {
    if (value[key] !== undefined && !isTextLanguage(value[key])) throw new Error('Invalid text language identifier.')
  }
}
