import { scheduleMotion } from '../primitives/motion-schedule.js'
import { applyNativeMotion, resetNativeMotion, orderedNativeEffects } from '../primitives/native-motion.mjs'
import { HTML_SNAPSHOT_VERSIONS } from '../snapshot-types.js'
import { captureSlidevOverview } from '../slidev/capture.js'
import { measureThemeRules } from './rule-measurement.js'
import { SLIDEV_OVERVIEW_ROOT_SELECTOR } from '../slidev/slidev.js'
import { measureTextAdvance, textGraphemeRanges } from '../slidev/text-layout.js'
import {
  SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
  isSlidewaveCaptureMessage,
} from './protocol.js'
import {
  overviewRenderComplete,
  renderedOverviewPageCount,
} from './readiness.js'

import type {
  SlidewaveCaptureRequest,
  SlidewaveOverflowRequest,
  SlidewaveOverflowResult,
  SlidewaveQualityRequest,
  SlidewaveQualityResult,
} from './protocol.js'

let parentOrigin: string | undefined
const activeRequests = new Set<string>()

function installEmbeddedPreviewStyles(): void {
  if (new URLSearchParams(window.location.search).get('embedded') !== 'true')
    return
  const style = document.createElement('style')
  style.dataset.fastpptPreview = 'true'
  style.textContent = `
    html, body, #app { background: transparent !important; }
    #slide-container { background: transparent !important; }
    button.slidev-icon-btn[title="Go to previous slide"],
    button.slidev-icon-btn[title="Go to next slide"] {
      display: none !important;
    }
    .fastppt-animation-preview[data-fastppt-animation="entrance_fade"] { animation: fastppt-preview-in 420ms ease both; }
    .fastppt-animation-preview[data-fastppt-animation="appear"] { animation: fastppt-preview-in 420ms steps(1, start) both; }
    .fastppt-animation-preview[data-fastppt-animation="exit_fade"] { animation: fastppt-preview-out 420ms ease both; }
    .fastppt-animation-preview[data-fastppt-animation="emphasis_pulse"] { animation: fastppt-preview-pulse 420ms ease both; }
    .fastppt-animation-preview[data-fastppt-animation="zoom"] { animation: fastppt-preview-zoom 420ms ease both; }
    .fastppt-animation-preview[data-fastppt-animation="fly"] { animation: fastppt-preview-fly 420ms ease both; }
    .fastppt-animation-preview[data-fastppt-animation="teeter"] { animation: fastppt-preview-teeter 420ms ease both; }
    :root[data-fastppt-reduced-motion="true"] .fastppt-animation-preview[data-fastppt-animation="zoom"],
    :root[data-fastppt-reduced-motion="true"] .fastppt-animation-preview[data-fastppt-animation="fly"] { animation-name: fastppt-preview-in !important; }
    :root[data-fastppt-reduced-motion="true"] .fastppt-animation-preview[data-fastppt-animation="emphasis_pulse"],
    :root[data-fastppt-reduced-motion="true"] .fastppt-animation-preview[data-fastppt-animation="teeter"],
    :root[data-fastppt-reduced-motion="true"] .fastppt-animation-preview[data-fastppt-animation="path_line"],
    :root[data-fastppt-reduced-motion="true"] .fastppt-animation-preview[data-fastppt-animation="path_arc"] { animation: none !important; }
    @keyframes fastppt-preview-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fastppt-preview-out { from { opacity: 1; } to { opacity: 0; } }
    @keyframes fastppt-preview-pulse { 50% { transform: scale(1.04); } }
    @keyframes fastppt-preview-zoom { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: none; } }
    @keyframes fastppt-preview-fly { from { opacity: 0; transform: translateX(-18px); } to { opacity: 1; transform: none; } }
    @keyframes fastppt-preview-teeter { 25% { transform: rotate(-2deg); } 75% { transform: rotate(2deg); } }
  `
  document.head.append(style)
}

