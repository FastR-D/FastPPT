import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export interface IconCollectionSummary {
  prefix: string
  name: string
  total: number
}

export interface IconMatch {
  prefix: string
  collection: string
  name: string
  category: string | undefined
  svg: string
}

export interface IconSearchOptions {
  /** Maximum results; defaults to 20, clamped to [1, 100]. */
  limit?: number
  /** Restrict the search to a single collection prefix. */
  prefix?: string
}

interface IconifyAlias {
  parent: string
  width?: number
  height?: number
}

interface IconifyIconData {
  body: string
  width?: number
  height?: number
}

interface IconifyCollectionData {
  prefix: string
  info?: { name?: string; total?: number }
  icons: Record<string, IconifyIconData>
  aliases?: Record<string, IconifyAlias>
  categories?: Record<string, string[]>
  width?: number
  height?: number
}

interface CollectionRegistry {
  prefix: string
  name: string
  modulePath: string
}

/**
 * Icon collections installed by default. The same prefixes must be declared
 * as `@iconify-json/*` dependencies of the Slidev themes so decks can render
 * `i-<prefix>-<name>` UnoCSS classes.
 */
const COLLECTIONS: CollectionRegistry[] = [
  {
    prefix: 'mdi',
    name: 'Material Design Icons',
    modulePath: '@iconify-json/mdi/icons.json',
  },
  {
    prefix: 'ant-design',
    name: 'Ant Design Icons',
    modulePath: '@iconify-json/ant-design/icons.json',
  },
]

const cache = new Map<string, IconifyCollectionData>()

async function loadCollection(
  prefix: string,
): Promise<IconifyCollectionData | undefined> {
  const cached = cache.get(prefix)
  if (cached) return cached
  const registry = COLLECTIONS.find((collection) => collection.prefix === prefix)
  if (!registry) return undefined
  const filePath = require.resolve(registry.modulePath)
  const data = JSON.parse(await readFile(filePath, 'utf8')) as IconifyCollectionData
  cache.set(prefix, data)
  return data
}

function buildSvg(
  body: string,
  iconWidth: number | undefined,
  iconHeight: number | undefined,
  collection: IconifyCollectionData,
): string {
  const width = iconWidth ?? collection.width ?? 1024
  const height = iconHeight ?? collection.height ?? width
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="1em" height="1em">${body}</svg>`
  )
}

/**
 * Lower is better. Canonical-name hits beat alias hits, which beat category
 * keywords; exact matches beat prefixes, which beat substrings.
 */
function rank(
  name: string,
  needle: string,
  categories: readonly string[],
  kind: 'canonical' | 'alias',
): number | undefined {
  const lower = name.toLowerCase()
  if (lower === needle) return kind === 'canonical' ? 0 : 2
  if (lower.startsWith(needle)) return kind === 'canonical' ? 1 : 4
  if (lower.includes(needle)) return kind === 'canonical' ? 3 : 5
  if (categories.some((category) => category.toLowerCase() === needle)) return 6
  if (categories.some((category) => category.toLowerCase().includes(needle)))
    return 7
  return undefined
}

interface Candidate extends IconMatch {
  score: number
}

export async function listCollections(): Promise<IconCollectionSummary[]> {
  const summaries: IconCollectionSummary[] = []
  for (const collection of COLLECTIONS) {
    const data = await loadCollection(collection.prefix)
    if (!data) continue
    summaries.push({
      prefix: collection.prefix,
      name: collection.name,
      total: data.info?.total ?? Object.keys(data.icons).length,
    })
  }
  return summaries
}

export async function searchIcons(
  query: string,
  options: IconSearchOptions = {},
): Promise<IconMatch[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
  const prefixes = options.prefix
    ? [options.prefix]
    : COLLECTIONS.map((collection) => collection.prefix)

  const candidates: Candidate[] = []
  for (const prefix of prefixes) {
    const data = await loadCollection(prefix)
    if (!data) continue
    const collectionName =
      COLLECTIONS.find((collection) => collection.prefix === prefix)?.name ??
      prefix
    const categories = data.categories ?? {}

    for (const [name, icon] of Object.entries(data.icons)) {
      const score = rank(name, needle, categories[name] ?? [], 'canonical')
      if (score === undefined) continue
      candidates.push({
        score,
        prefix,
        collection: collectionName,
        name,
        category: categories[name]?.[0],
        svg: buildSvg(icon.body, icon.width, icon.height, data),
      })
    }
    for (const [aliasName, alias] of Object.entries(data.aliases ?? {})) {
      const parent = data.icons[alias.parent]
      if (!parent) continue
      const score = rank(aliasName, needle, [], 'alias')
      if (score === undefined) continue
      // 别名本身就是有效标识(`mdi:<alias>` 渲染时解析到父图标),保留原名。
      candidates.push({
        score,
        prefix,
        collection: collectionName,
        name: aliasName,
        category: categories[alias.parent]?.[0],
        svg: buildSvg(
          parent.body,
          alias.width ?? parent.width,
          alias.height ?? parent.height,
          data,
        ),
      })
    }
  }

  candidates.sort(
    (a, b) => a.score - b.score || a.name.localeCompare(b.name),
  )
  return candidates.slice(0, limit).map((candidate) => ({
    prefix: candidate.prefix,
    collection: candidate.collection,
    name: candidate.name,
    category: candidate.category,
    svg: candidate.svg,
  }))
}
