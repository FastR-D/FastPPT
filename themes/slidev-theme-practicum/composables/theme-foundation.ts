export const THEME_SLIDE_MODES = ['light', 'dark', 'color'] as const
export const THEME_TONES = ['blue', 'orange', 'green', 'red', 'yellow'] as const
export const THEME_SLOT_SURFACES = ['none', 'light', 'dark', 'color', 'tint'] as const

export type ThemeSlideMode = typeof THEME_SLIDE_MODES[number]
export type ThemeTone = typeof THEME_TONES[number]
export type ThemeSlotSurface = typeof THEME_SLOT_SURFACES[number]

export type ResolvedThemeMode = {
  mode: ThemeSlideMode
  tone: ThemeTone
  background: string
  text: string
  muted: string
  contrast: boolean
}

export type ResolvedSlideTheme = ResolvedThemeMode

export type ResolvedSlotTheme = {
  surface: ThemeSlotSurface
  tone: ThemeTone
}

export type ResolveThemeModeOptions = {
  mode?: unknown
  tone?: unknown
  defaultTone?: ThemeTone
  label?: string
}

export type ResolveSurfaceToneOptions = {
  surface?: unknown
  tone?: unknown
  defaultTone?: ThemeTone
  label?: string
}

export type ResolveSlideThemeOptions = ResolveThemeModeOptions
export type ResolveSlotThemeOptions = ResolveSurfaceToneOptions

function fail(label: string, message: string): never {
  throw new Error(`[${label}] ${message}`)
}

function normalizeString(value: unknown) {
  if (typeof value !== 'string')
    return null

  const normalized = value.trim().toLowerCase()
  return normalized || null
}

function resolveEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  fallback?: T,
) {
  const normalized = normalizeString(value)
  if (normalized == null) {
    if (fallback)
      return fallback

    fail(label, `Значение обязательно. Допустимые варианты: ${allowed.join(', ')}.`)
  }

  if ((allowed as readonly string[]).includes(normalized))
    return normalized as T

  fail(label, `Недопустимое значение "${normalized}". Разрешены только: ${allowed.join(', ')}.`)
}

export function resolveSlideMode(
  value: unknown,
  label = 'Slide.mode',
  fallback: ThemeSlideMode = 'light',
) {
  return resolveEnum(value, THEME_SLIDE_MODES, label, fallback)
}

export function resolveTone(
  value: unknown,
  label = 'tone',
  fallback: ThemeTone = 'blue',
) {
  return resolveEnum(value, THEME_TONES, label, fallback)
}

export function resolveSlotSurface(
  value: unknown,
  label = 'surface',
  fallback: ThemeSlotSurface = 'none',
) {
  return resolveEnum(value, THEME_SLOT_SURFACES, label, fallback)
}

export function isContrastSlideMode(mode: ThemeSlideMode) {
  return mode !== 'light'
}

export function resolveThemeMode(options: ResolveThemeModeOptions = {}): ResolvedThemeMode {
  const label = options.label ?? 'Slide'
  const mode = resolveSlideMode(options.mode, `${label}.mode`, 'light')
  const tone = resolveTone(options.tone, `${label}.tone`, options.defaultTone ?? 'blue')

  if (mode === 'light') {
    return {
      mode,
      tone,
      background: 'var(--theme-color-light-0)',
      text: 'var(--theme-color-dark-0)',
      muted: 'var(--theme-color-dark-2)',
      contrast: false,
    }
  }

  if (mode === 'dark') {
    return {
      mode,
      tone,
      background: 'var(--theme-color-dark-0)',
      text: 'var(--theme-color-light-0)',
      muted: 'var(--theme-text-muted-on-contrast)',
      contrast: true,
    }
  }

  return {
    mode,
    tone,
    background: `var(--theme-color-${tone}-0)`,
    text: 'var(--theme-color-light-0)',
    muted: 'var(--theme-text-muted-on-contrast)',
    contrast: true,
  }
}

export function resolveSurfaceTone(options: ResolveSurfaceToneOptions = {}): ResolvedSlotTheme {
  const label = options.label ?? 'Slot'
  const surface = resolveSlotSurface(options.surface, `${label}.surface`, 'none')
  const rawTone = normalizeString(options.tone)

  if (surface !== 'color' && surface !== 'tint') {
    if (rawTone) {
      fail(label, `tone разрешён только для surface="color" или surface="tint". Получено: "${rawTone}".`)
    }

    return {
      surface,
      tone: options.defaultTone ?? 'blue',
    }
  }

  return {
    surface,
    tone: resolveTone(rawTone, `${label}.tone`, options.defaultTone ?? 'blue'),
  }
}

export const resolveSlideTheme = resolveThemeMode
export const resolveSlotTheme = resolveSurfaceTone

export function themeVars(scope: 'slide', theme: ResolvedSlideTheme): Record<string, string>
export function themeVars(scope: 'slot', theme: ResolvedSlotTheme): Record<string, string>
export function themeVars(
  scope: 'slide' | 'slot',
  theme: ResolvedSlideTheme | ResolvedSlotTheme,
): Record<string, string> {
  if (scope === 'slide') {
    const slideTheme = theme as ResolvedSlideTheme

    return {
      '--theme-bg': slideTheme.background,
      '--theme-text': slideTheme.text,
      '--theme-text-muted': slideTheme.muted,
      '--theme-inline-code-text': slideTheme.text,
      '--theme-text-on-dark': 'var(--theme-color-light-0)',
      '--theme-link': slideTheme.contrast ? 'var(--theme-color-light-0)' : 'var(--theme-current-color)',
      '--theme-current-color': `var(--theme-color-${slideTheme.tone}-0)`,
    }
  }

  const slotTheme = theme as ResolvedSlotTheme
  if (slotTheme.surface !== 'color' && slotTheme.surface !== 'tint')
    return {}

  return {
    '--theme-slot-color': `var(--theme-color-${slotTheme.tone}-0)`,
    '--theme-slot-tint': `var(--theme-color-${slotTheme.tone}-1, color-mix(in srgb, var(--theme-color-${slotTheme.tone}-0) 40%, var(--theme-color-light-0)))`,
  }
}