installEmbeddedPreviewStyles()

function slideNavigationOperation(
  key: string,
): 'nextSlide' | 'prevSlide' | undefined {
  if (key === 'ArrowRight') return 'nextSlide'
  if (key === 'ArrowLeft') return 'prevSlide'
  return undefined
}

window.addEventListener(
  'keydown',
  (event) => {
    const operation = slideNavigationOperation(event.key)
    if (!operation || event.altKey || event.ctrlKey || event.metaKey) return
    if (advanceImportedMotion(operation === 'nextSlide' ? 1 : -1)) { event.preventDefault(); event.stopImmediatePropagation(); return }
    event.preventDefault()
    event.stopImmediatePropagation()
    window.postMessage(
      { target: 'slidev', type: 'navigate', operation },
      window.location.origin,
    )
  },
  { capture: true },
)

function isCaptureRequest(value: unknown): value is SlidewaveCaptureRequest {
  return (
    isSlidewaveCaptureMessage(value) &&
    value.type === 'fastppt.slidewave.capture.request' &&
    value.requestId.length > 0
  )
}

function isOverflowRequest(value: unknown): value is SlidewaveOverflowRequest {
  return (
    isSlidewaveCaptureMessage(value) &&
    value.type === 'fastppt.slidewave.overflow.request'
  )
}

function isQualityRequest(value: unknown): value is SlidewaveQualityRequest {
  return (
    isSlidewaveCaptureMessage(value) &&
    value.type === 'fastppt.slidewave.quality.request'
  )
}

function captureErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message
  if (typeof cause === 'string' && cause) return cause
  return fallback
}

function selectorFor(element: HTMLElement): string {
  if (element.id) return `#${CSS.escape(element.id)}`
  const classes = [...element.classList]
    .slice(0, 2)
    .map((name) => `.${CSS.escape(name)}`)
  return `${element.tagName.toLowerCase()}${classes.join('')}`
}

function inspectOverflow(
  request: SlidewaveOverflowRequest,
): SlidewaveOverflowResult {
  const pages = [...document.querySelectorAll<HTMLElement>('.slidev-page')]
  const root = pages[request.slide - 1]
  if (!root) throw new Error(`Slide ${request.slide} did not render.`)
  const rootRect = root.getBoundingClientRect()
  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')].flatMap(
    (element) => {
      const rect = element.getBoundingClientRect()
      const overflow = {
        top: Math.max(0, rootRect.top - rect.top),
        right: Math.max(
          0,
          rect.right - rootRect.right,
          element.scrollWidth - element.clientWidth,
        ),
        bottom: Math.max(
          0,
          rect.bottom - rootRect.bottom,
          element.scrollHeight - element.clientHeight,
        ),
        left: Math.max(0, rootRect.left - rect.left),
      }
      if (!Object.values(overflow).some((value) => value > 0.5)) return []
      const text = element.textContent
        ?.replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240)
      return [
        {
          selector: selectorFor(element),
          ...(text ? { text } : {}),
          overflow,
        },
      ]
    },
  )
  const overflowBy = elements.reduce(
    (maximum, element) => ({
      top: Math.max(maximum.top, element.overflow.top),
      right: Math.max(maximum.right, element.overflow.right),
      bottom: Math.max(maximum.bottom, element.overflow.bottom),
      left: Math.max(maximum.left, element.overflow.left),
    }),
    { top: 0, right: 0, bottom: 0, left: 0 },
  )
  return {
    inspectionAvailable: true,
    overflow: elements.length > 0,
    slide: request.slide,
    slideCount: pages.length,
    viewport: { width: rootRect.width, height: rootRect.height },
    overflowBy,
    elements,
  }
}

