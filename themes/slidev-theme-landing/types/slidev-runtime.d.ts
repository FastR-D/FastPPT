import type { ComputedRef, Ref } from 'vue'

export interface ThemeTocItem {
  title: string
  path?: string
  children?: ThemeTocItem[]
}

export interface ThemeSlidevRuntime {
  nav: {
    clicks: number
    currentPage: number
    go(page: number, click?: number): void
  }
}

declare module '@slidev/client' {
  export function useNav(): {
    currentPage: Ref<number>
    total: ComputedRef<number>
    tocTree: ComputedRef<ThemeTocItem[]>
    isPrintMode: ComputedRef<boolean>
    next(): void
    prev(): void
  }
  export function useSlideContext(): {
    $page: Ref<number>
    $slidev: ThemeSlidevRuntime
  }
}

declare module '@slidev/types' {
  export interface AppSetupContext {
    app: {
      use(plugin: unknown): void
    }
  }

  export type ShikiSetupReturn = Record<string, unknown>

  export function defineAppSetup(
    setup: (context: AppSetupContext) => void | Promise<void>,
  ): typeof setup
  export function defineMermaidSetup<T>(setup: () => T): () => T
  export function defineMonacoSetup<T>(
    setup: (monaco: unknown) => T | Promise<T>,
  ): typeof setup
  export function defineShikiSetup<T>(setup: () => T): () => T
}

export {}
