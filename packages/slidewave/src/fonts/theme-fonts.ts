import { parseXml } from '../server/slide-xml.js'
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
/** Explicit theme faces. Empty script faces require language-specific resolution. */
export function themeFontAliases(xml: string): Map<string, string> {
  const aliases = new Map<string, string>()
  const root = parseXml(xml)
  const elements = root.children.find(node => node.namespace === DRAWING_NS && node.local === 'themeElements')
  const scheme = elements?.children.find(node => node.namespace === DRAWING_NS && node.local === 'fontScheme')
  for (const [role, prefix] of [['majorFont', 'mj'], ['minorFont', 'mn']] as const) {
    const group = scheme?.children.find(node => node.namespace === DRAWING_NS && node.local === role)
    for (const [script, suffix] of [['latin', 'lt'], ['ea', 'ea'], ['cs', 'cs']] as const) {
      const family = group?.children.find(node => node.namespace === DRAWING_NS && node.local === script)?.attributes.typeface
      if (family?.trim()) aliases.set(`+${prefix}-${suffix}`, family)
    }
  }
  return aliases
}