function renderedLineCount(element: HTMLElement): number {
  const tops = new Set<number>()
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    const text = node.textContent ?? ''
    for (const grapheme of textGraphemeRanges(text)) {
      if (!grapheme.text.trim()) continue
      const range = document.createRange()
      range.setStart(node, grapheme.start)
      range.setEnd(node, grapheme.end)
      for (const rect of range.getClientRects()) tops.add(Math.round(rect.top * 2) / 2)
    }
  }
  return tops.size
}

function inspectQuality(
  request: SlidewaveQualityRequest,
): SlidewaveQualityResult {
  const pages = [...document.querySelectorAll<HTMLElement>('.slidev-page')]
  const root = pages[request.slide - 1]
  if (!root) throw new Error(`Slide ${request.slide} did not render.`)
  const rootRect = root.getBoundingClientRect()
  const issues: SlidewaveQualityResult['issues'] = []
  const candidates = [...root.querySelectorAll<HTMLElement>('h1,h2,h3,p,li,blockquote,[data-fastppt-role]')]
  for (const element of candidates) {
    const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (!text) continue
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const selector = selectorFor(element)
    const box = {
      x: rect.x - rootRect.x,
      y: rect.y - rootRect.y,
      width: rect.width,
      height: rect.height,
    }
    const naturalWidth = measureTextAdvance(text, style)
    if (rect.width > 0 && naturalWidth > rect.width * 1.8)
      issues.push({
        layer: 'pretext', severity: 'warning', code: 'TEXT_NATURAL_WIDTH_RISK',
        message: 'Text requires aggressive wrapping for the available width.',
        slide: request.slide, selector, box,
        metric: { actual: naturalWidth, expected: rect.width * 1.8, unit: 'px' },
        suggestedFix: 'Shorten the copy, widen the text box, or reduce font size.',
      })
    const role = element.dataset.fastpptRole ?? (element.matches('h1,h2') ? 'title' : 'body')
    const configuredMax = Number.parseInt(element.dataset.fastpptMaxLines ?? '', 10)
    const maxLines = Number.isFinite(configuredMax) ? configuredMax : role === 'title' ? 2 : 6
    const lineCount = renderedLineCount(element)
    if (lineCount > maxLines)
      issues.push({
        layer: 'geometry', severity: 'error', code: 'TEXT_LINE_LIMIT_EXCEEDED',
        message: `${role} text renders on ${lineCount} lines; limit is ${maxLines}.`,
        slide: request.slide, selector, box,
        metric: { actual: lineCount, expected: maxLines, unit: 'lines' },
        suggestedFix: 'Reduce copy or choose a layout with more text capacity.',
      })
    if (element.scrollWidth > element.clientWidth + 0.5 || element.scrollHeight > element.clientHeight + 0.5)
      issues.push({
        layer: 'geometry', severity: 'error', code: 'TEXT_CLIPPED',
        message: 'Rendered text is clipped by its container.', slide: request.slide,
        selector, box, suggestedFix: 'Increase the container size or reduce the text.',
      })
    const letterSpacing = Number.parseFloat(style.letterSpacing)
    if (/\p{Script=Han}/u.test(text) && Number.isFinite(letterSpacing) && letterSpacing > Number.parseFloat(style.fontSize) * 0.12)
      issues.push({
        layer: 'pretext', severity: 'warning', code: 'CJK_TRACKING_EXCESSIVE',
        message: 'CJK tracking exceeds 12% of the font size.', slide: request.slide,
        selector, box, metric: { actual: letterSpacing, expected: Number.parseFloat(style.fontSize) * 0.12, unit: 'px' },
      })
    if (!document.fonts.check(`${style.fontSize} ${style.fontFamily}`, text.slice(0, 32)))
      issues.push({
        layer: 'pretext', severity: 'warning', code: 'FONT_UNRESOLVED',
        message: 'The requested font is not fully resolved.', slide: request.slide,
        selector, box, suggestedFix: 'Wait for fonts to load or use an available fallback.',
      })
  }
  for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    const rect = element.getBoundingClientRect()
    if (rect.left < rootRect.left - 0.5 || rect.top < rootRect.top - 0.5 || rect.right > rootRect.right + 0.5 || rect.bottom > rootRect.bottom + 0.5)
      issues.push({
        layer: 'geometry', severity: 'error', code: 'ELEMENT_OUT_OF_BOUNDS',
        message: 'An element extends beyond the slide canvas.', slide: request.slide,
        selector: selectorFor(element),
        box: { x: rect.x - rootRect.x, y: rect.y - rootRect.y, width: rect.width, height: rect.height },
        suggestedFix: 'Move or resize the element inside the slide bounds.',
      })
  }
  return { inspectionAvailable: true, slide: request.slide, slideCount: pages.length, issues, ruleMeasurement: measureThemeRules(root, request.slide) }
}

