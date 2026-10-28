import { parseXml } from '@fastppt/slidewave/xml'
import { DRAWING_NS, PRESENTATION_NS, matchesNamespace } from './relationships.js'

export interface SourceColorMap {
  part: string
  mode: 'mapping' | 'master'
  mapping: Record<string, string>
  sourceXml: string
  provenance: 'extracted'
}

export function extractColorMap(xml: string, part: string): SourceColorMap | undefined {
  if (!xml.trim()) return undefined
  const root = parseXml(xml)
  const definitions = root.children.filter((node) => matchesNamespace(node.namespace, PRESENTATION_NS) && ['clrMap', 'clrMapOvr'].includes(node.local))
  if (definitions.length > 1) throw new Error(`Ambiguous color mapping in ${part}`)
  const definition = definitions[0]
  if (!definition) return undefined
  let mapping = definition
  if (definition.local === 'clrMapOvr') {
    const choices = definition.children.filter((node) => matchesNamespace(node.namespace, DRAWING_NS) && ['masterClrMapping', 'overrideClrMapping'].includes(node.local))
    if (choices.length !== 1) throw new Error(`Invalid color mapping override in ${part}`)
    mapping = choices[0]!
  }
  return { part, mode: mapping.local === 'masterClrMapping' ? 'master' : 'mapping', mapping: Object.fromEntries(Object.entries(mapping.attributes).filter(([key]) => !key.includes(':') && key !== 'xmlns')), sourceXml: xml.slice(definition.start, definition.end), provenance: 'extracted' }
}

export function resolveColorMap(page: string, maps: readonly SourceColorMap[], layout?: string, master?: string) {
  const find = (part?: string) => maps.find((map) => map.part === part)
  const local = find(page) ?? find(layout)
  const source = local?.mode === 'mapping' ? local : find(master)
  return { part: page, ...(source?.mode === 'mapping' ? { mapping: source.mapping, sourcePart: source.part } : {}), ...(local?.mode === 'master' ? { resetBy: local.part } : {}), status: source?.mode === 'mapping' ? 'resolved' as const : 'unspecified' as const, provenance: 'derived' as const }
}
