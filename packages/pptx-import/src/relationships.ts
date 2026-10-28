import { parseXml } from '@fastppt/slidewave/xml'
import { posix } from 'node:path'

export interface PartRelationship { id: string; type: string; target: string; external: boolean }

export const PRESENTATION_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
export const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
export const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
export const DOCUMENT_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const strictNamespaces: Record<string, string> = {
  [PRESENTATION_NS]: 'http://purl.oclc.org/ooxml/presentationml/main',
  [DRAWING_NS]: 'http://purl.oclc.org/ooxml/drawingml/main',
  [DOCUMENT_REL_NS]: 'http://purl.oclc.org/ooxml/officeDocument/relationships',
}
export function matchesNamespace(actual: string | undefined, expected: string): boolean {
  return actual === expected || (strictNamespaces[expected] !== undefined && actual === strictNamespaces[expected])
}

export function tags(xml: string, localName: string, namespace = PRESENTATION_NS): Record<string, string>[] {
  if (!xml.trim()) return []
  const result: Record<string, string>[] = []
  const walk = (element: ReturnType<typeof parseXml>) => {
    if (element.local === localName && matchesNamespace(element.namespace, namespace)) {
      const attributes = { ...element.attributes }
      for (const [name, value] of Object.entries(element.attributes)) {
        const [prefix, local] = name.split(':')
        if (local && matchesNamespace(element.namespaces[prefix!], DOCUMENT_REL_NS)) attributes[`r:${local}`] = value
      }
      result.push(attributes)
    }
    element.children.forEach(walk)
  }
  walk(parseXml(xml))
  return result
}

export function relationshipPart(part: string): string {
  return posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`)
}

export function relationships(xml: string, source: string): PartRelationship[] {
  const ids = new Set<string>()
  return tags(xml, 'Relationship', PACKAGE_REL_NS).map((entry) => {
    if (!entry.Id || !entry.Type || !entry.Target || ids.has(entry.Id)) throw new Error(`Invalid or duplicate relationship in ${source}`)
    ids.add(entry.Id)
    const external = entry.TargetMode === 'External'
    const target = external ? entry.Target : posix.normalize(entry.Target.startsWith('/') ? entry.Target.slice(1) : posix.join(posix.dirname(source), entry.Target))
    if (!external && (target.startsWith('../') || target.includes('\\'))) throw new Error(`Invalid package target in ${source}`)
    const knownType = [DOCUMENT_REL_NS, strictNamespaces[DOCUMENT_REL_NS]!].some((namespace) => entry.Type!.startsWith(`${namespace}/`))
    return { id: entry.Id, type: knownType ? entry.Type.split('/').at(-1)! : entry.Type, target, external }
  })
}
