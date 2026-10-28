import { expect, it } from 'vitest'
import { nativeMasterLayoutXml } from '../src/server/master-layout.js'
import { parseXml } from '../src/server/slide-xml.js'

it('writes independent placeholder geometry and escaped layout names', () => {
  const slot = { index: 0, type: 'title' as const, x: 100, y: 200, width: 3000, height: 400 }
  const first = nativeMasterLayoutXml({ name: 'Title & body', placeholders: [slot] })
  const second = nativeMasterLayoutXml({ name: 'Centered', placeholders: [{ ...slot, x: 500, width: 6000 }] })
  expect(parseXml(first).children[0]?.attributes.name).toBe('Title & body')
  expect(first).toContain('<p:ph type="title" idx="0"/>')
  expect(first).toContain('<a:off x="100" y="200"/>')
  expect(second).toContain('<a:ext cx="6000" cy="400"/>')
  expect(second).not.toContain('cx="3000"')
  expect(() => nativeMasterLayoutXml({ name: 'Invalid', placeholders: [slot, slot] })).toThrow('duplicate')
})
it('stores native placeholder text defaults with escaped multilingual font names', () => {
  const layout = { name: 'Text', placeholders: [{ index: 0, type: 'title' as const, x: 0, y: 0, width: 100, height: 100, textStyle: { fontFamily: '中文 & Serif', fontSize: 24.5, color: 'aabbcc', bold: false, italic: true } }] }
  const xml = nativeMasterLayoutXml(layout)
  expect(() => parseXml(xml)).not.toThrow()
  const nodes: ReturnType<typeof parseXml>[] = []
  const walk = (node: ReturnType<typeof parseXml>) => { nodes.push(node); node.children.forEach(walk) }
  walk(parseXml(xml))
  const levels = nodes.filter(node => /^lvl[1-9]pPr$/.test(node.local))
  expect(levels).toHaveLength(9)
  for (const level of levels) {
    expect(level.attributes).toMatchObject({ algn: 'l', marL: '0', indent: '0' })
    expect(level.children.find(node => node.local === 'defRPr')?.attributes).toMatchObject({ sz: '2450', b: '0', i: '1', kern: '0' })
    expect(level.children.some(node => node.local === 'buNone')).toBe(true)
  }
  expect(xml).toContain('<a:srgbClr val="AABBCC"/>')
  expect(xml).toContain('<a:ea typeface="中文 &amp; Serif"/>')
  expect(() => nativeMasterLayoutXml({ ...layout, placeholders: [{ ...layout.placeholders[0]!, textStyle: { color: 'red' } }] })).toThrow('text color')
})
it('writes fixed layout objects behind placeholders without placeholder markers', () => {
  const fixed = { name: 'Brand', x: 10, y: 20, width: 300, height: 100, fill: '112233', text: 'A & B\nSecond', fontFamily: 'Inter', fontSize: 12, color: 'FFFFFF' }
  const xml = nativeMasterLayoutXml({ name: 'Brand layout', placeholders: [], fixedObjects: [fixed] })
  expect(() => parseXml(xml)).not.toThrow()
  expect(xml).toContain('name="Brand"')
  expect(xml).toContain('A &amp; B')
  expect(xml).toContain('Second')
  expect(xml).toContain('<a:srgbClr val="112233"/>')
  expect(xml).not.toContain('<p:ph')
  expect(() => nativeMasterLayoutXml({ name: 'Bad', placeholders: [], fixedObjects: [fixed, fixed] })).toThrow('duplicate')
})
it('uses script fonts before the common fallback and leaves undeclared scripts inherited', () => {
  const slot = { index: 0, type: 'body' as const, x: 0, y: 0, width: 100, height: 100 }
  const textStyle = { fontFamily: 'Fallback', fontFamilies: { ea: '中文 & Serif', cs: 'Arabic' } }
  const xml = nativeMasterLayoutXml({ name: 'Scripts', placeholders: [{ ...slot, textStyle }] })
  expect(xml).toContain('<a:latin typeface="Fallback"/><a:ea typeface="中文 &amp; Serif"/><a:cs typeface="Arabic"/>')
  const partial = nativeMasterLayoutXml({ name: 'Scripts', placeholders: [{ ...slot, textStyle: { fontFamilies: { ea: '中文' } } }] })
  expect(partial).toContain('<a:ea typeface="中文"/>')
  expect(partial).not.toContain('<a:latin')
  expect(partial).not.toContain('<a:cs')
  for (const fontFamilies of [{}, { ea: ' ' }])
    expect(() => nativeMasterLayoutXml({ name: 'Scripts', placeholders: [{ ...slot, textStyle: { fontFamilies } }] })).toThrow('script fonts')
})
it('scales placeholder and fixed object geometry from a declared reference canvas', () => {
  const layout = { name: 'Scaled', canvas: { width: 1000, height: 500 }, placeholders: [{ index: 0, type: 'title' as const, x: 100, y: 50, width: 400, height: 100 }], fixedObjects: [{ name: 'Brand', x: 20, y: 30, width: 100, height: 20, text: 'Brand', fontSize: 12 }] }
  const xml = nativeMasterLayoutXml(layout, { width: 2000, height: 1000 })
  expect(xml).toContain('<a:off x="200" y="100"/>')
  expect(xml).toContain('<a:ext cx="800" cy="200"/>')
  expect(xml).toContain('<a:off x="40" y="60"/>')
  expect(xml).toContain('sz="2400"')
  expect(xml).toContain('lIns="0" rIns="0" tIns="0" bIns="0"')
  expect(xml).toContain('<a:spcPct val="120000"/>')
  expect(layout.placeholders[0]?.x).toBe(100)
  expect(() => nativeMasterLayoutXml({ ...layout, canvas: { width: 0, height: 10 } })).toThrow('reference canvas')
})

