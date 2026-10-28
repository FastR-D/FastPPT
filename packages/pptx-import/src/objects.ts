import { parseXml } from '@fastppt/slidewave/xml'
import {
  DRAWING_NS,
  PRESENTATION_NS,
  DOCUMENT_REL_NS,
  matchesNamespace,
} from './relationships.js'

type Element = ReturnType<typeof parseXml>
type SourceRun = NonNullable<
  SourceObject['text']
>['paragraphs'][number]['runs'][number]

export interface SourceTextProperty {
  kind: string
  namespace?: string
  attributes: Record<string, string>
  children: SourceTextProperty[]
}

export interface SourceCharacterProperties {
  attributes: Record<string, string>
  fonts: Partial<
    Record<'latin' | 'eastAsian' | 'complexScript', Record<string, string>>
  >
  fill?: SourceFill
  children: SourceTextProperty[]
  sourceXml: string
  provenance: 'extracted'
}

export interface SourceParagraphProperties {
  /** One-based DrawingML list level; absent for defPPr or paragraph pPr. */
  level?: number
  attributes: Record<string, string>
  children: SourceTextProperty[]
  defaultRun?: SourceCharacterProperties
  sourceXml: string
  provenance: 'extracted'
}

export interface SourcePartTextStyles {
  part: string
  defaultTextStyle: SourceParagraphProperties[]
  titleStyle: SourceParagraphProperties[]
  bodyStyle: SourceParagraphProperties[]
  otherStyle: SourceParagraphProperties[]
  provenance: 'extracted'
}
export interface SourceObject {
  part: string
  shapeId?: string
  name?: string
  kind: string
  parentShapeId?: string
  order: number
  unsupported?: string[]
  shapeGeometry?: {
    kind: 'preset' | 'custom'
    preset?: string
    sourceXml: string
  }
  placeholder?: { type: string; idx: string; explicit: Record<string, string> }
  transform?: {
    units: 'emu'
    attributes: Record<string, string>
    offset?: Record<string, string>
    extent?: Record<string, string>
    childOffset?: Record<string, string>
    childExtent?: Record<string, string>
  }
  image?: {
    references: Array<{ kind: 'embed' | 'link'; relationshipId: string }>
    crop: Record<string, string>
    stretch?: Record<string, string>
    tile?: Record<string, string>
    attributes: Record<string, string>
  }
  /** Local DrawingML appearance.  This is source evidence; it is not a
   * promise that the appearance can already be materialized by the exporter. */
  appearance?: {
    fill?: SourceFill
    line?: SourceLine
    textBody?: {
      attributes: Record<string, string>
      children?: string[]
      properties?: SourceTextProperty[]
      sourceXml: string
      provenance: 'extracted'
    }
    paragraphDefaults?: SourceParagraphProperties[]
    fontReference?: {
      index: string
      color?: SourceColor
      sourceXml: string
      provenance: 'extracted'
    }
  }
  text?: {
    paragraphs: Array<{
      format?: SourceParagraphProperties
      endProperties?: SourceCharacterProperties
      runs: Array<{
        text: string
        properties: Record<string, string>
        character?: SourceCharacterProperties
        kind?: 'text' | 'field' | 'break' | 'tab'
        style?: {
          latin?: string
          eastAsian?: string
          complexScript?: string
          fill?: SourceFill
        }
        sourceXml: string
        provenance: 'extracted'
      }>
      text: string
      sourceXml: string
      provenance: 'extracted'
    }>
    plainText: string
    provenance: 'extracted'
  }
  sourceXml: string
  provenance: 'extracted'
}

export interface SourceColor {
  kind: string
  attributes: Record<string, string>
  transforms: Array<{ kind: string; attributes: Record<string, string> }>
  sourceXml: string
  provenance: 'extracted'
}

export interface SourceFill {
  kind:
    'solid' | 'gradient' | 'image' | 'pattern' | 'group' | 'none' | 'unknown'
  attributes: Record<string, string>
  color?: SourceColor
  stops?: Array<{
    position: number
    color?: SourceColor
    sourceXml: string
    provenance: 'extracted'
  }>
  references?: Array<{ kind: 'embed' | 'link'; relationshipId: string }>
  sourceXml: string
  provenance: 'extracted'
}

