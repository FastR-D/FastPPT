/** Slidev 52 marks overview thumbnails with this class. */
export const SLIDEV_OVERVIEW_ROOT_SELECTOR =
  '.slidev-page.disable-view-transition'

/** Replaces Slidev overview's global current-page value with the captured page id. */
export function normalizeSlidevPageNumber(
  text: string,
  slideId: string | undefined,
): string {
  if (!slideId || !/^\d+$/.test(slideId)) return text
  return text.replace(
    /\d+(?=\s*\/\s*\d+)/,
    String(Number.parseInt(slideId, 10)),
  )
}
