import { describe, expect, it } from 'vitest'

import { elementSource, isRenderedElement } from '../../src/slidev/dom.js'

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
  it('preserves compiler animation anchors from data attributes', () => {
    const element = {
      tagName: 'DIV',
      className: 'reveal',
      getAttribute: (name: string) =>
        name === 'data-fastppt-group' ? 'agenda' : null,
    } as unknown as Element
    expect(elementSource(element, 'root.1')).toMatchObject({
      path: 'root.1',
      anchor: 'agenda',
    })
  })

  it('uses an authored element id as an animation anchor when no group is injected', () => {
    const element = {
      tagName: 'DIV',
      className: 'reveal',
      getAttribute: (name: string) => name === 'id' ? 'hero' : null,
    } as unknown as Element
    expect(elementSource(element, 'root.1')).toMatchObject({ anchor: 'hero' })
  })

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

it('captures fixed layout ownership from an ancestor for nested text', () => {
  const owner = { getAttribute: (name: string) => name === 'data-fastppt-layout' ? 'cover' : name === 'data-fastppt-layout-object' ? 'Brand' : null }
  const element = { tagName: 'SPAN', className: '', getAttribute: () => null, closest: () => owner } as unknown as Element
  expect(elementSource(element, 'root/brand/span').nativeLayoutObject).toEqual({ layout: 'cover', name: 'Brand' })
})

it('keeps an explicit fixed-object anchor on nested captured content', () => {
  const attrs: Record<string, string> = { 'data-fastppt-layout': 'cover', 'data-fastppt-layout-object': 'Brand', 'data-fastppt-object-scope': 'master', 'data-fastppt-group': 'brand-logo' }
  const owner = { getAttribute: (name: string) => attrs[name] ?? null }
  const element = { tagName: 'SPAN', className: '', getAttribute: () => null, closest: () => owner } as unknown as Element
  expect(elementSource(element, 'root/brand/span')).toMatchObject({ anchor: 'brand-logo', nativeLayoutObject: { layout: 'cover', name: 'Brand', scope: 'master' } })
})
