import { access, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { ColorPaletteSchema, type ColorPalette } from '@fastppt/protocol'
import { z } from 'zod'

export const PaletteSearchSchema = z.object({
  query: z.string().trim().max(2000).default(''),
  source: z.string().max(100).optional(),
  kind: ColorPaletteSchema.shape.kind.optional(),
  count: z.coerce.number().int().min(2).max(12).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(60).default(24),
})
export type PaletteSearch = z.input<typeof PaletteSearchSchema>
const IndexSchema = z.object({
  version: z.literal(1),
  entries: z.array(ColorPaletteSchema),
})
const synonyms = [
  [
    '商务',
    '商业',
    '汇报',
    '金融',
    'business',
    'corporate',
    '蓝色',
    '中性',
    '经典',
  ],
  [
    '科技',
    '技术',
    '互联网',
    'tech',
    'digital',
    'blue',
    'cyan',
    '蓝色',
    '青色',
    '现代',
  ],
  ['自然', '环保', '森林', '生态', 'nature', 'green', 'earth', '绿色', '棕色'],
  ['温柔', '柔和', '奶油', '莫兰迪', 'pastel', 'muted', '浅色'],
  ['学术', '科研', '数据', '图表', 'academic', 'scientific', 'visualization'],
  ['活力', '年轻', '运动', 'vibrant', '红色', '橙色', '黄色'],
  ['暗色', '黑暗', '深色', 'dark', '编辑器'],
  ['高端', '奢华', 'luxury', '中性', '深色', '灰色'],
]
function terms(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase()
  const original = normalized.match(/[a-z0-9#-]+|[\p{Script=Han}]+/gu) ?? []
  return [
    ...new Set(
      original.flatMap((term) =>
        /\p{Script=Han}/u.test(term) && term.length > 2
          ? [
              term,
              ...Array.from({ length: term.length - 1 }, (_, i) =>
                term.slice(i, i + 2),
              ),
            ]
          : [term],
      ),
    ),
  ]
}
function distance(a: string, b: string): number {
  return Math.sqrt(
    [1, 3, 5].reduce(
      (sum, offset) =>
        sum +
        (parseInt(a.slice(offset, offset + 2), 16) -
          parseInt(b.slice(offset, offset + 2), 16)) **
          2,
      0,
    ),
  )
}
export function rankPalettes(
  entries: readonly ColorPalette[],
  input: PaletteSearch = {},
) {
  const options = PaletteSearchSchema.parse(input)
  const query = options.query.toLowerCase()
  const original = terms(query)
  const expanded = [
    ...new Set(
      synonyms
        .filter((group) => group.some((term) => query.includes(term)))
        .flat(),
    ),
  ]
  const color = query.match(/#[0-9a-f]{6}\b/i)?.[0]?.toUpperCase()
  const ranked = entries
    .filter(
      (item) =>
        (!options.source || item.source === options.source) &&
        (!options.kind || item.kind === options.kind) &&
        (!options.count || item.colors.length === options.count),
    )
    .map((item) => {
      const title =
        `${item.title} ${item.family} ${item.aliases.join(' ')}`.toLowerCase()
      const text = `${title} ${item.source} ${item.kind} ${item.tags.join(' ')}`
        .normalize('NFKC')
        .toLowerCase()
      let score = query
        ? 0
        : item.source === 'Color Hunt'
          ? 12
          : item.kind === 'theme'
            ? 8
            : 1
      for (const term of original)
        if (text.includes(term)) score += title.includes(term) ? 30 : 12
      for (const term of expanded) if (text.includes(term)) score += 2
      if (color)
        score += Math.max(
          0,
          100 -
            Math.min(...item.colors.map((value) => distance(color, value))) / 3,
        )
      return { item, score }
    })
    .filter((result) => !query || result.score > 0)
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
  return {
    total: ranked.length,
    offset: options.offset,
    limit: options.limit,
    items: ranked
      .slice(options.offset, options.offset + options.limit)
      .map((result) => result.item),
  }
}

export class PaletteLibrary {
  #root: string | undefined
  #signature = ''
  #entries: Promise<ColorPalette[]> | undefined
  constructor(root = process.env.FASTPPT_PALETTES_ROOT) {
    this.#root = root
  }
  async entries(): Promise<ColorPalette[]> {
    if (!this.#root) {
      for (const relative of ['../data/', '../../data/', '../palettes/']) {
        const candidate = fileURLToPath(new URL(relative, import.meta.url))
        try { await access(join(candidate, 'index.json')); this.#root = candidate; break } catch { /* Try source, compiled, then bundled CLI data. */ }
      }
      if (!this.#root) throw new Error('Palette library unavailable; set FASTPPT_PALETTES_ROOT.')
    }
    const path = join(this.#root, 'index.json')
    const info = await stat(path)
    const signature = `${info.mtimeMs}:${info.size}`
    if (signature !== this.#signature) {
      this.#signature = signature
      this.#entries = undefined
    }
    this.#entries ??= readFile(path, 'utf8')
      .then((source) => IndexSchema.parse(JSON.parse(source)).entries)
      .catch((error: unknown) => {
        this.#entries = undefined
        throw error
      })
    return this.#entries
  }
  async search(input: PaletteSearch = {}) {
    return rankPalettes(await this.entries(), input)
  }
  async read(id: string): Promise<ColorPalette | undefined> {
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(id))
      throw new Error('Invalid palette id')
    return (await this.entries()).find((item) => item.id === id)
  }
  async facets() {
    const entries = await this.entries()
    return {
      total: entries.length,
      sources: [...new Set(entries.map((item) => item.source))],
      kinds: [...new Set(entries.map((item) => item.kind))],
    }
  }
  async recommend(
    query: string,
    generate: (prompt: string) => Promise<string>,
    filters: Pick<PaletteSearch, 'source' | 'kind' | 'count'> = {},
  ) {
    query = z.string().trim().min(1).max(2000).parse(query)
    const matched = await this.search({ ...filters, query, limit: 36 })
    const candidates =
      matched.items.length >= 8
        ? matched.items
        : (await this.search({ ...filters, limit: 36 })).items
    if (!candidates.length) throw new Error('当前筛选条件下没有可推荐的配色。')
    // Keep model context varied across source collections and hue families.
    const diverse: ColorPalette[] = [],
      families = new Set<string>()
    for (const item of candidates) {
      if (families.has(item.family) && diverse.length < 20) continue
      families.add(item.family)
      diverse.push(item)
    }
    const prompt = `你是演示文稿配色顾问。根据用户需求，从下面候选配色中选择 3–6 组，说明适用场景、色彩关系和文字可读性建议。仅推荐候选中的 ID，不虚构色号。不要修改文件或运行命令。只返回 JSON：{"recommendations":[{"id":"候选id","reason":"简短中文理由"}]}。\n用户需求：${JSON.stringify(query)}\n候选：${JSON.stringify(diverse.map((item) => ({ id: item.id, title: item.title, colors: item.colors, tags: item.tags, source: item.source })))}`
    const response = (await generate(prompt))
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
    const start = response.indexOf('{'),
      end = response.lastIndexOf('}')
    const parsed = z
      .object({
        recommendations: z
          .array(
            z.object({
              id: z.string(),
              reason: z.string().trim().min(1).max(2000),
            }),
          )
          .min(1)
          .max(8),
      })
      .parse(JSON.parse(response.slice(start, end + 1)))
    const catalog = new Map(diverse.map((item) => [item.id, item]))
    const seen = new Set<string>()
    const recommendations = parsed.recommendations
      .map((item) => {
        const palette = catalog.get(item.id)
        if (!palette) throw new Error('模型返回了候选库之外的配色，请重试。')
        if (seen.has(item.id)) return undefined
        seen.add(item.id)
        return { palette, reason: item.reason }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    return { query, recommendations }
  }
}

export const PALETTE_AUTHORING_GUIDANCE = `<fastppt-palette-guidance>
Use search_palettes and read_palette to find sourced color values by mood, hue, use case and scheme type. Read actual palette colors before recommending. Retain the confirmed theme unless the user asks to recolor; when adopting a palette, describe background, text, primary and accent roles, and verify contrast in context. Palette provenance does not establish text accessibility for every possible pairing.
</fastppt-palette-guidance>`