export interface SourceLine {
  attributes: Record<string, string>
  fill?: SourceFill
  sourceXml: string
  provenance: 'extracted'
}

function child(
  element: Element | undefined,
  local: string,
  namespace = PRESENTATION_NS,
): Element | undefined {
  return element?.children.find(
    (item) =>
      item.local === local && matchesNamespace(item.namespace, namespace),
  )
}

function textContent(node: Element, xml: string): string {
  return xml
    .slice(node.openEnd, node.closeStart)
    .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
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
    })
}

function extractText(shape: Element, xml: string): SourceObject['text'] {
  const body = child(shape, 'txBody')
  if (!body) return undefined
  const paragraphs = body.children
    .filter(
      (node) =>
        matchesNamespace(node.namespace, DRAWING_NS) && node.local === 'p',
    )
    .map((paragraph) => {
      const runs = paragraph.children
        .filter(
          (node) =>
            matchesNamespace(node.namespace, DRAWING_NS) &&
            ['r', 'fld', 'br', 'tab'].includes(node.local),
        )
        .flatMap<SourceRun>((run) => {
          const properties = drawingChild(run, 'rPr')
          const character = extractCharacterProperties(properties, xml)
          const style: NonNullable<SourceRun['style']> = {
            ...Object.fromEntries(
              Object.entries(character?.fonts ?? {}).map(([script, font]) => [
                script,
                font.typeface,
              ]),
            ),
            ...(character?.fill ? { fill: character.fill } : {}),
          }
          if (run.local === 'br' || run.local === 'tab')
            return [
              {
                text: run.local === 'br' ? '\n' : '\t',
                properties: properties?.attributes ?? {},
                ...(character ? { character } : {}),
                style,
                kind:
                  run.local === 'br' ? ('break' as const) : ('tab' as const),
                sourceXml: xml.slice(run.start, run.end),
                provenance: 'extracted' as const,
              },
            ]
          const textNodes = run.children.filter(
            (node) =>
              matchesNamespace(node.namespace, DRAWING_NS) &&
              node.local === 't',
          )
          return textNodes.map((textNode) => ({
            text: textContent(textNode, xml),
            kind: run.local === 'fld' ? ('field' as const) : ('text' as const),
            style,
            properties: properties?.attributes ?? {},
            ...(character ? { character } : {}),
            sourceXml: xml.slice(run.start, run.end),
            provenance: 'extracted' as const,
          }))
        })
      const text = runs.map((run) => run.text).join('')
      const properties = drawingChild(paragraph, 'pPr')
      return {
        runs,
        text,
        ...(properties
          ? { format: extractParagraphProperties(properties, xml) }
          : {}),
        ...(drawingChild(paragraph, 'endParaRPr')
          ? {
              endProperties: extractCharacterProperties(
                drawingChild(paragraph, 'endParaRPr'),
                xml,
              )!,
            }
          : {}),
        sourceXml: xml.slice(paragraph.start, paragraph.end),
        provenance: 'extracted' as const,
      }
    })
  if (!paragraphs.length) return undefined
  return {
    paragraphs,
    plainText: paragraphs.map((paragraph) => paragraph.text).join('\n'),
    provenance: 'extracted',
  }
}

function drawingChild(
  node: Element | undefined,
  local: string,
): Element | undefined {
  return node?.children.find(
    (item) =>
      matchesNamespace(item.namespace, DRAWING_NS) && item.local === local,
  )
}

function extractColor(
  node: Element | undefined,
  xml: string,
): SourceColor | undefined {
  if (!node || !matchesNamespace(node.namespace, DRAWING_NS)) return undefined
  if (
    ![
      'srgbClr',
      'sysClr',
      'schemeClr',
      'prstClr',
      'scrgbClr',
      'hslClr',
    ].includes(node.local)
  )
    return undefined
  return {
    kind: node.local,
    attributes: node.attributes,
    transforms: node.children
      .filter((child) => matchesNamespace(child.namespace, DRAWING_NS))
      .map((child) => ({ kind: child.local, attributes: child.attributes })),
    sourceXml: xml.slice(node.start, node.end),
    provenance: 'extracted',
  }
}

