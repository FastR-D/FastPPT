import { describe, expect, it } from 'vitest'

import { academyTheme } from '../../../src/slidev/themes/academy/index.js'

function element(className: string, tagName = 'div'): HTMLElement {
  return {
    className,
    matches: (selector: string) => {
      if (selector === '.katex') return className === 'katex'
      if (selector === '.ustc-section-bar')
        return className === 'ustc-section-bar'
      return false
    },
  } as unknown as HTMLElement
}

describe('Academy capture theme', () => {
  it('groups KaTeX and section bars but keeps inline code editable', () => {
    for (const candidate of [element('katex'), element('ustc-section-bar')]) {
      expect(
        academyTheme.captureAsGroup?.({
          root: candidate,
          element: candidate,
          rootScaleX: 1,
          rootScaleY: 1,
        }),
      ).toBe(true)
    }
    expect(
      academyTheme.captureAsGroup?.({
        root: element('', 'code'),
        element: element('', 'code'),
        rootScaleX: 1,
        rootScaleY: 1,
      }),
    ).toBe(false)
  })

  it('keeps ordinary content editable', () => {
    const candidate = element('callout')
    expect(
      academyTheme.captureAsGroup?.({
        root: candidate,
        element: candidate,
        rootScaleX: 1,
        rootScaleY: 1,
      }),
    ).toBe(false)
  })

  it('centers numbered-list marker text in its circular marker', () => {
    const marker = {
      getBoundingClientRect: () => ({ x: 16, y: 10, width: 24, height: 24 }),
    } as unknown as HTMLElement
    const parent = {
      classList: {
        contains: (name: string) => name === 'numbered-list-marker-text',
      },
      closest: (selector: string) =>
        selector === '.numbered-list-marker' ? marker : null,
    } as unknown as HTMLElement
    const adjustment = academyTheme.adjustText?.({
      root: parent,
      parent,
      text: '2',
      box: { x: 20, y: 14, width: 8, height: 12 },
      style: {} as never,
      precision: 4,
      rect: (candidate) =>
        candidate === marker
          ? { x: 16, y: 10, width: 24, height: 24 }
          : { x: 0, y: 0, width: 0, height: 0 },
      measureReplacementBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    })
    expect(adjustment).toMatchObject({
      box: { x: 16, y: 9.04, width: 24, height: 24 },
      align: 'center',
      verticalAlign: 'middle',
    })
  })

  it('shrinks inline code backgrounds without changing the text baseline', () => {
    const code = {
      tagName: 'CODE',
      classList: { contains: () => false },
      closest: (selector: string) =>
        selector === '.slidev-code, pre' ? null : code,
    } as unknown as HTMLElement
    expect(
      academyTheme.adjustBackgroundBox?.({
        root: code,
        element: code,
        box: { x: 10, y: 20, width: 60, height: 20 },
        precision: 4,
      }),
    ).toEqual({ x: 10, y: 21.2, width: 60, height: 17.6 })

    const adjustment = academyTheme.adjustText?.({
      root: code,
      parent: code,
      text: 'claude',
      box: { x: 14, y: 20, width: 48, height: 20 },
      style: { fontSizePx: 16, lineHeightPx: 28 } as never,
      precision: 4,
      rect: (candidate) =>
        candidate === code
          ? { x: 10, y: 20, width: 60, height: 20 }
          : { x: 0, y: 0, width: 0, height: 0 },
      measureReplacementBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    })
    expect(adjustment).toBeUndefined()
  })

  it('does not apply inline geometry to fenced code blocks', () => {
    const code = {
      tagName: 'CODE',
      closest: (selector: string) =>
        selector === '.slidev-code, pre' ? ({} as HTMLElement) : null,
    } as unknown as HTMLElement
    expect(
      academyTheme.adjustBackgroundBox?.({
        root: code,
        element: code,
        box: { x: 10, y: 20, width: 60, height: 20 },
        precision: 4,
      }),
    ).toBeUndefined()
  })

  it('centers takeaway text in the full container', () => {
    const takeaway = {
      getBoundingClientRect: () => ({ x: 20, y: 10, width: 200, height: 48 }),
    } as unknown as HTMLElement
    const parent = {
      classList: { contains: () => false },
      closest: (selector: string) =>
        selector === '.takeaway' ? takeaway : null,
    } as unknown as HTMLElement
    const adjustment = academyTheme.adjustText?.({
      root: parent,
      parent,
      text: 'Conclusion',
      box: { x: 30, y: 23, width: 80, height: 12 },
      style: { fontSizePx: 16, lineHeightPx: 20 } as never,
      precision: 4,
      rect: (candidate) =>
        candidate === takeaway
          ? { x: 20, y: 10, width: 200, height: 48 }
          : { x: 30, y: 20, width: 80, height: 18 },
      measureReplacementBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    })
    expect(adjustment).toMatchObject({
      box: { x: 30, y: 19, width: 80, height: 20 },
      verticalAlign: 'middle',
    })
  })

  it('uses the captured overview slide id for footer page numbers', () => {
    const footer = {
      getBoundingClientRect: () => ({ x: 800, y: 520, width: 150, height: 24 }),
    } as unknown as HTMLElement
    const parent = {
      classList: { contains: () => false },
      closest: (selector: string) =>
        selector === '.footer-right' ? footer : null,
    } as unknown as HTMLElement
    const adjustment = academyTheme.adjustText?.({
      root: parent,
      parent,
      text: '1 / 80',
      box: { x: 900, y: 522, width: 40, height: 12 },
      style: { fontSizePx: 12, lineHeightPx: 14 } as never,
      slideId: '17',
      precision: 4,
      rect: () => ({ x: 800, y: 520, width: 150, height: 24 }),
      measureReplacementBox: (_element, text) => ({
        x: 895,
        y: 520,
        width: text.length * 8,
        height: 24,
      }),
    })
    expect(adjustment).toMatchObject({
      text: '17 / 80',
      align: 'right',
      verticalAlign: 'middle',
    })
  })
})
