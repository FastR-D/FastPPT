import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  safeRun,
  setSilent,
  setStrict,
  validateColor,
  validateRect,
  validateText,
} from '../src/validate'

describe('validation', () => {
  beforeEach(() => {
    setStrict(false)
    setSilent(false)
  })

  afterEach(() => {
    setStrict(false)
    setSilent(false)
    vi.restoreAllMocks()
  })

  it('does not warn for valid primitive options', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    validateRect({ x: 1, y: 1, w: 2, h: 2 })
    validateText({ fontSize: 24, charSpacing: 1, lineSpacingMultiple: 1.2 })
    validateColor('#AABBCC')

    expect(warn).not.toHaveBeenCalled()
  })

  it('includes context in non-strict warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    validateRect({ x: Number.NaN, y: 0, w: -1, h: 1 }, 'card')

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[Slidewave:card]'))
  })

  it('supports silent and strict validation modes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setSilent(true)
    validateColor('not-a-color')
    expect(warn).not.toHaveBeenCalled()

    setSilent(false)
    setStrict(true)
    expect(() => validateColor('not-a-color', 'brand')).toThrow('[Slidewave:brand]')
  })

  it('returns null after a raster failure in non-strict mode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(safeRun(async () => { throw new Error('boom') }, 'blob')).resolves.toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('raster failed: boom'))
  })

  it('preserves the original error in strict mode', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('original')
    setStrict(true)

    await expect(safeRun(async () => { throw error })).rejects.toBe(error)
  })
})
