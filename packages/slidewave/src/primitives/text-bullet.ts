import { autoNumberSchemes } from './text-numbering.mjs'

export const textBulletCompatibility = 'Native marker, font, size and source indent are preserved. Browser marker widths and baselines do not establish target-application layout. LibreOffice 7.3.7.2 can substitute OpenSymbol for follow-text character bullets ignore fixed point bullet sizes, and keep character bullets regular beside bold text; review first-line wrapping and marker alignment in the actual exported file.'

export type AutoNumberScheme =
  | 'arabicPeriod'
  | 'arabicParenR'
  | 'arabicParenBoth'
  | 'arabicPlain'
  | 'alphaLcPeriod'
  | 'alphaUcPeriod'
  | 'alphaLcParenR'
  | 'alphaUcParenR'
  | 'alphaLcParenBoth'
  | 'alphaUcParenBoth'
  | 'romanLcPeriod'
  | 'romanUcPeriod'
  | 'romanLcParenR'
  | 'romanUcParenR'
  | 'romanLcParenBoth'
  | 'romanUcParenBoth'
export type TextBullet =
  | { kind: 'none' }
  | { kind: 'character'; character: string }
  | {
      kind: 'auto-number'
      scheme: AutoNumberScheme
      startAt?: number | undefined
    }
export type TextBulletFont =
  { kind: 'text' } | { kind: 'font'; fontFamily: string }
export type TextBulletSize =
  | { kind: 'text' }
  | { kind: 'points'; value: number }
  | { kind: 'percent'; value: number }
export type TextBulletColor =
  { kind: 'text' } | { kind: 'color'; color: string }

export interface TextBulletProperties {
  bullet?: TextBullet | undefined
  bulletFont?: TextBulletFont | undefined
  bulletSize?: TextBulletSize | undefined
  bulletColor?: TextBulletColor | undefined
}

/** One printable Unicode scalar. Keep markers separate from paragraph text. */
export function isBulletCharacter(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    [...value].length === 1 &&
    !/[\p{Cc}\p{Cf}\p{Cs}\p{Z}]/u.test(value)
  )
}

export function validateTextBulletProperties(
  value: TextBulletProperties,
): void {
  const validObject = (
    entry: unknown,
    keys: string[],
  ): entry is Record<string, unknown> =>
    !!entry &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    Object.keys(entry).every((key) => keys.includes(key))
  const { bullet, bulletFont, bulletSize, bulletColor } = value
  if (
    bullet !== undefined &&
    !(
      (validObject(bullet, ['kind']) && bullet.kind === 'none') ||
      (validObject(bullet, ['kind', 'character']) &&
        bullet.kind === 'character' &&
        isBulletCharacter(bullet.character)) ||
      (validObject(bullet, ['kind', 'scheme', 'startAt']) &&
        bullet.kind === 'auto-number' &&
        autoNumberSchemes.includes(bullet.scheme) &&
        (bullet.startAt === undefined ||
          (Number.isSafeInteger(bullet.startAt) &&
            bullet.startAt >= 1 &&
            bullet.startAt <= 32767)))
    )
  )
    throw new Error('Invalid text bullet.')
  if (
    bulletFont !== undefined &&
    !(
      validObject(bulletFont, ['kind', 'fontFamily']) &&
      ((bulletFont.kind === 'text' && Object.keys(bulletFont).length === 1) ||
        (bulletFont.kind === 'font' &&
          typeof bulletFont.fontFamily === 'string' &&
          !!bulletFont.fontFamily.trim()))
    )
  )
    throw new Error('Invalid bullet font.')
  if (
    bulletSize !== undefined &&
    !(
      validObject(bulletSize, ['kind', 'value']) &&
      ((bulletSize.kind === 'text' && Object.keys(bulletSize).length === 1) ||
        ((bulletSize.kind === 'points' || bulletSize.kind === 'percent') &&
          Number.isFinite(bulletSize.value) &&
          bulletSize.value >= (bulletSize.kind === 'points' ? 1 : 25) &&
          bulletSize.value <= (bulletSize.kind === 'points' ? 4000 : 400)))
    )
  )
    throw new Error('Invalid bullet size.')
  if (
    bulletColor !== undefined &&
    !(
      validObject(bulletColor, ['kind', 'color']) &&
      ((bulletColor.kind === 'text' && Object.keys(bulletColor).length === 1) ||
        (bulletColor.kind === 'color' &&
          typeof bulletColor.color === 'string' &&
          /^[0-9a-fA-F]{6}$/.test(bulletColor.color)))
    )
  )
    throw new Error('Invalid bullet color.')
}
