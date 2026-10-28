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

it('roundtrips original strings, capitalization and provenance through template generation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-capitalization-source-'))
  try {
    const style = { fontFamily: 'Liberation Serif', fontSizePx: 20, letterSpacingPx: 0, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, capitalization: 'none', color: { hex: '112233', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr' }
    const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [1, 2, 3].map(index => ({ version: 1, id: String(index), width: 960, height: 540, warnings: [], elements: [{ id: 'body', kind: 'text', text: 'Straße i中文', paragraphLevel: index, box: { x: 50, y: 50, width: 600, height: 100 }, order: 0, zIndex: 0, opacity: 1, source: { tag: 'p', path: 'p', anchor: 'body' }, style }] })) })
    const definition: NativeMasterLayout = { name: 'capitalization', canvas: { width: 12192000, height: 6858000 }, placeholders: [{ index: 0, type: 'body', x: 500000, y: 500000, width: 10000000, height: 5000000, textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, autoFit: 'none' }, textStyle: { fontFamily: 'Liberation Serif', fontSize: 20, color: '112233', capitalization: 'all', levels: [{ level: 2, textStyle: { capitalization: 'none' } }, { level: 3, textStyle: { capitalization: 'small' } }] } }], fixedObjects: [{ name: 'Footer', x: 500000, y: 6000000, width: 8000000, height: 450000, text: 'Straße', fontFamily: 'Liberation Serif', fontSize: 12, color: '112233', capitalization: 'small' }] }
    const source = join(directory, 'source.pptx'), analysisPath = join(directory, 'analysis.json')
    await writeEditablePptx(snapshot, source, { embedFonts: false, slideLayouts: Array<string>(3).fill(definition.name), masterLayoutDefinitions: [definition], placeholderBindings: [1, 2, 3].map(slide => ({ slide, target: 'body', index: 0, geometry: 'layout', textStyle: 'layout' })) })
    const fixture = await JSZip.loadAsync(await readFile(source)), master = 'ppt/slideMasters/slideMaster1.xml'
    fixture.file(master, (await fixture.file(master)!.async('string')).replace(/(<p:bodyStyle>[\s\S]*?<a:lvl1pPr\b[\s\S]*?<a:defRPr)\b([^>]*)>/, (_all, start: string, attributes: string) => `${start}${attributes.replace(/\scap="[^"]*"/g, '')} cap="all">`))
    for (const path of Object.keys(fixture.files).filter(path => path.startsWith('ppt/slideLayouts/') && path.endsWith('.xml'))) {
      const xml = await fixture.file(path)!.async('string')
      if (xml.includes('name="capitalization"')) fixture.file(path, xml.replace(/(<a:lvl1pPr\b[\s\S]*?<a:defRPr\b[^>]*?) cap="all"/, '$1'))
    }
    await writeFile(source, await fixture.generateAsync({ type: 'nodebuffer' }))
    const analysis = await analyzePptx(await readFile(source))
    const evidence = analysis.extractedFeatures.resolvedObjectText as Array<{ part: string; objects: ReturnType<typeof resolveObjectText>[] }>
    const runs = analysis.sourceGraph!.slides.map(slide => evidence.find(entry => entry.part === slide.part)!.objects.find(object => object.paragraphs.length)!.paragraphs[0]!.runs)
    expect(runs.map(items => items.map(run => run.text).join(''))).toEqual(Array(3).fill('Straße i中文'))
    expect(runs.map(items => items.map(run => run.attributes.cap))).toEqual([['all'], ['none'], ['small']])
    expect(runs[0]![0]!.origins['attributes.cap']!.part).toBe(master)
    expect(runs.slice(1).flat().every(run => run.origins['attributes.cap']!.part.includes('slideLayouts'))).toBe(true)
    await writeFile(analysisPath, JSON.stringify(analysis))
    await promisify(execFile)(process.execPath, [resolve('../../scripts/extract-theme.mjs'), source, '--name', 'capitalization', '--out', directory, '--analysis', analysisPath])
    const agent = join(directory, 'slidev-theme-capitalization', 'agent')
    const definitions = NativeMasterLayoutSchema.array().parse(JSON.parse(await readFile(join(agent, 'native-layouts.json'), 'utf8')))
    expect(definitions).toHaveLength(1)
    const textStyle = definitions[0]!.placeholders[0]!.textStyle!
    expect([1, 2, 3].map(level => ({ ...textStyle, ...textStyle.levels?.find(entry => entry.level === level)?.textStyle }).capitalization)).toEqual(['all', 'none', 'small'])
    expect(definitions[0]!.fixedObjects![0]).toMatchObject({ text: 'Straße', capitalization: 'small' })
    expect(await readFile(join(agent, '..', 'layouts', definitions[0]!.name + '.vue'), 'utf8')).toContain('data-fastppt-text-capitalization-run')
    const output = join(directory, 'output.pptx')
    await writeEditablePptx(snapshot, output, { embedFonts: false, slideLayouts: Array<string>(3).fill(definitions[0]!.name), masterLayoutDefinitions: definitions, placeholderBindings: [1, 2, 3].map(slide => ({ slide, target: 'body', index: 0, geometry: 'layout', textStyle: 'layout' })) })
    const readback = await analyzePptx(await readFile(output)), resolved = readback.extractedFeatures.resolvedObjectText as typeof evidence
    const again = readback.sourceGraph!.slides.map(slide => resolved.find(entry => entry.part === slide.part)!.objects.find(object => object.paragraphs.length)!.paragraphs[0]!.runs[0]!)
    expect(again.map(run => [run.text, run.attributes.cap])).toEqual([['Straße i中文', 'all'], ['Straße i中文', 'none'], ['Straße i中文', 'small']])
    const zip = await JSZip.loadAsync(await readFile(source))
    for (const path of Object.keys(zip.files).filter(path => path.startsWith('ppt/slideLayouts/') && path.endsWith('.xml'))) {
      const xml = await zip.file(path)!.async('string')
      if (xml.includes('name="capitalization"')) zip.file(path, xml.replace('cap="all"', 'cap="uppercase"'))
    }
    const invalid = await zip.generateAsync({ type: 'nodebuffer' })
    await writeFile(source, invalid)
    await writeFile(analysisPath, JSON.stringify(await analyzePptx(invalid)))
    await promisify(execFile)(process.execPath, [resolve('../../scripts/extract-theme.mjs'), source, '--name', 'invalid', '--out', directory, '--analysis', analysisPath])
    const invalidAgent = join(directory, 'slidev-theme-invalid', 'agent')
    expect(JSON.parse(await readFile(join(invalidAgent, 'native-layouts.json'), 'utf8'))).toEqual([])
    const candidates = ImportLayoutCandidateSchema.array().parse((JSON.parse(await readFile(join(invalidAgent, 'layout-candidates.json'), 'utf8')) as { candidates: unknown }).candidates)
    expect(candidates.some(candidate => candidate.generated?.status === 'partial' && candidate.issues.some(issue => issue.includes('cap=uppercase')))).toBe(true)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
