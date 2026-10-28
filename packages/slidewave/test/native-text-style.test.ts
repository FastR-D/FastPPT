import { expect, it } from 'vitest'
import { nativeListStyleXml, nativeBulletXml, resolveNativeTextStyle, scaleNativeTextStyle, type NativeTextStyle } from '../src/server/native-text-style.js'
import { parseXml } from '../src/server/slide-xml.js'

const style: NativeTextStyle = {
  fontFamily: 'Base', fontFamilies: { ea: 'CJK' }, fontSize: 24, bold: true,
  paragraph: { align: 'left', marginLeft: 120000, lineSpacing: { unit: 'percent', value: 125 }, spaceBefore: { unit: 'points', value: 8 } },
  levels: [
    { level: 2, textStyle: { fontSize: 16, bold: false, fontFamilies: { ea: 'Level two' } }, paragraph: { marginLeft: 0, indent: -60000, spaceBefore: { unit: 'points', value: 0 } } },
    { level: 9, textStyle: { fontFamily: 'Ninth' }, paragraph: { align: 'right' } },
  ],
}

it('isolates sparse level defaults, retains explicit zero and false, and resets script faces with a uniform override', () => {
  const original = structuredClone(style)
  expect(resolveNativeTextStyle(style, 1)).toMatchObject({ fontSize: 24, bold: true, fontFamilies: { ea: 'CJK' }, paragraph: { marginLeft: 120000, spaceBefore: { value: 8 } } })
  expect(resolveNativeTextStyle(style, 2)).toMatchObject({ fontFamily: 'Base', fontSize: 16, bold: false, fontFamilies: { ea: 'Level two' }, paragraph: { marginLeft: 0, indent: -60000, spaceBefore: { value: 0 } } })
  expect(resolveNativeTextStyle(style, 3)).toEqual(resolveNativeTextStyle(style, 1))
  expect(resolveNativeTextStyle(style, 9)).toMatchObject({ fontFamily: 'Ninth', fontFamilies: undefined, paragraph: { align: 'right' } })
  expect(style).toEqual(original)
  expect(() => resolveNativeTextStyle(style, 0)).toThrow('level')
})

it('keeps marker choices independent across levels and writes scaled bullet properties in schema order', () => {
  const source: NativeTextStyle = { paragraph: {
    bullet: { kind: 'character', character: '&' }, bulletFont: { kind: 'font', fontFamily: 'Symbol & More' },
    bulletSize: { kind: 'points', value: 12 }, bulletColor: { kind: 'color', color: 'aa1133' }, indent: -200000,
  }, levels: [{ level: 2, paragraph: { bullet: { kind: 'none' }, bulletColor: { kind: 'text' }, bulletSize: { kind: 'percent', value: 80 } } }, { level: 9, paragraph: { bulletFont: { kind: 'text' } } }] }
  const scaled = scaleNativeTextStyle(source, 2)
  const xml = nativeListStyleXml(scaled)
  const levels = parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</root>`).children[0]!.children
  expect(levels[0]!.children.map(node => node.local)).toEqual(['lnSpc', 'spcBef', 'spcAft', 'buClr', 'buSzPts', 'buFont', 'buChar', 'defRPr'])
  expect(levels[0]!.children.find(node => node.local === 'buChar')!.attributes.char).toBe('&')
  expect(levels[0]!.children.find(node => node.local === 'buFont')!.attributes.typeface).toBe('Symbol & More')
  expect(levels[0]!.children.find(node => node.local === 'buSzPts')!.attributes.val).toBe('2400')
  expect(levels[1]!.children.map(node => node.local)).toContain('buNone')
  expect(levels[1]!.children.find(node => node.local === 'buSzPct')!.attributes.val).toBe('80000')
  expect(levels[1]!.children.map(node => node.local)).toContain('buClrTx')
  expect(levels[8]!.children.map(node => node.local)).toContain('buFontTx')
  expect(source.paragraph!.bulletSize).toEqual({ kind: 'points', value: 12 })
  for (const bullet of [{ kind: 'character', character: '' }, { kind: 'character', character: 'ab' }, { kind: 'character', character: '\t' }, { kind: 'none', character: '•' }, null]) expect(() => nativeBulletXml({ bullet } as never)).toThrow()
  for (const bulletSize of [{ kind: 'text', value: 12 }, { kind: 'percent', value: 24 }, { kind: 'points', value: Infinity }]) expect(() => nativeBulletXml({ bulletSize } as never)).toThrow()
  expect(nativeBulletXml({ bullet: { kind: 'character', character: '◆' } })).toContain('<a:buFontTx/><a:buChar char="◆"/>')
})

it('writes distinct paragraph levels and scales lengths without changing percentages or the input', () => {
  const scaled = scaleNativeTextStyle(style, 2)
  expect(scaled).toMatchObject({ fontSize: 48, paragraph: { marginLeft: 240000, lineSpacing: { value: 125 }, spaceBefore: { value: 16 } }, levels: [{ level: 2, textStyle: { fontSize: 32 }, paragraph: { marginLeft: 0, indent: -120000, spaceBefore: { value: 0 } } }, { level: 9 }] })
  const xml = nativeListStyleXml(scaled)
  const levels = parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</root>`).children[0]!.children
  expect(levels).toHaveLength(9)
  expect(levels[1]!.attributes).toMatchObject({ marL: '0', indent: '-120000' })
  expect(levels[2]!.attributes).toMatchObject({ marL: '240000', indent: '0' })
  expect(levels[8]!.attributes.algn).toBe('r')
  expect(xml).toContain('typeface="Level two"')
  expect(xml).toContain('<a:spcPct val="125000"/>')
  expect(style.fontSize).toBe(24)
  for (const bad of [{ levels: [{ level: 0 }] }, { levels: [{ level: 2 }, { level: 2 }] }, { paragraph: { marginLeft: -1 } }, { paragraph: { spaceBefore: { unit: 'points' as const, value: Infinity } } }])
    expect(() => nativeListStyleXml(bad)).toThrow()
})

