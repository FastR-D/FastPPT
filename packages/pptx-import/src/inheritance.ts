import type { SourceFill, SourceObject, SourceTextProperty } from './objects.js'
import { DRAWING_NS, matchesNamespace } from './relationships.js'
import { resolveObjectGeometry, sourceNumber } from './geometry.js'

const masterType = (type: string): string => {
  if (type === 'ctrTitle') return 'title'
  if (
    [
      'obj',
      'subTitle',
      'pic',
      'chart',
      'clipArt',
      'dgm',
      'media',
      'tbl',
    ].includes(type)
  )
    return 'body'
  return type
}

interface AppearanceOrigin {
  part: string
  shapeId?: string
}
interface ResolvedAttributes {
  attributes: Record<string, string>
  attributeOrigins: Record<string, AppearanceOrigin>
  sources: Array<AppearanceOrigin & { sourceXml: string }>
  provenance: 'derived'
}
export interface ResolvedPlaceholderAppearance {
  unsupported?: string[]
  fill?: SourceFill
  line?: ResolvedAttributes & {
    fill?: SourceFill
    fillOrigin?: AppearanceOrigin
  }
  textBody?: ResolvedAttributes & { autoFit?: SourceTextProperty & { origin: AppearanceOrigin } }
  paragraphDefaults?: Array<ResolvedAttributes & { level?: number }>
  origins: Partial<
    Record<
      'fill' | 'line' | 'textBody' | 'paragraphDefaults',
      { part: string; shapeId?: string }
    >
  >
}

function sourceOrigin(entry: SourceObject) {
  return {
    part: entry.part,
    ...(entry.shapeId ? { shapeId: entry.shapeId } : {}),
  }
}

function inheritAttributes(
  current: ResolvedAttributes | undefined,
  source: { attributes: Record<string, string>; sourceXml: string },
  entry: SourceObject,
): ResolvedAttributes {
  return {
    attributes: { ...source.attributes, ...current?.attributes },
    attributeOrigins: {
      ...Object.fromEntries(
        Object.keys(source.attributes).map((key) => [key, sourceOrigin(entry)]),
      ),
      ...current?.attributeOrigins,
    },
    sources: [
      ...(current?.sources ?? []),
      { ...sourceOrigin(entry), sourceXml: source.sourceXml },
    ],
    provenance: 'derived',
  }
}

