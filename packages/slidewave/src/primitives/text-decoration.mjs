export function validateTextDecorations(value) {
  for (const key of ['underline', 'strike'])
    if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw new Error(`Invalid text ${key}; only single or explicitly disabled decoration is supported.`)
}

export function sourceTextDecorations(style, overrides = {}) {
  return Object.fromEntries(['underline', 'strike'].flatMap(key => {
    const value = overrides[key] === undefined ? style[key] : overrides[key]
    return value === undefined ? [] : [[key, value]]
  }))
}

export function textDecorationLine(style) {
  return [style.underline === true ? 'underline' : '', style.strike === true ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'
}

export function readTextDecorationContract(element, attribute) {
  const raw = element.getAttribute(attribute)
  if (raw === null) return undefined
  const value = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['underline', 'strike'].includes(key)))
    throw new Error('Invalid source text decoration contract.')
  validateTextDecorations(value)
  return value
}
