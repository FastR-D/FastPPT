import { expect, it } from 'vitest'
import { occupiedFraction } from '../../src/browser/rule-measurement.js'

it('measures clipped union area without double counting nested and overlapping content', () => {
  const canvas = { x: 100, y: 100, width: 100, height: 100 }
  expect(
    occupiedFraction(
      [
        { x: 50, y: 100, width: 100, height: 100 },
        { x: 100, y: 100, width: 10, height: 10 },
        { x: 140, y: 150, width: 100, height: 100 },
        { x: 300, y: 100, width: 100, height: 100 },
      ],
      canvas,
    ),
  ).toBe(0.75)
  expect(occupiedFraction([], canvas)).toBe(0)
  expect(occupiedFraction([canvas], canvas)).toBe(1)
})
