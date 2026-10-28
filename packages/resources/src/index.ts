import { createHash } from 'node:crypto'
import { access, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface LayoutResource {
  id: string
  title: string
  kind: 'layout' | 'diagram'
  description: string
  tags: string[]
  style: string
  scenarios: string
  source: string
  sourcePage: number
  file: string
  aspect: number
  density: 'airy' | 'balanced' | 'dense'
  status: 'reconstructed' | 'needs-review' | 'excluded'
  warnings: string[]
  license: string
  revision?: string
  composition?: { file: string; pageSha256: string; revision?: string; stats: Record<string, number> }
  stats: Record<string, number>
  searchText: string
  renderQa?: { textOverflow: number; missingImages: number; textOutsidePage?: number; blockSsim?: number; normalizedMae?: number; error?: string }
}
export interface ResourceComposition {
  version: number
  id: string
  pageSha256: string
  revision?: string
  coordinates: string
  limitations: string[]
  stats: Record<string, number>
  objects: { id: string; name: string; type: string; parent: string | null; text: string; box: number[]; slots: { id: string; kind: string }[]; connections: { end: string; target: string; site?: string }[] }[]
  mapping: { anchor: string; sourceObject: string | null; status: string; confidence: number; method: string; candidates: string[] }[]
}
/** Bounded tool context. Full geometry, text and mapping remain in the local file. */
export function summarizeComposition(value: ResourceComposition, limit = 16) {
  const count = Math.min(24, Math.max(1, limit))
  return { version: value.version, id: value.id, pageSha256: value.pageSha256, revision: value.revision, coordinates: value.coordinates, limitations: value.limitations,
    stats: value.stats, objectCount: value.objects.length,
    objects: value.objects.filter(object => object.slots.length || object.connections.length).slice(0, count).map(object => ({
      id: object.id, name: object.name, type: object.type, parent: object.parent, box: object.box,
      text: object.text.slice(0, 160), textTruncated: object.text.length > 160, slotCount: object.slots.length, slots: object.slots.slice(0, 8).map(slot => ({ id: slot.id, kind: slot.kind })), connections: object.connections.slice(0, 8),
      anchors: value.mapping.filter(mapping => mapping.sourceObject === object.id && mapping.status === 'mapped').slice(0, 8).map(mapping => ({ anchor: mapping.anchor, confidence: mapping.confidence, method: mapping.method })),
    })), notice: 'Bounded semantic object sample. Read compositionPath for all source objects, slots, connections, anchors and mapping ambiguities; unmapped paint is not a semantic identity.' }
}
export type ResourceSummary = Omit<LayoutResource, 'searchText'>
export interface ResourceSearch {
  query?: string | undefined
  kind?: 'layout' | 'diagram' | undefined
  density?: 'airy' | 'balanced' | 'dense' | undefined
  source?: string | undefined
  status?: 'reconstructed' | 'needs-review' | 'excluded' | undefined
  limit?: number | undefined
  offset?: number | undefined
}

const aliases: Record<string, string[]> = {
  流程: ['process', '步骤', 'step'], 时间轴: ['timeline', '历程', '里程碑'],
  闭环: ['cycle', '循环', 'pdca'], 对比: ['comparison', '比较', 'vs'],
  矩阵: ['matrix', '象限', 'swot'], 层级: ['pyramid', 'hierarchy', '金字塔'],
  架构: ['hierarchy', '组织', '体系'], 数据: ['metrics', 'chart', '指标', '图表'],
  图文: ['image-text', '图片', '排版'], 封面: ['cover'], 目录: ['agenda'],
  逻辑图: ['diagram', 'relationship', '逻辑', '关系'],
}
const stopWords = new Set(['的', '了', '一个', '一些', '帮我', '请', '需要', '可以', '这', '这里', '那', '和', '或', '与', '用', '把', '做', '成', '改', '一', '有', '是', '我', '给', '让', '对', '不', '都', '个', '种', '某', '上', '下', '将', '页', '页面', 'a', 'an', 'the', 'and', 'or', 'to', 'for', 'please'])
function terms(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase().trim()
  // Chinese word segmentation plus bigrams makes arbitrary Chinese prose searchable
  // without downloading embeddings or depending on a provider/API key.
  const segments = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(normalized)]
    .filter((part) => part.isWordLike && !stopWords.has(part.segment)).map((part) => part.segment)
  return [...new Set([...segments, ...[...normalized.matchAll(/[\p{Script=Han}]{2,}/gu)]
    .flatMap(([word]) => Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2)))])]
}
function expandedTerms(query: string): { original: string[]; expanded: string[] } {
  const original = terms(query)
  const expanded = new Set(original)
  for (const [key, values] of Object.entries(aliases)) {
    if ([key, ...values].some((value) => query.toLowerCase().includes(value)))
      for (const value of [key, ...values]) expanded.add(value)
  }
  return { original, expanded: [...expanded] }
}
export function rankResources(entries: readonly LayoutResource[], input: ResourceSearch = {}) {
  const query = (input.query ?? '').trim().slice(0, 2000)
  const { original, expanded } = expandedTerms(query)
  const candidates = entries.filter((item) =>
    (input.status ? item.status === input.status : item.status !== 'excluded') &&
    (!input.kind || item.kind === input.kind) &&
    (!input.density || item.density === input.density) &&
    (!input.source || item.source === input.source),
  )
  const ranked = candidates.map((item) => {
    const fields: [string, number][] = [
      [item.id, 12], [item.title, 8], [item.tags.join(' '), 7], [item.description, 4],
      [item.scenarios, 3], [item.style, 2], [item.searchText, 0.3],
    ]
    let score = query ? 0 : item.status === 'reconstructed' ? 2 : 1
    const matched = new Set<string>()
    for (const [value, weight] of fields) {
      const text = value.normalize('NFKC').toLowerCase()
      if (query && text.includes(query.toLowerCase())) score += weight * 3
      for (const term of expanded) if (text.includes(term)) {
        score += weight * (original.includes(term) ? 2 : 0.2)
        matched.add(term)
      }
    }
    for (const term of original) if (matched.has(term)) score += /^[a-z][a-z0-9-]{1,}$/i.test(term) ? 120 : 20
    if (query && matched.size) score += item.status === 'reconstructed' ? 1 : 0
    if (query && expanded.some(term => ['process', 'cycle', 'matrix', 'hierarchy', 'timeline', 'swot', '逻辑图'].includes(term)) && (item.stats.textBlocks ?? 0) < 3 && (item.stats.objects ?? 0) < 12) score -= 80
    if (item.renderQa) score += item.renderQa.error || item.renderQa.missingImages || item.renderQa.textOutsidePage ? -60 : item.renderQa.textOverflow ? -Math.min(30, item.renderQa.textOverflow * 2) : (item.renderQa.blockSsim ?? 1) < .92 || (item.renderQa.normalizedMae ?? 0) > .035 ? -8 : 6
    return { item, score, matched: [...matched] }
  }).filter(({ matched }) => !query || matched.length > 0)
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
  const offset = Math.max(0, Math.floor(input.offset ?? 0))
  const limit = Math.min(60, Math.max(1, Math.floor(input.limit ?? 24)))
  return {
    total: ranked.length,
    offset,
    limit,
    items: ranked.slice(offset, offset + limit).map(({ item, score, matched }) => {
      const { searchText, ...summary } = item
      void searchText
      return { ...summary, score, matched }
    }),
  }
}

