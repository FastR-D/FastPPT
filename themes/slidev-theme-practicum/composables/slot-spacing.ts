export type SlotMarginLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export type SlotMarginInput = SlotMarginLevel | `${SlotMarginLevel}`
export type SlotGapLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
export type SlotGapInput = SlotGapLevel | `${SlotGapLevel}`

export interface SlotSpacingInput {
  margin?: SlotMarginInput
  marginTop?: SlotMarginInput
  marginRight?: SlotMarginInput
  marginBottom?: SlotMarginInput
  marginLeft?: SlotMarginInput
}

export interface SlotSpacingStyle {
  paddingTop: string | undefined
  paddingRight: string | undefined
  paddingBottom: string | undefined
  paddingLeft: string | undefined
}

const SLOT_MARGIN_LEVELS = new Set<string>(['1', '2', '3', '4', '5', '6', '7', '8'])
const SLOT_GAP_LEVELS = new Set<string>(['0', '1', '2', '3', '4', '5', '6', '7'])

export function resolveSlotMarginCssValue(
  value: SlotMarginInput | undefined,
  label = 'slot',
): string | undefined {
  if (value == null)
    return undefined

  const normalizedValue = String(value)
  if (!SLOT_MARGIN_LEVELS.has(normalizedValue)) {
    throw new Error(`[${label}] margin должен быть уровнем 1..8. Получено: "${normalizedValue}".`)
  }

  return `var(--theme-slot-margin-${normalizedValue})`
}

export function resolveSlotGapCssValue(
  value: SlotGapInput | undefined,
  label = 'slot',
): string {
  if (value == null || String(value) === '0')
    return '0'

  const normalizedValue = String(value)
  if (!SLOT_GAP_LEVELS.has(normalizedValue)) {
    throw new Error(`[${label}] gap должен быть уровнем 0..7. Получено: "${normalizedValue}".`)
  }

  return `var(--theme-slot-margin-${normalizedValue})`
}

export function resolveSlotSpacingStyle(
  input: SlotSpacingInput,
  label = 'slot',
): SlotSpacingStyle | null {
  const style: SlotSpacingStyle = {
    paddingTop: resolveSlotMarginCssValue(input.marginTop ?? input.margin, label),
    paddingRight: resolveSlotMarginCssValue(input.marginRight ?? input.margin, label),
    paddingBottom: resolveSlotMarginCssValue(input.marginBottom ?? input.margin, label),
    paddingLeft: resolveSlotMarginCssValue(input.marginLeft ?? input.margin, label),
  }

  return Object.values(style).every(value => value == null) ? null : style
}
