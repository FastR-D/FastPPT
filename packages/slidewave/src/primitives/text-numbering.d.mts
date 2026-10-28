import type { TextBullet } from './text-bullet.js'
export const autoNumberSchemes: readonly [
  'arabicPeriod',
  'arabicParenR',
  'arabicParenBoth',
  'arabicPlain',
  'alphaLcPeriod',
  'alphaUcPeriod',
  'alphaLcParenR',
  'alphaUcParenR',
  'alphaLcParenBoth',
  'alphaUcParenBoth',
  'romanLcPeriod',
  'romanUcPeriod',
  'romanLcParenR',
  'romanUcParenR',
  'romanLcParenBoth',
  'romanUcParenBoth',
]
export function formatAutoNumber(scheme: string, value: number): string
export function nextNumberingMarker(
  state: Map<number, { scheme: string; seed: number; next: number }>,
  paragraph: {
    level: number
    bullet?: TextBullet | undefined
    visible: boolean
    restartAt?: number | undefined
  },
): {
  label: string
  value?: number
  bullet?: TextBullet | undefined
  review?: 'explicit-restart'
}
export function autoNumberGlyphs(scheme: string): string
