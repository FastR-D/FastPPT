import { posix } from 'node:path'
import type JSZip from 'jszip'
import { parseXml, PRESENTATION_NS } from './slide-xml.js'
import type { NativeMasterLayout } from './master-layout.js'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const escape = (value: string) => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const remove = (xml: string, nodes: Array<{ start: number; end: number }>) => nodes.sort((a, b) => b.start - a.start).reduce((text, node) => text.slice(0, node.start) + text.slice(node.end), xml)

/** Give explicitly grouped layouts independent masters while preserving seed theme relationships. */
export async function materializeMasterGroups(zip: JSZip, layouts: readonly NativeMasterLayout[], paths: Map<string, string>): Promise<void> {
  const groups = new Map<string, string[]>()
  for (const layout of layouts) {
    const group = layout.masterId?.trim() ?? 'default'
    if (!group) throw new Error('Master group must not be empty.')
    if (group === 'default') continue
    const names = groups.get(group) ?? []
    names.push(layout.name.trim())
    groups.set(group, names)
  }
  if (!groups.size) return
  const seedPath = 'ppt/slideMasters/slideMaster1.xml'
  const seedRelsPath = 'ppt/slideMasters/_rels/slideMaster1.xml.rels'
  const seedXml = await zip.file(seedPath)!.async('string')
  const seedRels = await zip.file(seedRelsPath)!.async('string')
  let originalXml = seedXml, originalRels = seedRels
  let presentation = await zip.file('ppt/presentation.xml')!.async('string')
  let presentationRels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')
  let contentTypes = await zip.file('[Content_Types].xml')!.async('string')
  let number = Math.max(...Object.keys(zip.files).map(path => Number(/^ppt\/slideMasters\/slideMaster(\d+)\.xml$/.exec(path)?.[1] ?? 0))) + 1
  let relNumber = Math.max(0, ...parseXml(presentationRels).children.map(node => Number(/^rId(\d+)$/.exec(node.attributes.Id ?? '')?.[1] ?? 0))) + 1
  let masterId = Math.max(2147483647, ...parseXml(presentation).children.find(node => node.local === 'sldMasterIdLst')!.children.map(node => Number(node.attributes.id))) + 1
  for (const [group, names] of groups) {
    const masterPath = `ppt/slideMasters/slideMaster${number}.xml`
    const layoutPaths = new Set(names.map(name => paths.get(name)!))
    const selected = parseXml(seedRels).children.filter(node => node.attributes.Type === `${REL}slideLayout` && layoutPaths.has(posix.normalize(posix.join('ppt/slideMasters', node.attributes.Target!))))
    if (selected.length !== names.length) throw new Error(`Missing layout relationship in master group ${group}`)
    const ids = new Set(selected.map(node => node.attributes.Id))
    const list = parseXml(seedXml).children.find(node => node.namespace === PRESENTATION_NS && node.local === 'sldLayoutIdLst')!
    const keptIds = list.children.filter(node => ids.has(node.attributes['r:id']))
    let clone = remove(seedXml, list.children.filter(node => !ids.has(node.attributes['r:id'])))
    clone = clone.replace(/<p:cSld\b([^>]*)>/, (_match, attributes: string) => `<p:cSld${attributes.replace(/\sname="[^"]*"/, '')} name="${escape(group)}">`)
    zip.file(masterPath, clone)
    zip.file(`ppt/slideMasters/_rels/slideMaster${number}.xml.rels`, remove(seedRels, parseXml(seedRels).children.filter(node => node.attributes.Type === `${REL}slideLayout` && !ids.has(node.attributes.Id))))
    originalRels = remove(originalRels, parseXml(originalRels).children.filter(node => ids.has(node.attributes.Id)))
    const currentList = parseXml(originalXml).children.find(node => node.local === 'sldLayoutIdLst')!
    originalXml = remove(originalXml, currentList.children.filter(node => keptIds.some(kept => kept.attributes.id === node.attributes.id)))
    for (const path of layoutPaths) {
      const relsPath = `${posix.dirname(path)}/_rels/${posix.basename(path)}.rels`
      const xml = await zip.file(relsPath)!.async('string')
      const relation = parseXml(xml).children.find(node => node.attributes.Type === `${REL}slideMaster`)!
      const replacement = `<${relation.name} Id="${escape(relation.attributes.Id!)}" Type="${REL}slideMaster" Target="../slideMasters/slideMaster${number}.xml"/>`
      zip.file(relsPath, xml.slice(0, relation.start) + replacement + xml.slice(relation.end))
    }
    const id = `rId${relNumber++}`
    presentationRels = presentationRels.replace('</Relationships>', `<Relationship Id="${id}" Type="${REL}slideMaster" Target="slideMasters/slideMaster${number}.xml"/></Relationships>`)
    presentation = presentation.replace('</p:sldMasterIdLst>', `<p:sldMasterId id="${masterId++}" r:id="${id}"/></p:sldMasterIdLst>`)
    contentTypes = contentTypes.replace('</Types>', `<Override PartName="/${masterPath}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/></Types>`)
    number++
  }
  zip.file(seedPath, originalXml)
  zip.file(seedRelsPath, originalRels)
  zip.file('ppt/presentation.xml', presentation)
  zip.file('ppt/_rels/presentation.xml.rels', presentationRels)
  zip.file('[Content_Types].xml', contentTypes)
}
