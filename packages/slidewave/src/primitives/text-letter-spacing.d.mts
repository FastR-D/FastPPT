export interface TextLetterSpacing {
  /** Additional character advance in points. Omitted inherits; zero clears. */
  letterSpacing?: number | undefined
}
export function validateTextLetterSpacing(value: TextLetterSpacing): void
export const textLetterSpacingCompatibility: string
/** Undefined signals invalid source syntax/range, not an inherited value. */
export function parseSourceLetterSpacing(value: unknown): number | undefined
