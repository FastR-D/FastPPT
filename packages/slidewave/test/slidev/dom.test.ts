import { describe, expect, it } from 'vitest'

import { isRenderedElement } from '../../src/slidev/dom.js'

function renderedElement(attributes: Record<string, string> = {}): HTMLElement {
  return {
    getAttribute: (name: string) => attributes[name] ?? null,
    hasAttribute: (name: string) => Object.hasOwn(attributes, name),
    getBoundingClientRect: () => ({
      left: 10,
      top: 10,
      right: 30,
      bottom: 30,
      width: 20,
      height: 20,
    }),
    textContent: '',
  } as unknown as HTMLElement
}

const style = {
  display: 'inline-flex',
  visibility: 'visible',
} as CSSStyleDeclaration

const rootRect = {
  left: 0,
  top: 0,
  right: 100,
  bottom: 100,
} as DOMRectReadOnly

describe('Slidev DOM visibility', () => {
  it('captures aria-hidden visuals because accessibility does not hide pixels', () => {
    expect(
      isRenderedElement(renderedElement({ 'aria-hidden': 'true' }), style, rootRect),
    ).toBe(true)
  })

  it('continues to capture explicitly marked aria-hidden visuals', () => {
    expect(
      isRenderedElement(
        renderedElement({
          'aria-hidden': 'true',
          'data-slidewave-capture': '',
        }),
        style,
        rootRect,
      ),
    ).toBe(true)
  })
})
