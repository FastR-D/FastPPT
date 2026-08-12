export interface TimelineGridItem {
  active?: boolean
}

export function resolveTimelineLabelSpan(items: readonly TimelineGridItem[]): 3 | 5 {
  return items.length <= 2 ? 5 : 3
}

export function resolveTimelineItemGridStyle(
  items: readonly TimelineGridItem[],
  index: number,
) {
  const count = items.length || 1
  const activeItemIndices = items.flatMap((item, itemIndex) => item.active ? [itemIndex] : [])

  if (count === 3 && activeItemIndices.length === 1) {
    const activeIndex = activeItemIndices[0]
    const spans = items.map((_, itemIndex) => itemIndex === activeIndex ? 6 : 3)
    const start = spans.slice(0, index).reduce((sum, span) => sum + span, 1)

    return { gridColumn: `${start} / ${start + spans[index]}` }
  }

  if (count > 12)
    throw new Error('[Timeline] items поддерживает не больше 12 событий.')

  const start = Math.floor((index * 12) / count) + 1
  const end = Math.floor(((index + 1) * 12) / count) + 1

  return { gridColumn: `${start} / ${end}` }
}