function resolveAppearance(
  chain: readonly SourceObject[],
): ResolvedPlaceholderAppearance | undefined {
  const origins: ResolvedPlaceholderAppearance['origins'] = {}
  let fill: SourceFill | undefined
  let line: ResolvedPlaceholderAppearance['line']
  let textBody: ResolvedPlaceholderAppearance['textBody']
  let autoFit: NonNullable<ResolvedPlaceholderAppearance['textBody']>['autoFit']
  let autoFitSeen = false
  const bodyIssues: string[] = []
  type ParagraphDefault = NonNullable<
    ResolvedPlaceholderAppearance['paragraphDefaults']
  >[number]
  const paragraphByLevel = new Map<number | undefined, ParagraphDefault>()
  for (const entry of chain) {
    const appearance = entry.appearance
    if (!appearance) continue
    if (fill === undefined && appearance.fill) {
      fill = appearance.fill
      origins.fill = sourceOrigin(entry)
    }
    if (appearance.line) {
      const fill = line?.fill ?? appearance.line.fill
      const fillOrigin =
        line?.fillOrigin ?? (fill ? sourceOrigin(entry) : undefined)
      line = {
        ...inheritAttributes(line, appearance.line, entry),
        ...(fill ? { fill } : {}),
        ...(fillOrigin ? { fillOrigin } : {}),
      }
      origins.line ??= sourceOrigin(entry)
    }
    if (appearance.textBody) {
      textBody = inheritAttributes(textBody, appearance.textBody, entry)
      origins.textBody ??= sourceOrigin(entry)
      const properties = appearance.textBody.properties
      if (properties) {
        const isAutoFit = (node: SourceTextProperty) => matchesNamespace(node.namespace, DRAWING_NS) && ['noAutofit', 'normAutofit', 'spAutoFit'].includes(node.kind)
        const fits = properties.filter(isAutoFit)
        if (fits.length > 1) bodyIssues.push(`Ambiguous text body autofit at ${entry.part}#${entry.shapeId ?? entry.order}`)
        if (!autoFitSeen && fits.length) {
          autoFitSeen = true
          if (fits.length === 1) autoFit = { ...fits[0]!, origin: sourceOrigin(entry) }
        }
        bodyIssues.push(...properties.filter(node => !isAutoFit(node)).map(node => `Text body child ${node.kind} requires review`))
      } else bodyIssues.push(...(appearance.textBody.children ?? []).map(kind => `Text body child ${kind} requires review`))
    }
    for (const paragraph of appearance.paragraphDefaults ?? []) {
      const level = paragraph.level
      paragraphByLevel.set(level, {
        ...inheritAttributes(paragraphByLevel.get(level), paragraph, entry),
        ...(level === undefined ? {} : { level }),
      })
      origins.paragraphDefaults ??= sourceOrigin(entry)
    }
  }
  const paragraphDefaults = [...paragraphByLevel.values()].sort(
    (left, right) => (left.level ?? 0) - (right.level ?? 0),
  )
  const unsupported = chain.flatMap((entry) => [
    ...(entry.unsupported ?? []),
    ...(entry.text?.paragraphs.some((paragraph) =>
      paragraph.runs.some(
        (run) =>
          Object.keys(run.style ?? {}).length ||
          Object.keys(run.properties).some(
            (key) => !['lang', 'altLang', 'dirty', 'smtClean'].includes(key),
          ),
      ),
    )
      ? ['Placeholder run style requires full text inheritance']
      : []),
  ])
  unsupported.push(...bodyIssues)
  if (
    !fill &&
    !line &&
    !textBody &&
    paragraphDefaults.length === 0 &&
    !unsupported.length
  )
    return undefined
  return {
    ...(unsupported.length ? { unsupported: [...new Set(unsupported)] } : {}),
    ...(fill ? { fill } : {}),
    ...(line ? { line } : {}),
    ...(textBody ? { textBody: { ...textBody, ...(autoFit ? { autoFit } : {}) } } : {}),
    ...(paragraphDefaults.length ? { paragraphDefaults } : {}),
    origins,
  }
}

export function resolvePlaceholderChain(
  object: SourceObject,
  layout: readonly SourceObject[],
  master: readonly SourceObject[],
  mode: 'slide' | 'layout',
) {
  const issues: string[] = []
  const chain: SourceObject[] = [object]
  const choose = (
    candidates: readonly SourceObject[],
    predicate: (candidate: SourceObject) => boolean,
    label: string,
  ): SourceObject | undefined => {
    const matches = candidates.filter(
      (candidate) => candidate.placeholder && predicate(candidate),
    )
    if (matches.length !== 1) {
      issues.push(
        `${matches.length ? 'Ambiguous' : 'Missing'} ${label} placeholder for ${object.part}#${object.shapeId ?? object.order}`,
      )
      return undefined
    }
    return matches[0]
  }
  let layoutObject: SourceObject | undefined =
    mode === 'layout' ? object : undefined
  if (object.placeholder && mode === 'slide') {
    const idx = object.placeholder.idx
    if (!/^\d+$/.test(idx)) issues.push(`Invalid placeholder idx: ${idx}`)
    else
      layoutObject = choose(
        layout,
        (candidate) =>
          /^\d+$/.test(candidate.placeholder!.idx) &&
          Number(candidate.placeholder!.idx) === Number(idx),
        'layout',
      )
    if (layoutObject) chain.push(layoutObject)
  }
  if (layoutObject?.placeholder) {
    const parent = choose(
      master,
      (candidate) =>
        candidate.placeholder!.type ===
        masterType(layoutObject.placeholder!.type),
      'master',
    )
    if (parent) chain.push(parent)
  }
  return { chain, issues }
}

