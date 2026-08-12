const INLINE_WHITESPACE = /[ \t\r\n\f\v]+/g

/**
 * @param {string} value
 */
export function normalizeInlineText(value) {
  return value.replace(INLINE_WHITESPACE, ' ').trim()
}

/**
 * @param {string} source
 */
export function dedentMarkdownSource(source) {
  const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n')
  const nonEmpty = lines.filter(line => line.trim())

  if (!nonEmpty.length)
    return ''

  const minIndent = Math.min(...nonEmpty.map((line) => {
    const match = line.match(/^(\s*)/)
    return match ? match[1].length : 0
  }))

  if (!minIndent)
    return source.trim()

  return lines
    .map(line => (line.trim() ? line.slice(minIndent) : line))
    .join('\n')
    .trim()
}

/**
 * @param {unknown} input
 * @returns {{ level: number, text: string } | null}
 */
export function extractMarkdownHeading(input) {
  if (typeof input !== 'string')
    return null

  const lines = input
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length !== 1)
    return null

  const match = lines[0].match(/^(#{1,6})\s+(.+?)\s*$/)
  if (!match)
    return null

  return {
    level: match[1].length,
    text: match[2].trim(),
  }
}

/**
 * @param {unknown} input
 * @returns {string | null}
 */
export function extractMarkdownQuote(input) {
  if (typeof input !== 'string')
    return null

  const trimmed = input.trim()
  if (!trimmed.startsWith('>'))
    return null

  const lines = trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (!lines.length)
    return null

  const parts = lines.map((line) => {
    const match = line.match(/^>\s?(.*)$/)
    return match ? match[1].trim() : null
  })

  if (parts.some(part => part == null))
    return null

  return parts.join(' ').trim() || null
}
