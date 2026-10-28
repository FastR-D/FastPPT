import { expect, it } from 'vitest'
import { fixedObjectOverrides, isFixedObjectOverridden } from '../src/server/fixed-object-overrides.js'
import { HtmlDeckSnapshotSchema } from '../src/snapshot.js'
import type { WriteEditablePptxOptions } from '../src/server/index.js'

const object = { name: 'Brand', x: 0, y: 0, width: 1000, height: 1000, text: 'Brand' }
function snapshot(scope: 'layout' | 'master') {
  return HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: [{ version: 1, id: 'one', width: 100, height: 100, warnings: [], elements: [{ id: 'logo', kind: 'shape', shape: 'rect', box: { x: 0, y: 0, width: 10, height: 10 }, opacity: 1, zIndex: 0, order: 0, source: { tag: 'div', path: 'logo', anchor: 'brand', nativeLayoutObject: { layout: 'Body', name: 'Brand', scope } }, fill: { hex: '112233', alpha: 1 } }] }] })
}
function options(): WriteEditablePptxOptions {
  return {
    embedFonts: false, slideLayouts: ['Body'],
    masterLayoutDefinitions: [
      { name: 'Cover', masterId: 'Brand', placeholders: [], masterTheme: { fontFamily: 'Inter', colors: ['112233'] }, masterObjects: { canvas: { width: 10000, height: 10000 }, objects: [object, { ...object, name: 'Footer' }] } },
      { name: 'Body', masterId: 'Brand', placeholders: [{ index: 0, type: 'title', x: 1, y: 2, width: 300, height: 400 }], fixedObjects: [object] },
      { name: 'Body · page 1 animation', masterId: 'Brand · page 1 animation', placeholders: [] },
    ],
    objectAnimations: [{ slide: 1, target: 'brand', kind: 'exit_fade' }],
  }
}
it('inherits sibling master theme and objects while keeping same-named layout objects', () => {
  const input = options()
  const before = structuredClone(input)
  const result = fixedObjectOverrides(snapshot('master'), input)
  const variant = result.options.masterLayoutDefinitions!.at(-1)!
  expect(variant.name).toBe('Body · page 1 animation_')
  expect(variant.masterId).toBe('Brand · page 1 animation_')
  expect(variant.masterTheme).toEqual({ fontFamily: 'Inter', colors: ['112233'] })
  expect(variant.masterObjects).toEqual({ canvas: { width: 10000, height: 10000 }, objects: [{ ...object, name: 'Footer' }] })
  expect(variant.fixedObjects).toEqual([object])
  expect(variant.placeholders).toEqual(input.masterLayoutDefinitions![1]!.placeholders)
  expect(result.options.slideLayouts).toEqual([variant.name])
  expect(isFixedObjectOverridden(result.excluded, 0, { scope: 'master', name: 'Brand' })).toBe(true)
  expect(isFixedObjectOverridden(result.excluded, 0, { scope: 'layout', name: 'Brand' })).toBe(false)
  expect(input).toEqual(before)
})
it('keeps a layout-only override in the original master group', () => {
  const result = fixedObjectOverrides(snapshot('layout'), options())
  const variant = result.options.masterLayoutDefinitions!.at(-1)!
  expect(variant.masterId).toBe('Brand')
  expect(variant.fixedObjects).toEqual([])
  expect(variant.masterObjects).toBeUndefined()
  expect(isFixedObjectOverridden(result.excluded, 0, { name: 'Brand' })).toBe(true)
})
it('does not create variants for disabled masters or unmatched animation targets', () => {
  for (const input of [{ ...options(), master: false }, { ...options(), objectAnimations: [{ slide: 1, target: 'other', kind: 'appear' as const }] }]) {
    const result = fixedObjectOverrides(snapshot('master'), input)
    expect(result.options).toBe(input)
    expect(result.excluded.size).toBe(0)
  }
})
