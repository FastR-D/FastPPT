export interface MotionTiming {
  trigger?: 'on-click' | 'with-previous' | 'after-previous'
  delayMs?: number
  durationMs?: number
}
export interface ScheduledMotion<T> {
  effect: T
  index: number
  clickGroup: number
  /** Relative to this click group; group zero starts on page entry. */
  startMs: number
  endMs: number
  /** Deterministic automatic preview, with clicks at the previous group's end. */
  previewStartMs: number
  previewEndMs: number
}
export function scheduleMotion<T extends MotionTiming>(effects: readonly T[]): ScheduledMotion<T>[] {
  const result: ScheduledMotion<T>[] = []
  let clickGroup = 0
  let groupOffset = 0
  let groupEnd = 0
  let previousStart = 0
  let previousEnd = 0
  for (const [index, effect] of effects.entries()) {
    const delay = effect.delayMs ?? 0
    const duration = effect.durationMs ?? 400
    if (!Number.isFinite(delay) || delay < 0 || !Number.isFinite(duration) || duration < 0)
      throw new RangeError('Motion delay and duration must be finite non-negative milliseconds.')
    const trigger = effect.trigger ?? 'on-click'
    if (!['on-click', 'with-previous', 'after-previous'].includes(trigger))
      throw new TypeError(`Unsupported motion trigger: ${String(trigger)}`)
    if (trigger === 'on-click') {
      groupOffset += groupEnd
      clickGroup += 1
      groupEnd = 0
      previousStart = 0
      previousEnd = 0
    }
    const startMs = delay + (trigger === 'with-previous' ? previousStart : trigger === 'after-previous' ? previousEnd : 0)
    const endMs = startMs + duration
    if (!Number.isFinite(groupOffset + endMs)) throw new RangeError('Motion timeline exceeds finite milliseconds.')
    result.push({ effect, index, clickGroup, startMs, endMs, previewStartMs: groupOffset + startMs, previewEndMs: groupOffset + endMs })
    previousStart = startMs
    previousEnd = endMs
    groupEnd = Math.max(groupEnd, endMs)
  }
  return result
}
