function preserveTextFrameTabs(html) {
  if (!html.includes('data-fastppt-text-box') || !/(\t|&#0*9;|&#[xX]0*9;|&Tab;)/.test(html)) return html
  const stack = []
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
  const rawTags = new Set(['script', 'style', 'textarea', 'pre'])
  const token = /<!--[\s\S]*?-->|<\/?([a-z][\w:.-]*)\b(?:[^<>"']|"[^"]*"|'[^']*')*>|\{\{/gi
  let cursor = 0, output = '', match
  const text = value => stack.some(entry => entry.frame)
    ? value.replace(/\t|&#0*9;|&#[xX]0*9;|&Tab;/g, '<span data-fastppt-source-tab>{{ \'\\t\' }}</span>')
    : value
  while ((match = token.exec(html))) {
    output += text(html.slice(cursor, match.index))
    const value = match[0]
    if (value === '{{') {
      // Vue closes interpolation at the first delimiter, before JS parsing.
      // Do not invent a second JS lexer (regexes and template strings may
      // contain quotes); preserve precisely the same source slice as Vue.
      const end = html.indexOf('}}', token.lastIndex)
      const index = end < 0 ? html.length : end + 2
      output += html.slice(match.index, index)
      cursor = token.lastIndex = index
      continue
    }
    output += value
    cursor = token.lastIndex
    const tag = match[1]?.toLowerCase()
    if (!tag) continue
    if (value.startsWith('</')) {
      const index = stack.findLastIndex(entry => entry.tag === tag)
      if (index !== -1) stack.splice(index)
    } else if (rawTags.has(tag) && !value.endsWith('/>')) {
      const closing = new RegExp('</' + tag + '\\s*>', 'gi')
      closing.lastIndex = cursor
      const end = closing.exec(html)
      const next = end ? closing.lastIndex : html.length
      output += html.slice(cursor, next)
      cursor = token.lastIndex = next
    } else if (!voids.has(tag) && !value.endsWith('/>')) {
      const attributes = [...value.matchAll(/([^\s=<>/"']+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s<>]+))?/g)]
      stack.push({ tag, frame: attributes.some(attribute => attribute[1] === 'data-fastppt-text-box') })
    }
  }
  return output + text(html.slice(cursor))
}
export default () => [{ name: 'fastppt-source-text-tabs', enforce: 'pre', transform(code, id) { if (/\.(md|vue)(?:$|\?)/.test(id) && code.includes('<template')) return preserveTextFrameTabs(code) } }]
