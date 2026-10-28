import type { HtmlDeckSnapshot, HtmlSnapshotVersion } from '../snapshot-types.js'
import type { SlidevCaptureThemeOption } from '../slidev/themes/types.js'

export const SLIDEWAVE_CAPTURE_PROTOCOL_VERSION = 1 as const

/** Legacy peers omit capabilities and therefore support V1 only. */
export function negotiateSnapshotVersion(runtime: readonly number[] = [1], server: readonly number[] = [1]): HtmlSnapshotVersion | undefined {
  return ([2, 1] as const).find(version => runtime.includes(version) && server.includes(version))
}

export interface SlidewaveCaptureReady {
  type: 'fastppt.slidewave.capture.ready'
  snapshotVersions?: HtmlSnapshotVersion[]
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
}

export interface SlidewavePreviewState {
  type: 'fastppt.slidewave.preview.state'
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
  page: number | null
  path: string
  /** Visible slide canvas, normalized to the embedded preview viewport. */
  bounds?: { x: number; y: number; width: number; height: number }
  /** Intrinsic canvas dimensions, before Slidev scales the preview. */
  slideSize?: { width: number; height: number }
}

export type SlidewaveAnimationPreview = {
  type: 'fastppt.slidewave.animation.preview'
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
  /** Omitted only for legacy global previews. */
  slide?: number
  motionPreference?: 'system' | 'reduce' | 'full'
} & ({ reset: true; effect?: never; elapsedMs?: never } | {
  reset?: false
  /** Negative positions represent the state before an effect begins. */
  elapsedMs?: number
  effect: { target: string; kind: string; durationMs?: number; id?: string; params?: Record<string, unknown> }
})

export interface SlidewaveCaptureRequest {
  type: 'fastppt.slidewave.capture.request'
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
  requestId: string
  theme?: SlidevCaptureThemeOption
  snapshotVersion?: HtmlSnapshotVersion
}

export interface SlidewaveCaptureCompleted {
  type: 'fastppt.slidewave.capture.completed'
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
  requestId: string
  snapshot: HtmlDeckSnapshot
}

export interface SlidewaveCaptureProgress {
  type: 'fastppt.slidewave.capture.progress'
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
  requestId: string
  completed: number
  total: number
}

export interface SlidewaveCaptureFailed {
  type: 'fastppt.slidewave.capture.failed'
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
  requestId: string
  error: string
}

export interface SlidewaveOverflowResult {
  inspectionAvailable: true
  overflow: boolean
  slide: number
  slideCount: number
  viewport: { width: number; height: number }
  overflowBy: { top: number; right: number; bottom: number; left: number }
  elements: Array<{
    selector: string
    text?: string
    overflow: { top: number; right: number; bottom: number; left: number }
  }>
}

export interface SlidewaveOverflowRequest {
  type: 'fastppt.slidewave.overflow.request'
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
  requestId: string
  slide: number
}

export interface SlidewaveOverflowCompleted {
  type: 'fastppt.slidewave.overflow.completed'
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
  requestId: string
  result: SlidewaveOverflowResult
}

export interface SlidewaveQualityIssue {
  layer: 'pretext' | 'geometry' | 'visual'
  severity: 'error' | 'warning' | 'needs-human'
  code: string
  message: string
  slide: number
  selector?: string
  box?: { x: number; y: number; width: number; height: number }
  metric?: { actual: number; expected: number; unit: string }
  suggestedFix?: string
}

export interface SlidewaveQualityResult {
  inspectionAvailable: true
  slide: number
  slideCount: number
  issues: SlidewaveQualityIssue[]
  ruleMeasurement?: { slide: number; textLines: number; density: number; tokens: string[] }
}

export interface SlidewaveQualityRequest {
  type: 'fastppt.slidewave.quality.request'
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
  requestId: string
  slide: number
}

export interface SlidewaveQualityCompleted {
  type: 'fastppt.slidewave.quality.completed'
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
  requestId: string
  result: SlidewaveQualityResult
}

export type SlidewaveCaptureMessage =
  | SlidewaveCaptureReady
  | SlidewavePreviewState
  | SlidewaveAnimationPreview
  | SlidewaveCaptureRequest
  | SlidewaveCaptureCompleted
  | SlidewaveCaptureProgress
  | SlidewaveCaptureFailed
  | SlidewaveOverflowRequest
  | SlidewaveOverflowCompleted
  | SlidewaveQualityRequest
  | SlidewaveQualityCompleted

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSnapshot(value: unknown): value is HtmlDeckSnapshot {
  if (!isRecord(value)) return false
  return (
    (value.version === 1 || value.version === 2) &&
    (value.source === 'slidev' || value.source === 'html') &&
    Array.isArray(value.slides) &&
    Array.isArray(value.warnings)
  )
}