export function resolvePlaceholderGeometry(
  object: SourceObject,
  layout: readonly SourceObject[],
  master: readonly SourceObject[],
  mode: 'slide' | 'layout',
  local: readonly SourceObject[] = [object],
) {
  const { chain, issues } = resolvePlaceholderChain(
    object,
    layout,
    master,
    mode,
  )
  let geometryBlocked = false
  const geometry: Record<string, string> = {}
  const origins: Record<string, { part: string; shapeId?: string }> = {}
  const geometryCandidates = (entry: SourceObject): readonly SourceObject[] =>
    entry.part === object.part
      ? local
      : entry.part === (layout[0]?.part ?? '')
        ? layout
        : master
  for (const entry of chain) {
    // A fully specified local frame does not inherit an ancestor's transform.
    if (['x', 'y', 'cx', 'cy'].every((field) => geometry[field] !== undefined))
      break
    const transformed = entry.parentShapeId
      ? resolveObjectGeometry(entry, geometryCandidates(entry))
      : undefined
    const raw = {
      x: entry.transform?.offset?.x,
      y: entry.transform?.offset?.y,
      cx: entry.transform?.extent?.cx,
      cy: entry.transform?.extent?.cy,
    }
    if (
      transformed &&
      (transformed.status !== 'resolved' || !transformed.axisAligned)
    ) {
      issues.push(
        ...transformed.issues,
        `Placeholder requires a non-axis-aligned or unresolved group transform: ${entry.part}#${entry.shapeId ?? entry.order}`,
      )
      if (['x', 'y', 'cx', 'cy'].some((field) => geometry[field] === undefined))
        geometryBlocked = true
      break
    }
    const attributes = entry.transform?.attributes ?? {}
    if (
      (attributes.rot !== undefined &&
        (sourceNumber(attributes.rot) === undefined ||
          Number(attributes.rot) % 21600000 !== 0)) ||
      [attributes.flipH, attributes.flipV].some(
        (value) => value !== undefined && value !== '0' && value !== 'false',
      )
    ) {
      issues.push(
        `Placeholder rotation/flip requires a matrix: ${entry.part}#${entry.shapeId ?? entry.order}`,
      )
      geometryBlocked = true
    }
    const resolved =
      transformed?.status === 'resolved'
        ? {
            x: transformed.bounds.x,
            y: transformed.bounds.y,
            cx: transformed.bounds.width,
            cy: transformed.bounds.height,
          }
        : Object.fromEntries(
            Object.entries(raw).map(([field, value]) => {
              const number = sourceNumber(value)
              if (value !== undefined && number === undefined) {
                issues.push(`Invalid ${field} geometry in ${entry.part}`)
                geometryBlocked = true
              }
              return [field, number]
            }),
          )
    for (const [field, value] of Object.entries({
      x: resolved.x,
      y: resolved.y,
      cx: resolved.cx,
      cy: resolved.cy,
    })) {
      if (geometry[field] !== undefined || value === undefined) continue
      if (
        !Number.isSafeInteger(value) ||
        (field.startsWith('c') && value <= 0)
      ) {
        issues.push(`Invalid ${field} geometry in ${entry.part}`)
        geometryBlocked = true
        continue
      }
      geometry[field] = String(value)
      origins[field] = sourceOrigin(entry)
    }
  }
  const appearance = resolveAppearance(chain)
  return {
    part: object.part,
    ...(object.shapeId ? { shapeId: object.shapeId } : {}),
    units: 'emu' as const,
    geometry,
    origins,
    chain: chain.map((entry) => ({
      part: entry.part,
      ...(entry.shapeId ? { shapeId: entry.shapeId } : {}),
    })),
    complete:
      !geometryBlocked &&
      ['x', 'y', 'cx', 'cy'].every((field) => geometry[field] !== undefined),
    ...(appearance ? { appearance } : {}),
    issues,
    provenance: 'derived' as const,
  }
}