it('inherits and cancels underline and strike independently without scaling or weakening unsupported values', () => {
  const input: NativeTextStyle = { underline: true, strike: true, levels: [{ level: 2, textStyle: { underline: false } }, { level: 3, textStyle: { strike: false } }] }
  expect(resolveNativeTextStyle(input, 2)).toMatchObject({ underline: false, strike: true })
  expect(resolveNativeTextStyle(input, 3)).toMatchObject({ underline: true, strike: false })
  expect(scaleNativeTextStyle(input, 2)).toEqual(input)
  const root = parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${nativeListStyleXml(input)}</root>`)
  const defaults = root.children[0]!.children.map(level => level.children.find(child => child.local === 'defRPr')!)
  expect(defaults.slice(0, 3).map(node => [node.attributes.u, node.attributes.strike])).toEqual([['sng', 'sngStrike'], ['none', 'sngStrike'], ['sng', 'noStrike']])
  expect(defaults[0]!.children.map(node => node.local)).toEqual(['uLnTx', 'uFillTx'])
  for (const underline of ['double', 'none', 0, null]) expect(() => nativeListStyleXml({ underline } as never)).toThrow('Invalid text underline')
  for (const strike of ['double', 'noStrike', 0, null]) expect(() => nativeListStyleXml({ levels: [{ level: 2, textStyle: { strike } }] } as never)).toThrow('Invalid text strike')
})

it('serializes and validates paragraph direction without changing physical margins', () => {
  const input: NativeTextStyle = {
    fontFamily: 'Noto Sans Arabic',
    paragraph: { direction: 'rtl', align: 'right', marginLeft: 120000, marginRight: 240000, indent: -60000 },
    levels: [{ level: 2, paragraph: { direction: 'ltr', align: 'left' } }],
  }
  const xml = nativeListStyleXml(input)
  const root = parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</root>`)
  const levels = root.children[0]!.children
  expect(levels[0]!.attributes).toMatchObject({ rtl: '1', algn: 'r', marL: '120000', marR: '240000', indent: '-60000' })
  expect(levels[1]!.attributes).toMatchObject({ rtl: '0', algn: 'l', marL: '120000', marR: '240000', indent: '-60000' })
  expect(scaleNativeTextStyle(input, 2).paragraph).toMatchObject({ direction: 'rtl', marginLeft: 240000, marginRight: 480000, indent: -120000 })
  expect(() => nativeListStyleXml({ paragraph: { direction: 'vertical' } } as never)).toThrow('direction')
})
