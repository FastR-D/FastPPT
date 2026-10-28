import { expect, it } from 'vitest'
import { layoutFontRuns } from '../../src/fonts/layout-fonts.js'
const ns = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
it('uses the matching slot and paragraph level then applies explicit run overrides', () => {
  const layout = `<p:sldLayout ${ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph idx="2"/></p:nvPr></p:nvSpPr><p:txBody><a:lstStyle><a:lvl2pPr><a:defRPr b="1"><a:latin typeface="Inherited"/><a:ea typeface="中文"/></a:defRPr></a:lvl2pPr></a:lstStyle></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`
  const slide = `<p:sld ${ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph idx="2"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:pPr lvl="1"/><a:r><a:rPr b="0"><a:latin typeface="Local"/></a:rPr><a:t>内容 &amp; Text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const runs = layoutFontRuns(slide, layout)
  expect(runs).toContain('b="0"')
  expect(runs).toContain('typeface="Local"')
  expect(runs).toContain('typeface="中文"')
  expect(runs).not.toContain('Inherited')
  expect(runs).toContain('内容 &amp; Text')
  expect(layoutFontRuns(slide.replace('idx="2"', 'idx="3"'), layout)).not.toContain('中文')
})
it('inherits master title style through the layout placeholder role', () => {
  const layout = `<p:sldLayout ${ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph idx="5" type="title"/></p:nvPr></p:nvSpPr></p:sp></p:spTree></p:cSld></p:sldLayout>`
  const slide = `<p:sld ${ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph idx="5"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const master = `<p:sldMaster ${ns}><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr b="1"><a:latin typeface="Master font"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:otherStyle><a:lvl1pPr><a:defRPr><a:latin typeface="Other font"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`
  const result = layoutFontRuns(slide, layout, master)
  expect(result).toContain('typeface="Master font"')
  expect(result).toContain('b="1"')
  expect(result).not.toContain('Other font')
})

it('collects inherited bullet glyphs in their symbol or first-visible-run font without rewriting slide text', () => {
  const layout = `<p:sldLayout ${ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph idx="2" type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:lstStyle><a:defPPr><a:buFont typeface="Symbol"/><a:buChar char="◆"/><a:defRPr><a:latin typeface="Latin"/><a:ea typeface="CJK"/></a:defRPr></a:defPPr><a:lvl2pPr><a:buFontTx/></a:lvl2pPr></a:lstStyle></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`
  const slide = `<p:sld ${ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph idx="2"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:pPr lvl="1"/><a:r><a:t> </a:t></a:r><a:r><a:rPr b="1"/><a:t>&#20013;文</a:t></a:r></a:p><a:p><a:pPr/><a:r><a:t>Symbol body</a:t></a:r></a:p><a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>Disabled</a:t></a:r></a:p><a:p><a:pPr/><a:r><a:t> </a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const result = layoutFontRuns(slide, layout)
  const markers = result.match(/<a:r><a:rPr[^>]*>[\s\S]*?<a:t>◆<\/a:t><\/a:r>/g) ?? []
  expect(result.match(/<a:t>◆<\/a:t>/g)).toHaveLength(2)
  expect(markers[0]).toContain('<a:latin typeface="CJK"/>')
  expect(markers[0]).toContain('b="1"')
  expect(markers[1]).toContain('<a:latin typeface="Symbol"/>')
  expect(slide).not.toContain('◆')
})

it('collects the complete small numbering alphabet for inherited and restarted lists', () => {
  const slide = `<p:sld ${ns}><p:cSld><p:spTree><p:sp><p:txBody><a:lstStyle><a:lvl1pPr><a:buFont typeface="Numbers"/><a:buAutoNum type="alphaUcPeriod" startAt="27"/></a:lvl1pPr><a:lvl2pPr><a:buAutoNum type="romanLcParenBoth"/><a:defRPr><a:latin typeface="Body"/></a:defRPr></a:lvl2pPr></a:lstStyle><a:p><a:r><a:t>First</a:t></a:r></a:p><a:p><a:pPr><a:buAutoNum type="arabicParenR" startAt="1"/></a:pPr><a:r><a:t>Restart</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>Roman</a:t></a:r></a:p><a:p><a:r><a:t> </a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const result = layoutFontRuns(slide)
  expect(result).toContain('<a:t>ABCDEFGHIJKLMNOPQRSTUVWXYZ.</a:t>')
  expect(result).toContain('<a:t>0123456789)</a:t>')
  expect(result).toContain('<a:t>ivxlcdm()</a:t>')
  expect(result.match(/<a:t>ABCDEFGHIJKLMNOPQRSTUVWXYZ\.<\/a:t>/g)).toHaveLength(1)
  expect(result).toContain('typeface="Numbers"')
  expect(result).toContain('typeface="Body"')
  expect(slide).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
})
