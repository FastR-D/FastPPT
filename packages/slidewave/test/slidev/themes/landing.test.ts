import { describe, expect, it, vi } from 'vitest'

import {
  createLandingHighlightBand,
  landingHintOpticalOffset,
  landingTheme,
} from '../../../src/slidev/themes/landing'

describe('Landing landing capture policy', () => {
  it('keeps ordinary Hint sizes geometric and optically lowers only large text', () => {
    expect(landingHintOpticalOffset(14)).toBe(0)
    expect(landingHintOpticalOffset(16)).toBe(0)
    expect(landingHintOpticalOffset(18)).toBe(1.5)
  })

  it('converts the theme Mark gradient into its clean lower highlight band', () => {
    expect(
      createLandingHighlightBand(
        { x: 20, y: 40, width: 100, height: 20 },
        {
          angle: 180,
          stops: [
            { offset: 0, color: { hex: 'F8A3BC', alpha: 0 } },
            { offset: 0.35, color: { hex: 'F8A3BC', alpha: 1 } },
            { offset: 1, color: { hex: 'F8A3BC', alpha: 0 } },
          ],
        },
      ),
    ).toEqual({
      box: { x: 20, y: 50.8, width: 100, height: 6 },
      fill: { hex: 'F8A3BC', alpha: 0.45 },
      radiusPx: 2,
    })
    expect(landingTheme.name).toBe('landing')
  })

  it('aligns Hint text to the captured icon center', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      display: 'flex',
      alignItems: 'center',
    }))
    const icon = {
      classList: {
        contains: (name: string) =>
          name === 'text-primary' || name === 'shrink-0',
      },
    } as unknown as HTMLElement
    const container = {
      classList: { contains: (name: string) => name === 'bg-gray-100/50' },
      children: [icon],
    } as unknown as HTMLElement
    const parent = {
      closest: () => container,
      classList: { contains: () => false },
      parentElement: container,
      tagName: 'SPAN',
    } as unknown as HTMLElement
    const adjustment = landingTheme.adjustText?.({
      root: parent,
      parent,
      text: 'Hint text',
      box: { x: 30, y: 20, width: 60, height: 14 },
      style: { fontSizePx: 16 } as never,
      precision: 4,
      rect: (element) =>
        element === icon
          ? { x: 20, y: 10, width: 18, height: 24 }
          : { x: 0, y: 0, width: 100, height: 44 },
      measureReplacementBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    })
    expect(adjustment?.box?.y).toBe(15)
  })

  it('preserves browser line boxes for wrapped Landing text', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      display: 'flex',
      alignItems: 'center',
    }))
    const container = {
      classList: { contains: (name: string) => name === 'bg-gray-100/50' },
      children: [],
    } as unknown as HTMLElement
    const parent = {
      closest: () => container,
      classList: { contains: () => false },
      parentElement: container,
      tagName: 'P',
    } as unknown as HTMLElement
    const adjustment = landingTheme.adjustText?.({
      root: parent,
      parent,
      text: 'Wrapped Hint text',
      box: { x: 30, y: 20, width: 60, height: 14 },
      style: { fontSizePx: 16, lineHeightPx: 20 } as never,
      precision: 4,
      rect: (element) =>
        element === parent
          ? { x: 20, y: 10, width: 80, height: 42 }
          : { x: 0, y: 0, width: 100, height: 52 },
      measureReplacementBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    })
    expect(adjustment).toBeUndefined()
  })
})
