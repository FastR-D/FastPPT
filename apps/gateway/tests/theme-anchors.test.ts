import { expect, it } from 'vitest'
import { withThemeAnchors } from '../src/theme-anchors.js'
it('merges selected layout and sibling master anchors without leaking other groups', () => {
  const object = { name: 'logo', anchor: 'brand', x: 0, y: 0, width: 100, height: 100 }
  const slides = [{ layout: 'body', anchors: ['content'] }, { layout: 'other', anchors: [] }, { layout: 'unknown', anchors: ['own'] }]
  const before = structuredClone(slides)
  const result = withThemeAnchors(slides, [
    { name: 'cover', masterId: 'brand', placeholders: [], masterObjects: { objects: [object] } },
    { name: 'body', masterId: 'brand', placeholders: [], fixedObjects: [{ ...object, anchor: 'local' }, { ...object, anchor: 'content' }] },
    { name: 'other', masterId: 'other', placeholders: [] },
  ])
  expect(result.map(slide => slide.anchors)).toEqual([['content', 'local', 'brand'], [], ['own']])
  expect(slides).toEqual(before)
})
