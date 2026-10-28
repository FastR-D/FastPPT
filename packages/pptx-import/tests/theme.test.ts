import { expect, it } from 'vitest'
import { extractTheme, extractThemeOverride } from '../src/theme.js'
import { DRAWING_NS } from '../src/relationships.js'

it('preserves semantic theme colors, script fonts, empty fallback faces and background style references', () => {
  const xml = `<a:theme xmlns:a="${DRAWING_NS}" name="Source Brand"><a:themeElements>
    <a:clrScheme name="Brand"><a:dk1><a:sysClr val="windowText" lastClr="112233"/></a:dk1><a:accent1><a:srgbClr val="ABCDEF"><a:alpha val="50000"/></a:srgbClr></a:accent1></a:clrScheme>
    <a:fontScheme name="Bilingual"><a:majorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface="Arabic"/><a:font script="Hans" typeface="Source Han Sans SC"/><a:font script="Jpan" typeface="Noto Sans JP"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="Styles"><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill/></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements></a:theme>`
  const theme = extractTheme(xml, 'custom/theme.xml')
  expect(theme).toMatchObject({ part: 'custom/theme.xml', name: 'Source Brand', colors: [{ role: 'dk1', kind: 'sysClr', attributes: { val: 'windowText', lastClr: '112233' } }, { role: 'accent1', attributes: { val: 'ABCDEF' }, transforms: [{ kind: 'alpha', attributes: { val: '50000' } }] }], majorFonts: { latin: { typeface: 'Inter' }, eastAsian: { typeface: '' }, scripts: [{ script: 'Hans', typeface: 'Source Han Sans SC' }, { script: 'Jpan', typeface: 'Noto Sans JP' }] }, minorFonts: { latin: { typeface: 'Arial' } }, backgroundStyles: [{ index: 1001, kind: 'solidFill' }, { index: 1002, kind: 'gradFill' }] })
})

it('extracts a relationship-backed DrawingML themeOverride as separate source evidence', () => {
  const xml = `<a:themeOverride xmlns:a="${DRAWING_NS}" name="Slide Override"><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="00FF00"/></a:accent1></a:clrScheme></a:themeElements></a:themeOverride>`
  expect(extractThemeOverride(xml, 'ppt/theme/themeOverride1.xml')).toMatchObject({
    part: 'ppt/theme/themeOverride1.xml#themeOverride',
    overridePart: 'ppt/theme/themeOverride1.xml',
    name: 'Slide Override',
    colors: [{ role: 'accent1', kind: 'srgbClr', attributes: { val: '00FF00' } }],
  })
})
