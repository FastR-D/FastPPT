import { expect, it } from 'vitest'
import { extractBackground, resolveBackground, resolveBackgroundAppearance } from '../src/backgrounds.js'
import { extractTheme } from '../src/theme.js'
import { PRESENTATION_NS, DRAWING_NS } from '../src/relationships.js'

const xml = (background: string) => `<p:sld xmlns:p="${PRESENTATION_NS}" xmlns:a="${DRAWING_NS}"><p:cSld>${background}<p:spTree/></p:cSld></p:sld>`

it('preserves explicit no-fill and style references and resolves nearest background', () => {
  const master = extractBackground(xml('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="123456"/></a:solidFill></p:bgPr></p:bg>'), 'master.xml')!
  const layout = extractBackground(xml('<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>'), 'layout.xml')!
  const page = extractBackground(xml('<p:bg><p:bgPr><a:noFill/></p:bgPr></p:bg>'), 'page.xml')!
  expect(resolveBackground('page.xml', [master], 'layout.xml', 'master.xml')).toMatchObject({ inherited: true, source: { part: 'master.xml' } })
  expect(resolveBackground('page.xml', [master, layout], 'layout.xml', 'master.xml')).toMatchObject({ source: { part: 'layout.xml', kind: 'style-reference', attributes: { idx: '1001' } } })
  expect(resolveBackground('page.xml', [master, layout, page], 'layout.xml', 'master.xml')).toMatchObject({ inherited: false, source: { part: 'page.xml' } })
  expect(page.sourceXml).toContain('<a:noFill/>')
  expect(page.namespaces.a).toBe(DRAWING_NS)
  expect(extractBackground(xml(''), 'empty.xml')).toBeUndefined()
  expect(resolveBackground('page.xml', [])).toMatchObject({ status: 'unspecified' })
})

it('rejects ambiguous backgrounds rather than silently selecting the first', () => {
  expect(() => extractBackground(xml('<p:bg><p:bgPr/><p:bgRef idx="1"/></p:bg>'), 'bad.xml')).toThrow('Invalid background')
})

it('resolves bgRef styles through the theme background list and page color map', () => {
  const master = extractBackground(xml('<p:bg><p:bgPr><a:noFill/></p:bgPr></p:bg>'), 'master.xml')!
  const page = extractBackground(xml('<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>'), 'page.xml')!
  const theme = extractTheme(`<a:theme xmlns:a="${DRAWING_NS}"><a:themeElements><a:clrScheme><a:lt1><a:srgbClr val="F0F0F0"/></a:lt1><a:bg1><a:srgbClr val="112233"/></a:bg1></a:clrScheme><a:fmtScheme><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`, 'theme.xml')
  expect(resolveBackgroundAppearance('page.xml', [master, page], theme, { bg1: 'lt1' }, undefined, 'master.xml')).toMatchObject({ kind: 'solid', styleIndex: 1001, color: { value: '#F0F0F0' }, sourcePart: 'page.xml' })
})

it('classifies direct gradient and explicit no-fill backgrounds', () => {
  const page = extractBackground(xml('<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst><a:lin ang="18000000"/></a:gradFill></p:bgPr></p:bg>'), 'page.xml')!
  const theme = extractTheme(`<a:theme xmlns:a="${DRAWING_NS}"><a:themeElements><a:clrScheme/></a:themeElements></a:theme>`, 'theme.xml')
  expect(resolveBackgroundAppearance('page.xml', [page], theme)).toMatchObject({ kind: 'gradient', angle: 300, stops: [{ position: 0, color: { value: '#000000' } }, { position: 1, color: { value: '#FFFFFF' } }] })
})