async function waitForOverview(): Promise<void> {
  const deadline = Date.now() + 90_000
  let stablePageCount = 0
  let stableChecks = 0
  while (Date.now() < deadline) {
    const pages = [
      ...document.querySelectorAll<HTMLElement>(SLIDEV_OVERVIEW_ROOT_SELECTOR),
    ]
    const renderedPageCount = renderedOverviewPageCount(
      pages.map((page) => {
        const rect = page.getBoundingClientRect()
        const style = getComputedStyle(page)
        return {
          width: rect.width,
          height: rect.height,
          display: style.display,
          visibility: style.visibility,
        }
      }),
    )
    const expectedPageCount = pages.length
    const complete = overviewRenderComplete(
      renderedPageCount,
      expectedPageCount,
    )
    if (
      (complete || (expectedPageCount === 0 && renderedPageCount > 0)) &&
      renderedPageCount === stablePageCount
    ) {
      stableChecks += 1
      if (stableChecks >= 20) return
    } else {
      stablePageCount = renderedPageCount
      stableChecks = 0
    }
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50))
  }
  throw new Error('Slidev overview did not render before capture timed out.')
}

const previewProperties = ['animation-duration', 'animation-delay', 'animation-play-state'] as const
const previewOriginals = new Map<HTMLElement, { animation: string | undefined; hadClass: boolean; styles: Array<{ name: string; value: string; priority: string }> }>()
function restoreBasicPreviewElement(element:HTMLElement):void {
  const original=previewOriginals.get(element)
  if(!original)return
  element.classList.toggle('fastppt-animation-preview',original.hadClass)
  if(original.animation===undefined)delete element.dataset.fastpptAnimation
  else element.dataset.fastpptAnimation=original.animation
  for(const style of original.styles){if(style.value)element.style.setProperty(style.name,style.value,style.priority);else element.style.removeProperty(style.name)}
  previewOriginals.delete(element)
}
function resetAnimationPreview(): void {
  stopImportedMotion()
  resetNativeMotion()
  for(const element of [...previewOriginals.keys()])restoreBasicPreviewElement(element)
}

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
let motionPreference: 'system' | 'reduce' | 'full' = 'system'
function applyMotionPreference(): void {
  document.documentElement.dataset.fastpptReducedMotion = String(motionPreference === 'reduce' || (motionPreference === 'system' && motionQuery.matches))
}
motionQuery.addEventListener('change', applyMotionPreference)
applyMotionPreference()

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || (parentOrigin !== undefined && event.origin !== parentOrigin)) return
  const preview = event.data as { target?: string; type?: string; version?: number; reset?: boolean; motionPreference?: 'system' | 'reduce' | 'full'; slide?: number; elapsedMs?: number; effect?: { target?: string; kind?: string; durationMs?: number; id?: string; params?: Record<string, unknown> } } | undefined
  if (preview?.type === 'fastppt.slidewave.animation.preview' && !isSlidewaveCaptureMessage(preview)) return
  if (preview?.target === 'fastppt-preview' && preview.type === 'fastppt.slidewave.animation.preview' && preview.motionPreference) {
    motionPreference = preview.motionPreference
    applyMotionPreference()
  }
  if (preview?.target === 'fastppt-preview' && preview.type === 'fastppt.slidewave.animation.preview' && preview.version === SLIDEWAVE_CAPTURE_PROTOCOL_VERSION && preview.reset) {
    resetAnimationPreview()
    return
  }
  if (preview?.target === 'fastppt-preview' && preview.type === 'fastppt.slidewave.animation.preview' && preview.version === SLIDEWAVE_CAPTURE_PROTOCOL_VERSION && preview.effect?.target) {
    stopImportedMotion()
    const target = preview.effect.target
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(target) : target.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    if (preview.slide !== undefined && (!Number.isInteger(preview.slide) || preview.slide < 1)) return
    const root = preview.slide === undefined ? document : document.querySelector<HTMLElement>(`[data-slidev-no="${preview.slide}"]`)
    if (!root) return
    const elements = root.querySelectorAll<HTMLElement>(`[data-fastppt-group="${escaped}"], #${escaped}`)
    for (const element of elements) {
      if (preview.effect.kind === 'native') {
        restoreBasicPreviewElement(element)
        try { applyNativeMotion(element, { id: preview.effect.id ?? target, target, durationMs: preview.effect.durationMs ?? 400, params: preview.effect.params ?? {} }, preview.elapsedMs ?? 0) }
        catch (error) { window.parent.postMessage({ type: 'fastppt.animation.preview.failed', target, message: String(error) }, event.origin) }
        continue
      }
      resetNativeMotion(element)
      if (!previewOriginals.has(element)) previewOriginals.set(element, {
        animation: element.dataset.fastpptAnimation,
        hadClass: element.classList.contains('fastppt-animation-preview'),
        styles: previewProperties.map((name) => ({ name, value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) })),
      })
      element.classList.remove('fastppt-animation-preview')
      void element.offsetWidth
      element.dataset.fastpptAnimation = preview.effect.kind ?? 'appear'
      const duration = preview.effect.durationMs
      element.style.animationDuration = typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? `${duration}ms` : ''
      const elapsed = preview.elapsedMs
      const positioned = typeof elapsed === 'number' && Number.isFinite(elapsed)
      element.style.animationDelay = positioned ? `${-elapsed}ms` : ''
      element.style.animationPlayState = positioned ? 'paused' : ''
      element.classList.add('fastppt-animation-preview')
    }
    return
  }
  if (
    event.source !== window.parent ||
    (parentOrigin !== undefined && event.origin !== parentOrigin) ||
    !isCaptureRequest(event.data)
  )
    return
  parentOrigin = event.origin
  resetAnimationPreview()
  const request = event.data
  if (activeRequests.has(request.requestId)) return
  activeRequests.add(request.requestId)
  window.clearInterval(readyTimer)
  void waitForOverview()
    .then(() =>
      captureSlidevOverview({
        embedImages: true,
        snapshotVersion: request.snapshotVersion ?? 1,
        precision: 4,
        theme: request.theme ?? 'auto',
        waitForReady: false,
        onSlideCaptured: (completed, total) =>
          window.parent.postMessage(
            {
              type: 'fastppt.slidewave.capture.progress',
              version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
              requestId: request.requestId,
              completed,
              total,
            },
            event.origin,
          ),
      }),
    )
    .then(
      (snapshot) => {
        activeRequests.delete(request.requestId)
        window.parent.postMessage(
          {
            type: 'fastppt.slidewave.capture.completed',
            version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
            requestId: request.requestId,
            snapshot,
          },
          event.origin,
        )
      },
      (cause: unknown) => {
        activeRequests.delete(request.requestId)
        window.parent.postMessage(
          {
            type: 'fastppt.slidewave.capture.failed',
            version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
            requestId: request.requestId,
            error: captureErrorMessage(
              cause,
              'Slidewave capture failed unexpectedly.',
            ),
          },
          event.origin,
        )
      },
    )
})

