import { posix } from 'node:path'
import type JSZip from 'jszip'
import { animationShapeIds, parseXml, PRESENTATION_NS } from './slide-xml.js'
import type { NativeMasterLayout } from './master-layout.js'
import type { HtmlDeckSnapshot } from '../snapshot-types.js'
import { isFixedObjectOverridden } from './fixed-object-overrides.js'

const IDENTITY_NS = 'urn:fastppt:template-identity:v1'
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  )

/** Office can ignore this extension. Readback uses it only for logical names;
 * relationships and actual shapes remain the structural evidence. */
function withIdentity(
  xml: string,
  attributes: Record<string, string>,
  children = '',
): string {
  const root = parseXml(xml)
  if (root.namespace !== PRESENTATION_NS)
    throw new Error('Expected a PresentationML part for template identity')
  const existing = root.children.find(
    (node) => node.namespace === PRESENTATION_NS && node.local === 'extLst',
  )
  const extension = `<p:ext xmlns:p="${PRESENTATION_NS}" uri="${IDENTITY_NS}"><fp:identity xmlns:fp="${IDENTITY_NS}" ${Object.entries(
    attributes,
  )
    .map(([key, value]) => `${key}="${escape(value)}"`)
    .join(' ')}>${children}</fp:identity></p:ext>`
  if (existing) {
    if (existing.children.some((node) => node.attributes.uri === IDENTITY_NS))
      throw new Error('Duplicate template identity')
    if (xml.slice(existing.start, existing.end).endsWith('/>'))
      return (
        xml.slice(0, existing.start) +
        `<p:extLst xmlns:p="${PRESENTATION_NS}">${extension}</p:extLst>` +
        xml.slice(existing.end)
      )
    return (
      xml.slice(0, existing.closeStart) +
      extension +
      xml.slice(existing.closeStart)
    )
  }
  return (
    xml.slice(0, root.closeStart) +
    `<p:extLst xmlns:p="${PRESENTATION_NS}">${extension}</p:extLst>` +
    xml.slice(root.closeStart)
  )
}

export async function writeTemplateIdentities(
  zip: JSZip,
  paths: ReadonlyMap<string, string>,
  definitions: readonly NativeMasterLayout[],
  logical: ReadonlyMap<string, { layout: string; master: string }>,
  excluded: Map<number, Set<string>>,
  snapshot: HtmlDeckSnapshot,
): Promise<void> {
  const masters = new Map<string, string>()
  for (const [name, path] of paths) {
    const definition = definitions.find((item) => item.name.trim() === name)
    const identity = logical.get(name) ?? {
      layout: name,
      master: definition?.masterId?.trim() ?? 'default',
    }
    const xml = await zip.file(path)!.async('string')
    zip.file(
      path,
      withIdentity(xml, {
        kind: 'layout',
        name: identity.layout,
        materializedName: name,
      }),
    )
    const relsPath = posix.join(
      posix.dirname(path),
      '_rels',
      `${posix.basename(path)}.rels`,
    )
    const rels = await zip.file(relsPath)?.async('string')
    const relation = rels
      ? parseXml(rels).children.find(
          (node) =>
            node.attributes.Type ===
              'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster' &&
            node.attributes.TargetMode !== 'External',
        )
      : undefined
    if (!relation?.attributes.Target)
      throw new Error(`Missing master relationship for ${path}`)
    const target = relation.attributes.Target
    const masterPath = target.startsWith('/')
      ? target.slice(1)
      : posix.normalize(posix.join(posix.dirname(path), target))
    if (masters.has(masterPath) && masters.get(masterPath) !== identity.master)
      throw new Error('Conflicting logical master identities')
    masters.set(masterPath, identity.master)
  }
  for (const [path, name] of masters) {
    const xml = await zip.file(path)?.async('string')
    if (!xml) throw new Error(`Missing template master ${path}`)
    zip.file(path, withIdentity(xml, { kind: 'master', name }))
  }
  for (const [index, page] of snapshot.slides.entries()) {
    const path = `ppt/slides/slide${index + 1}.xml`
    const xml = await zip.file(path)?.async('string')
    if (!xml) throw new Error(`Missing template slide ${path}`)
    const overrides = new Map<
      string,
      { name: string; owner: string; ids: Set<string> }
    >()
    for (const element of page.elements) {
      const owner = element.source.nativeLayoutObject
      if (!owner || !isFixedObjectOverridden(excluded, index, owner)) continue
      if (!element.source.anchor)
        throw new Error('Fixed-object override has no source anchor')
      const ids = animationShapeIds(xml, element.source.anchor)
      if (!ids.length)
        throw new Error('Fixed-object override has no emitted shapes')
      const key = JSON.stringify([owner.scope ?? 'layout', owner.name])
      const record = overrides.get(key) ?? {
        name: owner.name,
        owner: owner.scope ?? 'layout',
        ids: new Set<string>(),
      }
      for (const id of ids) record.ids.add(id)
      overrides.set(key, record)
    }
    const children = [...overrides.values()]
      .map(
        (item) =>
          `<fp:override name="${escape(item.name)}" owner="${item.owner}" shapeIds="${[...item.ids].join(' ')}"/>`,
      )
      .join('')
    zip.file(
      path,
      withIdentity(xml, { kind: 'slide', name: page.id }, children),
    )
  }
}
