import type { ThemeTone } from './theme-foundation'

export type ThemeLayout = 'cover' | 'message' | 'explainer' | 'collection'
export type ThemeLayoutRole = 'primary' | 'secondary' | 'support' | 'media'
export type ThemeLayoutHeader = 'auto' | 'default' | 'cover' | 'none'
export type ThemeLayoutSurface = 'none' | 'light' | 'dark' | 'color' | 'tint'
export type ThemeLayoutMarginLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export type ThemeLayoutSlotSpec = {
  area: string
  surface?: ThemeLayoutSurface
  tone?: ThemeTone
  margin?: ThemeLayoutMarginLevel
  marginTop?: ThemeLayoutMarginLevel
  marginRight?: ThemeLayoutMarginLevel
  marginBottom?: ThemeLayoutMarginLevel
  marginLeft?: ThemeLayoutMarginLevel
  centered?: boolean
}

export type ThemeLayoutSpec = {
  slots: Partial<Record<ThemeLayoutRole, ThemeLayoutSlotSpec[]>>
}

export type ThemeLayoutAlias = {
  variant: string
  arrangement?: string
}

export type ThemeLayoutRegionInput = string | ThemeLayoutSlotSpec

export type ThemeLayoutRecipe = {
  layout: ThemeLayout
  content: string
  aliases: ThemeLayoutAlias[]
  regions: Partial<Record<ThemeLayoutRole, ThemeLayoutRegionInput | ThemeLayoutRegionInput[]>>
  shorthand?: string
}

type RecipeInput = Omit<ThemeLayoutRecipe, 'layout'>

export const THEME_LAYOUT_ROLES = ['primary', 'secondary', 'support', 'media'] as const satisfies readonly ThemeLayoutRole[]

function defineLayoutRecipes(layout: ThemeLayout, recipes: RecipeInput[]): ThemeLayoutRecipe[] {
  return recipes.map(recipe => ({ layout, ...recipe }))
}

function normalizeRegionList(input: ThemeLayoutRegionInput | ThemeLayoutRegionInput[] | undefined) {
  return input == null
    ? []
    : (Array.isArray(input) ? input : [input]).map(normalizeRegion)
}

function fail(label: string, message: string): never {
  throw new Error(`[${label}] ${message}`)
}

export function normalizeRegion(input: ThemeLayoutRegionInput): ThemeLayoutSlotSpec {
  return typeof input === 'string' ? { area: input } : input
}

export function resolveLayoutSlotProps(options: {
  recipe: ThemeLayoutRecipe
  role: ThemeLayoutRole
  index: number
  overrides: Partial<ThemeLayoutSlotSpec>
  themeTone?: ThemeTone
}) {
  const { recipe, role, index, overrides, themeTone } = options
  const regions = recipe.regions[role]
  const region = Array.isArray(regions)
    ? regions[index]
    : index === 0
      ? regions
      : undefined

  if (!region)
    fail('Slide', `Recipe "${recipe.layout}:${recipe.content}" не поддерживает ${role}[${index}].`)

  const base = normalizeRegion(region)
  const surface = overrides.surface ?? base.surface
  const allowsTone = surface === 'color' || surface === 'tint'
  const inheritedTone = overrides.surface !== undefined && overrides.surface !== base.surface
    ? undefined
    : base.tone
  const tone = allowsTone
    ? overrides.tone ?? inheritedTone ?? themeTone
    : overrides.tone ?? inheritedTone

  return { ...base, ...overrides, surface, tone }
}

export function normalizeRecipeRegions(recipe: ThemeLayoutRecipe): ThemeLayoutSpec {
  return {
    slots: Object.fromEntries(
      THEME_LAYOUT_ROLES
        .map(role => [role, normalizeRegionList(recipe.regions[role])] as const)
        .filter(([, regions]) => regions.length > 0),
    ) as ThemeLayoutSpec['slots'],
  }
}

