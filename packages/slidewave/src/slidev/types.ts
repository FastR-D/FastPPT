import type { Layout } from '../types'

export * from '../snapshot-types.js'
export type {
  HtmlDeckRenderOptions,
  HtmlRenderOptions,
  HtmlRenderResult,
} from './render-types.js'

export interface HtmlCaptureOptions {
  /** Negotiated transport version; default V1 preserves legacy callers. */
  snapshotVersion?: import('../snapshot-types.js').HtmlSnapshotVersion
  id?: string
  canvasWidth?: number
  canvasHeight?: number
  embedImages?: boolean
  includePseudoElements?: boolean
  excludeSelectors?: string[]
  waitForReady?: boolean
  ready?: () => void | Promise<void>
  precision?: number
  /** Component-level capture policy. Defaults to built-in theme auto-detection. */
  theme?: import('./themes/types').SlidevCaptureThemeOption
}

export interface SlidevCaptureOptions extends Omit<HtmlCaptureOptions, 'id'> {
  rootSelector?: string
  roots?: Iterable<HTMLElement>
  includeHiddenRoots?: boolean
  onSlideCaptured?: (completed: number, total: number) => void
}