/** Resolve both source workspace and bundled CLI, with an explicit private-library override. */
export async function resolveResourcesRoot(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = process.env.FASTPPT_RESOURCES_ROOT
    ? [resolve(process.env.FASTPPT_RESOURCES_ROOT)]
    : [resolve(here, '..'), resolve(here, '../resources'), resolve(here, '../../resources')]
  for (const path of candidates) {
    try { await access(join(path, 'index.json')); return path } catch { /* next */ }
  }
  throw new Error('Resource library unavailable: build packages/resources or set FASTPPT_RESOURCES_ROOT')
}

export class ResourceLibrary {
  readonly #root: Promise<string>
  #entries: Promise<LayoutResource[]> | undefined
  #signature = ''
  constructor(root?: string) { this.#root = root ? Promise.resolve(root) : resolveResourcesRoot() }
  async entries(): Promise<LayoutResource[]> {
    const root = await this.#root
    const signature = (await Promise.all(['index.json', 'render-audit.json'].map(async name => {
      try { const info = await stat(join(root, name)); return `${info.mtimeMs}:${info.size}` } catch { return 'missing' }
    }))).join('|')
    if (signature !== this.#signature) { this.#entries = undefined; this.#signature = signature }
    this.#entries ??= this.#root.then(async (root) => {
      const source = await readFile(join(root, 'index.json'), 'utf8')
      const data = JSON.parse(source) as { version: number; entries: LayoutResource[] }
      if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error('Unsupported resource index')
      try {
        const audit = JSON.parse(await readFile(join(root, 'render-audit.json'), 'utf8')) as { sourceIndexSha256: string; results: ({ id: string } & Partial<NonNullable<LayoutResource['renderQa']>>)[] }
        if (audit.sourceIndexSha256 === createHash('sha256').update(source).digest('hex')) {
          const results = new Map(audit.results.map(entry => [entry.id, entry]))
          return data.entries.map(entry => {
            const result = results.get(entry.id)
            if (!result) return entry
            const warnings = [...new Set([...entry.warnings, ...(result.error ? ['render-error'] : []), ...(result.missingImages ? ['render-missing-images'] : []), ...(result.textOverflow ? ['render-text-overflow'] : []), ...(result.textOutsidePage ? ['render-text-outside-page'] : [])])]
            return { ...entry, warnings, status: entry.status === 'excluded' ? 'excluded' as const : warnings.length ? 'needs-review' as const : entry.status,
              renderQa: { ...entry.renderQa, textOverflow: result.textOverflow ?? 0, missingImages: result.missingImages ?? 0, ...(result.textOutsidePage !== undefined ? { textOutsidePage: result.textOutsidePage } : {}), ...(result.blockSsim !== undefined ? { blockSsim: result.blockSsim } : {}), ...(result.normalizedMae !== undefined ? { normalizedMae: result.normalizedMae } : {}), ...(result.error ? { error: result.error } : {}) } }
          })
        }
      } catch { /* A source scan remains usable before the optional render audit. */ }
      return data.entries
    }).catch((error: unknown) => { this.#entries = undefined; throw error })
    return this.#entries
  }
  async search(input: ResourceSearch = {}) { return rankResources(await this.entries(), input) }
  async read(id: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(id)) throw new Error('Invalid resource id')
    const entry = (await this.entries()).find((item) => item.id === id)
    if (!entry) return undefined
    const markdown = await readFile(await this.filePath(entry.file), 'utf8')
    let composition: ResourceComposition | undefined
    let compositionPath: string | undefined
    let compositionWarning: string | undefined
    try {
      compositionPath = await this.filePath(`compositions/${id}.json`)
      const candidate = JSON.parse(await readFile(compositionPath, 'utf8')) as ResourceComposition
      if (candidate.version !== 1 || candidate.id !== id || !Array.isArray(candidate.objects) || !Array.isArray(candidate.mapping)) throw new Error('Unsupported composition')
      if (candidate.pageSha256 === createHash('sha256').update(markdown).digest('hex')) composition = candidate
      else compositionWarning = 'Composition mapping is stale for this Markdown revision; regenerate composition-map.py before using its anchors.'
    } catch { compositionWarning = 'Composition unavailable; inspect native page anchors directly.' }
    return { resource: entry, markdown, composition, compositionPath, compositionWarning }
  }
  async filePath(path: string): Promise<string> {
    if (!/^(?:pages\/[a-z0-9-]+\.md|compositions\/[a-z0-9-]+\.json|assets\/[a-f0-9]+\.(?:png|jpe?g|gif|webp|svg|woff2))$/.test(path)) throw new Error('Invalid resource path')
    const root = await realpath(await this.#root)
    const target = await realpath(join(root, path))
    const offset = relative(root, target)
    if (offset.startsWith('..') || isAbsolute(offset)) throw new Error('Resource escaped library')
    return target
  }
  async preview(id: string): Promise<string | undefined> {
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(id)) throw new Error('Invalid resource id')
    const entry = (await this.entries()).find((item) => item.id === id)
    if (!entry) return undefined
    // Gallery cards need only page HTML; semantic graphs are loaded by read().
    const markdown = await readFile(await this.filePath(entry.file), 'utf8')
    // Only trusted, locally generated HTML from the library is rendered. Serve
    // in an opaque sandbox with CSP; neither Markdown nor source PPT can execute JS.
    const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, '')
      .replaceAll('../assets/', '../assets/')
    const ratio = entry.aspect
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:grid;place-items:center;background:#eef1f4}main{position:relative;width:min(100vw,${ratio * 100}vh);height:min(100vh,${100 / ratio}vw)}</style><main>${body}</main></html>`
  }
}

