import { expect, it } from 'vitest'
import JSZip from 'jszip'
import { HtmlDeckSnapshotSchema, type HtmlDeckSnapshot, type HtmlTextStyle } from '../src/snapshot.js'
import { htmlDeckToPresentation } from '../src/slidev/render.js'
import { bindSlidePlaceholder } from '../src/server/placeholder-binding.js'
import { parseXml } from '../src/server/slide-xml.js'
import { applyTextParagraphs } from '../src/server/text-paragraphs.js'

const style: HtmlTextStyle = { fontFamily: 'Arial', fontSizePx: 24, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, letterSpacingPx: 0, color: { hex: '112233', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr', language: 'zh-CN' }
function fixture(): HtmlDeckSnapshot {
  const paragraphs = [
    { level: 1, style, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs: [
      { text: 'Plain ', style },
      { text: '中英 & link', style: { ...style, fontWeight: 700, fontStyle: 'italic' as const, fontFamilies: { ea: 'Noto Serif SC' } }, hyperlink: 'https://example.com/?a=1&b=2' },
    ] },
    { level: 2, style: { ...style, fontSizePx: 16 }, marginLeftPx: 96, marginRightPx: 12, indentPx: -24, spaceBeforePx: 4, spaceAfterPx: 6, runs: [] },
    { level: 3, style, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs: [{ text: '\nSoft\n\n尾行\n', style }] },
    { level: 1, style, marginLeftPx: 0, marginRightPx: 0, indentPx: 0, spaceBeforePx: 0, spaceAfterPx: 0, runs: [{ text: 'Final', style }] },
  ]
  return HtmlDeckSnapshotSchema.parse({ version: 1, source: 'html', warnings: [], slides: [{ version: 1, id: '1', width: 960, height: 540, warnings: [], elements: [{
    kind: 'text', id: 'body', source: { tag: 'div', path: 'root/body', anchor: 'body' },
    box: { x: 50, y: 50, width: 700, height: 400 }, order: 0, zIndex: 0, opacity: 1,
    text: paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n'), style, paragraphs,
  }] }] })
}
const nodes = (xml: string, local: string) => {
  const result: ReturnType<typeof parseXml>[] = []
  const visit = (node: ReturnType<typeof parseXml>) => {
    if (node.local === local) result.push(node)
    node.children.forEach(visit)
  }
  visit(parseXml(xml))
  return result
}

it('writes one editable shape with independent paragraphs, empty paragraphs, soft breaks, fonts and links', async () => {
  const input = fixture(), original = structuredClone(input)
  const result = htmlDeckToPresentation(input, { layout: 'LAYOUT_16x9' })
  expect(result.objects).toMatchObject([{ nativeCount: 1, imageCount: 0, status: 'native', fonts: { requested: ['Arial', 'Noto Serif SC'], substituted: false } }])
  const zip = await JSZip.loadAsync(await result.presentation.toArrayBuffer())
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
  expect(nodes(xml, 'sp')).toHaveLength(1)
  const paragraphs = nodes(xml, 'p')
  expect(paragraphs).toHaveLength(4)
  expect(paragraphs.map(p => p.children.filter(child => child.local === 'pPr').length)).toEqual([1, 1, 1, 1])
  expect(nodes(xml, 'pPr').map(p => p.attributes.lvl)).toEqual(['0', '1', '2', '0'])
  expect(nodes(xml, 'pPr')[1]!.attributes).toMatchObject({ marL: '914400', marR: '114300', indent: '-228600' })
  expect(nodes(xml, 'pPr')[2]!.attributes).toMatchObject({ marL: '0', marR: '0', indent: '0' })
  expect(nodes(xml, 'br')).toHaveLength(4)
  expect(nodes(xml, 'rPr')[0]!.attributes).toMatchObject({ b: '0', i: '0' })
  expect(nodes(xml, 'rPr').some(node => node.attributes.b === '1' && node.attributes.i === '1')).toBe(true)
  expect(nodes(xml, 'endParaRPr').map(node => node.attributes.sz)).toEqual(['1800', '1200', '1800', '1800'])
  expect(xml).toContain('typeface="Noto Serif SC"')
  expect(xml).toContain(' &amp; link')
  expect(xml).not.toContain('Final\n')
  expect(await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')).toContain('https://example.com/?a=1&amp;b=2')
  expect(input).toEqual(original)
  const id = nodes(xml, 'sp')[0]!.children[0]!.children.find(node => node.local === 'cNvPr')!.attributes.id!
  const bound = bindSlidePlaceholder(xml, id, { index: 0, type: 'body', x: 0, y: 0, width: 9144000, height: 5143500, textStyle: { fontSize: 24, levels: [{ level: 2, paragraph: { marginLeft: 0 } }] } }, 'layout', 'layout')
  expect(nodes(bound, 'ph')).toHaveLength(1)
  expect(nodes(bound, 'pPr').map(p => p.attributes.lvl)).toEqual(['0', '1', '2', '0'])
  expect(nodes(bound, 'pPr')[1]!.attributes.marL).toBeUndefined()
  expect(nodes(bound, 'pPr')[2]!.attributes.marL).toBe('0')
  expect(nodes(bound, 'rPr').every(node => node.attributes.sz === undefined)).toBe(true)
  expect(nodes(bound, 'hlinkClick')).toHaveLength(nodes(xml, 'hlinkClick').length)
  expect(() => applyTextParagraphs(xml, 'missing', [])).toThrow('one native shape')
  expect(() => applyTextParagraphs(xml, nodes(xml, 'sp')[0]!.children[0]!.children[0]!.attributes.name!, [])).toThrow('paragraph count changed')
})

it('rejects mismatched text bodies instead of silently losing captured content', () => {
  const input = fixture()
  const element = input.slides[0]!.elements[0]!
  if (element.kind !== 'text') throw new Error('Expected text fixture')
  element.text += ' missing'
  expect(htmlDeckToPresentation(input).objects[0]).toMatchObject({ status: 'missing', reasons: ['Text frame content does not match its paragraphs.'] })
})

it('preserves language on paragraph defaults, empty paragraphs, soft breaks and individual linked runs', async () => {
  const input = fixture(), element = input.slides[0]!.elements[0]!
  if (element.kind !== 'text') throw new Error('Expected text frame')
  const paragraphs = element.paragraphs!
  paragraphs[0]!.runs[1]!.style = { ...paragraphs[0]!.runs[1]!.style, language: 'ja-JP', alternativeLanguage: '' }
  paragraphs[1]!.style = { ...paragraphs[1]!.style, language: '', alternativeLanguage: 'en-GB' }
  paragraphs[2]!.runs[0]!.style = { ...style, language: 'de-DE', alternativeLanguage: 'fr-FR' }
  const result = htmlDeckToPresentation(HtmlDeckSnapshotSchema.parse(input))
  const zip = await JSZip.loadAsync(await result.presentation.toArrayBuffer())
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
  const languages = (local: string) => nodes(xml, local).map(node => [node.attributes.lang, node.attributes.altLang])
  expect(languages('defRPr')).toEqual([['zh-CN', undefined], ['', 'en-GB'], ['zh-CN', undefined], ['zh-CN', undefined]])
  expect(languages('endParaRPr')).toEqual(languages('defRPr'))
  expect(languages('rPr').filter(([lang]) => lang === 'ja-JP')).toEqual([['ja-JP', ''], ['ja-JP', '']])
  expect(languages('rPr').filter(([lang]) => lang === 'de-DE').every(([, alternate]) => alternate === 'fr-FR')).toBe(true)
  expect(xml).not.toContain('x-fastppt-')
  expect(xml).not.toContain('en-US')
  expect(nodes(xml, 'br')).toHaveLength(4)
  expect(nodes(xml, 'hlinkClick')).not.toHaveLength(0)
})

it('exports marker semantics without adding body text and inherits only declared bullet property groups', async () => {
  const input = fixture(), element = input.slides[0]!.elements[0]!
  if (element.kind !== 'text') throw new Error('Expected text frame')
  Object.assign(element.paragraphs![0]!, { bullet: { kind: 'character', character: '◆' }, bulletFont: { kind: 'font', fontFamily: 'Symbol' }, bulletSize: { kind: 'pixels', value: 20 }, bulletColor: { kind: 'color', color: 'CC3300' } })
  Object.assign(element.paragraphs![1]!, { bullet: { kind: 'character', character: '•' }, bulletFont: { kind: 'text' }, bulletSize: { kind: 'percent', value: 75 }, bulletColor: { kind: 'text' } })
  const result = htmlDeckToPresentation(HtmlDeckSnapshotSchema.parse(input), { layout: 'LAYOUT_16x9' })
  expect(result.objects[0]!.fonts).toMatchObject({ requested: ['Arial', 'Noto Serif SC', 'Symbol'], emitted: expect.arrayContaining(['Symbol']) })
  const zip = await JSZip.loadAsync(await result.presentation.toArrayBuffer())
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
  expect(nodes(xml, 'sp')).toHaveLength(1)
  expect(nodes(xml, 'buChar').map(node => node.attributes.char)).toEqual(['◆', '•'])
  expect(nodes(xml, 'buSzPts')[0]!.attributes.val).toBe('1500')
  expect(xml).not.toContain('<a:t>◆')
  expect(xml).not.toContain('<a:t>•')
  const id = nodes(xml, 'sp')[0]!.children[0]!.children.find(node => node.local === 'cNvPr')!.attributes.id!
  const bound = bindSlidePlaceholder(xml, id, { index: 0, type: 'body', x: 0, y: 0, width: 9144000, height: 5143500, textStyle: { paragraph: { bulletColor: { kind: 'text' } }, levels: [{ level: 2, paragraph: { bullet: { kind: 'none' }, bulletSize: { kind: 'text' } } }] } }, 'page', 'layout')
  expect(nodes(bound, 'buChar').map(node => node.attributes.char)).toEqual(['◆'])
  expect(nodes(bound, 'buClr')).toHaveLength(0)
  expect(nodes(bound, 'buClrTx')).toHaveLength(0)
  expect(nodes(bound, 'buSzPts')[0]!.attributes.val).toBe('1500')
  expect(nodes(bound, 'buSzPct')).toHaveLength(0)
  expect(nodes(bound, 'buFont')[0]!.attributes.typeface).toBe('Symbol')
  expect(nodes(bound, 'pPr').map(node => node.attributes.lvl)).toEqual(['0', '1', '2', '0'])
})

it('retains a captured frame with independent horizontal and vertical inset scaling', async () => {
  const input = fixture()
  const element = input.slides[0]!.elements[0]!
  if (element.kind !== 'text') throw new Error('Expected text fixture')
  element.textFrame = { insetsPx: { left: 0, right: 20, top: 30, bottom: 40 }, wrap: false }
  element.verticalAlign = 'bottom'
  const snapshot = HtmlDeckSnapshotSchema.parse(input)
  const result = htmlDeckToPresentation(snapshot, { layout: { width: 10, height: 10 } })
  const zip = await JSZip.loadAsync(await result.presentation.toArrayBuffer())
  const body = nodes(await zip.file('ppt/slides/slide1.xml')!.async('string'), 'bodyPr')[0]!
  expect(body.attributes).toMatchObject({ lIns: '0', rIns: '190500', tIns: '508000', bIns: '677333', anchor: 'b', wrap: 'none' })
  expect(snapshot.slides[0]!.elements[0]).toMatchObject({ textFrame: element.textFrame })
})

it('writes sequential automatic lists as one native frame with explicit restart evidence', async () => {
  const input = fixture(), element = input.slides[0]!.elements[0]!
  if (element.kind !== 'text') throw new Error('Expected text frame')
  const rows = [
    { text: 'A', level: 1 }, { text: 'B', level: 1 }, { text: 'C', level: 2 },
    { text: 'D', level: 1 }, { text: '', level: 1 }, { text: 'E', level: 1 },
    { text: 'Restart', level: 1, numberingRestart: 1 }, { text: 'After', level: 1 },
  ]
  element.paragraphs = rows.map(row => ({ ...element.paragraphs![0]!, ...row, bullet: { kind: 'auto-number', scheme: row.level === 1 ? 'arabicPeriod' : 'alphaLcParenR', startAt: row.level === 1 ? 5 : 27 }, runs: row.text ? [{ text: row.text, style }] : [] }))
  element.text = rows.map(row => row.text).join('\n')
  const parsed = HtmlDeckSnapshotSchema.parse(input)
  const result = htmlDeckToPresentation(parsed)
  expect(result.warnings.filter(warning => warning.code === 'numbering-compatibility')).toMatchObject([{ code: 'numbering-compatibility', elementId: 'body' }])
  expect(result.objects[0]).toMatchObject({ status: 'native', nativeCount: 1, reasons: expect.arrayContaining([expect.stringContaining('restart'), expect.stringContaining('OpenSymbol')]) })
  const zip = await JSZip.loadAsync(await result.presentation.toArrayBuffer())
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
  expect(nodes(xml, 'sp')).toHaveLength(1)
  expect(nodes(xml, 'buAutoNum').map(node => node.attributes)).toEqual([
    { type: 'arabicPeriod', startAt: '5' }, { type: 'arabicPeriod' }, { type: 'alphaLcParenR', startAt: '27' },
    { type: 'arabicPeriod' }, { type: 'arabicPeriod' }, { type: 'arabicPeriod' },
    { type: 'arabicPeriod', startAt: '1' }, { type: 'arabicPeriod' },
  ])
  expect(nodes(xml, 't').map(node => xml.slice(node.openEnd, node.closeStart)).filter(Boolean)).toEqual(rows.map(row => row.text).filter(Boolean))
  const id = nodes(xml, 'sp')[0]!.children[0]!.children.find(node => node.local === 'cNvPr')!.attributes.id!
  const slot = { index: 0, type: 'body' as const, x: 0, y: 0, width: 9144000, height: 5143500, textStyle: { paragraph: { bullet: { kind: 'auto-number' as const, scheme: 'arabicPeriod' as const, startAt: 3 } } } }
  expect(nodes(bindSlidePlaceholder(xml, id, slot, 'page', 'page'), 'buAutoNum')).toHaveLength(rows.length)
  expect(nodes(bindSlidePlaceholder(xml, id, slot, 'page', 'layout'), 'buAutoNum')).toHaveLength(0)
  const invalid = structuredClone(input)
  if (invalid.slides[0]!.elements[0]!.kind === 'text') invalid.slides[0]!.elements[0]!.paragraphs![6]!.bullet = { kind: 'none' }
  expect(HtmlDeckSnapshotSchema.safeParse(invalid).success).toBe(false)
})

it('retains literal tabs across styled runs and serializes measured paragraph stops', async () => {
  const input = fixture(), element = input.slides[0]!.elements[0]!
  if (element.kind !== 'text') throw new Error('Expected text frame')
  const paragraph = { ...element.paragraphs![0]!, defaultTabSizePx: 48, tabStopsPx: [{ position: 0, align: 'left' as const }, { position: 200, align: 'left' as const }], runs: [{ text: 'First\t', style }, { text: '\t中文\nSecond\tend', style: { ...style, fontWeight: 700 } }] }
  element.paragraphs = [paragraph]
  element.text = paragraph.runs.map(run => run.text).join('')
  const result = htmlDeckToPresentation(HtmlDeckSnapshotSchema.parse(input), { layout: 'LAYOUT_16x9' })
  expect(result.warnings).toMatchObject([{ code: 'text-tab-compatibility', elementId: 'body' }])
  const zip = await JSZip.loadAsync(await result.presentation.toArrayBuffer())
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
  expect(nodes(xml, 'sp')).toHaveLength(1)
  expect(nodes(xml, 'pPr')[0]!.attributes.defTabSz).toBe('457200')
  expect(nodes(xml, 'tab').map(node => node.attributes)).toEqual([{ pos: '0', algn: 'l' }, { pos: '1905000', algn: 'l' }])
  expect(nodes(xml, 't').map(node => xml.slice(node.openEnd, node.closeStart)).join('')).toBe('First\t\t中文Second\tend')
  expect(nodes(xml, 'br')).toHaveLength(1)
  delete (paragraph as Partial<typeof paragraph>).defaultTabSizePx
  expect(htmlDeckToPresentation(input).objects[0]).toMatchObject({ status: 'missing', reasons: [expect.stringContaining('measured paragraph tab contract')] })
})

it('keeps RTL logical text and writes paragraph rtl while leaving physical margins intact', async () => {
  const input = fixture()
  const element = input.slides[0]!.elements[0]!
  if (element.kind !== 'text') throw new Error('Expected text fixture')
  const rtl = { ...style, direction: 'rtl' as const, align: 'right' as const, language: 'ar-SA' }
  element.paragraphs![0]!.style = rtl
  element.paragraphs![0]!.marginLeftPx = 18
  element.paragraphs![0]!.marginRightPx = 24
  element.paragraphs![0]!.runs = [
    { text: 'مرحبا بالعالم 123 ABC', style: rtl, hyperlink: 'https://example.com/rtl' },
  ]
  element.text = [element.paragraphs![0]!, ...element.paragraphs!.slice(1)].map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n')
  const result = htmlDeckToPresentation(HtmlDeckSnapshotSchema.parse(input), { layout: 'LAYOUT_16x9' })
  const zip = await JSZip.loadAsync(await result.presentation.toArrayBuffer())
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
  const paragraphProperties = nodes(xml, 'pPr')
  expect(paragraphProperties[0]!.attributes).toMatchObject({ rtl: '1', algn: 'r', marL: '171450', marR: '228600' })
  expect(paragraphProperties[1]!.attributes.rtl).toBe('0')
  expect(xml.slice(nodes(xml, 't')[0]!.openEnd, nodes(xml, 't')[0]!.closeStart)).toBe('مرحبا بالعالم 123 ABC')
  expect(await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')).toContain('https://example.com/rtl')
})

it('retains paragraph rtl through empty paragraphs and breaks and inherits only owned direction', async () => {
  const input = fixture(), element = input.slides[0]!.elements[0]!
  if (element.kind !== 'text') throw new Error('Expected text fixture')
  for (const paragraph of element.paragraphs!) {
    paragraph.style = { ...paragraph.style, direction: 'rtl' }
    paragraph.runs = paragraph.runs.map(run => ({ ...run, style: { ...run.style, direction: 'rtl' } }))
  }
  const result = htmlDeckToPresentation(input)
  expect(result.objects[0]!.status).toBe('native')
  const zip = await JSZip.loadAsync(await result.presentation.toArrayBuffer())
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
  expect(nodes(xml, 'pPr').map(p => p.attributes.rtl)).toEqual(['1', '1', '1', '1'])
  expect(nodes(xml, 'br')).toHaveLength(4)
  const id = nodes(xml, 'cNvPr').find(p => p.attributes.name?.startsWith('fastppt:body:'))!.attributes.id!
  const slot = { index: 0, type: 'body' as const, x: 0, y: 0, width: 1000, height: 1000, textStyle: { levels: [{ level: 2, paragraph: { direction: 'ltr' as const } }] } }
  expect(nodes(bindSlidePlaceholder(xml, id, slot, 'page', 'layout'), 'pPr').map(p => p.attributes.rtl)).toEqual(['1', undefined, '1', '1'])
  expect(nodes(bindSlidePlaceholder(xml, id, slot, 'page', 'page'), 'pPr').map(p => p.attributes.rtl)).toEqual(['1', '1', '1', '1'])
  const paragraph = element.paragraphs![0]!
  paragraph.bullet = { kind: 'character', character: '*' }
  expect(htmlDeckToPresentation(input).objects[0]).toMatchObject({ status: 'missing', reasons: [expect.stringContaining('RTL text frames with bullets or tabs')] })
  delete paragraph.bullet
  paragraph.runs[0]!.style.direction = 'ltr'
  expect(htmlDeckToPresentation(input).objects[0]).toMatchObject({ status: 'missing', reasons: [expect.stringContaining('run direction')] })
})
