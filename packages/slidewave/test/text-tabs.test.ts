import { expect, it } from 'vitest'
import { resolveTextTab, validateTextTabs, validateDecimalTab, validateDecimalTabDeclaration, decimalTabCompatibility, type DecimalTab } from '../src/primitives/text-tabs.mjs'
import { nativeListStyleXml, resolveNativeTextStyle, scaleNativeTextStyle } from '../src/server/native-text-style.js'
import { bindSlidePlaceholder } from '../src/server/placeholder-binding.js'
import type { NativeTextStyle } from '../src/server/native-text-style.js'

it('resolves explicit left stops before the default grid without replacing tabs with spaces', () => {
  const stops = [{ position: 150, align: 'left' as const }, { position: 262.5, align: 'left' as const }]
  expect([12, 150, 262.5, 400].map(cursor => resolveTextTab(cursor, 72, stops, 0).position)).toEqual([150, 262.5, 288, 432])
  expect(resolveTextTab(149.984375, 72, stops, 0).position).toBe(262.5)
  expect(resolveTextTab(-8, 72, [], 0).position).toBe(0)
  expect(resolveTextTab(-138, 72, [], 0).position).toBe(0)
  expect(resolveTextTab(0, 72, [], 0).position).toBe(72)
  expect(resolveTextTab(0, 0, stops, 0).position).toBe(150)
  expect(() => resolveTextTab(300, 0, stops, 0).position).toThrow('zero default')
  expect(() => resolveTextTab(10, 72, [{ position: 100, align: 'decimal' }], 0).position).toThrow('separator convention')
})

it('aligns complete fields and clamps collisions without jumping to another stop', () => {
  expect(resolveTextTab(12, 72, [{ position: 150, align: 'center' }], 24)).toEqual({ position: 150, align: 'center', width: 126 })
  expect(resolveTextTab(12, 72, [{ position: 150, align: 'right' }], 24)).toEqual({ position: 150, align: 'right', width: 114 })
  expect(resolveTextTab(12, 72, [{ position: 150, align: 'center' }], 288).width).toBe(0)
  expect(resolveTextTab(12, 72, [{ position: 30, align: 'right' }, { position: 150, align: 'right' }], 24)).toEqual({ position: 30, align: 'right', width: 0 })
  expect(resolveTextTab(150, 72, [{ position: 150, align: 'right' }], 24)).toEqual({ position: 216, align: 'left', width: 66 })
  expect(resolveTextTab(12, 0, [{ position: 150, align: 'right' }], 0).width).toBe(138)
  expect(() => resolveTextTab(12, 72, [{ position: 150, align: 'decimal' }], 24)).toThrow('separator convention')
})

it('aligns measured decimal anchors and rejects missing or impossible measurements', () => {
  const stops = [{ position: 150, align: 'decimal' as const }]
  expect(resolveTextTab(12, 72, stops, 60, 24).width).toBe(114)
  expect(resolveTextTab(12, 72, stops, 60, 60).width).toBe(78)
  expect(resolveTextTab(12, 72, stops, 60, 0).width).toBe(138)
  expect(resolveTextTab(12, 72, stops, 0, 0).width).toBe(138)
  expect(resolveTextTab(12, 72, stops, 200, 160).width).toBe(0)
  expect(resolveTextTab(150, 72, stops, 60, 24)).toEqual({ position: 216, align: 'left', width: 66 })
  for (const offset of [undefined, NaN, -1, 61]) expect(() => resolveTextTab(12, 72, stops, 60, offset)).toThrow('measured separator')
})

