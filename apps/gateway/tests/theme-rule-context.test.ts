import { expect, it } from 'vitest'
import { themeRuleSlides } from '../src/theme-rule-context.js'

it('uses the selected layout and inherited master group, preserving overrides and absent measurements', () => {
  const definitions = [
    {
      name: 'cover',
      masterId: 'brand',
      placeholders: [
        {
          index: 0,
          type: 'title' as const,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      ],
      masterObjects: {
        objects: [
          { anchor: 'logo', name: 'Logo', x: 0, y: 0, width: 10, height: 10 },
        ],
      },
    },
    {
      name: 'body',
      masterId: 'brand',
      placeholders: [],
      fixedObjects: [{ name: 'Footer', x: 0, y: 100, width: 50, height: 10 }],
    },
    { name: 'other', masterId: 'secondary', placeholders: [] },
  ]
  const slides = [
    { slideId: 's1', layout: 'body' },
    { slideId: 's2', layout: 'other' },
    { slideId: 's3', layout: 'unresolved' },
  ]
  const evidence = themeRuleSlides(
    slides,
    definitions,
    [{ slideId: 's1', groups: [{ id: 'logo', effects: [{}] }] }],
    [{ slide: 1, textLines: 4, density: 0.3, tokens: ['--brand'] }],
  )
  expect(evidence[0]).toMatchObject({
    master: 'brand',
    placeholders: [],
    fixedObjects: [
      { name: 'Logo', owner: 'master', overridden: true },
      { name: 'Footer', owner: 'layout', overridden: false },
    ],
    textLines: 4,
    density: 0.3,
  })
  expect(evidence[1]).toEqual({
    index: 2,
    layout: 'other',
    master: 'secondary',
    placeholders: [],
    fixedObjects: [],
  })
  expect(evidence[2]).toEqual({ index: 3, layout: 'unresolved' })
})
