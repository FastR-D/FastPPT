import { expect, it } from 'vitest'
import { themeFontAliases } from '../../src/fonts/theme-fonts.js'
it('resolves explicit major/minor script fonts without inventing empty script defaults', () => {
  const xml = '<d:theme xmlns:d="http://schemas.openxmlformats.org/drawingml/2006/main"><d:themeElements><d:fontScheme><d:majorFont><d:latin typeface="Heading &amp; Serif"/><d:ea typeface="中文"/><d:cs typeface=""/></d:majorFont><d:minorFont><d:latin typeface="Body"/></d:minorFont></d:fontScheme></d:themeElements></d:theme>'
  expect([...themeFontAliases(xml)]).toEqual([['+mj-lt', 'Heading & Serif'], ['+mj-ea', '中文'], ['+mn-lt', 'Body']])
})