it('keeps declarations independent of stop inheritance and scaling without fabricating a DrawingML separator', () => {
  const declaration: DecimalTab = { separator: '.', targetProfile: 'libreoffice-7.3.7.2-linux-en-US', provenance: 'user-declared', reason: 'Author confirms period alignment' }
  const style: NativeTextStyle = { paragraph: { decimalTab: declaration, tabStops: [{ position: 100000, align: 'decimal' }] }, levels: [
    { level: 2, paragraph: { decimalTab: null } },
    { level: 3, paragraph: { decimalTab: { ...declaration, separator: ',', targetProfile: 'libreoffice-7.3.7.2-linux-de-DE' } } },
  ] }
  const scaled = scaleNativeTextStyle(style, 2)
  expect(resolveNativeTextStyle(scaled, 1).paragraph).toEqual({ decimalTab: declaration, tabStops: [{ position: 200000, align: 'decimal' }] })
  expect(resolveNativeTextStyle(scaled, 2).paragraph?.decimalTab).toBeNull()
  expect(resolveNativeTextStyle(scaled, 3).paragraph?.decimalTab?.separator).toBe(',')
  const xml = nativeListStyleXml(style)
  expect(xml).toContain('algn="dec"')
  expect(xml).not.toContain('separator')
  expect(xml).not.toContain('user-declared')
  expect(decimalTabCompatibility(declaration)).toContain('known indent differences')
  expect(decimalTabCompatibility(null)).toContain('undeclared')
  const manifest = { version: 1, sourcePptxSha256: 'a'.repeat(64), decimalTab: declaration }
  expect(() => validateDecimalTabDeclaration(manifest, 'a'.repeat(64))).not.toThrow()
  expect(() => validateDecimalTabDeclaration(manifest, 'b'.repeat(64))).toThrow('source PPTX')
  for (const value of [undefined, null, {}, { ...declaration, separator: ',' }, { ...declaration, targetProfile: 'en-US' }, { ...declaration, targetProfile: '__proto__' }, { ...declaration, provenance: 'extracted' }, { ...declaration, reason: ' ' }, { ...declaration, reportSha256: 'a'.repeat(64) }]) expect(() => validateDecimalTab(value)).toThrow('measured separator')
})

it('preserves zero/default/empty-list intent and writes ordered DrawingML tab properties', () => {
  const style: NativeTextStyle = { paragraph: { defaultTabSize: 500000, tabStops: [{ position: 0, align: 'left' }, { position: 800000, align: 'decimal' }] }, levels: [{ level: 2, paragraph: { defaultTabSize: 0, tabStops: [] } }] }
  const original = structuredClone(style)
  const scaled = scaleNativeTextStyle(style, 2)
  expect(resolveNativeTextStyle(scaled, 1).paragraph).toEqual({ defaultTabSize: 1000000, tabStops: [{ position: 0, align: 'left' }, { position: 1600000, align: 'decimal' }] })
  expect(resolveNativeTextStyle(scaled, 2).paragraph).toEqual({ defaultTabSize: 0, tabStops: [] })
  expect(resolveNativeTextStyle(scaled, 3).paragraph).toEqual(resolveNativeTextStyle(scaled, 1).paragraph)
  expect(style).toEqual(original)
  const xml = nativeListStyleXml(style)
  expect(xml).toContain('defTabSz="0"')
  expect(xml).toContain('<a:buNone/><a:tabLst><a:tab pos="0" algn="l"/><a:tab pos="800000" algn="dec"/></a:tabLst><a:defRPr')
  expect(xml).toContain('<a:tabLst></a:tabLst>')
  expect(nativeListStyleXml({ paragraph: {} })).not.toContain('tabLst')
  for (const value of [{ defaultTabSize: -1 }, { defaultTabSize: 1.5 }, { tabStops: [{ position: 100, align: 'left' }, { position: 100, align: 'right' }] }, { tabStops: [{ position: 0, align: 'unknown' }] }, { tabStops: [{ position: Infinity, align: 'left' }] }]) expect(() => validateTextTabs(value as never)).toThrow()
})

it('inherits default spacing and explicit stop lists independently, including empty lists', () => {
  const ns = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
  const xml = `<p:sld ${ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="0" defTabSz="700000"><a:tabLst><a:tab pos="800000" algn="l"/></a:tabLst></a:pPr><a:r><a:t>A&#9;B</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const slot = { index: 0, type: 'body' as const, x: 0, y: 0, width: 1000000, height: 1000000 }
  const spacing = bindSlidePlaceholder(xml, '2', { ...slot, textStyle: { paragraph: { defaultTabSize: 0 } } }, 'page', 'layout')
  expect(spacing).not.toContain('defTabSz=')
  expect(spacing).toContain('tabLst')
  const cleared = bindSlidePlaceholder(xml, '2', { ...slot, textStyle: { paragraph: { tabStops: [] } } }, 'page', 'layout')
  expect(cleared).toContain('defTabSz="700000"')
  expect(cleared).not.toContain('tabLst')
  expect(cleared).toContain('A&#9;B')
})
