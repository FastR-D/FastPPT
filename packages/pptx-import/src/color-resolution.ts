import { parseXml } from '@fastppt/slidewave/xml'
import { DRAWING_NS, matchesNamespace } from './relationships.js'

type Element = ReturnType<typeof parseXml>

export interface ThemeColorDefinition {
  role: string
  kind?: string
  attributes?: Record<string, string>
  transforms?: Array<{ kind: string; attributes: Record<string, string> }>
  sourceXml?: string
  provenance?: 'extracted'
}

export interface ThemeDefinitionLike {
  part: string
  colors: ThemeColorDefinition[]
  majorFonts?: ThemeFontCollection | undefined
  minorFonts?: ThemeFontCollection | undefined
  backgroundStyles?: Array<{
    index: number
    kind: string
    sourceXml: string
    namespaces?: Record<string, string>
  }>
  namespaces?: Record<string, string>
}

export interface ThemeFontCollection {
  sourcePart?: string
  latin?: Record<string, string> | undefined
  eastAsian?: Record<string, string> | undefined
  complexScript?: Record<string, string> | undefined
  scripts?: Array<Record<string, string>>
  sourceXml?: string
}

/** Merge a local OOXML themeOverride on top of its related theme. */
export function mergeThemeDefinition(
  base: ThemeDefinitionLike,
  override: ThemeDefinitionLike | undefined,
): ThemeDefinitionLike {
  if (!override) return base
  const overrides = new Map(override.colors.map((color) => [color.role, color]))
  const colors = base.colors.map((color) => overrides.get(color.role) ?? color)
  for (const color of override.colors)
    if (!base.colors.some((entry) => entry.role === color.role))
      colors.push(color)
  return {
    ...base,
    colors,
    ...(override.majorFonts ? { majorFonts: override.majorFonts } : {}),
    ...(override.minorFonts ? { minorFonts: override.minorFonts } : {}),
    ...(override.backgroundStyles
      ? { backgroundStyles: override.backgroundStyles }
      : {}),
    ...(override.namespaces
      ? { namespaces: { ...base.namespaces, ...override.namespaces } }
      : {}),
  } as ThemeDefinitionLike
}

export interface ResolvedColor {
  value: string
  alpha?: number
  source: {
    kind: string
    role?: string
    attributes?: Record<string, string>
    sourcePart?: string
  }
  transforms: Array<{ kind: string; value: number }>
  provenance: 'derived'
}

export interface ResolvedThemeColors {
  part: string
  colors: Record<string, ResolvedColor>
  unresolved: string[]
  colorMap?: Record<string, string>
  provenance: 'derived'
}

interface Rgb {
  r: number
  g: number
  b: number
}

interface Hsl {
  h: number
  s: number
  l: number
}

const COLOR_ATTR = 'val'

function numberAttribute(
  attributes: Record<string, string> | undefined,
  name: string,
): number | undefined {
  const value = attributes?.[name]
  if (value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value)) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value))
}

function hexToRgb(value: string): Rgb | undefined {
  const normalized = value.replace(/^#/, '').trim()
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return undefined
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase()
}

function srgbToLinear(value: number): number {
  const channel = value / 255
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(value: number): number {
  const channel = clamp(value)
  return (
    (channel <= 0.0031308
      ? channel * 12.92
      : 1.055 * channel ** (1 / 2.4) - 0.055) * 255
  )
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: lightness }
  const delta = max - min
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue: number
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0)
  else if (max === green) hue = (blue - red) / delta + 2
  else hue = (red - green) / delta + 4
  return { h: hue / 6, s: saturation, l: lightness }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const value = l * 255
    return { r: value, g: value, b: value }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hueToRgb = (position: number): number => {
    let value = position
    if (value < 0) value += 1
    if (value > 1) value -= 1
    if (value < 1 / 6) return p + (q - p) * 6 * value
    if (value < 1 / 2) return q
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
    return p
  }
  return {
    r: hueToRgb(h + 1 / 3) * 255,
    g: hueToRgb(h) * 255,
    b: hueToRgb(h - 1 / 3) * 255,
  }
}

function transformValue(
  attributes: Record<string, string>,
): number | undefined {
  const value = numberAttribute(attributes, COLOR_ATTR)
  return value === undefined ? undefined : value / 100000
}