function extractFill(
  node: Element | undefined,
  xml: string,
): SourceFill | undefined {
  if (!node || !isFill(node)) return undefined
  const kind =
    node.local === 'solidFill'
      ? 'solid'
      : node.local === 'gradFill'
        ? 'gradient'
        : node.local === 'blipFill'
          ? 'image'
          : node.local === 'pattFill'
            ? 'pattern'
            : node.local === 'grpFill'
              ? 'group'
              : node.local === 'noFill'
                ? 'none'
                : 'unknown'
  const color = extractColor(
    node.children.find((child) =>
      matchesNamespace(child.namespace, DRAWING_NS),
    ),
    xml,
  )
  const stops = drawingChild(node, 'gsLst')
    ?.children.filter(
      (child) =>
        matchesNamespace(child.namespace, DRAWING_NS) && child.local === 'gs',
    )
    .map((stop) => {
      const stopColor = extractColor(
        stop.children.find((child) =>
          matchesNamespace(child.namespace, DRAWING_NS),
        ),
        xml,
      )
      return {
        position: Number(stop.attributes.pos ?? 0) / 100000,
        ...(stopColor ? { color: stopColor } : {}),
        sourceXml: xml.slice(stop.start, stop.end),
        provenance: 'extracted' as const,
      }
    })
    .filter((stop) => Number.isFinite(stop.position))
  const blip = drawingChild(node, 'blip')
  const references = blip
    ? Object.entries(blip.attributes)
        .map(([name, relationshipId]) => {
          const [prefix, local] = name.split(':')
          return (local === 'embed' || local === 'link') &&
            matchesNamespace(blip.namespaces[prefix!], DOCUMENT_REL_NS)
            ? { kind: local, relationshipId }
            : undefined
        })
        .filter(
          (
            entry,
          ): entry is { kind: 'embed' | 'link'; relationshipId: string } =>
            Boolean(entry),
        )
    : undefined
  return {
    kind,
    attributes: node.attributes,
    ...(color ? { color } : {}),
    ...(stops?.length ? { stops } : {}),
    ...(references?.length ? { references } : {}),
    sourceXml: xml.slice(node.start, node.end),
    provenance: 'extracted',
  }
}

function isFill(node: Element): boolean {
  return (
    matchesNamespace(node.namespace, DRAWING_NS) &&
    [
      'solidFill',
      'gradFill',
      'blipFill',
      'pattFill',
      'grpFill',
      'noFill',
    ].includes(node.local)
  )
}

function textProperty(node: Element): SourceTextProperty {
  return {
    kind: node.local,
    ...(node.namespace ? { namespace: node.namespace } : {}),
    attributes: node.attributes,
    children: node.children.map(textProperty),
  }
}

function extractCharacterProperties(
  node: Element | undefined,
  xml: string,
): SourceCharacterProperties | undefined {
  if (!node) return undefined
  const fonts: SourceCharacterProperties['fonts'] = {}
  for (const [name, script] of [
    ['latin', 'latin'],
    ['ea', 'eastAsian'],
    ['cs', 'complexScript'],
  ] as const) {
    const font = drawingChild(node, name)
    if (font) fonts[script] = font.attributes
  }
  const fill = extractFill(node.children.find(isFill), xml)
  return {
    attributes: node.attributes,
    fonts,
    ...(fill ? { fill } : {}),
    children: node.children
      .filter(
        (entry) =>
          !matchesNamespace(entry.namespace, DRAWING_NS) ||
          (!['latin', 'ea', 'cs'].includes(entry.local) && !isFill(entry)),
      )
      .map(textProperty),
    sourceXml: xml.slice(node.start, node.end),
    provenance: 'extracted',
  }
}

function extractParagraphProperties(
  node: Element,
  xml: string,
): SourceParagraphProperties {
  const defaultRun = extractCharacterProperties(
    drawingChild(node, 'defRPr'),
    xml,
  )
  return {
    ...(/^lvl[1-9]pPr$/.test(node.local)
      ? { level: Number(node.local[3]) }
      : {}),
    attributes: node.attributes,
    children: node.children
      .filter(
        (entry) =>
          entry.local !== 'defRPr' ||
          !matchesNamespace(entry.namespace, DRAWING_NS),
      )
      .map(textProperty),
    ...(defaultRun ? { defaultRun } : {}),
    sourceXml: xml.slice(node.start, node.end),
    provenance: 'extracted',
  }
}

