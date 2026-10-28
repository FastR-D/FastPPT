export interface TextKerning {
  /** Minimum font size in points for kerning; zero enables it at every size. */
  kerningThreshold?: number | undefined
}
export function validateTextKerning(value: TextKerning): void
export function parseSourceKerning(value: unknown): number | undefined
export function readSourceKerning(element: Element, checkCss?: boolean): { thresholdPx: number; fontKerning: 'normal' | 'none' } | undefined
export function syncSourceKerning(root: Element | null): void
export function sourceKerningRuntime(): { validateTextKerning: typeof validateTextKerning; parseSourceKerning: typeof parseSourceKerning; readSourceKerning: typeof readSourceKerning; syncSourceKerning: typeof syncSourceKerning }
export const textKerningCompatibility: string
export const sourceKerningSetup: string
