export interface TextCapitalization {
  /** Display only. Omission inherits; none explicitly clears the display mode. */
  capitalization?: 'none' | 'all' | 'small' | undefined
}
export function validateTextCapitalization(value: TextCapitalization): void
export function textCapitalizationCss(capitalization: TextCapitalization['capitalization']): { textTransform: string; fontVariantCaps: string }
export function readSourceCapitalization(element: Element): TextCapitalization['capitalization']
export const textCapitalizationCompatibility: string
