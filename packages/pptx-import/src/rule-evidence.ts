import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { parseXml } from '@fastppt/slidewave/xml'
import { extractObjects } from './objects.js'
import {
  relationships,
  relationshipPart,
  matchesNamespace,
  PRESENTATION_NS,
  DOCUMENT_REL_NS,
} from './relationships.js'

const IDENTITY_NS = 'urn:fastppt:template-identity:v1'
type Element = ReturnType<typeof parseXml>
export interface PptxRuleSlideEvidence {
  index: number
  part: string
  slideId?: string
  layoutPart?: string
  layout?: string
  masterPart?: string
  master?: string
  placeholders?: Array<{ index: number; type: string }>
  fixedObjects?: Array<{
    name: string
    owner: 'master' | 'layout'
    overridden: boolean
    part: string
    shapeIds: string[]
  }>
}
const child = (node: Element, local: string) =>
  node.children.find(
    (item) =>
      item.local === local && matchesNamespace(item.namespace, PRESENTATION_NS),
  )
function identity(root: Element, expected: 'layout' | 'master' | 'slide') {
  if (
    root.children.filter(
      (node) =>
        node.local === 'extLst' &&
        matchesNamespace(node.namespace, PRESENTATION_NS),
    ).length > 1
  )
    throw new Error('Ambiguous template identity extension lists')
  const entries =
    child(root, 'extLst')?.children.filter(
      (node) =>
        matchesNamespace(node.namespace, PRESENTATION_NS) &&
        node.local === 'ext' &&
        node.attributes.uri === IDENTITY_NS,
    ) ?? []
  if (!entries.length) return undefined
  if (entries.length !== 1 || entries[0]!.children.length !== 1)
    throw new Error('Ambiguous template identity extension')
  const value = entries[0]!.children[0]!
  if (
    value.namespace !== IDENTITY_NS ||
    value.local !== 'identity' ||
    value.attributes.kind !== expected ||
    !value.attributes.name?.trim()
  )
    throw new Error('Invalid template identity extension')
  if (
    expected === 'layout' &&
    value.attributes.materializedName !== child(root, 'cSld')?.attributes.name
  )
    throw new Error('Template layout identity differs from its actual name')
  return value
}

/** Read structural facts from the artifact itself. No expected contract or
 * pre-export browser measurement is accepted as a substitute for XML evidence. */