export const LAYOUT_RECIPES: ThemeLayoutRecipe[] = [
  ...defineLayoutRecipes('cover', [
    {
      content: 'title-media',
      aliases: [{ variant: 'grid' }],
      regions: {
        primary: '1 / 1 / -1 / 7',
        media: ['1 / 7 / 5 / 10', '1 / 10 / 5 / -1', '5 / 7 / -1 / -1'],
      },
    },
    {
      content: 'title-media-balanced',
      aliases: [{ variant: 'grid-balanced' }],
      regions: {
        primary: '1 / 1 / -1 / 7',
        media: ['1 / 7 / 7 / 10', '1 / 10 / 7 / -1', '7 / 7 / -1 / -1'],
      },
    },
    {
      content: 'banner-media',
      aliases: [{ variant: 'banner' }],
      regions: {
        primary: '1 / 1 / 7 / -1',
        media: ['7 / 1 / -1 / 4', '7 / 4 / -1 / 8', '7 / 8 / -1 / -1'],
      },
    },
    {
      content: 'signal-media',
      aliases: [{ variant: 'signal' }],
      regions: {
        primary: '1 / 1 / 7 / 9',
        media: [
          { area: '1 / 9 / -1 / -1', surface: 'dark' },
          '7 / 1 / -1 / 4',
          '7 / 4 / -1 / 9',
        ],
      },
    },
    {
      content: 'split-media-triptych',
      aliases: [{ variant: 'split-media-triptych' }],
      regions: {
        primary: '1 / 1 / -1 / 8',
        media: ['1 / 8 / 5 / 10', '1 / 10 / 5 / -1', '5 / 8 / -1 / -1'],
      },
    },
  ]),
  ...defineLayoutRecipes('message', [
    {
      content: 'centered',
      aliases: [{ variant: 'centered' }],
      regions: {
        primary: { area: '3 / 3 / 10 / 11', centered: true },
      },
    },
    {
      content: 'quote',
      aliases: [{ variant: 'quote' }],
      regions: {
        primary: { area: '1 / 1 / 9 / -1', marginTop: 3 },
        support: '10 / 1 / -1 / 5',
      },
    },
    {
      content: 'closing',
      aliases: [{ variant: 'closing' }],
      regions: {
        primary: { area: '1 / 2 / -1 / 12', centered: true },
      },
    },
  ]),
  ...defineLayoutRecipes('explainer', [
    {
      content: 'title-supports',
      aliases: [{ variant: 'title-supports' }],
      regions: {
        primary: { area: '2 / 1 / -1 / 7', marginRight: 4 },
        secondary: '2 / 7 / -1 / -1',
      },
    },
    {
      content: 'title-supports-bottom-muted',
      aliases: [{ variant: 'title-supports-bottom-muted' }],
      regions: {
        primary: '2 / 1 / 5 / 7',
        support: [
          { area: '6 / 1 / 10 / 7', marginTop: 2 },
          { area: '6 / 7 / 10 / -1', marginTop: 2 },
        ],
      },
    },
    {
      content: 'title-supports-bottom-plain',
      aliases: [{ variant: 'title-supports-bottom-plain' }],
      regions: {
        primary: '2 / 1 / 5 / 7',
        support: [
          { area: '6 / 1 / -1 / 7', marginTop: 2 },
          { area: '6 / 7 / -1 / -1', marginTop: 2 },
        ],
      },
    },
    {
      content: 'title-body',
      aliases: [{ variant: 'title-body' }],
      regions: {
        primary: { area: '2 / 1 / -1 / 7', marginRight: 4 },
        secondary: '2 / 7 / -1 / -1',
      },
    },
    {
      content: 'definition',
      aliases: [{ variant: 'definition' }],
      regions: {
        primary: { area: '1 / 1 / -1 / -1', marginTop: 8 },
      },
    },
  ]),
  ...defineLayoutRecipes('collection', [
    {
      content: 'agenda',
      aliases: [{ variant: 'agenda' }],
      regions: {
        primary: { area: '1 / 1 / -1 / 10', margin: 4 },
        media: '1 / 10 / -1 / -1',
      },
    },
    {
      content: 'points',
      aliases: [{ variant: 'points-trio' }, { variant: 'points', arrangement: 'trio' }],
      regions: {
        primary: { area: '1 / 1 / 7 / -1', surface: 'light', margin: 4 },
        support: [
          { area: '7 / 1 / -1 / 5', surface: 'tint', margin: 3 },
          { area: '7 / 5 / -1 / 9', surface: 'dark', margin: 3 },
          { area: '7 / 9 / -1 / -1', surface: 'color', margin: 3 },
        ],
      },
    },
    {
      content: 'metrics',
      aliases: [{ variant: 'metrics-featured-media' }, { variant: 'metrics', arrangement: 'featured-media' }],
      regions: {
        primary: { area: '2 / 1 / 7 / -1', surface: 'light', margin: 4 },
        media: '7 / 1 / -1 / 7',
        support: [
          { area: '7 / 7 / -1 / 10', surface: 'dark', margin: 3 },
          { area: '7 / 10 / -1 / -1', surface: 'color', tone: 'blue', margin: 3 },
        ],
      },
    },
    {
      content: 'metrics',
      aliases: [{ variant: 'metrics-featured-copy' }, { variant: 'metrics', arrangement: 'featured-copy' }],
      regions: {
        primary: { area: '2 / 1 / 8 / -1', surface: 'light', marginLeft: 4, marginRight: 4 },
        media: '8 / 1 / -1 / 7',
        support: [
          { area: '8 / 7 / -1 / 10', surface: 'dark', margin: 3 },
          { area: '8 / 10 / -1 / -1', surface: 'color', tone: 'blue', margin: 3 },
        ],
      },
    },
    {
      content: 'metrics',
      aliases: [
        { variant: 'metrics-featured-copy-split-media' },
        { variant: 'metrics', arrangement: 'featured-copy-split-media' },
      ],
      regions: {
        primary: { area: '2 / 1 / 8 / -1', surface: 'light', marginLeft: 4, marginRight: 4 },
        media: ['8 / 1 / -1 / 4', '8 / 4 / -1 / 7'],
        support: [
          { area: '8 / 7 / -1 / 10', surface: 'dark', margin: 3 },
          { area: '8 / 10 / -1 / -1', surface: 'color', tone: 'blue', margin: 3 },
        ],
      },
    },
    {
      content: 'timeline',
      aliases: [{ variant: 'timeline' }],
      regions: {
        primary: '1 / 1 / 4 / 7',
        secondary: '1 / 7 / 4 / -1',
        support: '5 / 1 / -1 / -1',
      },
    },
    {
      content: 'facts',
      aliases: [{ variant: 'facts-stacked' }, { variant: 'facts', arrangement: 'stacked' }],
      regions: {
        primary: { area: '1 / 1 / -1 / 7', marginTop: 5, marginLeft: 2, marginRight: 3 },
        support: [
          { area: '1 / 7 / 5 / -1', marginTop: 5 },
          { area: '5 / 7 / 9 / -1', marginTop: 5 },
          { area: '9 / 7 / -1 / -1', marginTop: 2 },
        ],
      },
    },
    {
      content: 'facts',
      aliases: [{ variant: 'facts-trio' }, { variant: 'facts', arrangement: 'trio' }],
      regions: {
        primary: { area: '2 / 1 / 6 / -1' },
        support: [
          { area: '6 / 1 / -1 / 5', surface: 'light', margin: 3 },
          { area: '6 / 5 / -1 / 9', surface: 'light', margin: 3 },
          { area: '6 / 9 / -1 / -1', surface: 'light', margin: 3 },
        ],
      },
    },
    {
      content: 'facts',
      aliases: [{ variant: 'facts-duo' }, { variant: 'facts', arrangement: 'duo' }],
      regions: {
        primary: { area: '2 / 1 / 6 / -1' },
        support: [
          { area: '6 / 1 / -1 / 7', surface: 'light', margin: 3 },
          { area: '6 / 7 / -1 / -1', surface: 'light', margin: 3 },
        ],
      },
    },
    {
      content: 'facts',
      aliases: [{ variant: 'facts-quartet' }, { variant: 'facts', arrangement: 'quartet' }],
      regions: {
        primary: { area: '2 / 1 / 6 / -1' },
        support: [
          { area: '6 / 1 / -1 / 4', surface: 'light', margin: 3 },
          { area: '6 / 4 / -1 / 7', surface: 'light', margin: 3 },
          { area: '6 / 7 / -1 / 10', surface: 'light', margin: 3 },
          { area: '6 / 10 / -1 / -1', surface: 'light', margin: 3 },
        ],
      },
    },
    {
      content: 'facts',
      aliases: [{ variant: 'facts-featured' }, { variant: 'facts', arrangement: 'featured' }],
      regions: {
        primary: { area: '2 / 7 / 6 / -1', margin: 4 },
        support: [
          { area: '1 / 1 / -1 / 7', surface: 'color', tone: 'blue', margin: 4 },
          { area: '6 / 7 / -1 / 10', surface: 'light', margin: 4 },
          { area: '6 / 10 / -1 / -1', surface: 'light', margin: 4 },
        ],
      },
    },
  ]),
]

