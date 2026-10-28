import { expect, it } from 'vitest'
import { bindSlidePlaceholder } from '../src/server/placeholder-binding.js'
import { PRESENTATION_NS, parseXml } from '../src/server/slide-xml.js'
const slot = { index: 2, type: 'title' as const, x: 0, y: 0, width: 100, height: 100 }
const xml = `<p:sld xmlns:p="${PRESENTATION_NS}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="7"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody>Content</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
it('adds placeholder linkage without changing content or object geometry', () => {
  const result = bindSlidePlaceholder(xml, '7', slot)
  expect(() => parseXml(result)).not.toThrow()
  expect(result).toContain('type="title" idx="2"')
  expect(result).toContain('<p:spPr/><p:txBody>Content</p:txBody>')
  expect(() => bindSlidePlaceholder(result, '7', slot)).toThrow('already bound')
})
it('rejects absent objects and incompatible picture placeholders', () => {
  expect(() => bindSlidePlaceholder(xml, '8', slot)).toThrow('one top-level')
  expect(() => bindSlidePlaceholder(xml, '7', { ...slot, type: 'pic' })).toThrow('does not match')
})
it('inherits layout geometry only on request and retains unrelated shape styling', () => {
  const transform = '<a:xfrm><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></a:xfrm>'
  const styled = xml.replace('<p:spPr/>', `<p:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${transform}<a:noFill/></p:spPr>`)
  expect(bindSlidePlaceholder(styled, '7', slot)).toContain(transform)
  const inherited = bindSlidePlaceholder(styled, '7', slot, 'layout')
  expect(inherited).not.toContain('a:xfrm')
  expect(inherited).toContain('<a:noFill/>')
  expect(inherited).toContain('Content')
  expect(() => parseXml(inherited)).not.toThrow()
})
it('inherits defined text properties while retaining links, language and unrelated emphasis', () => {
  const styled = xml.replace('<p:txBody>Content</p:txBody>', '<p:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:rPr sz="3000" b="1" i="1" lang="zh-CN"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="Arial"/><a:hlinkClick id="link"/></a:rPr><a:t>Content</a:t></a:r></a:p></p:txBody>')
  const result = bindSlidePlaceholder(styled, '7', { ...slot, textStyle: { fontSize: 24, bold: false, color: 'FFFFFF', fontFamily: 'Inter' } }, 'page', 'layout')
  expect(result).not.toContain('sz="3000"')
  expect(result).not.toContain('b="1"')
  expect(result).not.toContain('typeface="Arial"')
  expect(result).not.toContain('000000')
  expect(result).toContain('i="1" lang="zh-CN"')
  expect(result).toContain('<a:hlinkClick id="link"/>')
  expect(result).toContain('<a:t>Content</a:t>')
  expect(() => parseXml(result)).not.toThrow()
  expect(() => bindSlidePlaceholder(styled, '7', slot, 'page', 'layout')).toThrow('no text defaults')
})
it('removes only the script overrides declared by the layout contract', () => {
  const fonts = '<a:latin typeface="Page Latin"/><a:ea typeface="Page CJK"/><a:cs typeface="Page Arabic"/>'
  const styled = xml.replace('<p:txBody>Content</p:txBody>', `<p:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:pPr><a:defRPr>${fonts}</a:defRPr></a:pPr><a:r><a:rPr lang="zh-CN">${fonts}</a:rPr><a:t>中文 English عربي</a:t></a:r><a:endParaRPr>${fonts}</a:endParaRPr></a:p></p:txBody>`)
  const result = bindSlidePlaceholder(styled, '7', { ...slot, textStyle: { fontFamilies: { ea: 'Layout CJK' } } }, 'page', 'layout')
  expect(result.match(/Page Latin/g)).toHaveLength(3)
  expect(result.match(/Page Arabic/g)).toHaveLength(3)
  expect(result).not.toContain('Page CJK')
  expect(result).toContain('lang="zh-CN"')
  expect(result).toContain('中文 English عربي')
  expect(bindSlidePlaceholder(styled, '7', { ...slot, textStyle: { fontFamilies: { ea: 'Layout CJK' } } })).toContain(fonts)
})
it('inherits paragraph and character properties using each paragraph level without changing its level or content', () => {
  const body = [0, 1, 2].map(level => `<a:p><a:pPr lvl="${level}" algn="ctr" marL="999" indent="444"><a:lnSpc><a:spcPts val="5000"/></a:lnSpc><a:defRPr b="1" sz="3300"/></a:pPr><a:r><a:rPr b="1" sz="3300" lang="zh-CN"/><a:t>Level ${level}</a:t></a:r></a:p>`).join('')
  const styled = xml.replace('<p:txBody>Content</p:txBody>', `<p:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:lstStyle/>${body}</p:txBody>`)
  const result = bindSlidePlaceholder(styled, '7', { ...slot, textStyle: { fontSize: 24, levels: [{ level: 2, textStyle: { bold: false }, paragraph: { marginLeft: 0, lineSpacing: { unit: 'percent', value: 140 } } }] } }, 'page', 'layout')
  expect(result).not.toContain('sz="3300"')
  expect(result.match(/marL="999"/g)).toHaveLength(2)
  expect(result.match(/<a:lnSpc>/g)).toHaveLength(2)
  expect(result.match(/b="1"/g)).toHaveLength(4)
  expect(result.match(/algn="ctr"/g)).toHaveLength(3)
  expect(result.match(/indent="444"/g)).toHaveLength(3)
  for (const level of [0, 1, 2]) {
    expect(result).toContain(`lvl="${level}"`)
    expect(result).toContain(`Level ${level}`)
  }
  expect(() => parseXml(result)).not.toThrow()
})

it('inherits only declared text body properties independently of geometry and character style', () => {
  const body = '<a:bodyPr lIns="900" rIns="800" tIns="700" bIns="600" anchor="ctr" wrap="none" vert="horz"><a:normAutofit fontScale="90000"/></a:bodyPr>'
  const source = xml.replace('<p:txBody>Content</p:txBody>', `<p:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${body}<a:p><a:r><a:rPr sz="3000"/><a:t>Content</a:t></a:r></a:p></p:txBody>`)
  const textBody = { insets: { left: 0, bottom: 100 }, verticalAlign: 'bottom' as const, wrap: true, autoFit: 'none' as const }
  expect(bindSlidePlaceholder(source, '7', { ...slot, textBody })).toContain(body)
  const result = bindSlidePlaceholder(source, '7', { ...slot, textBody }, 'page', 'page', 'layout')
  expect(result).toContain('<a:bodyPr rIns="800" tIns="700" vert="horz"></a:bodyPr>')
  expect(result).toContain('sz="3000"')
  expect(result).toContain('<a:t>Content</a:t>')
  expect(() => parseXml(result)).not.toThrow()
  expect(() => bindSlidePlaceholder(source, '7', slot, 'page', 'page', 'layout')).toThrow('no text body defaults')
})

it('inherits only declared decoration groups at each paragraph level and retains hyperlinks', () => {
  const source = xml.replace('<p:txBody>', '<p:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">').replace('Content', '<a:p><a:pPr lvl="0"><a:defRPr u="sng" strike="sngStrike"><a:uLn w="25400"/><a:uFill><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:uFill></a:defRPr></a:pPr><a:r><a:rPr u="sng" strike="sngStrike"><a:uFillTx/><a:hlinkClick r:id="rId4"/></a:rPr><a:t>One</a:t></a:r><a:br><a:rPr u="sng" strike="sngStrike"/></a:br><a:endParaRPr u="sng" strike="sngStrike"/></a:p><a:p><a:pPr lvl="1"/><a:r><a:rPr u="none" strike="noStrike"/><a:t>Two</a:t></a:r></a:p>')
  const output = bindSlidePlaceholder(source, '7', { ...slot, textStyle: { underline: false, levels: [{ level: 2, textStyle: { strike: true } }] } }, 'page', 'layout')
  expect(output).not.toMatch(/\su="/)
  expect(output).not.toContain('<a:uLn')
  expect(output).not.toContain('<a:uFill')
  expect(output).toContain('<a:hlinkClick r:id="rId4"/>')
  expect(output.match(/strike="sngStrike"/g)).toHaveLength(4)
  expect(output).not.toContain('strike="noStrike"')
  expect(bindSlidePlaceholder(source, '7', { ...slot, textStyle: { strike: false } }, 'page', 'layout')).toContain('<a:uLn w="25400"/>')
  expect(bindSlidePlaceholder(source, '7', slot)).toContain('u="sng" strike="sngStrike"')
})