window.addEventListener('message', (event) => {
  if (
    event.source !== window.parent ||
    (parentOrigin !== undefined && event.origin !== parentOrigin) ||
    !isOverflowRequest(event.data)
  )
    return
  parentOrigin = event.origin
  resetAnimationPreview()
  const request = event.data
  if (activeRequests.has(request.requestId)) return
  activeRequests.add(request.requestId)
  window.clearInterval(readyTimer)
  void waitForOverview().then(
    () => {
      activeRequests.delete(request.requestId)
      window.parent.postMessage(
        {
          type: 'fastppt.slidewave.overflow.completed',
          version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
          requestId: request.requestId,
          result: inspectOverflow(request),
        },
        event.origin,
      )
    },
    (cause: unknown) => {
      activeRequests.delete(request.requestId)
      window.parent.postMessage(
        {
          type: 'fastppt.slidewave.capture.failed',
          version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
          requestId: request.requestId,
          error: captureErrorMessage(
            cause,
            'Slidewave overflow inspection failed unexpectedly.',
          ),
        },
        event.origin,
      )
    },
  )
})

window.addEventListener('message', (event) => {
  if (
    event.source !== window.parent ||
    (parentOrigin !== undefined && event.origin !== parentOrigin) ||
    !isQualityRequest(event.data)
  ) return
  parentOrigin = event.origin
  resetAnimationPreview()
  const request = event.data
  if (activeRequests.has(request.requestId)) return
  activeRequests.add(request.requestId)
  window.clearInterval(readyTimer)
  void waitForOverview().then(
    () => {
      activeRequests.delete(request.requestId)
      window.parent.postMessage({
        type: 'fastppt.slidewave.quality.completed',
        version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
        requestId: request.requestId,
        result: inspectQuality(request),
      }, event.origin)
    },
    (cause: unknown) => {
      activeRequests.delete(request.requestId)
      window.parent.postMessage({
        type: 'fastppt.slidewave.capture.failed',
        version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
        requestId: request.requestId,
        error: captureErrorMessage(cause, 'Slidewave quality inspection failed unexpectedly.'),
      }, event.origin)
    },
  )
})

