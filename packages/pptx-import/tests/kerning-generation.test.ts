import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import { NativeMasterLayoutSchema, ImportLayoutCandidateSchema } from '@fastppt/presentation-ir'
import { analyzePptx } from '../src/index.js'
import type { resolveObjectText } from '../src/text-inheritance.js'

type Evidence = Array<{ part: string; objects: ReturnType<typeof resolveObjectText>[] }>
it('roundtrips signed kerning, master provenance and zero overrides, rejecting malformed source values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-kerning-source-'))
  try {
    const style = { fontFamily: 'Liberation Mono', fontSizePx: 20, letterSpacingPx: 0, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, kerningThresholdPx: 0, color: { hex: '112233', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr' }
    const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [1, 2, 3].map(index => ({ version: 1, id: String(index), width: 960, height: 540, warnings: [], elements: [{ id: 'body', kind: 'text', text: 'Body text', paragraphLevel: index, box: { x: 50, y: 50, width: 600, height: 100 }, order: 0, zIndex: 0, opacity: 1, source: { tag: 'p', path: 'p', anchor: 'body' }, style }] })) })
    const definition = NativeMasterLayoutSchema.parse({ name: 'kerning', canvas: { width: 12192000, height: 6858000 }, placeholders: [{ index: 0, type: 'body', x: 500000, y: 500000, width: 10000000, height: 5000000, textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, autoFit: 'none' }, textStyle: { fontFamily: 'Liberation Mono', fontSize: 20, color: '112233', kerningThreshold: 2, levels: [{ level: 2, textStyle: { kerningThreshold: 0 } }, { level: 3, textStyle: { kerningThreshold: 1.25 } }] } }], fixedObjects: [{ name: 'Footer', x: 500000, y: 6000000, width: 8000000, height: 450000, text: 'Compact footer', fontFamily: 'Liberation Mono', fontSize: 12, color: '112233', kerningThreshold: 0.5 }] })
    const source = join(directory, 'source.pptx'), analysisPath = join(directory, 'analysis.json')
    const bindings = [1, 2, 3].map(slide => ({ slide, target: 'body', index: 0, geometry: 'layout' as const, textStyle: 'layout' as const }))
    await writeEditablePptx(snapshot, source, { embedFonts: false, slideLayouts: Array(3).fill('kerning') as string[], masterLayoutDefinitions: [definition], placeholderBindings: bindings })
    const zip = await JSZip.loadAsync(await readFile(source)), master = 'ppt/slideMasters/slideMaster1.xml'
    zip.file(master, (await zip.file(master)!.async('string')).replace(/(<p:bodyStyle>[\s\S]*?<a:lvl1pPr\b[\s\S]*?<a:defRPr)\b([^>]*)>/, (_all, start: string, attributes: string) => `${start}${attributes.replace(/\skern="[^"]*"/g, '')} kern="200">`))
    let layoutPath = ''
    for (const path of Object.keys(zip.files).filter(path => /^ppt\/slideLayouts\/.*\.xml$/.test(path))) {
      const xml = await zip.file(path)!.async('string')
      if (xml.includes('name="kerning"')) { layoutPath = path; zip.file(path, xml.replace(/(<a:lvl1pPr\b[\s\S]*?<a:defRPr\b[^>]*?) kern="200"/, '$1')) }
    }
    expect(layoutPath).not.toBe('')
    const bytes = await zip.generateAsync({ type: 'nodebuffer' }), analysis = await analyzePptx(bytes)
    await writeFile(source, bytes)
    const evidence = analysis.extractedFeatures.resolvedObjectText as Evidence
    const first = evidence.find(entry => entry.part === analysis.sourceGraph!.slides[0]!.part)!.objects.find(object => object.paragraphs.length)!.paragraphs[0]!.runs[0]!
    expect(first.attributes.kern).toBe('200')
    expect(first.origins['attributes.kern']!.part).toBe(master)
    await writeFile(analysisPath, JSON.stringify(analysis))
    const extract = async (name: string) => promisify(execFile)(process.execPath, [resolve('../../scripts/extract-theme.mjs'), source, '--name', name, '--out', directory, '--analysis', analysisPath])
    await extract('kerning')
    const generated = join(directory, 'slidev-theme-kerning')
    const definitions = NativeMasterLayoutSchema.array().parse(JSON.parse(await readFile(join(generated, 'agent/native-layouts.json'), 'utf8')))
    expect(definitions).toHaveLength(1)
    const text = definitions[0]!.placeholders[0]!.textStyle!
    expect([1, 2, 3].map(level => ({ ...text, ...text.levels?.find(item => item.level === level)?.textStyle }).kerningThreshold)).toEqual([2, 0, 1.25])
    expect(definitions[0]!.fixedObjects![0]!.kerningThreshold).toBe(0.5)
    expect(await readFile(join(generated, 'layouts', `${definitions[0]!.name}.vue`), 'utf8')).toContain('data-fastppt-text-kerning')
    const output = join(directory, 'output.pptx')
    await writeEditablePptx(snapshot, output, { embedFonts: false, slideLayouts: Array(3).fill(definitions[0]!.name) as string[], masterLayoutDefinitions: definitions, placeholderBindings: bindings })
    const readback = await analyzePptx(await readFile(output)), resolved = readback.extractedFeatures.resolvedObjectText as Evidence
    const runs = readback.sourceGraph!.slides.map(slide => resolved.find(entry => entry.part === slide.part)!.objects.find(object => object.paragraphs.length)!.paragraphs[0]!.runs[0]!)
    expect(runs.map(run => [run.text, run.attributes.kern])).toEqual([['Body text', '200'], ['Body text', '0'], ['Body text', '125']])
    expect(runs.every(run => run.origins['attributes.kern']!.part.includes('slideLayouts'))).toBe(true)
    const baseline = await zip.file(layoutPath)!.async('string')
    for (const [index, invalid] of ['400001', '-1', '1.5', 'NaN'].entries()) {
      zip.file(layoutPath, baseline.replace('kern="0"', `kern="${invalid}"`))
      const altered = await zip.generateAsync({ type: 'nodebuffer' })
      await writeFile(source, altered)
      await writeFile(analysisPath, JSON.stringify(await analyzePptx(altered)))
      await extract(`invalid-${index}`)
      const agent = join(directory, `slidev-theme-invalid-${index}`, 'agent')
      expect(JSON.parse(await readFile(join(agent, 'native-layouts.json'), 'utf8'))).toEqual([])
      const candidates = ImportLayoutCandidateSchema.array().parse((JSON.parse(await readFile(join(agent, 'layout-candidates.json'), 'utf8')) as { candidates: unknown }).candidates)
      expect(candidates.some(candidate => candidate.generated?.status === 'partial' && candidate.issues.some(issue => issue.includes(`kern=${invalid}`)))).toBe(true)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
