import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { NodePresentation } from '../src/server/presentation.js'
import { parseXml } from '../src/server/slide-xml.js'
import { nativeListStyleXml, resolveNativeTextStyle } from '../src/server/native-text-style.js'
import { nativeMasterLayoutXml } from '../src/server/master-layout.js'
import { bindSlidePlaceholder } from '../src/server/placeholder-binding.js'

type XmlNode = ReturnType<typeof parseXml>
function nodes(node: XmlNode, local: string): XmlNode[] {
  return [...(node.local === local ? [node] : []), ...node.children.flatMap(child => nodes(child, local))]
}
const languages = (node: XmlNode) => ({ language: node.attributes.lang, alternativeLanguage: node.attributes.altLang })

it('recovers exact languages after writer run splitting without fabricating defaults or changing inputs', async () => {
  const presentation = new NodePresentation({ layout: 'LAYOUT_16x9' })
  const slide = presentation.addSlide()
  const options = { x: 1, y: 1, w: 8, h: 2, lang: 'de-DE', altLang: 'fr-FR' }
  const runs = [
    { text: 'Inherited\nAgain' },
    { text: '清除', options: { lang: '', altLang: '' } },
    { text: 'Private', options: { lang: 'x-FastPPT-0', hyperlink: { url: 'https://example.com/' } } },
    { text: 'Alternate', options: { altLang: 'zh-Hant' } },
  ]
  const original = structuredClone({ runs, options })
  slide.addText(runs, options)
  slide.addText('No declaration', { x: 1, y: 3, w: 8, h: 1 })
  slide.addText('Alternate only', { x: 1, y: 4, w: 8, h: 1, altLang: 'JA-jp' })
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-language-'))
  try {
    // Both serialization entry points must perform recovery, including repeated writes.
    const path = join(directory, 'output.pptx')
    await presentation.save(path)
    for (const bytes of [await readFile(path), await presentation.toArrayBuffer()]) {
      const zip = await JSZip.loadAsync(bytes)
      const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
      const tree = parseXml(xml)
      expect(nodes(tree, 'rPr').map(languages)).toEqual([
        { language: 'de-DE', alternativeLanguage: 'fr-FR' },
        { language: 'de-DE', alternativeLanguage: 'fr-FR' },
        { language: '', alternativeLanguage: '' },
        { language: 'x-FastPPT-0', alternativeLanguage: 'fr-FR' },
        { language: 'de-DE', alternativeLanguage: 'zh-Hant' },
        { language: undefined, alternativeLanguage: undefined },
        { language: undefined, alternativeLanguage: 'JA-jp' },
      ])
      expect(xml).not.toContain('x-fastppt-')
      expect(xml).not.toContain('en-US')
      expect(nodes(tree, 'hlinkClick')).toHaveLength(1)
    }
    expect({ runs, options }).toEqual(original)
    expect(JSON.stringify(slide._ops)).not.toContain('x-fastppt-')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('inherits primary and alternate defaults independently and strips only declared layout groups', () => {
  const style = { language: 'zh-CN', alternativeLanguage: 'en-GB', levels: [{ level: 2, textStyle: { language: '' } }, { level: 3, textStyle: { alternativeLanguage: 'x-review' } }] }
  const list = parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${nativeListStyleXml(style)}</root>`)
  expect(nodes(list, 'defRPr').map(languages)).toEqual([
    { language: 'zh-CN', alternativeLanguage: 'en-GB' }, { language: '', alternativeLanguage: 'en-GB' }, { language: 'zh-CN', alternativeLanguage: 'x-review' },
    ...Array.from({ length: 6 }, () => ({ language: 'zh-CN', alternativeLanguage: 'en-GB' })),
  ])
  expect(resolveNativeTextStyle(style, 2).language).toBe('')
  const slot = { index: 0, type: 'body' as const, x: 0, y: 0, width: 1000, height: 1000, textStyle: { levels: [{ level: 2, textStyle: { language: '' } }, { level: 3, textStyle: { alternativeLanguage: 'fr-FR' } }] } }
  const xml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody>${[0, 1, 2].map(level => `<a:p><a:pPr lvl="${level}"><a:defRPr lang="ja-JP" altLang="en-US"/></a:pPr><a:r><a:rPr lang="ja-JP" altLang="en-US"/><a:t>Body</a:t></a:r><a:endParaRPr lang="ja-JP" altLang="en-US"/></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const bound = parseXml(bindSlidePlaceholder(xml, '2', slot, 'page', 'layout'))
  for (const kind of ['rPr', 'defRPr', 'endParaRPr']) expect(nodes(bound, kind).map(languages)).toEqual([
    { language: 'ja-JP', alternativeLanguage: 'en-US' }, { language: undefined, alternativeLanguage: 'en-US' }, { language: 'ja-JP', alternativeLanguage: undefined },
  ])
  expect(nodes(parseXml(bindSlidePlaceholder(xml, '2', slot, 'page', 'page')), 'rPr').map(languages)).toEqual(Array.from({ length: 3 }, () => ({ language: 'ja-JP', alternativeLanguage: 'en-US' })))
  const layout = parseXml(nativeMasterLayoutXml({ name: 'Language', placeholders: [{ ...slot, textStyle: style }], fixedObjects: [{ name: 'Footer', x: 0, y: 0, width: 1000, height: 1000, text: 'Fixed\nText', language: '', alternativeLanguage: 'fr-FR' }] }))
  expect(nodes(layout, 'endParaRPr').map(languages)).toEqual([{ language: undefined, alternativeLanguage: undefined }])
  expect(nodes(layout, 'rPr').map(languages)).toEqual(Array.from({ length: 2 }, () => ({ language: '', alternativeLanguage: 'fr-FR' })))
})

it('rejects invalid language transport before native XML is emitted', () => {
  const slide = new NodePresentation({ layout: 'LAYOUT_16x9' }).addSlide()
  for (const invalid of ['en_US', ' en-US ', 'en-"/><a:r/>', 'a'.repeat(256), 12, null]) {
    expect(() => slide.addText('Body', { lang: invalid })).toThrow('language')
    expect(() => slide.addText([{ text: 'Body', options: { altLang: invalid } }], {})).toThrow('language')
    expect(() => nativeListStyleXml({ language: invalid } as never)).toThrow('language')
  }
  expect(slide._ops).toHaveLength(0)
})