function reportCaptureReady(): void {
  window.parent.postMessage(
    {
      type: 'fastppt.slidewave.capture.ready',
      snapshotVersions: HTML_SNAPSHOT_VERSIONS,
      version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
    },
    parentOrigin ?? '*',
  )
}

reportCaptureReady()
const readyTimer = window.setInterval(reportCaptureReady, 500)
window.setTimeout(() => window.clearInterval(readyTimer), 30_000)

let importedPageKey = ''
let importedFrame: number | undefined
let importedStep = 0
let importedPlayer: { root: HTMLElement; rows: ReturnType<typeof scheduleMotion<{id:string;target:string;kind:string;durationMs:number;trigger?:'on-click'|'with-previous'|'after-previous';delayMs?:number;params?:Record<string,unknown>}>>; totalGroups:number } | undefined
function stopImportedMotion(): void { if (importedFrame !== undefined) cancelAnimationFrame(importedFrame); importedFrame=undefined; importedPlayer=undefined }
function renderImportedAt(time:number):void {
  if(!importedPlayer)return
  const visible=new Map<string,(typeof importedPlayer.rows)[number]>()
  for(const row of importedPlayer.rows)if(!visible.has(row.effect.target)||time>=row.previewStartMs)visible.set(row.effect.target,row)
  for(const row of visible.values()) {
    const element=[...importedPlayer.root.querySelectorAll<HTMLElement>('[data-fastppt-group]')].find(n=>n.dataset.fastpptGroup===row.effect.target)
    if(element&&row.effect.kind==='native')try{applyNativeMotion(element,row.effect,time-row.previewStartMs)}catch(error){stopImportedMotion();window.parent.postMessage({type:'fastppt.animation.preview.failed',message:String(error)},parentOrigin??'*');return}
  }
}
function playImportedGroup(group:number):void {
  if(!importedPlayer)return
  if(importedFrame!==undefined)cancelAnimationFrame(importedFrame)
  const selected=importedPlayer.rows.filter(row=>row.clickGroup===group)
  const start=Math.min(...selected.map(row=>row.previewStartMs)),end=Math.max(...selected.map(row=>row.previewEndMs))
  if(!selected.length){renderImportedAt(0);return}
  const beginning=performance.now()
  const tick=(now:number)=>{if(!importedPlayer)return;const time=Math.min(end,start+now-beginning);renderImportedAt(time);if(time<end)importedFrame=requestAnimationFrame(tick)}
  importedFrame=requestAnimationFrame(tick)
}
function advanceImportedMotion(direction:number):boolean {
  if(!importedPlayer)return false
  const next=importedStep+direction
  if(next<0||next>importedPlayer.totalGroups)return false
  importedStep=next;playImportedGroup(next);return true
}
function attachImportedMotion(canvas:HTMLElement|null,page:number|null):void {
  const marker=canvas?.querySelector('[data-fastppt-motion]'),key=marker?`${page}:${marker.getAttribute('data-fastppt-motion')}`:''
  if(key===importedPageKey)return
  stopImportedMotion();resetNativeMotion();importedPageKey=key
  if(!marker||!canvas||window.location.pathname.includes('/overview'))return
  try {
    const document=JSON.parse(marker.getAttribute('data-fastppt-motion')??'{}') as {groups:Array<{effects:Array<{id:string;target:string;kind:string;durationMs:number;trigger?:'on-click'|'with-previous'|'after-previous';delayMs?:number;params?:Record<string,unknown>}>}>}
    const rows=scheduleMotion(orderedNativeEffects(document.groups))
    importedPlayer={root:canvas,rows,totalGroups:Math.max(0,...rows.map(row=>row.clickGroup))};importedStep=0;renderImportedAt(0);playImportedGroup(0)
  }catch(error){window.parent.postMessage({type:'fastppt.animation.preview.failed',message:String(error)},parentOrigin??'*')}
}
function reportPreviewState(): void {
  const path = `${window.location.pathname}${window.location.hash}`
  const pageSegment = `${window.location.pathname}/${window.location.hash}`
    .split('/')
    .find((segment) => /^\d+$/.test(segment))
  const page = pageSegment
    ? Number(pageSegment)
    : window.location.pathname.includes('/overview')
      ? null
      : 1
  const canvas = page ? document.querySelector<HTMLElement>(`[data-slidev-no="${page}"] .slidev-layout`) ?? document.querySelector<HTMLElement>(`[data-slidev-no="${page}"]`) : null
  attachImportedMotion(canvas, page)
  const rect = canvas?.getBoundingClientRect()
  const slideContent = document.querySelector<HTMLElement>('#slide-content')
  const slideSize = slideContent && slideContent.offsetWidth > 0 && slideContent.offsetHeight > 0
    ? { width: slideContent.offsetWidth, height: slideContent.offsetHeight }
    : undefined
  const bounds = rect && rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1
    ? { x: rect.x / innerWidth, y: rect.y / innerHeight, width: Math.min(rect.width, innerWidth - rect.x) / innerWidth, height: Math.min(rect.height, innerHeight - rect.y) / innerHeight }
    : undefined
  window.parent.postMessage(
    {
      type: 'fastppt.slidewave.preview.state',
      version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
      page,
      path,
      ...(bounds ? { bounds } : {}),
      ...(slideSize ? { slideSize } : {}),
    },
    parentOrigin ?? '*',
  )
}

reportPreviewState()
window.addEventListener('hashchange', reportPreviewState)
window.addEventListener('popstate', reportPreviewState)
window.setInterval(reportPreviewState, 500)