function extractListStyle(
  node: Element | undefined,
  xml: string,
): SourceParagraphProperties[] {
  return (node?.children ?? [])
    .filter(
      (entry) =>
        matchesNamespace(entry.namespace, DRAWING_NS) &&
        (entry.local === 'defPPr' || /^lvl[1-9]pPr$/.test(entry.local)),
    )
    .map((entry) => extractParagraphProperties(entry, xml))
}

/** Keep presentation/master defaults separate from shape-local evidence. */
export function extractPartTextStyles(
  xml: string,
  part: string,
): SourcePartTextStyles {
  const root = xml.trim() ? parseXml(xml) : undefined
  const styles = child(root, 'txStyles')
  return {
    part,
    defaultTextStyle: extractListStyle(child(root, 'defaultTextStyle'), xml),
    titleStyle: extractListStyle(child(styles, 'titleStyle'), xml),
    bodyStyle: extractListStyle(child(styles, 'bodyStyle'), xml),
    otherStyle: extractListStyle(child(styles, 'otherStyle'), xml),
    provenance: 'extracted',
  }
}

function extractAppearance(
  shape: Element,
  properties: Element | undefined,
  xml: string,
): SourceObject['appearance'] {
  const fillNode = properties?.children.find(
    (child) =>
      matchesNamespace(child.namespace, DRAWING_NS) &&
      [
        'solidFill',
        'gradFill',
        'blipFill',
        'pattFill',
        'grpFill',
        'noFill',
      ].includes(child.local),
  )
  const lineNode = drawingChild(properties, 'ln')
  const body = child(shape, 'txBody')
  const bodyPr = drawingChild(body, 'bodyPr')
  const listStyle = drawingChild(body, 'lstStyle')
  const paragraphDefaults = extractListStyle(listStyle, xml)
  const fontReferenceNode = drawingChild(child(shape, 'style'), 'fontRef')
  const referenceColor = extractColor(fontReferenceNode?.children[0], xml)
  const fill = fillNode ? extractFill(fillNode, xml) : undefined
  const lineFillNode = lineNode?.children.find(isFill)
  const lineFill = lineFillNode ? extractFill(lineFillNode, xml) : undefined
  const appearance = {
    ...(fill ? { fill } : {}),
    ...(lineNode
      ? {
          line: {
            attributes: lineNode.attributes,
            ...(lineFill ? { fill: lineFill } : {}),
            sourceXml: xml.slice(lineNode.start, lineNode.end),
            provenance: 'extracted' as const,
          },
        }
      : {}),
    ...(bodyPr
      ? {
          textBody: {
            attributes: bodyPr.attributes,
            children: bodyPr.children
              .filter((node) => matchesNamespace(node.namespace, DRAWING_NS))
              .map((node) => node.local),
            properties: bodyPr.children.map(textProperty),
            sourceXml: xml.slice(bodyPr.start, bodyPr.end),
            provenance: 'extracted' as const,
          },
        }
      : {}),
    ...(paragraphDefaults.length ? { paragraphDefaults } : {}),
    ...(fontReferenceNode
      ? {
          fontReference: {
            index: fontReferenceNode.attributes.idx ?? '',
            ...(referenceColor ? { color: referenceColor } : {}),
            sourceXml: xml.slice(
              fontReferenceNode.start,
              fontReferenceNode.end,
            ),
            provenance: 'extracted' as const,
          },
        }
      : {}),
  }
  return Object.keys(appearance).length ? appearance : undefined
}

