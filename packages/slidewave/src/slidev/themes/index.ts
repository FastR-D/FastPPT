import { academyTheme } from './academy'
import { landingTheme } from './landing'
import type { SlidevCaptureTheme, SlidevCaptureThemeOption } from './types'

const BUILT_IN_THEMES = [academyTheme, landingTheme]

export function resolveSlidevCaptureTheme(
  root: HTMLElement,
  option: SlidevCaptureThemeOption = 'auto',
): SlidevCaptureTheme | undefined {
  if (option === 'none') return undefined
  if (option === 'academy') return academyTheme
  if (option === 'landing') return landingTheme
  if (option !== 'auto') return option
  return BUILT_IN_THEMES.find((theme) => theme.matches(root))
}

export * from './types'
export * from './academy'
export * from './landing'
