import { parseXml } from '@fastppt/slidewave/xml'
import {
  DRAWING_NS,
  PRESENTATION_NS,
  matchesNamespace,
} from './relationships.js'

type Element = ReturnType<typeof parseXml>
const child = (node: Element | undefined, local: string) =>
  node?.children.find(
    (item) =>
      matchesNamespace(item.namespace, DRAWING_NS) && item.local === local,
  )

function extractThemeElements(
  xml: string,
  part: string,
  elements: Element | undefined,
  name?: string,
) {
  const scheme = child(elements, 'clrScheme')
  const colors = (scheme?.children ?? [])
    .filter((node) => matchesNamespace(node.namespace, DRAWING_NS))
    .map((role) => {
      const color = role.children.find((node) =>
        matchesNamespace(node.namespace, DRAWING_NS),
      )
      return {
        role: role.local,
        ...(color
          ? {
              kind: color.local,
              attributes: color.attributes,
              transforms: color.children
                .filter((node) => matchesNamespace(node.namespace, DRAWING_NS))
                .map((node) => ({
                  kind: node.local,
                  attributes: node.attributes,
                })),
            }
          : {}),
        sourceXml: xml.slice(role.start, role.end),
        provenance: 'extracted' as const,
      }
    })
  const fonts = child(elements, 'fontScheme')
  const fontCollection = (name: string) => {
    const collection = child(fonts, name)
    if (!collection) return undefined
    return {
      sourcePart: part,
      latin: child(collection, 'latin')?.attributes,
      eastAsian: child(collection, 'ea')?.attributes,
      complexScript: child(collection, 'cs')?.attributes,
      scripts: collection.children
        .filter(
          (node) =>
            matchesNamespace(node.namespace, DRAWING_NS) &&
            node.local === 'font',
        )
        .map((node) => node.attributes),
      sourceXml: xml.slice(collection.start, collection.end),
    }
  }
  const format = child(elements, 'fmtScheme')
  const backgroundStyles =
    child(format, 'bgFillStyleLst')
      ?.children.filter((node) => matchesNamespace(node.namespace, DRAWING_NS))
      .map((node, index) => ({
        index: index + 1001,
        kind: node.local,
        sourceXml: xml.slice(node.start, node.end),
        namespaces: node.namespaces,
      })) ?? []
  return {
    part,
    ...(name ? { name } : {}),
    colorSchemeName: scheme?.attributes.name,
    colors,
    fontSchemeName: fonts?.attributes.name,
    majorFonts: fontCollection('majorFont'),
    minorFonts: fontCollection('minorFont'),
    backgroundStyles,
    namespaces: elements?.namespaces ?? {},
    provenance: 'extracted' as const,
  }
}

export function extractTheme(xml: string, part: string) {
  const root = parseXml(xml)
  return extractThemeElements(
    xml,
    part,
    child(root, 'themeElements'),
    root.attributes.name,
  )
}

export function extractThemeOverride(xml: string, part: string) {
  if (!xml.trim()) return undefined
  const root = parseXml(xml)
  let override: Element | undefined
  const visit = (node: Element): void => {
    if (
      (matchesNamespace(node.namespace, PRESENTATION_NS) ||
        matchesNamespace(node.namespace, DRAWING_NS)) &&
      node.local === 'themeOverride'
    ) {
      if (override) throw new Error(`Multiple theme overrides in ${part}`)
      override = node
    }
    node.children.forEach(visit)
  }
  visit(root)
  if (!override) return undefined
  const elements = child(override, 'themeElements')
  if (!elements)
    throw new Error(`Theme override has no themeElements in ${part}`)
  return {
    ...extractThemeElements(
      xml,
      `${part}#themeOverride`,
      elements,
      override.attributes.name,
    ),
    overridePart: part,
    provenance: 'extracted' as const,
  }
}
