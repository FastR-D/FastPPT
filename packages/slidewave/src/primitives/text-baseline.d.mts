export interface TextBaseline {
  /** Positive moves up, relative to the declared font size; zero clears. */
  baselinePercent?: number | undefined
}
export function validateTextBaseline(value: TextBaseline): void
export function parseSourceBaseline(value: unknown): number | undefined
export const textBaselineCompatibility: string
export function readSourceBaseline(element: Element): { baselinePercent: number; shiftPx: number } | undefined
