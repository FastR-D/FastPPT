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
it('roundtrips source decoration defaults, explicit cancellation and uniform fixed text, retaining complex losses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-decoration-source-'))
  try {
    const style = { fontFamily: 'Liberation Mono', fontSizePx: 24, fontWeight: 400, fontStyle: 'normal', lineHeightPx: 30, letterSpacingPx: 0, color: { hex: '112233', alpha: 1 }, align: 'left', decoration: [], direction: 'ltr' }
    const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [1, 2, 3].map(index => ({ version: 1, id: `slide-${index}`, width: 960, height: 540, warnings: [], elements: [{ id: 'body', kind: 'text', text: 'Body text', paragraphLevel: index, box: { x: 50, y: 50, width: 600, height: 100 }, order: 0, zIndex: 0, opacity: 1, source: { tag: 'p', path: 'p', anchor: 'body' }, style }] })) })
    const definition = NativeMasterLayoutSchema.parse({ name: 'decorations', canvas: { width: 12192000, height: 6858000 }, placeholders: [{ index: 0, type: 'body', x: 500000, y: 500000, width: 10000000, height: 5000000, textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, autoFit: 'none' }, textStyle: { fontFamily: 'Liberation Mono', fontSize: 24, color: '112233', underline: true, strike: true, levels: [{ level: 2, textStyle: { underline: false } }, { level: 3, textStyle: { strike: false } }] } }], fixedObjects: [{ name: 'Footer', x: 500000, y: 6000000, width: 8000000, height: 450000, text: 'Uniform underline', fontFamily: 'Liberation Mono', fontSize: 12, color: '112233', underline: true, strike: false }] })
    const source = join(directory, 'source.pptx'), analysisPath = join(directory, 'analysis.json')
    const bindings = [1, 2, 3].map(slide => ({ slide, target: 'body', index: 0, geometry: 'layout' as const, textStyle: 'layout' as const }))
    await writeEditablePptx(snapshot, source, { embedFonts: false, slideLayouts: ['decorations', 'decorations', 'decorations'], masterLayoutDefinitions: [definition], placeholderBindings: bindings })
    const zip = await JSZip.loadAsync(await readFile(source))
    // Let the master own underline at level 1, while the layout independently
    // owns strike and level-2 cancellation. Source provenance must survive.
    const masterPath = 'ppt/slideMasters/slideMaster1.xml'
    zip.file(masterPath, (await zip.file(masterPath)!.async('string')).replace(/(<p:bodyStyle>[\s\S]*?<a:lvl1pPr\b[\s\S]*?<a:defRPr)\b([^>]*)>/, (_all, start: string, attributes: string) => `${start}${attributes.replace(/\su="[^"]*"/g, '')} u="sng">`))
    let layoutPath = ''
    for (const path of Object.keys(zip.files).filter(path => /^ppt\/slideLayouts\/.*\.xml$/.test(path))) {
      const xml = await zip.file(path)!.async('string')
      if (xml.includes('name="decorations"')) { layoutPath = path; zip.file(path, xml.replace(/(<a:lvl1pPr\b[\s\S]*?<a:defRPr\b[^>]*?) u="sng"/, '$1')) }
    }
    expect(layoutPath).not.toBe('')
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    await writeFile(source, bytes)
    const analysis = await analyzePptx(bytes)
    const sourceText = analysis.extractedFeatures.resolvedObjectText as Evidence
    const sourceParagraph = sourceText.find(entry => entry.part === analysis.sourceGraph!.slides[0]!.part)!.objects.find(object => object.paragraphs.length)!.paragraphs[0]!
    expect(sourceParagraph.runs[0]!.attributes).toMatchObject({ u: 'sng', strike: 'sngStrike' })
    expect(sourceParagraph.runs[0]!.origins['attributes.u']!.part).toBe(masterPath)
    await writeFile(analysisPath, JSON.stringify(analysis))
    await promisify(execFile)(process.execPath, [resolve('../../scripts/extract-theme.mjs'), source, '--name', 'decorations', '--out', directory, '--analysis', analysisPath])
    const generated = join(directory, 'slidev-theme-decorations')
    const definitions = NativeMasterLayoutSchema.array().parse(JSON.parse(await readFile(join(generated, 'agent/native-layouts.json'), 'utf8')))
    const candidateText = await readFile(join(generated, 'agent/layout-candidates.json'), 'utf8')
    expect(definitions, candidateText).toHaveLength(1)
    const text = definitions[0]!.placeholders[0]!.textStyle!
    const at = (level: number) => ({ ...text, ...text.levels?.find(item => item.level === level)?.textStyle })
    expect([at(1), at(2), at(3)]).toMatchObject([{ underline: true, strike: true }, { underline: false, strike: true }, { underline: true, strike: false }])
    expect(definitions[0]!.fixedObjects![0]).toMatchObject({ text: 'Uniform underline', underline: true, strike: false })
    const vue = await readFile(join(generated, 'layouts', `${definitions[0]!.name}.vue`), 'utf8')
    expect(vue).toContain('data-fastppt-text-decoration-run')
    expect(vue).toContain('text-decoration-line:underline')
    const output = join(directory, 'output.pptx')
    await writeEditablePptx(snapshot, output, { embedFonts: false, slideLayouts: Array(3).fill(definitions[0]!.name) as string[], masterLayoutDefinitions: definitions, placeholderBindings: bindings })
    const readback = await analyzePptx(await readFile(output)), evidence = readback.extractedFeatures.resolvedObjectText as Evidence
    const runs = readback.sourceGraph!.slides.map(slide => evidence.find(entry => entry.part === slide.part)!.objects.find(object => object.paragraphs.length)!.paragraphs[0]!.runs[0]!)
    expect(runs.map(run => [run.text, run.attributes.u, run.attributes.strike])).toEqual([['Body text', 'sng', 'sngStrike'], ['Body text', 'none', 'sngStrike'], ['Body text', 'sng', 'noStrike']])
    expect(runs.every(run => run.origins['attributes.u']!.part.includes('slideLayouts'))).toBe(true)
    const baseline = await zip.file(layoutPath)!.async('string')
    for (const [name, mutate, diagnostic] of [
      ['double-underline', (xml: string) => xml.replace('u="sng"', 'u="dbl"'), 'u=dbl'],
      ['double-strike', (xml: string) => xml.replace('strike="sngStrike"', 'strike="dblStrike"'), 'strike=dblStrike'],
      ['custom-color', (xml: string) => xml.replace('<a:uFillTx/>', '<a:uFill><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:uFill>'), 'uFill'],
    ] as const) {
      zip.file(layoutPath, mutate(baseline))
      const altered = await zip.generateAsync({ type: 'nodebuffer' })
      await writeFile(source, altered)
      await writeFile(analysisPath, JSON.stringify(await analyzePptx(altered)))
      await promisify(execFile)(process.execPath, [resolve('../../scripts/extract-theme.mjs'), source, '--name', name, '--out', directory, '--analysis', analysisPath])
      const agent = join(directory, `slidev-theme-${name}`, 'agent')
      expect(JSON.parse(await readFile(join(agent, 'native-layouts.json'), 'utf8'))).toEqual([])
      const candidates = ImportLayoutCandidateSchema.array().parse((JSON.parse(await readFile(join(agent, 'layout-candidates.json'), 'utf8')) as { candidates: unknown }).candidates)
      expect(candidates.some(candidate => candidate.generated?.status === 'partial' && candidate.issues.some(issue => issue.includes(diagnostic)))).toBe(true)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
