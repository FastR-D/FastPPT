import { describe, expect, it, vi } from 'vitest'
import { createPageWheelHandler } from './page-wheel.js'

function wheel(deltaY: number, overrides: Partial<WheelEvent> = {}) {
  return { deltaX: 0, deltaY, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault: vi.fn(), ...overrides }
}

describe('wheel page navigation', () => {
  it('accumulates small trackpad deltas and suppresses rapid wheel bursts', () => {
    const navigate = vi.fn()
    let time = 0
    const handle = createPageWheelHandler(navigate, () => true, () => time)
    for (let i = 0; i < 4; i++) { handle(wheel(12)); time += 20 }
    expect(navigate.mock.calls).toEqual([[1]])
    handle(wheel(120))
    expect(navigate).toHaveBeenCalledTimes(1)
    time = 300
    handle(wheel(-120))
    expect(navigate.mock.calls).toEqual([[1], [-1]])
  })

  it('resets incomplete gestures after a pause or direction change', () => {
    const navigate = vi.fn()
    let time = 0
    const handle = createPageWheelHandler(navigate, () => true, () => time)
    handle(wheel(30))
    time = 200
    handle(wheel(30))
    handle(wheel(-30))
    expect(navigate).not.toHaveBeenCalled()
    handle(wheel(-20))
    expect(navigate).toHaveBeenCalledWith(-1)
  })

  it('normalizes line and page wheels without intercepting zoom or horizontal scroll', () => {
    for (const [deltaY, deltaMode] of [[3, 1], [1, 2]]) {
      const navigate = vi.fn()
      createPageWheelHandler(navigate)(wheel(deltaY!, { deltaMode: deltaMode! }))
      expect(navigate).toHaveBeenCalledWith(1)
    }
    const navigate = vi.fn()
    const handle = createPageWheelHandler(navigate)
    for (const event of [wheel(100, { ctrlKey: true }), wheel(100, { metaKey: true }), wheel(100, { shiftKey: true }), wheel(5, { deltaX: 100 }), wheel(0)]) {
      handle(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
    const disabled = wheel(120)
    createPageWheelHandler(navigate, () => false)(disabled)
    expect(disabled.preventDefault).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
