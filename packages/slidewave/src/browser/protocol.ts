import type { HtmlDeckSnapshot } from '../snapshot-types.js'
import type { SlidevCaptureThemeOption } from '../slidev/themes/types.js'

export const SLIDEWAVE_CAPTURE_PROTOCOL_VERSION = 1 as const

export interface SlidewaveCaptureReady {
  type: 'fastppt.slidewave.capture.ready'
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
}

export interface SlidewavePreviewState {
  type: 'fastppt.slidewave.preview.state'
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
  page: number | null
  path: string
}

export interface SlidewaveCaptureRequest {
  type: 'fastppt.slidewave.capture.request'
  version: typeof SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
  requestId: string
  theme?: SlidevCaptureThemeOption
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
    value.version === 1 &&
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
      return true
    case 'fastppt.slidewave.preview.state':
      return (
        (value.page === null ||
          (typeof value.page === 'number' &&
            Number.isInteger(value.page) &&
            value.page > 0)) &&
        typeof value.path === 'string'
      )
    case 'fastppt.slidewave.capture.request':
      return (
        typeof value.requestId === 'string' &&
        value.requestId.length > 0 &&
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
