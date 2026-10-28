/** Namespace-aware structural editing of generated PresentationML.
 * Retains original bytes outside the edited root child. DTDs are never accepted.
 */
export const PRESENTATION_NS =
  'http://schemas.openxmlformats.org/presentationml/2006/main'
interface XmlElement {
  name: string
  local: string
  namespace: string
  attributes: Record<string, string>
  start: number
  openEnd: number
  closeStart: number
  end: number
  children: XmlElement[]
  namespaces: Record<string, string>
}
function decode(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,
    (entity) => {
      const predefined: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
      }
      if (predefined[entity]) return predefined[entity]
      return String.fromCodePoint(
        parseInt(
          entity.slice(entity.startsWith('&#x') ? 3 : 2, -1),
          entity.startsWith('&#x') ? 16 : 10,
        ),
      )
    },
  )
}
export function parseXml(xml: string): XmlElement {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('DTD and entity declarations are not supported')
  const tokens =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[\w:.-]+(?:[^<>"']|"[^"]*"|'[^']*')*>/g
  const stack: XmlElement[] = []
  let root: XmlElement | undefined
  let cursor = 0
  for (const match of xml.matchAll(tokens)) {
    if (xml.slice(cursor, match.index).includes('<') || (!stack.length && xml.slice(cursor, match.index).trim()))
      throw new Error('Malformed XML markup')
    cursor = match.index + match[0].length
    const token = match[0]
    if (token.startsWith('<?') || token.startsWith('<!')) continue
    const name = /^<\/?([\w:.-]+)/.exec(token)![1]!
    if (token.startsWith('</')) {
      const element = stack.pop()
      if (!element || element.name !== name)
        throw new Error(`Unbalanced XML element: ${name}`)
      element.closeStart = match.index
      element.end = cursor
      continue
    }
    const attributeSource = token.slice(name.length + 1).replace(/\/?\s*>$/, '')
    const attributePattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    if (attributeSource.replace(attributePattern, '').trim()) throw new Error('Malformed XML attributes')
    const attributes: Record<string, string> = {}
    const namespaces: Record<string, string> = {
      ...(stack.at(-1)?.namespaces ?? {}),
      xml: 'http://www.w3.org/XML/1998/namespace',
    }
    for (const attribute of token.matchAll(
      /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    )) {
      const key = attribute[1]!,
        value = decode(attribute[2] ?? attribute[3] ?? '')
      if (Object.hasOwn(attributes, key))
        throw new Error(`Duplicate XML attribute: ${key}`)
      attributes[key] = value
      if (key === 'xmlns') namespaces[''] = value
      else if (key.startsWith('xmlns:')) namespaces[key.slice(6)] = value
    }
    for (const key of Object.keys(attributes)) {
      const parts = key.split(':')
      if (parts.length > 2 || (parts.length === 2 && parts[0] !== 'xmlns' && !namespaces[parts[0]!]))
        throw new Error(`Unbound XML attribute prefix: ${key}`)
    }
    const parts = name.split(':'),
      prefix = parts.length > 1 ? parts[0]! : ''
    if (prefix && !namespaces[prefix])
      throw new Error(`Unbound XML prefix: ${prefix}`)
    const element: XmlElement = {
      name,
      local: parts.at(-1)!,
      namespace: namespaces[prefix] ?? '',
      attributes,
      start: match.index,
      openEnd: cursor,
      closeStart: cursor,
      end: cursor,
      children: [],
      namespaces,
    }
    if (stack.length) stack.at(-1)!.children.push(element)
    else if (root) throw new Error('Multiple XML roots')
    else root = element
    if (!token.endsWith('/>')) stack.push(element)
  }
  if (!root || stack.length || xml.slice(cursor).trim())
    throw new Error('Incomplete XML document')
  return root
}
const SLIDE_ORDER = ['cSld', 'clrMapOvr', 'transition', 'timing', 'extLst']
function slideChildName(node: XmlElement): string | undefined {
  if (node.namespace === PRESENTATION_NS) return node.local
  if (node.namespace !== 'http://schemas.openxmlformats.org/markup-compatibility/2006' || node.local !== 'AlternateContent') return undefined
  const branches = node.children
  if (!branches.length || branches.some(branch => branch.children.length !== 1)) return undefined
  const names = branches.map(branch => branch.children[0]!).map(child => child.namespace === PRESENTATION_NS ? child.local : undefined)
  return names.every(name => name === names[0]) ? names[0] : undefined
}

export function setSlideChild(
  xml: string,
  name: 'transition' | 'timing',
  fragment: string,
): string {
  let root = parseXml(xml)
  if (root.namespace !== PRESENTATION_NS || root.local !== 'sld')
    throw new Error('Expected PresentationML slide')
  const replacement = parseXml(
    `<p:sld xmlns:p="${PRESENTATION_NS}">${fragment}</p:sld>`,
  ).children
  if (
    replacement.length !== 1 ||
    !replacement[0] || slideChildName(replacement[0]) !== name
  )
    throw new Error(`Invalid ${name} fragment`)
  for (const existing of root.children
    .filter(
      (child) => slideChildName(child) === name,
    )
    .reverse()) {
    xml = xml.slice(0, existing.start) + xml.slice(existing.end)
  }
  root = parseXml(xml)
  const next = root.children.find(
    (child) =>
      SLIDE_ORDER.indexOf(slideChildName(child) ?? '') > SLIDE_ORDER.indexOf(name),
  )
  const position = next?.start ?? root.closeStart
  // The fragment owns its namespace, even if the source uses another prefix.
  const qualified =
    root.namespaces.p === PRESENTATION_NS
      ? fragment
      : fragment.replace(
          `<p:${name}`,
          `<p:${name} xmlns:p="${PRESENTATION_NS}"`,
        )
  return xml.slice(0, position) + qualified + xml.slice(position)
}
export function validateSlideAnimationXml(xml: string): string[] {
  const root = parseXml(xml),
    issues: string[] = []
  let order = -1
  const seen = new Set<string>()
  for (const child of root.children) {
    const local = slideChildName(child)
    if (!local) continue
    const rank = SLIDE_ORDER.indexOf(local)
    if (rank < 0) continue
    if (rank < order)
      issues.push(`Slide child out of schema order: ${child.local}`)
    if (seen.has(local))
      issues.push(`Duplicate slide child: ${child.local}`)
    seen.add(local)
    order = rank
  }
  const all: XmlElement[] = []
  const walk = (node: XmlElement) => {
    all.push(node)
    node.children.forEach(walk)
  }
  walk(root)
  const shapes = new Set(
    all
      .filter((e) => e.namespace === PRESENTATION_NS && e.local === 'cNvPr')
      .map((e) => e.attributes.id),
  )
  const timingIds = new Set<string>()
  for (const element of all.filter((e) => e.namespace === PRESENTATION_NS)) {
    if (element.local === 'cTn') {
      const id = element.attributes.id
      if (!id || timingIds.has(id))
        issues.push(`Missing or duplicate timing ID: ${id ?? ''}`)
      if (id) timingIds.add(id)
    }
    if (element.local === 'spTgt' && !shapes.has(element.attributes.spid))
      issues.push(
        `Animation references missing shape: ${element.attributes.spid}`,
      )
    if (element.local === 'morph')
      issues.push(
        'Morph requires an Office extension and verified object matching',
      )
  }
  for (const element of all.filter((e) => e.namespace === PRESENTATION_NS && e.local === 'tn')) {
    if (!element.attributes.val || !timingIds.has(element.attributes.val))
      issues.push(`Animation references missing timing node: ${element.attributes.val ?? ''}`)
  }
  return issues
}

/** Resolve every generated shape in a source group without relying on attribute order. */
export function animationShapeIds(xml: string, anchor: string): string[] {
  const ids = new Set<string>(), exact = new Set<string>()
  const expected = `fastppt:${anchor}`
  const visit = (element: XmlElement): void => {
    const name = element.attributes.name
    const id = element.attributes.id
    if (element.namespace === PRESENTATION_NS && element.local === 'cNvPr' && id && (name === expected || name?.startsWith(`${expected}:`))) { ids.add(id); if (name === expected) exact.add(id) }
    for (const child of element.children) visit(child)
  }
  visit(parseXml(xml))
  return [...(exact.size ? exact : ids)]
}