export function resolveLayoutRecipe(layout: ThemeLayout, variant: string, arrangement = '') {
  const resolvedVariant = variant.trim()
  const resolvedArrangement = arrangement.trim()
  const recipe = LAYOUT_RECIPES.find(candidate =>
    candidate.layout === layout
    && candidate.aliases.some(alias =>
      alias.variant === resolvedVariant
      && (alias.arrangement ?? '') === resolvedArrangement,
    ),
  )

  if (!recipe) {
    const suffix = resolvedArrangement ? `:${resolvedArrangement}` : ''
    fail('Slide', `Неизвестная layout recipe для "${layout}:${resolvedVariant}${suffix}".`)
  }

  return recipe
}

export function resolveLayoutVariant(layout: ThemeLayout | '', variant: string, arrangement = '') {
  if (!layout)
    return variant.trim()

  return resolveLayoutRecipe(layout, variant, arrangement).aliases[0].variant
}

export function resolveLayoutSpec(layout: ThemeLayout, variant: string) {
  return normalizeRecipeRegions(resolveLayoutRecipe(layout, variant))
}

export function resolveLayoutSlotSpec(
  layout: ThemeLayout,
  variant: string,
  role: ThemeLayoutRole,
  index: number,
) {
  const resolved = resolveLayoutSpec(layout, variant).slots[role]?.[index]
  if (!resolved)
    fail('Slide', `Variant "${layout}:${variant}" не поддерживает ${role}[${index}].`)
  return resolved
}