export function isSlidewaveCaptureMessage(
  value: unknown,
): value is SlidewaveCaptureMessage {
  if (!isRecord(value) || value.version !== SLIDEWAVE_CAPTURE_PROTOCOL_VERSION)
    return false
  switch (value.type) {
    case 'fastppt.slidewave.capture.ready':
      return value.snapshotVersions === undefined || (Array.isArray(value.snapshotVersions) && value.snapshotVersions.length > 0 && value.snapshotVersions.every(version => version === 1 || version === 2))
    case 'fastppt.slidewave.preview.state':
      return (
        (value.page === null ||
          (typeof value.page === 'number' &&
            Number.isInteger(value.page) &&
            value.page > 0)) &&
        typeof value.path === 'string' &&
        (value.slideSize === undefined || (isRecord(value.slideSize) &&
          typeof value.slideSize.width === 'number' && Number.isFinite(value.slideSize.width) && value.slideSize.width > 0 &&
          typeof value.slideSize.height === 'number' && Number.isFinite(value.slideSize.height) && value.slideSize.height > 0)) &&
        (value.bounds === undefined || (isRecord(value.bounds) &&
          Object.values(value.bounds).length === 4 && Object.values(value.bounds).every(entry => typeof entry === 'number' && Number.isFinite(entry)) &&
          Number(value.bounds.x) >= 0 && Number(value.bounds.y) >= 0 && Number(value.bounds.width) > 0 && Number(value.bounds.height) > 0 &&
          Number(value.bounds.x) + Number(value.bounds.width) <= 1.001 && Number(value.bounds.y) + Number(value.bounds.height) <= 1.001))
      )
    case 'fastppt.slidewave.animation.preview':
      if (value.motionPreference !== undefined && (typeof value.motionPreference !== 'string' || !['system', 'reduce', 'full'].includes(value.motionPreference))) return false
      if (value.slide !== undefined && (typeof value.slide !== 'number' || !Number.isSafeInteger(value.slide) || value.slide < 1)) return false
      if (value.reset === true) return value.effect === undefined && value.elapsedMs === undefined
      if (value.reset !== undefined && value.reset !== false) return false
      return (value.elapsedMs === undefined || (typeof value.elapsedMs === 'number' && Number.isFinite(value.elapsedMs)))
        && isRecord(value.effect)
        && typeof value.effect.target === 'string' && value.effect.target.trim().length > 0
        && typeof value.effect.kind === 'string' && value.effect.kind.trim().length > 0
        && (value.effect.durationMs === undefined || (typeof value.effect.durationMs === 'number' && Number.isFinite(value.effect.durationMs) && value.effect.durationMs > 0))
    case 'fastppt.slidewave.capture.request':
      return (
        typeof value.requestId === 'string' &&
        value.requestId.length > 0 &&
        (value.snapshotVersion === undefined || value.snapshotVersion === 1 || value.snapshotVersion === 2) &&
        (value.theme === undefined ||
          value.theme === 'auto' ||
          value.theme === 'academy' ||
          value.theme === 'landing')
      )
    case 'fastppt.slidewave.capture.completed':
      return (
        typeof value.requestId === 'string' &&
        value.requestId.length > 0 &&
        isSnapshot(value.snapshot)
      )
    case 'fastppt.slidewave.capture.progress':
      return (
        typeof value.requestId === 'string' &&
        value.requestId.length > 0 &&
        typeof value.completed === 'number' &&
        Number.isInteger(value.completed) &&
        value.completed >= 0 &&
        typeof value.total === 'number' &&
        Number.isInteger(value.total) &&
        value.total > 0 &&
        value.completed <= value.total
      )
    case 'fastppt.slidewave.capture.failed':
      return (
        typeof value.requestId === 'string' &&
        value.requestId.length > 0 &&
        typeof value.error === 'string' &&
        value.error.length > 0
      )
    case 'fastppt.slidewave.overflow.request':
    case 'fastppt.slidewave.quality.request':
      return (
        typeof value.requestId === 'string' &&
        value.requestId.length > 0 &&
        typeof value.slide === 'number' &&
        Number.isInteger(value.slide) &&
        value.slide > 0
      )
    case 'fastppt.slidewave.overflow.completed':
      return (
        typeof value.requestId === 'string' &&
        value.requestId.length > 0 &&
        isRecord(value.result) &&
        value.result.inspectionAvailable === true &&
        typeof value.result.overflow === 'boolean' &&
        Array.isArray(value.result.elements)
      )
    case 'fastppt.slidewave.quality.completed':
      return (
        typeof value.requestId === 'string' &&
        value.requestId.length > 0 &&
        isRecord(value.result) &&
        value.result.inspectionAvailable === true &&
        Array.isArray(value.result.issues)
      )
    default:
      return false
  }
}