export const RESOURCE_AUTHORING_GUIDANCE = `<fastppt-resource-guidance>
Use search_resources to find page structures and logic diagrams by slide job, relationship, content density and number of items. Read 2–3 candidates with read_resource; the search response includes source, license, reconstruction status and limitations. A resource is a composition reference, not a replacement for the confirmed theme. Retain the active theme Skill, typography and palette. Choose explicitly between reusing a structure, combining a diagram with a registered theme layout, and creating a new composition when candidates do not fit. Never insert a full-slide screenshot, fabricate chart values or silently drop source content. Use compositionPath to inspect named source objects, real groups, replaceable slots and mapped HTML anchor sets. Mapping scores are not identity proof: inspect ambiguity and unmapped source objects; never infer semantics from anonymous paint ordering. For needs-review candidates, inspect warnings and rebuild unsupported objects with native HTML/SVG and editable labels. Copy referenced local assets into the deck assets directory and rewrite relative paths before writing; do not leave library URLs in delivered Markdown. Do not copy reference sample data as factual claims. Preserve source provenance and licensing. For a selected region, use normalized coordinates relative to the slide, inspect the target page, edit intersecting elements and necessary dependencies only, and preserve all other pages byte-for-byte. End with a concise result, checks and any unresolved limitation.
</fastppt-resource-guidance>`
