import { parseXml } from '@fastppt/slidewave/xml'
import { DRAWING_NS, PRESENTATION_NS, matchesNamespace } from './relationships.js'
import { resolveColorElement, type ResolvedColor, type ThemeDefinitionLike } from './color-resolution.js'

export interface SourceBackground {
  part: string
  kind: 'properties' | 'style-reference'
  attributes: Record<string, string>
  sourceXml: string
  namespaces: Record<string, string>
  provenance: 'extracted'
}

export function extractBackground(xml: string, part: string): SourceBackground | undefined {
  if (!xml.trim()) return undefined
  const root = parseXml(xml)
  const common = root.children.find((node) => matchesNamespace(node.namespace, PRESENTATION_NS) && node.local === 'cSld')
  const backgrounds = common?.children.filter((node) => matchesNamespace(node.namespace, PRESENTATION_NS) && node.local === 'bg') ?? []
  if (backgrounds.length > 1) throw new Error(`Multiple backgrounds in ${part}`)
  const background = backgrounds[0]
  if (!background) return undefined
  const definitions = background.children.filter((node) => matchesNamespace(node.namespace, PRESENTATION_NS) && ['bgPr', 'bgRef'].includes(node.local))
  if (definitions.length !== 1) throw new Error(`Invalid background definition in ${part}`)
  const definition = definitions[0]!
  return { part, kind: definition.local === 'bgPr' ? 'properties' : 'style-reference', attributes: definition.attributes, sourceXml: xml.slice(background.start, background.end), namespaces: background.namespaces, provenance: 'extracted' }
}

export function resolveBackground(page: string, backgrounds: readonly SourceBackground[], layout?: string, master?: string) {
  const chain = [page, layout, master].filter((part): part is string => Boolean(part))
  const source = chain.map((part) => backgrounds.find((background) => background.part === part)).find(Boolean)
  return { part: page, chain, ...(source ? { source } : {}), status: source ? 'source-resolved' as const : 'unspecified' as const, inherited: source ? source.part !== page : false, provenance: 'derived' as const }
}

export interface ResolvedBackgroundAppearance {
  part: string
  sourcePart?: string
  themePart?: string
  inherited: boolean
  kind: 'solid' | 'gradient' | 'image' | 'none' | 'unresolved' | 'unspecified'
  styleIndex?: number
  color?: ResolvedColor
  stops?: Array<{ position: number; color: ResolvedColor }>
  angle?: number
  reason?: string
  provenance: 'derived'
}

type Element = ReturnType<typeof parseXml>

function drawingChild(node: Element | undefined, local: string): Element | undefined {
  return node?.children.find((child) => matchesNamespace(child.namespace, DRAWING_NS) && child.local === local)
}

function fillElement(node: Element | undefined): Element | undefined {
  if (node && matchesNamespace(node.namespace, DRAWING_NS) && ['solidFill', 'gradFill', 'blipFill', 'noFill'].includes(node.local)) return node
  return node?.children.find((child) => matchesNamespace(child.namespace, DRAWING_NS) && ['solidFill', 'gradFill', 'blipFill', 'noFill'].includes(child.local))
}

function findBackgroundRoot(sourceXml: string, namespaces: Record<string, string> = {}): Element | undefined {
  if (!sourceXml.trim()) return undefined
  const rootWithNamespaces = sourceXml.replace(/^<([\w:.-]+)/, (_match, name: string) => {
    const declarations = Object.entries(namespaces)
      .filter(([prefix]) => prefix !== 'xml')
      .filter(([prefix, value]) => value && !new RegExp(`xmlns(?::${prefix})?\\s*=`).test(sourceXml))
      .map(([prefix, value]) => ` xmlns${prefix ? `:${prefix}` : ''}="${value}"`)
      .join('')
    return `<${name}${declarations}`
  })
  return parseXml(rootWithNamespaces)
}

