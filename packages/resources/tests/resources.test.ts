import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ResourceLibrary, rankResources, resolveResourcesRoot, summarizeComposition, type LayoutResource } from '../src/index.js'
const sample = (id: string, tags: string[], status: LayoutResource['status'] = 'reconstructed'): LayoutResource => ({
  id, title: id, kind: 'diagram', description: tags.join(' '), tags, style: 'neutral', scenarios: '',
  source: 'fixture.pptx', sourcePage: 1, file: `pages/${id}.md`, aspect: 16 / 9, density: 'balanced',
  status, warnings: [], license: 'fixture', stats: {}, searchText: '',
})
describe('resource retrieval', () => {
  const samples = [sample('four-step', ['process', '步骤']), sample('loop', ['cycle', 'PDCA']), sample('promo', ['process'], 'excluded')]
  it('connects Chinese intent with English relationship tags without exposing excluded pages', () => {
    expect(rankResources(samples, { query: '帮我画一个流程' }).items[0]?.id).toBe('four-step')
    expect(rankResources(samples, { query: '改成闭环' }).items[0]?.id).toBe('loop')
    expect(rankResources([...samples, { ...sample('qa-passed', ['timeline']), renderQa: { textOverflow: 0, missingImages: 0 }, searchText: '普通的页面' }], { query: '毫不相干的术语' }).total).toBe(0)
    expect(rankResources(samples).items.some(item => item.id === 'promo')).toBe(false)
    expect(rankResources(samples, { status: 'excluded' }).items[0]?.id).toBe('promo')
  })
  it('filters before paginating and omits large source text from search responses', () => {
    expect(rankResources(samples, { kind: 'layout' }).total).toBe(0)
    const page = rankResources(samples, { limit: 1, offset: 1 })
    expect(page.total).toBe(2); expect(page.items).toHaveLength(1)
    expect(page.items[0]).not.toHaveProperty('searchText')
  })
  it('uses current image comparison evidence and rejects an audit from another index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fastppt-resource-qa-'))
    const source = JSON.stringify({ version: 1, entries: [sample('reference', ['process'])] })
    await writeFile(join(root, 'index.json'), source)
    const audit = { sourceIndexSha256: createHash('sha256').update(source).digest('hex'), results: [{ id: 'reference', textOverflow: 0, missingImages: 0, textOutsidePage: 1, blockSsim: .88, normalizedMae: .04 }] }
    await writeFile(join(root, 'render-audit.json'), JSON.stringify(audit))
    const library = new ResourceLibrary(root)
    expect((await library.search()).items[0]).toMatchObject({ status: 'needs-review', warnings: ['render-text-outside-page'], renderQa: { textOutsidePage: 1, blockSsim: .88, normalizedMae: .04 } })
    await writeFile(join(root, 'render-audit.json'), JSON.stringify({ ...audit, sourceIndexSha256: 'stale' }))
    expect((await library.search()).items[0]).toMatchObject({ status: 'reconstructed', warnings: [] })
    expect((await library.search()).items[0]).not.toHaveProperty('renderQa')
  })
  it('rejects traversal and symlinks escaping the library', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fastppt-resources-'))
    await mkdir(join(root, 'pages'))
    const outside = await mkdtemp(join(tmpdir(), 'fastppt-outside-'))
    await writeFile(join(outside, 'secret.md'), 'secret')
    await symlink(join(outside, 'secret.md'), join(root, 'pages/escape.md'))
    const library = new ResourceLibrary(root)
    await expect(library.filePath('../secret.md')).rejects.toThrow('Invalid')
    await expect(library.filePath('pages/escape.md')).rejects.toThrow('escaped')
    await expect(library.read('../../secret')).rejects.toThrow('Invalid')
  })
  it('previews page HTML without reading semantic compositions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fastppt-preview-'))
    await mkdir(join(root, 'pages'))
    await writeFile(join(root, 'index.json'), JSON.stringify({ version: 1, entries: [sample('preview', ['process'])] }))
    await writeFile(join(root, 'pages/preview.md'), '---\nlayout: none\n---\n<div>Native preview</div>')
    const library = new ResourceLibrary(root)
    const read = vi.spyOn(library, 'read').mockRejectedValue(new Error('Preview must not load semantic graphs'))
    const filePath = vi.spyOn(library, 'filePath')
    expect(await library.preview('preview')).toContain('<div>Native preview</div>')
    expect(read).not.toHaveBeenCalled()
    expect(filePath.mock.calls).toEqual([['pages/preview.md']])
    await expect(library.preview('../../secret')).rejects.toThrow('Invalid')
    expect(await library.preview('missing')).toBeUndefined()
  })
  it('exposes current semantic mappings, bounds tool summaries and rejects stale anchors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fastppt-compositions-'))
    await mkdir(join(root, 'pages')); await mkdir(join(root, 'compositions'))
    await writeFile(join(root, 'index.json'), JSON.stringify({ version: 1, entries: [sample('semantic', ['process'])] }))
    const markdown = '<div>Native reference</div>'
    await writeFile(join(root, 'pages/semantic.md'), markdown)
    const composition = { version: 1, id: 'semantic', pageSha256: createHash('sha256').update(markdown).digest('hex'), coordinates: 'normalized', limitations: [], stats: {},
      objects: Array.from({ length: 60 }, (_, i) => ({ id: `shape-${i}`, name: 'Source object', type: 'text', parent: null, text: 'x'.repeat(1000), box: [0, 0, 1, 1], slots: [{ id: `shape-${i}-text`, kind: 'text' }], connections: [] })), mapping: [] }
    await writeFile(join(root, 'compositions/semantic.json'), JSON.stringify(composition))
    const library = new ResourceLibrary(root)
    const current = await library.read('semantic')
    expect(current?.composition?.objects).toHaveLength(60)
    expect(current?.compositionPath).toBe(join(root, 'compositions', 'semantic.json'))
    const summary = summarizeComposition(current!.composition!)
    expect(summary.objects).toHaveLength(16)
    expect(summary.objects[0]?.text).toHaveLength(160)
    await writeFile(join(root, 'pages/semantic.md'), markdown + 'changed')
    const stale = await library.read('semantic')
    expect(stale?.composition).toBeUndefined()
    expect(stale?.compositionWarning).toContain('stale')
  })
  // Traverse all real library pages, including complete composition hash validation.
  it('indexes every source page exactly once, with readable single-page files and evidence', async () => {
    const library = new ResourceLibrary()
    const entries = await library.entries()
    const report = JSON.parse(await readFile(join(await resolveResourcesRoot(), 'scan-report.json'), 'utf8')) as { pageCount: number; sources: { pages: number; entries: string[] }[] }
    expect(entries.length).toBe(report.pageCount)
    expect(new Set(entries.map(item => item.id)).size).toBe(entries.length)
    expect(report.sources.flatMap(source => source.entries).sort()).toEqual(entries.map(item => item.id).sort())
    expect(report.sources.every(source => source.pages === source.entries.length)).toBe(true)
    for (const entry of entries) {
      const source = await library.read(entry.id)
      expect(source?.markdown.startsWith('---\nlayout: none\n')).toBe(true)
      expect(entry.license).toBe('')
      // XML self-closing template/div tags can swallow subsequent slide content
      // when parsed as HTML, even though a naive overflow audit reports zero.
      expect(source?.markdown).not.toMatch(/<(?:div|span|template)(?:\s[^<>]*?)?\s*\/>/)
      if (entry.stats.objects) expect(source?.markdown).toContain('data-fastppt-group=')
      else expect(entry.status).toBe('excluded')
      expect(entry.status === 'needs-review' ? entry.warnings.length : 1).toBeGreaterThan(0)
    }
  }, 120_000)
})
