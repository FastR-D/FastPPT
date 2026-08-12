import { computed } from 'vue'
import { useSlideContext } from '@slidev/client'
import { resolveTone, type ThemeTone } from './theme-foundation'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean')
    return value

  if (typeof value === 'number')
    return value !== 0

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1')
      return true
    if (normalized === 'false' || normalized === '0')
      return false
  }

  return fallback
}

function readDefaultTone(value: unknown, fallback: ThemeTone): ThemeTone {
  if (value == null || value === '')
    return fallback

  return resolveTone(value, 'themeConfig.defaultTone', fallback)
}

export function useThemeConfig() {
  const { $slidev } = useSlideContext()
  const configs = computed<Record<string, unknown>>(() => $slidev?.configs ?? {})

  const themeConfigs = computed<Record<string, unknown>>(() => {
    const value = $slidev?.themeConfigs?.value ?? configs.value.themeConfig
    return isRecord(value) ? value : {}
  })

  const deckTitle = computed(() => {
    const explicit = themeConfigs.value.deckTitle
    if (typeof explicit === 'string' && explicit.trim())
      return explicit.trim()

    const fallback = configs.value.title
    if (typeof fallback === 'string' && fallback.trim())
      return fallback.trim()

    return ''
  })

  const showPageNumber = computed(() => readBoolean(themeConfigs.value.showPageNumber, true))
  const debugGrid = computed(() => readBoolean(themeConfigs.value.debugGrid, false))
  const defaultTone = computed(() => readDefaultTone(themeConfigs.value.defaultTone, 'blue'))
  const decors = computed(() => {
    const explicit = themeConfigs.value.decors
    return Array.isArray(explicit) ? explicit : []
  })

  return {
    themeConfigs,
    deckTitle,
    showPageNumber,
    debugGrid,
    defaultTone,
    decors,
  }
}
