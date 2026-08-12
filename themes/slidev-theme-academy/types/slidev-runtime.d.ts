import type { ComputedRef, Ref } from 'vue'

export interface ThemeSlide {
  no?: number
  title?: string
  frontmatter?: Record<string, unknown>
  meta?: {
    layout?: string
    frontmatter?: Record<string, unknown>
    slide?: {
      title?: string
      frontmatter?: Record<string, unknown>
    }
  }
}

export interface ThemeSlidevRuntime {
  configs: {
    authors?: unknown
    conference?: string
    date?: string
    figureNumberSuffix?: string
    figurePrefix?: string
    figureZoom?: boolean
    flowGap?: unknown
    lineHeight?: unknown
    presenterName?: string
    sectionBar?: boolean
    sectionBarMode?: string
    tableNumberSuffix?: string
    tablePrefix?: string
    talkTitle?: string
    [key: string]: unknown
  }
  nav: {
    clicks: number
    currentPage: number
    slides: ThemeSlide[]
    go(page: number, click?: number): void
  }
}

declare global {
  const $slidev: ThemeSlidevRuntime
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $slidev: ThemeSlidevRuntime
  }
}

declare module '@slidev/client' {
  export const configs: ThemeSlidevRuntime['configs']
  export function useNav(): {
    slides: Ref<ThemeSlide[]>
    currentPage: Ref<number>
    total: ComputedRef<number>
    tocTree: ComputedRef<unknown[]>
  }
  export function useSlideContext(): {
    $page: Ref<number>
    $slidev: ThemeSlidevRuntime
  }
}

declare module '@slidev/types' {
  export interface AppContext {
    router: {
      afterEach(handler: () => void): unknown
    }
  }

  export interface MarkdownTransformContext {
    [key: string]: unknown
  }
}

export {}
