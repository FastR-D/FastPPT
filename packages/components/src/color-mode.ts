import { computed, readonly, shallowRef } from 'vue'

export type ColorMode = 'light' | 'dark'
export type ColorModePreference = ColorMode | 'system'
const STORAGE_KEY = 'fastppt.color-mode'
const mode = shallowRef<ColorMode>('light')
let preference: ColorModePreference = 'system'
let initialized = false
let systemQuery: MediaQueryList | undefined

function apply(): void {
  mode.value =
    preference === 'system'
      ? systemQuery?.matches
        ? 'dark'
        : 'light'
      : preference
  document.documentElement.dataset.theme = mode.value
}

export function initializeColorMode(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  systemQuery = window.matchMedia('(prefers-color-scheme: dark)')
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') preference = saved
  } catch {
    /* System preference remains usable without storage. */
  }
  apply()
  systemQuery.addEventListener('change', () => {
    if (preference === 'system') apply()
  })
}

export function setColorMode(value: ColorModePreference): void {
  initializeColorMode()
  preference = value
  try {
    if (value === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, value)
  } catch {
    /* The current session still keeps the selected mode. */
  }
  apply()
}

export function useColorMode() {
  initializeColorMode()
  return {
    mode: readonly(mode),
    isDark: computed(() => mode.value === 'dark'),
    toggle: () => setColorMode(mode.value === 'dark' ? 'light' : 'dark'),
  }
}
