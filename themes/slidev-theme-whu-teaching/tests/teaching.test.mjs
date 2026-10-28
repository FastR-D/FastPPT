import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sections,
  activeSection,
  columnRatio,
  rhythm,
} from '../utils/teaching.mjs'
test('chapters support runtime nesting and explicit teaching entry pages', () => {
  const groups = sections([
    { no: 1, frontmatter: { layout: 'cover' } },
    {
      no: 3,
      meta: {
        slide: { frontmatter: { sectionStart: true, sectionLabel: '整数' } },
      },
    },
    {
      no: 9,
      meta: { slide: { frontmatter: { layout: 'section' }, title: '浮点数' } },
    },
  ])
  assert.deepEqual(groups, [
    { page: 3, title: '整数' },
    { page: 9, title: '浮点数' },
  ])
  assert.equal(activeSection(groups, 2), -1)
  assert.equal(activeSection(groups, 8), 0)
  assert.equal(activeSection(groups, 9), 1)
})
test('ratio rejects nonfinite, negative, zero and malformed input', () => {
  assert.equal(columnRatio('3:2'), 'minmax(0, 3fr) minmax(0, 2fr)')
  for (const value of ['Infinity:1', '0:1', '-1:2', '1:2:3', 'garbage'])
    assert.equal(columnRatio(value), columnRatio('1:1'))
})
test('page rhythm overrides global options without accepting arbitrary CSS', () => {
  assert.deepEqual(
    rhythm(
      { density: 'compact', flowGap: '12px' },
      { density: 'dense', lineHeight: 1.7 },
    ),
    { density: 'compact', flowGap: '12px', lineHeight: 1.7 },
  )
  assert.deepEqual(
    rhythm({ density: 'x', flowGap: 'url(bad)', lineHeight: 0 }),
    { density: 'normal', flowGap: '18px', lineHeight: 1.55 },
  )
  assert.equal(rhythm({ flowGap: 'none' }).flowGap, '0px')
})
