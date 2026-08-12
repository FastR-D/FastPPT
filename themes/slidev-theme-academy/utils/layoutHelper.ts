import type { CSSProperties } from 'vue'
import type { ThemeSlide } from '../types/slidev-runtime'

export type SlideLike = ThemeSlide | Record<string, unknown> | null | undefined

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

// Three fallback paths reflect the two contexts where this is called:
//   1. slide.frontmatter          — test stubs and Slidev's transformer context
//                                   (ctx.options.data.slides[i].source is NOT used here;
//                                    that context accesses .source.frontmatter directly)
//   2. slide.meta?.slide?.frontmatter — primary runtime shape of $slidev.nav.slides
//   3. slide.meta?.frontmatter    — fallback for alternative Slidev runtime shapes
// If Slidev restructures its slide object, add the new path here rather than
// scattering defensive access across call sites.
export function getSlideFrontmatter(slide: SlideLike): Record<string, unknown> {
  const value = record(slide)
  const meta = record(value?.meta)
  const nestedSlide = record(meta?.slide)
  return (
    record(value?.frontmatter) ??
    record(nestedSlide?.frontmatter) ??
    record(meta?.frontmatter) ??
    {}
  )
}

export function getLayout(slide: SlideLike): string {
  const value = record(slide)
  const meta = record(value?.meta)
  const layout = getSlideFrontmatter(slide).layout ?? meta?.layout
  return typeof layout === 'string' ? layout : ''
}

export function getSectionTitle(slide: SlideLike, fallback: string): string {
  const value = record(slide)
  const meta = record(value?.meta)
  const nestedSlide = record(meta?.slide)
  const frontmatter = getSlideFrontmatter(slide)
  const title =
    frontmatter.sectionLabel ??
    nestedSlide?.title ??
    meta?.title ??
    value?.title ??
    frontmatter.title ??
    fallback
  return typeof title === 'string' ? title : fallback
}

/**
 * Read a slide's per-page sectionBarMode frontmatter override, falling back
 * to a default. Each call site still owns its `currentSlide` reactive
 * lookup and `barMode` computed wrapper — this only deduplicates the
 * three-level frontmatter chain.
 */
export function getSectionBarMode(slide: SlideLike, fallback: string = 'full'): string {
  const local = getSlideFrontmatter(slide).sectionBarMode
  return typeof local === 'string' ? local : fallback
}

export function resolveAssetUrl(url: string) {
  if (url.startsWith('/')) return import.meta.env.BASE_URL + url.slice(1)
  return url
}

export function handleBackground(background?: string, coverOverlay = false): CSSProperties {
  const isColor =
    background &&
    ([
      '#',
      'rgb',
      'hsl',
      'oklch',
      'lch',
      'lab',
      'hwb',
      'color',
      'transparent',
      'currentColor',
      'inherit',
    ].some((v) => background.startsWith(v)) ||
      /^[a-z]+$/.test(background))

  const style: CSSProperties = {
    background: isColor ? background : undefined,
    backgroundImage: isColor
      ? undefined
      : background
        ? coverOverlay
          ? `linear-gradient(90deg,rgba(255,255,255,1),rgba(255,255,255,0.85)),url("${resolveAssetUrl(background)}")`
          : `url("${resolveAssetUrl(background)}")`
        : undefined,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
    backgroundSize: 'cover',
  }

  if (!style.background) delete style.background
  return style
}

export function resolveBodyMargin(margin?: 'normal' | 'tight' | 'tighter' | 'none'): CSSProperties {
  const marginMap: Record<'normal' | 'tight' | 'tighter' | 'none', { x: string; y: string }> = {
    normal: { x: '2.8rem', y: '1.75rem' },
    tight: { x: '2.0rem', y: '1.25rem' },
    tighter: { x: '1.2rem', y: '0.8rem' },
    none: { x: '0rem', y: '0rem' },
  }

  const value = marginMap[margin ?? 'normal']
  return {
    '--ustc-px': value.x,
    '--ustc-pl': value.x,
    '--ustc-py': value.y,
  }
}

export interface AuthorEntry {
  name: string
  affiliations: string[]
  marks?: string[]
}

export interface NormalizedAuthor {
  name: string
  affiliations: string[]
  marks: string[]
}

function normalizeAuthor(entry: AuthorEntry): NormalizedAuthor {
  return { name: entry.name, affiliations: entry.affiliations ?? [], marks: entry.marks ?? [] }
}

export function normalizeAuthors(authors: AuthorEntry[]): NormalizedAuthor[] {
  return authors.map(normalizeAuthor)
}

interface InstitutionMap {
  [key: string]: number
}
interface AuthorInstitutions {
  instituteNum: number[]
  instituteName: string[]
}
interface AuthorsDict {
  [key: string]: AuthorInstitutions
}

export interface FootnoteEntry {
  number: number
  content: string
}

// We expose `presenterName` (not `presenter`) as the theme's frontmatter/config
// override because Slidev reserves `presenter` for its built-in presenter mode
// option (`true | false | 'dev'`). Using `presenter` here would shadow that
// option in global frontmatter and configs.
export function getPresenterName(
  authors: unknown = [],
  presenterName?: unknown,
  frontmatter?: Record<string, unknown>,
): string {
  const normalizedAuthors = Array.isArray(authors)
    ? authors.filter(isAuthorEntry)
    : []
  if (typeof presenterName === 'string' && presenterName.trim()) return presenterName
  const frontmatterPresenterName = frontmatter?.presenterName
  if (typeof frontmatterPresenterName === 'string' && frontmatterPresenterName.trim())
    return frontmatterPresenterName
  return normalizedAuthors[0]?.name ?? ''
}

function isAuthorEntry(value: unknown): value is AuthorEntry {
  const candidate = record(value)
  return (
    typeof candidate?.name === 'string' &&
    Array.isArray(candidate.affiliations) &&
    candidate.affiliations.every((item) => typeof item === 'string')
  )
}

export function handleAuthor(authors: AuthorEntry[] = []): [AuthorsDict, FootnoteEntry[]] {
  const normalized = normalizeAuthors(authors)
  const allInstitutions: InstitutionMap = {}
  let institutionIndex = 1

  normalized.forEach(({ affiliations }) => {
    affiliations.forEach((inst) => {
      if (!allInstitutions[inst]) allInstitutions[inst] = institutionIndex++
    })
  })

  const authorsDict: AuthorsDict = normalized.reduce((acc: AuthorsDict, { name, affiliations }) => {
    acc[name] = {
      instituteNum: affiliations.flatMap((institution) => {
        const number = allInstitutions[institution]
        return number === undefined ? [] : [number]
      }),
      instituteName: affiliations,
    }
    return acc
  }, {})

  return [
    authorsDict,
    Object.entries(allInstitutions).map(([content, number]) => ({ number, content })),
  ]
}