function resolveFill(
  fill: Element,
  context: Parameters<typeof resolveColorElement>[1],
): Pick<ResolvedBackgroundAppearance, 'kind' | 'color' | 'stops' | 'angle' | 'reason'> {
  if (fill.local === 'noFill') return { kind: 'none' }
  if (fill.local === 'blipFill') return { kind: 'image' }
  if (fill.local === 'solidFill') {
    const color = resolveColorElement(fill, context)
    return color ? { kind: 'solid', color } : { kind: 'unresolved', reason: 'solid background color cannot be resolved' }
  }
  if (fill.local === 'gradFill') {
    const list = drawingChild(fill, 'gsLst')
    const stops = (list?.children ?? [])
      .filter((stop) => matchesNamespace(stop.namespace, DRAWING_NS) && stop.local === 'gs')
      .map((stop) => {
        const color = resolveColorElement(stop, context)
        const position = Number(stop.attributes.pos)
        return color && Number.isFinite(position) ? { position: position / 100000, color } : undefined
      })
      .filter((stop): stop is { position: number; color: ResolvedColor } => Boolean(stop))
    const line = drawingChild(fill, 'lin')
    return {
      kind: stops.length >= 2 ? 'gradient' : 'unresolved',
      ...(stops.length >= 2 ? { stops } : { reason: 'gradient background has fewer than two resolved stops' }),
      ...(line?.attributes.ang && Number.isFinite(Number(line.attributes.ang)) ? { angle: (Number(line.attributes.ang) / 60000) % 360 } : {}),
    }
  }
  return { kind: 'unresolved', reason: `unsupported background fill: ${fill.local}` }
}

/** Resolve the nearest page/layout/master background into a typed appearance. */
export function resolveBackgroundAppearance(
  page: string,
  backgrounds: readonly SourceBackground[],
  theme: ThemeDefinitionLike | undefined,
  colorMap: Record<string, string> = {},
  layout?: string,
  master?: string,
): ResolvedBackgroundAppearance {
  const resolved = resolveBackground(page, backgrounds, layout, master)
  if (!resolved.source) return { part: page, inherited: false, kind: 'unspecified', provenance: 'derived' }
  const source = resolved.source
  if (!theme) return { part: page, sourcePart: source.part, inherited: resolved.inherited, kind: 'unresolved', reason: 'background has no reachable theme', provenance: 'derived' }
  const context = { theme, colorMap, sourcePart: source.part }
  const root = findBackgroundRoot(source.sourceXml, source.namespaces)
  if (!root) return { part: page, sourcePart: source.part, themePart: theme.part, inherited: resolved.inherited, kind: 'unresolved', reason: 'background source XML is empty', provenance: 'derived' }
  let fill: Element | undefined
  let styleIndex: number | undefined
  if (source.kind === 'style-reference') {
    styleIndex = Number(source.attributes.idx)
    const bg = root.local === 'bg' ? root : root.children.find((child) => matchesNamespace(child.namespace, PRESENTATION_NS) && child.local === 'bg')
    const ref = bg?.children.find((child) => matchesNamespace(child.namespace, PRESENTATION_NS) && child.local === 'bgRef')
    const style = theme.backgroundStyles?.find((entry) => entry.index === styleIndex)
    const styleRoot = style ? findBackgroundRoot(style.sourceXml, style.namespaces ?? theme.namespaces) : undefined
    fill = fillElement(styleRoot)
    const phColor = ref ? resolveColorElement(ref, context) : undefined
    const styleContext = phColor ? { ...context, phClrBase: phColor.value } : context
    if (!fill) return { part: page, sourcePart: source.part, themePart: theme.part, inherited: resolved.inherited, styleIndex, kind: 'unresolved', reason: `background style ${source.attributes.idx ?? 'unknown'} is unavailable`, provenance: 'derived' }
    const appearance = resolveFill(fill, styleContext)
    return { part: page, sourcePart: source.part, themePart: theme.part, inherited: resolved.inherited, styleIndex, ...appearance, provenance: 'derived' }
  }
  const bg = root.local === 'bg' ? root : root.children.find((child) => matchesNamespace(child.namespace, PRESENTATION_NS) && child.local === 'bg')
  const properties = bg?.children.find((child) => matchesNamespace(child.namespace, PRESENTATION_NS) && child.local === 'bgPr')
  fill = fillElement(properties)
  if (!fill) return { part: page, sourcePart: source.part, themePart: theme.part, inherited: resolved.inherited, kind: 'unresolved', reason: 'background properties do not contain a supported fill', provenance: 'derived' }
  return { part: page, sourcePart: source.part, themePart: theme.part, inherited: resolved.inherited, ...resolveFill(fill, context), provenance: 'derived' }
}
