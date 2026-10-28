// Slidev runtime and parsed-document shapes are both accepted.
export function frontmatter(slide) {
  return (
    slide?.frontmatter ??
    slide?.meta?.slide?.frontmatter ??
    slide?.meta?.frontmatter ??
    {}
  )
}
export function sections(slides = []) {
  return slides.flatMap((slide, index) => {
    const fm = frontmatter(slide)
    if (fm.layout !== 'section' && fm.sectionStart !== true) return []
    const title =
      fm.sectionLabel ??
      slide?.meta?.slide?.title ??
      slide?.title ??
      fm.title ??
      `章节 ${index + 1}`
    return [{ page: slide.no ?? index + 1, title: String(title) }]
  })
}
export function activeSection(groups, page) {
  return groups.findLastIndex((group) => group.page <= page)
}
export function columnRatio(value, fallback = '1:1') {
  const parts = String(value ?? fallback)
    .split(':')
    .map(Number)
  return parts.length === 2 && parts.every((n) => Number.isFinite(n) && n > 0)
    ? parts.map((n) => `minmax(0, ${n}fr)`).join(' ')
    : 'minmax(0, 1fr) minmax(0, 1fr)'
}
export function rhythm(local = {}, global = {}) {
  const pick = (key) => local[key] ?? global[key]
  const density = ['normal', 'compact', 'dense'].includes(pick('density'))
    ? pick('density')
    : 'normal'
  const gaps = { none: '0px', tight: '10px', normal: '18px', loose: '26px' }
  const gap = pick('flowGap') ?? 'normal'
  const flowGap =
    gaps[gap] ??
    (/^\d+(\.\d+)?(px|rem|em)$/.test(String(gap)) ? gap : gaps.normal)
  const value = Number(pick('lineHeight'))
  return {
    density,
    flowGap,
    lineHeight:
      Number.isFinite(value) && value >= 1 && value <= 2.4
        ? value
        : { normal: 1.55, compact: 1.45, dense: 1.4 }[density],
  }
}