function applyTransform(
  color: Rgb,
  alpha: number,
  kind: string,
  value: number,
): { color: Rgb; alpha: number } {
  if (kind === 'tint') {
    const amount = clamp(value)
    return {
      color: {
        r: linearToSrgb(srgbToLinear(color.r) * amount + (1 - amount)),
        g: linearToSrgb(srgbToLinear(color.g) * amount + (1 - amount)),
        b: linearToSrgb(srgbToLinear(color.b) * amount + (1 - amount)),
      },
      alpha,
    }
  }
  if (kind === 'shade') {
    const amount = clamp(value)
    return {
      color: {
        r: linearToSrgb(srgbToLinear(color.r) * amount),
        g: linearToSrgb(srgbToLinear(color.g) * amount),
        b: linearToSrgb(srgbToLinear(color.b) * amount),
      },
      alpha,
    }
  }
  if (
    kind === 'lumMod' ||
    kind === 'lumOff' ||
    kind === 'satMod' ||
    kind === 'satOff' ||
    kind === 'hueMod' ||
    kind === 'hueOff'
  ) {
    const hsl = rgbToHsl(color)
    if (kind === 'lumMod') hsl.l = clamp(hsl.l * value)
    if (kind === 'lumOff') hsl.l = clamp(hsl.l + value)
    if (kind === 'satMod') hsl.s = clamp(hsl.s * value)
    if (kind === 'satOff') hsl.s = clamp(hsl.s + value)
    if (kind === 'hueMod') hsl.h = (hsl.h * value) % 1
    if (kind === 'hueOff') hsl.h = (hsl.h + value) % 1
    if (hsl.h < 0) hsl.h += 1
    return { color: hslToRgb(hsl), alpha }
  }
  if (kind === 'alpha') return { color, alpha: clamp(value) }
  if (kind === 'alphaMod') return { color, alpha: clamp(alpha * value) }
  if (kind === 'alphaOff') return { color, alpha: clamp(alpha + value) }
  return { color, alpha }
}

function applyTransforms(
  base: Rgb,
  transforms: Array<{ kind: string; attributes: Record<string, string> }> = [],
  baseAlpha = 1,
):
  | {
      color: Rgb
      alpha: number
      applied: Array<{ kind: string; value: number }>
    }
  | undefined {
  let color = base
  let alpha = baseAlpha
  const applied: Array<{ kind: string; value: number }> = []
  for (const transform of transforms) {
    if (
      ![
        'tint',
        'shade',
        'lumMod',
        'lumOff',
        'satMod',
        'satOff',
        'hueMod',
        'hueOff',
        'alpha',
        'alphaMod',
        'alphaOff',
      ].includes(transform.kind)
    )
      return undefined
    // hueOff is an angle in 1/60000 degrees, not a percentage.
    const raw = numberAttribute(transform.attributes, COLOR_ATTR)
    const value =
      transform.kind === 'hueOff'
        ? raw === undefined
          ? undefined
          : raw / 21600000
        : transformValue(transform.attributes)
    if (value === undefined) return undefined
    const result = applyTransform(color, alpha, transform.kind, value)
    color = result.color
    alpha = result.alpha
    applied.push({ kind: transform.kind, value })
  }
  return { color, alpha, applied }
}

function fallbackSystemColor(value: string | undefined): string | undefined {
  switch (value?.toLowerCase()) {
    case 'window':
    case 'buttonface':
    case 'highlight':
      return '#FFFFFF'
    case 'windowtext':
    case 'buttontext':
    case 'highlighttext':
      return '#000000'
    default:
      return undefined
  }
}

function normalizeColor(
  kind: string,
  attributes: Record<string, string>,
): Rgb | undefined {
  if (kind === 'srgbClr') return hexToRgb(attributes[COLOR_ATTR] ?? '')
  if (kind === 'sysClr')
    return (
      hexToRgb(attributes.lastClr ?? '') ??
      hexToRgb(fallbackSystemColor(attributes[COLOR_ATTR]) ?? '')
    )
  // Preset colors occasionally occur in generated decks. Keeping a small, explicit
  // table is safer than silently treating unknown values as black.
  if (kind === 'prstClr') {
    const preset: Record<string, string> = {
      black: '#000000',
      white: '#FFFFFF',
      red: '#FF0000',
      green: '#008000',
      blue: '#0000FF',
      yellow: '#FFFF00',
      cyan: '#00FFFF',
      magenta: '#FF00FF',
      gray: '#808080',
    }
    return hexToRgb(preset[attributes[COLOR_ATTR]?.toLowerCase() ?? ''] ?? '')
  }
  return undefined
}

function toResolvedColor(
  color: Rgb,
  alpha: number,
  source: ResolvedColor['source'],
  transforms: Array<{ kind: string; value: number }>,
): ResolvedColor {
  return {
    value: rgbToHex(color),
    ...(alpha < 1 ? { alpha } : {}),
    source,
    transforms,
    provenance: 'derived',
  }
}