export async function readPptxRuleEvidence(input: Uint8Array) {
  const zip = await JSZip.loadAsync(input)
  const read = async (part: string) => {
    const file = zip.file(part)
    if (!file) throw new Error(`Missing PPTX part: ${part}`)
    return file.async('string')
  }
  const readRelations = async (part: string) => {
    const path = part ? relationshipPart(part) : '_rels/.rels'
    return relationships(zip.file(path) ? await read(path) : '', part)
  }
  const linked = async (
    part: string,
    kind: string,
  ): Promise<string | undefined> => {
    const candidates = (await readRelations(part)).filter(
      (entry) => entry.type === kind,
    )
    if (candidates.length > 1 || candidates.some((entry) => entry.external))
      throw new Error(`Invalid ${kind} relationship in ${part}`)
    const target = candidates[0]?.target
    if (target && !zip.file(target))
      throw new Error(`Missing ${kind} part: ${target}`)
    return target
  }
  const presentationPart = await linked('', 'officeDocument')
  if (!presentationPart)
    throw new Error('PPTX has no officeDocument relationship')
  const presentation = await read(presentationPart)
  const presentationRoot = parseXml(presentation)
  if (
    !matchesNamespace(presentationRoot.namespace, PRESENTATION_NS) ||
    presentationRoot.local !== 'presentation'
  )
    throw new Error(`Invalid presentation part: ${presentationPart}`)
  const lists = presentationRoot.children.filter(
    (node) =>
      node.local === 'sldIdLst' &&
      matchesNamespace(node.namespace, PRESENTATION_NS),
  )
  if (lists.length > 1) throw new Error('Ambiguous presentation slide list')
  const presentationRels = await readRelations(presentationPart)
  const ids =
    lists[0]?.children.filter(
      (node) =>
        node.local === 'sldId' &&
        matchesNamespace(node.namespace, PRESENTATION_NS),
    ) ?? []
  const seenIds = new Set<string>()
  const seen = new Set<string>()
  const slides: PptxRuleSlideEvidence[] = []
  for (const [index, id] of ids.entries()) {
    const numericId = id.attributes.id
    if (
      !numericId ||
      !/^\d+$/.test(numericId) ||
      !Number.isSafeInteger(Number(numericId)) ||
      seenIds.has(String(Number(numericId)))
    )
      throw new Error('Invalid or duplicate presentation slide id')
    seenIds.add(String(Number(numericId)))
    const references = Object.entries(id.attributes).filter(([name]) => {
      const [prefix, local] = name.split(':')
      return (
        local === 'id' &&
        matchesNamespace(id.namespaces[prefix!], DOCUMENT_REL_NS)
      )
    })
    if (references.length !== 1)
      throw new Error('Invalid presentation slide relationship reference')
    const reference = references[0]![1]
    const relation = presentationRels.find(
      (entry) =>
        entry.id === reference && entry.type === 'slide' && !entry.external,
    )
    if (!relation || seen.has(relation.target))
      throw new Error(`Invalid presentation slide relationship: ${reference}`)
    seen.add(relation.target)
    const part = relation.target
    const slideXml = await read(part),
      root = parseXml(slideXml)
    if (
      !matchesNamespace(root.namespace, PRESENTATION_NS) ||
      root.local !== 'sld'
    )
      throw new Error(`Invalid slide part: ${part}`)
    const slideIdentity = identity(root, 'slide')
    const evidence: PptxRuleSlideEvidence = {
      index: index + 1,
      part,
      ...(slideIdentity ? { slideId: slideIdentity.attributes.name! } : {}),
    }
    const layoutPart = await linked(part, 'slideLayout')
    if (!layoutPart)
      throw new Error(`Missing slideLayout relationship in ${part}`)
    if (layoutPart) {
      const layoutXml = await read(layoutPart),
        layoutRoot = parseXml(layoutXml)
      if (
        !matchesNamespace(layoutRoot.namespace, PRESENTATION_NS) ||
        layoutRoot.local !== 'sldLayout'
      )
        throw new Error(`Invalid layout part: ${layoutPart}`)
      const layoutIdentity = identity(layoutRoot, 'layout')
      const layoutName =
        layoutIdentity?.attributes.name ??
        child(layoutRoot, 'cSld')?.attributes.name
      evidence.layoutPart = layoutPart
      if (layoutName?.trim()) evidence.layout = layoutName
      const layoutObjects = extractObjects(layoutXml, layoutPart)
      evidence.placeholders = layoutObjects
        .filter((object) => object.placeholder)
        .map((object) => {
          const placeholder = object.placeholder!
          if (
            !/^\d+$/.test(placeholder.idx) ||
            !Number.isSafeInteger(Number(placeholder.idx))
          )
            throw new Error(`Invalid placeholder index in ${layoutPart}`)
          return { index: Number(placeholder.idx), type: placeholder.type }
        })
      if (
        new Set(evidence.placeholders.map((item) => item.index)).size !==
        evidence.placeholders.length
      )
        throw new Error(`Duplicate placeholder index in ${layoutPart}`)
      const fixed = (xml: string, path: string, owner: 'layout' | 'master') =>
        extractObjects(xml, path)
          .filter(
            (object) =>
              !object.placeholder &&
              object.kind !== 'grpSp' &&
              object.name &&
              object.shapeId &&
              !object.unsupported?.includes(
                'hidden source object requires review',
              ),
          )
          .map((object) => ({
            name: object.name!,
            owner,
            overridden: false,
            part: path,
            shapeIds: [object.shapeId!],
          }))
      const masterPart = await linked(layoutPart, 'slideMaster')
      if (!masterPart)
        throw new Error(`Missing slideMaster relationship in ${layoutPart}`)
      if (masterPart) {
        const masterXml = await read(masterPart),
          masterRoot = parseXml(masterXml)
        if (
          !matchesNamespace(masterRoot.namespace, PRESENTATION_NS) ||
          masterRoot.local !== 'sldMaster'
        )
          throw new Error(`Invalid master part: ${masterPart}`)
        const masterName =
          identity(masterRoot, 'master')?.attributes.name ??
          child(masterRoot, 'cSld')?.attributes.name
        evidence.masterPart = masterPart
        if (masterName?.trim()) evidence.master = masterName
        const hidden = (node: Element) =>
          ['0', 'false'].includes(node.attributes.showMasterSp ?? '')
        evidence.fixedObjects = hidden(root)
          ? []
          : [
              ...(hidden(layoutRoot)
                ? []
                : fixed(masterXml, masterPart, 'master')),
              ...fixed(layoutXml, layoutPart, 'layout'),
            ]
        if (
          new Set(
            evidence.fixedObjects.map((item) =>
              JSON.stringify([item.owner, item.name]),
            ),
          ).size !== evidence.fixedObjects.length
        )
          throw new Error(`Ambiguous fixed-object names in ${part}`)
        const shapes = new Set(
          extractObjects(slideXml, part)
            .map((object) => object.shapeId)
            .filter(Boolean),
        )
        const overrides = new Set<string>()
        for (const entry of slideIdentity?.children ?? []) {
          const { name, owner, shapeIds } = entry.attributes
          const ids = shapeIds?.split(' ') ?? []
          if (
            entry.namespace !== IDENTITY_NS ||
            entry.local !== 'override' ||
            !name ||
            !['master', 'layout'].includes(owner ?? '') ||
            !ids.length ||
            ids.some((id) => !shapes.has(id)) ||
            new Set(ids).size !== ids.length
          )
            throw new Error(`Invalid fixed-object override evidence in ${part}`)
          const key = JSON.stringify([owner, name])
          if (
            overrides.has(key) ||
            evidence.fixedObjects.some(
              (item) => item.name === name && item.owner === owner,
            )
          )
            throw new Error(
              `Ambiguous fixed-object override evidence in ${part}`,
            )
          overrides.add(key)
          evidence.fixedObjects.push({
            name,
            owner: owner as 'master' | 'layout',
            overridden: true,
            part,
            shapeIds: ids,
          })
        }
      }
    }
    slides.push(evidence)
  }
  return {
    source: 'pptx-xml' as const,
    sha256: createHash('sha256').update(input).digest('hex'),
    presentationPart,
    slides,
  }
}
