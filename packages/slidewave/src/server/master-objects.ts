import { posix } from 'node:path'
import type JSZip from 'jszip'
import { nativeMasterLayoutXml, type NativeMasterLayout } from './master-layout.js'
import { parseXml, PRESENTATION_NS } from './slide-xml.js'

/** Shared fixed objects belong to the master, once per group. */
export async function materializeMasterObjects(zip: JSZip, layouts: readonly NativeMasterLayout[], paths: Map<string, string>, canvas?: { width: number; height: number }): Promise<void> {
  const groups = new Map<string, { layout: NativeMasterLayout; xml: string }>()
  for (const layout of layouts) {
    if (!layout.masterObjects) continue
    const group = layout.masterId?.trim() ?? 'default'
    const xml = nativeMasterLayoutXml({ name: group, canvas: layout.masterObjects.canvas, fixedObjects: layout.masterObjects.objects, placeholders: [] }, canvas)
    if (groups.has(group) && groups.get(group)!.xml !== xml) throw new Error(`Conflicting fixed objects for master ${group}`)
    groups.set(group, { layout, xml })
  }
  const writes: Array<{ path: string; xml: string }> = []
  for (const { layout, xml: source } of groups.values()) {
    const layoutPath = paths.get(layout.name.trim())
    if (!layoutPath) throw new Error(`Missing layout path: ${layout.name}`)
    const relsPath = `${posix.dirname(layoutPath)}/_rels/${posix.basename(layoutPath)}.rels`
    const rels = await zip.file(relsPath)?.async('string')
    const relation = rels ? parseXml(rels).children.find(node => node.attributes.Type === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster' && node.attributes.TargetMode !== 'External') : undefined
    if (!relation?.attributes.Target) throw new Error(`Missing master relation: ${layout.name}`)
    const target = relation.attributes.Target
    const path = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(posix.dirname(layoutPath), target))
    const xml = await zip.file(path)?.async('string')
    if (!xml) throw new Error(`Missing master part: ${path}`)
    const tree = parseXml(xml).children.find(node => node.namespace === PRESENTATION_NS && node.local === 'cSld')?.children.find(node => node.namespace === PRESENTATION_NS && node.local === 'spTree')
    if (!tree) throw new Error(`Missing master shape tree: ${path}`)
    let id = 1
    const visit = (node: ReturnType<typeof parseXml>): void => {
      if (node.namespace === PRESENTATION_NS && node.local === 'cNvPr') id = Math.max(id, Number(node.attributes.Id ?? node.attributes.id) || 0)
      node.children.forEach(visit)
    }
    visit(tree)
    const sourceTree = parseXml(source).children.find(node => node.local === 'cSld')!.children.find(node => node.local === 'spTree')!
    const shapes = sourceTree.children.filter(node => node.local === 'sp').map(node => source.slice(node.start, node.end)
      .replace('<p:sp>', `<p:sp xmlns:p="${PRESENTATION_NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`)
      .replace(/(<p:cNvPr id=")\d+/, `$1${++id}`)).join('')
    const position = tree.children.find(node => node.local === 'grpSpPr')?.end
    if (position === undefined) throw new Error(`Missing master group properties: ${path}`)
    writes.push({ path, xml: xml.slice(0, position) + shapes + xml.slice(position) })
  }
  for (const write of writes) zip.file(write.path, write.xml)
}