export function resolveThemeColors(
  theme: ThemeDefinitionLike,
  colorMap: Record<string, string> = {},
): ResolvedThemeColors {
  const definitions = new Map(theme.colors.map((color) => [color.role, color]))
  const resolved = new Map<string, ResolvedColor>()
  const unresolved: string[] = []

  const resolveRole = (
    role: string,
    stack: string[] = [],
  ): ResolvedColor | undefined => {
    const existing = resolved.get(role)
    if (existing) return existing
    if (stack.includes(role)) return undefined
    const definition = definitions.get(role)
    if (!definition?.kind || !definition.attributes) return undefined
    let base: Rgb | undefined
    let baseAlpha = 1
    let sourceRole: string | undefined
    if (definition.kind === 'schemeClr') {
      sourceRole = definition.attributes[COLOR_ATTR]
      const mapped = colorMap[sourceRole ?? ''] ?? sourceRole
      const referenced = mapped
        ? resolveRole(mapped, [...stack, role])
        : undefined
      base = referenced ? hexToRgb(referenced.value) : undefined
      baseAlpha = referenced?.alpha ?? 1
    } else {
      base = normalizeColor(definition.kind, definition.attributes)
    }
    if (!base) return undefined
    const result = applyTransforms(base, definition.transforms, baseAlpha)
    if (!result) return undefined
    const color = toResolvedColor(
      result.color,
      result.alpha,
      {
        kind: definition.kind,
        role: sourceRole ?? role,
        attributes: definition.attributes,
        sourcePart: theme.part,
      },
      result.applied,
    )
    resolved.set(role, color)
    return color
  }

  for (const definition of theme.colors) {
    if (resolveRole(definition.role) === undefined)
      unresolved.push(definition.role)
  }
  return {
    part: theme.part,
    colors: Object.fromEntries(
      [...resolved.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
    unresolved: [...new Set(unresolved)].sort(),
    ...(Object.keys(colorMap).length ? { colorMap: { ...colorMap } } : {}),
    provenance: 'derived',
  }
}

function directColorElement(node: Element): Element | undefined {
  if (
    matchesNamespace(node.namespace, DRAWING_NS) &&
    ['srgbClr', 'sysClr', 'schemeClr', 'prstClr'].includes(node.local)
  )
    return node
  return node.children.find(
    (child) =>
      matchesNamespace(child.namespace, DRAWING_NS) &&
      ['srgbClr', 'sysClr', 'schemeClr', 'prstClr'].includes(child.local),
  )
}

function elementTransforms(
  node: Element,
): Array<{ kind: string; attributes: Record<string, string> }> {
  return node.children
    .filter((child) => matchesNamespace(child.namespace, DRAWING_NS))
    .map((child) => ({ kind: child.local, attributes: child.attributes }))
}

export interface ColorReferenceContext {
  theme: ThemeDefinitionLike
  colorMap?: Record<string, string>
  phClrBase?: string
  sourcePart?: string
}

/** Resolve one DrawingML color element while retaining its source role and transforms. */
export function resolveColorElement(
  node: Element,
  context: ColorReferenceContext,
): ResolvedColor | undefined {
  const color = directColorElement(node)
  if (!color) return undefined
  return resolveSourceColor(
    {
      kind: color.local,
      attributes: color.attributes,
      transforms: elementTransforms(color),
    },
    context,
  )
}

/** Typed source evidence avoids reparsing fragments with missing namespace bindings. */
export function resolveSourceColor(
  color: {
    kind: string
    attributes: Record<string, string>
    transforms?: Array<{ kind: string; attributes: Record<string, string> }>
  },
  context: ColorReferenceContext,
): ResolvedColor | undefined {
  const attributes = color.attributes
  let base: Rgb | undefined
  let baseAlpha = 1
  let role: string | undefined
  if (color.kind === 'schemeClr') {
    role = attributes[COLOR_ATTR]
    if (role?.toLowerCase() === 'phclr' && context.phClrBase)
      base = hexToRgb(context.phClrBase)
    else {
      const theme = resolveThemeColors(context.theme, context.colorMap)
      const mapped = context.colorMap?.[role ?? ''] ?? role
      base = mapped ? hexToRgb(theme.colors[mapped]?.value ?? '') : undefined
      baseAlpha = mapped ? (theme.colors[mapped]?.alpha ?? 1) : 1
    }
  } else {
    base = normalizeColor(color.kind, attributes)
  }
  if (!base) return undefined
  const result = applyTransforms(base, color.transforms, baseAlpha)
  if (!result) return undefined
  const source: ResolvedColor['source'] = {
    kind: color.kind,
    attributes,
    ...(role ? { role } : {}),
    ...(context.sourcePart ? { sourcePart: context.sourcePart } : {}),
  }
  return toResolvedColor(
    result.color,
    result.alpha,
    {
      ...source,
    },
    result.applied,
  )
}

/** Resolve a compact XML fragment such as `<a:solidFill>...</a:solidFill>`. */
export function resolveColorXml(
  xml: string,
  context: ColorReferenceContext,
): ResolvedColor | undefined {
  if (!xml.trim()) return undefined
  return resolveColorElement(parseXml(xml), context)
}
