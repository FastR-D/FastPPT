export interface OverviewPageState {
  width: number
  height: number
  display: string
  visibility: string
}

export function renderedOverviewPageCount(
  pages: readonly OverviewPageState[],
): number {
  return pages.filter(
    (page) =>
      page.display !== 'none' &&
      page.visibility !== 'hidden' &&
      page.visibility !== 'collapse' &&
      page.width > 0 &&
      page.height > 0,
  ).length
}

export function overviewRenderComplete(
  renderedPageCount: number,
  expectedPageCount: number,
): boolean {
  return expectedPageCount > 0 && renderedPageCount === expectedPageCount
}
