import { describe, expect, it } from 'vitest'
import { scheduleMotion } from '../src/primitives/motion-schedule'

describe('motion scheduling', () => {
  it('distinguishes parallel, sequential and click-triggered effects', () => {
    const result = scheduleMotion([
      { trigger: 'on-click', delayMs: 100, durationMs: 500 },
      { trigger: 'with-previous', delayMs: 50, durationMs: 100 },
      { trigger: 'after-previous', delayMs: 20, durationMs: 100 },
      { trigger: 'on-click', durationMs: 200 },
    ] as const)
    expect(result.map(({ clickGroup, startMs, endMs, previewStartMs }) => [clickGroup, startMs, endMs, previewStartMs])).toEqual([
      [1, 100, 600, 100], [1, 150, 250, 150], [1, 270, 370, 270], [2, 0, 200, 600],
    ])
  })
  it('supports page-entry effects and zero-duration steps', () => {
    expect(scheduleMotion([{ trigger: 'with-previous', durationMs: 0 }])[0]).toMatchObject({ clickGroup: 0, startMs: 0, endMs: 0 })
    expect(scheduleMotion([])).toEqual([])
  })
  it('rejects invalid timing rather than corrupting subsequent steps', () => {
    for (const durationMs of [-1, NaN, Infinity]) expect(() => scheduleMotion([{ durationMs }])).toThrow(RangeError)
    expect(() => scheduleMotion([{ delayMs: Number.MAX_VALUE, durationMs: Number.MAX_VALUE }])).toThrow(RangeError)
    expect(() => scheduleMotion([{ trigger: 'invalid' as 'on-click' }])).toThrow(TypeError)
  })
})