it('scales text body insets on each canvas axis while preserving explicit zero, alignment and wrapping', () => {
  const textBody = { insets: { left: 0, right: 100, top: 200, bottom: 300 }, verticalAlign: 'bottom' as const, wrap: false, autoFit: 'none' as const }
  const layout = { name: 'Body frame', canvas: { width: 1000, height: 500 }, placeholders: [{ index: 0, type: 'body' as const, x: 0, y: 0, width: 1000, height: 500, textBody }] }
  const xml = nativeMasterLayoutXml(layout, { width: 2000, height: 1500 })
  expect(xml).toContain('<a:bodyPr lIns="0" rIns="200" tIns="600" bIns="900" anchor="b" wrap="none"')
  expect(xml).toContain('<a:noAutofit/>')
  const defaults = nativeMasterLayoutXml({ ...layout, placeholders: [{ ...layout.placeholders[0]!, textBody: { verticalAlign: 'middle' } }] }, { width: 2000, height: 1500 })
  expect(defaults).toContain('lIns="182880" rIns="182880" tIns="137160" bIns="137160" anchor="ctr"')
  expect(layout.placeholders[0]!.textBody).toEqual(textBody)
  for (const body of [{ insets: { left: -1 } }, { insets: { top: Infinity } }, { insets: { left: 51206401 } }])
    expect(() => nativeMasterLayoutXml({ ...layout, placeholders: [{ ...layout.placeholders[0]!, textBody: body }] })).toThrow('insets')
  expect(() => nativeMasterLayoutXml({ ...layout, placeholders: [{ ...layout.placeholders[0]!, type: 'pic' }] })).toThrow('Picture')
})

it('accepts RTL fixed text and emits the same direction in the master layout XML', () => {
  const xml = nativeMasterLayoutXml({ name: 'RTL', placeholders: [], fixedObjects: [{ name: 'Footer', x: 0, y: 0, width: 1000, height: 1000, text: 'שלום 123 ABC', direction: 'rtl' }] })
  const root = parseXml(xml)
  const paragraph = (() => {
    let found: ReturnType<typeof parseXml> | undefined
    const visit = (node: ReturnType<typeof parseXml>) => { if (node.local === 'pPr') found = node; node.children.forEach(visit) }
    visit(root)
    return found
  })()
  expect(paragraph?.attributes).toMatchObject({ rtl: '1', algn: 'l' })
  expect(() => nativeMasterLayoutXml({ name: 'bad', placeholders: [], fixedObjects: [{ name: 'Footer', x: 0, y: 0, width: 100, height: 100, text: 'x', direction: 'vertical' as never }] })).toThrow('direction')
})
