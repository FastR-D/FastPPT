declare module '@slidev/client' {
  import type { Ref } from 'vue'

  export function useSlideContext(): {
    $frontmatter: Record<string, unknown>
    $page?: number | string
    $slidev?: {
      configs?: Record<string, unknown>
      nav?: {
        currentPage?: unknown
      }
      themeConfigs?: Ref<Record<string, unknown>>
    }
  }
}
