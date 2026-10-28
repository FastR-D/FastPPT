import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { expect, it } from 'vitest'
import { writeEditablePptx, type NativeMasterLayout } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import JSZip from 'jszip'
import { ImportLayoutCandidateSchema, NativeMasterLayoutSchema } from '@fastppt/presentation-ir'
import { analyzePptx } from '../src/index.js'
import type { resolveObjectText } from '../src/text-inheritance.js'

it('roundtrips paragraph direction, explicit LTR and source ownership without inferring from language', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-direction-source-'))
  try {
    const style = { fontFamily: 'DejaVu Sans', fontSizePx: 20, letterSpacingPx: 0, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, color: { hex: '112233', alpha: 1 }, align: 'left', decoration: [], direction: 'rtl', language: 'en-US' }
    const original = 'שלום 123 ABC (x)'
    const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [1, 2, 3].map(index => ({ version: 1, id: String(index), width: 960, height: 540, warnings: [], elements: [{ id: 'body', kind: 'text', text: original, paragraphLevel: index, box: { x: 50, y: 50, width: 600, height: 100 }, order: 0, zIndex: 0, opacity: 1, source: { tag: 'p', path: 'p', anchor: 'body' }, style }] })) })
    const definition: NativeMasterLayout = { name: 'direction', canvas: { width: 12192000, height: 6858000 }, placeholders: [{ index: 0, type: 'body', x: 500000, y: 500000, width: 10000000, height: 5000000, textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, autoFit: 'none' }, textStyle: { fontFamily: 'DejaVu Sans', fontSize: 20, color: '112233', language: 'en-US', paragraph: { direction: 'rtl', align: 'left' }, levels: [{ level: 2, paragraph: { direction: 'ltr' } }, { level: 3, paragraph: { align: 'right' } }] } }], fixedObjects: [{ name: 'Footer', x: 500000, y: 6000000, width: 8000000, height: 450000, text: original, direction: 'rtl', fontFamily: 'DejaVu Sans', fontSize: 12, color: '112233' }] }
    const source = join(directory, 'source.pptx'), analysisPath = join(directory, 'analysis.json')
    await writeEditablePptx(snapshot, source, { embedFonts: false, slideLayouts: Array<string>(3).fill(definition.name), masterLayoutDefinitions: [definition], placeholderBindings: [1, 2, 3].map(slide => ({ slide, target: 'body', index: 0, geometry: 'layout', textStyle: 'layout' })) })
    // The source fixture deliberately declares direction in its master. This is
    // source inheritance coverage, not an application rendering comparison.
    const fixture = await JSZip.loadAsync(await readFile(source)), master = 'ppt/slideMasters/slideMaster1.xml'
    fixture.file(master, (await fixture.file(master)!.async('string')).replace(/(<p:bodyStyle>[\s\S]*?<a:lvl1pPr\b[^>]*?)rtl="0"/, '$1rtl="true"'))
    const layoutPart = Object.keys(fixture.files).find(path => path.startsWith('ppt/slideLayouts/') && path.endsWith('.xml') && path.endsWith('slideLayout2.xml'))!
    for (const path of Object.keys(fixture.files).filter(path => path.startsWith('ppt/slideLayouts/') && path.endsWith('.xml'))) {
      const xml = await fixture.file(path)!.async('string')
      if (xml.includes('name="direction"')) fixture.file(path, xml.replace(/(<a:lvl1pPr\b[^>]*?) rtl="1"/, '$1'))
    }
    void layoutPart
    await writeFile(source, await fixture.generateAsync({ type: 'nodebuffer' }))
    const analysis = await analyzePptx(await readFile(source))
    type Evidence = Array<{ part: string; objects: ReturnType<typeof resolveObjectText>[] }>
    const paragraphs = (value: typeof analysis) => value.sourceGraph!.slides.map(slide => (value.extractedFeatures.resolvedObjectText as Evidence).find(entry => entry.part === slide.part)!.objects.find(object => object.paragraphs.length)!.paragraphs[0]!)
    expect(paragraphs(analysis).map(p => [p.attributes.rtl, p.runs.map(run => run.text).join('')])).toEqual([['true', original], ['0', original], ['1', original]])
    expect(paragraphs(analysis)[0]!.origins['attributes.rtl']!.part).toBe(master)
    await writeFile(analysisPath, JSON.stringify(analysis))
    const extract = async (name: string) => {
      await promisify(execFile)(process.execPath, [resolve('../../scripts/extract-theme.mjs'), source, '--name', name, '--out', directory, '--analysis', analysisPath])
      return join(directory, `slidev-theme-${name}`, 'agent')
    }
    const agent = await extract('direction')
    const definitions = NativeMasterLayoutSchema.array().parse(JSON.parse(await readFile(join(agent, 'native-layouts.json'), 'utf8')))
    expect(definitions).toHaveLength(1)
    const text = definitions[0]!.placeholders[0]!.textStyle!
    expect([1, 2, 3].map(level => ({ ...text.paragraph, ...text.levels?.find(entry => entry.level === level)?.paragraph }).direction)).toEqual(['rtl', 'ltr', 'rtl'])
    expect(definitions[0]!.fixedObjects![0]).toMatchObject({ direction: 'rtl', text: original })
    const vue = await readFile(join(agent, '..', 'layouts', definitions[0]!.name + '.vue'), 'utf8')
    expect(vue).toContain('data-fastppt-text-direction')
    expect(vue).toContain('direction:rtl')
    const output = join(directory, 'output.pptx')
    await writeEditablePptx(snapshot, output, { embedFonts: false, slideLayouts: Array<string>(3).fill(definitions[0]!.name), masterLayoutDefinitions: definitions, placeholderBindings: [1, 2, 3].map(slide => ({ slide, target: 'body', index: 0, geometry: 'layout', textStyle: 'layout' })) })
    expect(paragraphs(await analyzePptx(await readFile(output))).map(p => [p.attributes.rtl, p.runs.map(run => run.text).join('')])).toEqual([['1', original], ['0', original], ['1', original]])
    const originalSource = await readFile(source)
    for (const [name, from, to, issue] of [
      ['invalid-direction', 'rtl="1"', 'rtl="auto"', 'rtl=auto'],
      ['rtl-bullet', '<a:buNone/>', '<a:buChar char="*"/>', 'RTL bullets or tabs'],
    ]) {
      const zip = await JSZip.loadAsync(originalSource)
      for (const path of Object.keys(zip.files).filter(path => path.startsWith('ppt/slideLayouts/') && path.endsWith('.xml'))) {
        const xml = await zip.file(path)!.async('string')
        if (xml.includes('name="direction"')) zip.file(path, xml.replace(from!, to!))
      }
      const invalid = await zip.generateAsync({ type: 'nodebuffer' })
      await writeFile(source, invalid)
      await writeFile(analysisPath, JSON.stringify(await analyzePptx(invalid)))
      const invalidAgent = await extract(name!)
      expect(JSON.parse(await readFile(join(invalidAgent, 'native-layouts.json'), 'utf8'))).toEqual([])
      const candidates = ImportLayoutCandidateSchema.array().parse((JSON.parse(await readFile(join(invalidAgent, 'layout-candidates.json'), 'utf8')) as { candidates: unknown }).candidates)
      expect(candidates.some(candidate => candidate.generated?.status === 'partial' && candidate.issues.some(value => value.includes(issue!))), issue).toBe(true)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
