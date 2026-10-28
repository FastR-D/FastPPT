import { expect, it } from 'vitest'
import {
  autoNumberSchemes,
  formatAutoNumber,
  nextNumberingMarker,
} from '../src/primitives/text-numbering.mjs'
import { nativeBulletXml } from '../src/server/native-text-style.js'
import type { TextBullet } from '../src/primitives/text-bullet.js'

it('formats common DrawingML schemes without wrapping alphabetic numbers at Z', () => {
  expect(
    [1, 26, 27, 28, 52, 53, 702, 703, 32767].map((value) =>
      formatAutoNumber('alphaUcPeriod', value),
    ),
  ).toEqual(['A.', 'Z.', 'AA.', 'AB.', 'AZ.', 'BA.', 'ZZ.', 'AAA.', 'AVLG.'])
  expect(
    [4, 9, 49, 3999, 4000].map((value) =>
      formatAutoNumber('romanLcParenBoth', value),
    ),
  ).toEqual(['(iv)', '(ix)', '(xlix)', '(mmmcmxcix)', '(mmmm)'])
  expect(
    autoNumberSchemes.map((scheme) => formatAutoNumber(scheme, 27)),
  ).toEqual([
    '27.',
    '27)',
    '(27)',
    '27',
    'aa.',
    'AA.',
    'aa)',
    'AA)',
    '(aa)',
    '(AA)',
    'xxvii.',
    'XXVII.',
    'xxvii)',
    'XXVII)',
    '(xxvii)',
    '(XXVII)',
  ])
  for (const value of [0, -1, 1.5, Infinity, 32768])
    expect(() => formatAutoNumber('arabicPeriod', value)).toThrow()
  expect(() => formatAutoNumber('unknown', 1)).toThrow()
})

it('keeps template starts stable, resumes parent levels, and resets children only for list items', () => {
  const state = new Map()
  const next = (
    level: number,
    bullet: TextBullet = {
      kind: 'auto-number',
      scheme: 'arabicPeriod',
      startAt: level === 1 ? 5 : 3,
    },
    visible = true,
    restartAt?: number,
  ) => nextNumberingMarker(state, { level, bullet, visible, restartAt })
  expect(next(1)).toMatchObject({ label: '5.', bullet: { startAt: 5 } })
  expect(next(1)).toEqual({
    label: '6.',
    value: 6,
    bullet: { kind: 'auto-number', scheme: 'arabicPeriod' },
  })
  expect(next(2).label).toBe('3.')
  expect(next(2).label).toBe('4.')
  next(1, { kind: 'none' })
  expect(next(2).label).toBe('5.')
  next(1, undefined, false)
  expect(next(2).label).toBe('6.')
  expect(next(1).label).toBe('7.')
  expect(next(2).label).toBe('3.')
  expect(next(1, undefined, true, 1)).toMatchObject({
    label: '1.',
    review: 'explicit-restart',
    bullet: { startAt: 1 },
  })
  expect(next(1).label).toBe('2.')
  next(1, { kind: 'character', character: '•' })
  expect(next(1).label).toBe('5.')
  expect(next(1, { kind: 'auto-number', scheme: 'alphaLcPeriod' }).label).toBe(
    'a.',
  )
  expect(next(1).label).toBe('5.')
  expect(
    nextNumberingMarker(new Map(), {
      level: 1,
      visible: true,
      bullet: { kind: 'auto-number', scheme: 'arabicPeriod', startAt: 5 },
    }).label,
  ).toBe('5.')
  expect(
    next(1, { kind: 'auto-number', scheme: 'arabicPeriod', startAt: 1 }),
  ).toMatchObject({ label: '1.', review: 'explicit-restart' })
  expect(() => next(1, { kind: 'none' }, true, 3)).toThrow()
  expect(() => next(1, undefined, true, 0)).toThrow()
})

it('preserves native numbering intent, rejects invalid contracts and never consumes empty paragraphs', () => {
  const bullet = {
    kind: 'auto-number',
    scheme: 'alphaUcParenR',
    startAt: 27,
  } as const
  expect(nativeBulletXml({ bullet })).toContain(
    '<a:buAutoNum type="alphaUcParenR" startAt="27"/>',
  )
  expect(
    nativeBulletXml({
      bullet: { kind: 'auto-number', scheme: 'arabicPeriod' },
    }),
  ).toContain('<a:buAutoNum type="arabicPeriod"/>')
  for (const invalid of [
    { ...bullet, startAt: 0 },
    { ...bullet, startAt: 32768 },
    { ...bullet, scheme: 'unknown' },
    { ...bullet, character: '•' },
    { kind: 'none', startAt: 2 },
  ])
    expect(() => nativeBulletXml({ bullet: invalid } as never)).toThrow()
  const state = new Map()
  expect(
    nextNumberingMarker(state, {
      level: 1,
      bullet,
      visible: false,
      restartAt: 7,
    }),
  ).toMatchObject({
    label: '',
    review: 'explicit-restart',
    bullet: { startAt: 7 },
  })
  expect(
    nextNumberingMarker(state, { level: 1, bullet, visible: true }).label,
  ).toBe('AA)')
})