/** Preserve local OOXML geometry and group coordinate systems; do not flatten inheritance. */
export function extractObjects(xml: string, part: string): SourceObject[] {
  if (!xml.trim()) return []
  const root = parseXml(xml)
  const tree = child(child(root, 'cSld'), 'spTree')
  if (!tree) return []
  const objects: SourceObject[] = []
  const walk = (container: Element, parentShapeId?: string) => {
    for (const shape of container.children) {
      if (
        !matchesNamespace(shape.namespace, PRESENTATION_NS) ||
        ![
          'sp',
          'pic',
          'graphicFrame',
          'cxnSp',
          'grpSp',
          'contentPart',
        ].includes(shape.local)
      )
        continue
      const nonVisual = shape.children.find(
        (item) =>
          matchesNamespace(item.namespace, PRESENTATION_NS) &&
          /^nv.*Pr$/.test(item.local),
      )
      const identity = child(nonVisual, 'cNvPr')?.attributes
      const placeholder = child(child(nonVisual, 'nvPr'), 'ph')
      const properties = child(
        shape,
        shape.local === 'grpSp' ? 'grpSpPr' : 'spPr',
      )
      const transform =
        child(properties, 'xfrm', DRAWING_NS) ?? child(shape, 'xfrm')
      const entry: SourceObject = {
        part,
        kind: shape.local,
        order: objects.length,
        sourceXml: xml.slice(shape.start, shape.end),
        provenance: 'extracted',
        ...(identity?.id ? { shapeId: identity.id } : {}),
        ...(identity?.name ? { name: identity.name } : {}),
        ...(parentShapeId ? { parentShapeId } : {}),
        ...(placeholder
          ? {
              placeholder: {
                type: placeholder.attributes.type ?? 'obj',
                idx: placeholder.attributes.idx ?? '0',
                explicit: placeholder.attributes,
              },
            }
          : {}),
      }
      const imageFill =
        child(shape, 'blipFill') ?? child(properties, 'blipFill', DRAWING_NS)
      if (imageFill) {
        const blip = child(imageFill, 'blip', DRAWING_NS)
        const references: NonNullable<SourceObject['image']>['references'] = []
        for (const [name, relationshipId] of Object.entries(
          blip?.attributes ?? {},
        )) {
          const [prefix, local] = name.split(':')
          if (
            (local === 'embed' || local === 'link') &&
            matchesNamespace(blip?.namespaces[prefix!], DOCUMENT_REL_NS)
          )
            references.push({ kind: local, relationshipId })
        }
        const stretch = child(
          child(imageFill, 'stretch', DRAWING_NS),
          'fillRect',
          DRAWING_NS,
        )
        const tile = child(imageFill, 'tile', DRAWING_NS)
        entry.image = {
          references,
          crop: child(imageFill, 'srcRect', DRAWING_NS)?.attributes ?? {},
          attributes: imageFill.attributes,
          ...(stretch ? { stretch: stretch.attributes } : {}),
          ...(tile ? { tile: tile.attributes } : {}),
        }
      }
      const text = extractText(shape, xml)
      if (text) entry.text = text
      const preset = drawingChild(properties, 'prstGeom')
      const custom = drawingChild(properties, 'custGeom')
      if (preset || custom) {
        const node = (preset ?? custom)!
        entry.shapeGeometry = {
          kind: preset ? 'preset' : 'custom',
          ...(preset?.attributes.prst
            ? { preset: preset.attributes.prst }
            : {}),
          sourceXml: xml.slice(node.start, node.end),
        }
      }
      const appearance = extractAppearance(shape, properties, xml)
      if (appearance) entry.appearance = appearance
      const unsupported = [
        ...(properties?.children ?? [])
          .filter(
            (node) =>
              matchesNamespace(node.namespace, DRAWING_NS) &&
              ![
                'xfrm',
                'prstGeom',
                'custGeom',
                'ln',
                'noFill',
                'solidFill',
                'gradFill',
                'blipFill',
                'pattFill',
                'grpFill',
              ].includes(node.local),
          )
          .map((node) => `shape property ${node.local} requires review`),
        ...(child(shape, 'style')?.children ?? [])
          .filter(
            (node) =>
              node.local !== 'fontRef' ||
              !matchesNamespace(node.namespace, DRAWING_NS),
          )
          .map((node) => `theme style reference ${node.local} requires review`),
        ...(identity?.hidden && !['0', 'false'].includes(identity.hidden)
          ? ['hidden source object requires review']
          : []),
      ]
      if (unsupported.length) entry.unsupported = unsupported
      if (transform) {
        entry.transform = { units: 'emu', attributes: transform.attributes }
        for (const [name, field] of [
          ['off', 'offset'],
          ['ext', 'extent'],
          ['chOff', 'childOffset'],
          ['chExt', 'childExtent'],
        ] as const) {
          const value = child(transform, name, DRAWING_NS)
          if (value) entry.transform[field] = value.attributes
        }
      }
      objects.push(entry)
      if (shape.local === 'grpSp') walk(shape, identity?.id)
    }
  }
  walk(tree)
  return objects
}
