<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import {
  SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
  isSlidewaveCaptureMessage,
} from '@fastppt/slidewave/browser'

import { resolveGatewayUrl } from '../../api/useGatewayClient.js'
import AppSelect, { type SelectOption } from '../AppSelect.vue'

import type {
  DeckSummary,
  BrowserInspectionJob,
  ExportJob,
  SlidevProcessState,
  ThemeSummary,
} from '@fastppt/protocol'
import type { SlidewaveCaptureRequest } from '@fastppt/slidewave/browser'
import type { DeepReadonly } from 'vue'

const props = defineProps<{
  decks: readonly DeckSummary[]
  selectedDeckId: string | undefined
  theme: DeepReadonly<ThemeSummary> | undefined
  state: DeepReadonly<SlidevProcessState> | undefined
  loading: boolean
  error: string | undefined
  frameRevision: number
  exportJob: DeepReadonly<ExportJob> | undefined
  inspectionJob: DeepReadonly<BrowserInspectionJob> | undefined
}>()

const emit = defineEmits<{
  selectDeck: [deckId: string]
  start: []
  restart: []
  stop: []
  refresh: []
  export: []
  cancelExport: []
  downloadExport: []
  snapshot: [input: { exportId: string; snapshot: unknown }]
  captureProgress: [
    input: { exportId: string; completed: number; total: number },
  ]
  inspectionResult: [input: { inspectionId: string; result: unknown }]
}>()

const frame = useTemplateRef<HTMLIFrameElement>('frame')
const ready = computed(
  () => props.state?.status === 'ready' && props.state.previewUrl,
)
const deckOptions = computed<readonly SelectOption[]>(() =>
  props.decks.map((deck) => ({ value: deck.id, label: deck.name })),
)
const proxiedPreviewUrl = computed(() => {
  if (!props.state?.port) return props.state?.previewUrl
  return new URL(
    `/api/v1/preview/p${String(props.state.port)}/`,
    resolveGatewayUrl(),
  ).toString()
})
const previewUrl = computed(() => {
  if (!proxiedPreviewUrl.value) return undefined
  const url = new URL(proxiedPreviewUrl.value)
  url.searchParams.set('embedded', 'true')
  return url.toString()
})
const statusMessage = computed(
  () =>
    props.error ??
    props.state?.lastError?.message ??
    '选择 Deck 并启动受管理的本地 Slidev 进程。',
)
const themeLabel = computed(() =>
  props.theme
    ? `${props.theme.displayName} · ${props.theme.skillId}@${props.theme.skillVersion}`
    : '',
)
const exporting = computed(() =>
  ['queued', 'running'].includes(props.exportJob?.status ?? ''),
)
const captureFrame = useTemplateRef<HTMLIFrameElement>('captureFrame')
const currentPage = shallowRef<number>()
const captureRequestId = shallowRef<string>()
const captureError = shallowRef<string>()
const capturedSlides = shallowRef(0)
const captureSlideCount = shallowRef(0)
const captureActive = computed(
  () =>
    ((props.exportJob?.status === 'queued' &&
      props.exportJob.phase === 'awaiting-browser-capture') ||
      props.inspectionJob?.status === 'queued') &&
    Boolean(proxiedPreviewUrl.value),
)
const captureJobId = computed(
  () =>
    (props.inspectionJob?.status === 'queued'
      ? props.inspectionJob.id
      : undefined) ??
    (props.exportJob?.status === 'queued' ? props.exportJob.id : undefined),
)
const exportProgress = computed(() => {
  if (
    props.exportJob?.status === 'queued' &&
    props.exportJob.phase === 'awaiting-browser-capture' &&
    captureSlideCount.value > 0
  ) {
    return Math.round(5 + (capturedSlides.value / captureSlideCount.value) * 20)
  }
  return props.exportJob?.progress ?? 0
})
const groupedExportWarnings = computed(() => {
  const groups = new Map<
    string,
    { code: string; message: string; count: number }
  >()
  for (const warning of props.exportJob?.warnings ?? []) {
    const key = `${warning.code}\u0000${warning.message}`
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else
      groups.set(key, {
        code: warning.code,
        message: warning.message,
        count: 1,
      })
  }
  return [...groups.values()]
})
const captureUrl = computed(() => {
  if (!proxiedPreviewUrl.value) return undefined
  const url = new URL('overview', proxiedPreviewUrl.value)
  url.searchParams.set('embedded', 'true')
  return url.toString()
})

function captureTheme(): NonNullable<SlidewaveCaptureRequest['theme']> {
  if (props.theme?.themeId === 'slidev-theme-academy') return 'academy'
  return props.theme?.themeId === 'slidev-theme-landing' ? 'landing' : 'auto'
}

function requestCapture(): void {
  const frameWindow = captureFrame.value?.contentWindow
  const previewUrl = proxiedPreviewUrl.value
  if (!frameWindow || !previewUrl || !captureActive.value) return
  const requestId = captureRequestId.value ?? crypto.randomUUID()
  captureRequestId.value = requestId
  const message =
    props.inspectionJob?.status === 'queued'
      ? {
          type: 'fastppt.slidewave.overflow.request',
          version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
          requestId,
          slide: props.inspectionJob.slide,
        }
      : {
          type: 'fastppt.slidewave.capture.request',
          version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
          requestId,
          theme: captureTheme(),
        }
  frameWindow.postMessage(message, new URL(previewUrl).origin)
}

function navigatePreview(direction: 'previous' | 'next'): void {
  frame.value?.contentWindow?.postMessage(
    {
      target: 'slidev',
      type: 'navigate',
      operation: direction === 'next' ? 'nextSlide' : 'prevSlide',
    },
    proxiedPreviewUrl.value
      ? new URL(proxiedPreviewUrl.value).origin
      : window.location.origin,
  )
}

function handlePreviewKey(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  if (event.altKey || event.ctrlKey || event.metaKey) return
  event.preventDefault()
  event.stopPropagation()
  navigatePreview(event.key === 'ArrowRight' ? 'next' : 'previous')
}

function handleCaptureMessage(event: MessageEvent<unknown>): void {
  const previewWindow = frame.value?.contentWindow
  const previewUrl = proxiedPreviewUrl.value
  if (
    previewWindow &&
    event.source === previewWindow &&
    previewUrl &&
    event.origin === new URL(previewUrl).origin &&
    isSlidewaveCaptureMessage(event.data) &&
    event.data.type === 'fastppt.slidewave.preview.state'
  ) {
    currentPage.value = event.data.page ?? undefined
    return
  }
  const frameWindow = captureFrame.value?.contentWindow
  if (!frameWindow || event.source !== frameWindow || !captureActive.value)
    return
  if (!previewUrl || event.origin !== new URL(previewUrl).origin) return
  if (!isSlidewaveCaptureMessage(event.data)) return
  const message = event.data
  if (
    message.type === 'fastppt.slidewave.capture.ready' &&
    message.version === SLIDEWAVE_CAPTURE_PROTOCOL_VERSION
  ) {
    requestCapture()
    return
  }
  if (!('requestId' in message) || message.requestId !== captureRequestId.value)
    return
  if (message.type === 'fastppt.slidewave.capture.progress') {
    capturedSlides.value = message.completed
    captureSlideCount.value = message.total
    const exportId = props.exportJob?.id
    if (props.exportJob?.status === 'queued' && exportId)
      emit('captureProgress', {
        exportId,
        completed: message.completed,
        total: message.total,
      })
  } else if (message.type === 'fastppt.slidewave.capture.completed') {
    const exportId = props.exportJob?.id
    if (props.exportJob?.status === 'queued' && exportId)
      emit('snapshot', { exportId, snapshot: message.snapshot })
    captureRequestId.value = undefined
  } else if (message.type === 'fastppt.slidewave.overflow.completed') {
    const inspectionId = props.inspectionJob?.id
    if (props.inspectionJob?.status === 'queued' && inspectionId)
      emit('inspectionResult', { inspectionId, result: message.result })
    captureRequestId.value = undefined
  } else if (message.type === 'fastppt.slidewave.capture.failed') {
    captureError.value = message.error
    captureRequestId.value = undefined
  }
}

watch(captureJobId, () => {
  captureRequestId.value = undefined
  captureError.value = undefined
  capturedSlides.value = 0
  captureSlideCount.value = 0
})
onMounted(() => window.addEventListener('message', handleCaptureMessage))
onUnmounted(() => window.removeEventListener('message', handleCaptureMessage))

function openPreview(): void {
  if (proxiedPreviewUrl.value)
    window.open(proxiedPreviewUrl.value, '_blank', 'noopener,noreferrer')
}

async function enterFullscreen(): Promise<void> {
  await frame.value?.requestFullscreen()
}
</script>

<template>
  <aside class="preview-panel panel-surface">
    <header class="preview-header">
      <div class="preview-identity">
        <span class="eyebrow">Live preview</span>
        <AppSelect
          id="fastppt-preview-deck"
          :value="selectedDeckId"
          :options="deckOptions"
          :disabled="!decks.length"
          :placeholder="
            !decks.length
              ? loading
                ? '正在读取 Markdown…'
                : '未发现 Markdown 文件'
              : '选择 Deck'
          "
          aria-label="Preview deck"
          @keydown="handlePreviewKey"
          @change="(deckId: string) => $emit('selectDeck', deckId)"
        />
      </div>
      <div class="preview-actions">
        <span class="page-indicator">
          {{ currentPage ? `第 ${currentPage} 页` : '页码待同步' }}
        </span>
        <button type="button" :disabled="!ready" @click="$emit('refresh')">
          刷新
        </button>
        <button type="button" :disabled="!ready" @click="$emit('restart')">
          重启
        </button>
        <button type="button" :disabled="!ready" @click="enterFullscreen">
          全屏
        </button>
        <button type="button" :disabled="!ready" @click="openPreview">
          新窗口
        </button>
        <button
          class="export-button"
          type="button"
          :disabled="!ready || exporting"
          @click="$emit('export')"
        >
          {{ exporting ? '导出中…' : '导出 PPTX' }}
        </button>
      </div>
    </header>
    <div class="preview-content">
      <div
        class="preview-canvas"
        tabindex="0"
        aria-label="幻灯片预览，使用左右方向键翻页"
        @keydown="handlePreviewKey"
      >
        <iframe
          v-if="ready"
          :key="`${state?.previewUrl}-${frameRevision}`"
          ref="frame"
          class="preview-frame"
          :src="previewUrl"
          title="Slidev preview"
          sandbox="allow-scripts allow-same-origin allow-popups"
          allow="fullscreen; screen-wake-lock"
        ></iframe>
        <iframe
          v-if="captureActive"
          :key="`capture-${captureJobId}-${frameRevision}`"
          ref="captureFrame"
          class="capture-frame"
          :src="captureUrl"
          title="Slidewave capture"
          sandbox="allow-scripts allow-same-origin"
          allow="screen-wake-lock"
          aria-hidden="true"
          tabindex="-1"
        ></iframe>
        <div v-if="!ready" class="slide-placeholder">
          <span class="slide-kicker">FASTPPT / SLIDEV</span>
          <h2>{{ loading ? '正在启动预览…' : '预览尚未运行' }}</h2>
          <p>{{ statusMessage }}</p>
          <button v-if="!loading" type="button" @click="$emit('start')">
            启动预览
          </button>
        </div>
      </div>
      <section v-if="exportJob" class="export-status" aria-live="polite">
        <div class="export-summary">
          <span>{{ exportJob.outputName }}</span>
          <strong>{{ exportProgress }}%</strong>
        </div>
        <progress :value="exportProgress" max="100">
          {{ exportProgress }}%
        </progress>
        <div class="export-detail">
          <span>{{ exportJob.status }} · {{ exportJob.phase }}</span>
          <span v-if="exportJob.slideCount !== undefined">
            {{ exportJob.slideCount }} 页
          </span>
          <span v-else-if="captureSlideCount > 0">
            已捕获 {{ capturedSlides }}/{{ captureSlideCount }} 页
          </span>
          <span v-if="exportJob.elementCount !== undefined">
            {{ exportJob.elementCount }} 个可编辑元素
          </span>
        </div>
        <p v-if="exportJob.error" class="export-error">
          {{ exportJob.error.message }}
        </p>
        <p v-else-if="captureError" class="export-error">
          {{ captureError }}
        </p>
        <details v-if="exportJob.warnings.length" class="export-warnings">
          <summary>
            导出警告 {{ exportJob.warnings.length }} 条 ·
            {{ groupedExportWarnings.length }} 类
          </summary>
          <ul>
            <li
              v-for="warning in groupedExportWarnings"
              :key="`${warning.code}-${warning.message}`"
            >
              {{ warning.message }}
              <strong v-if="warning.count > 1">×{{ warning.count }}</strong>
            </li>
          </ul>
        </details>
        <div class="export-controls">
          <button v-if="exporting" type="button" @click="$emit('cancelExport')">
            取消导出
          </button>
          <button
            v-if="exportJob.status === 'completed'"
            type="button"
            @click="$emit('downloadExport')"
          >
            下载 PPTX
          </button>
        </div>
      </section>
    </div>
    <footer class="preview-footer">
      <span>{{ error ? '错误' : (state?.status ?? 'stopped') }}</span>
      <span v-if="theme">{{ themeLabel }}</span>
      <button
        v-if="state?.status !== 'stopped'"
        type="button"
        @click="$emit('stop')"
      >
        停止
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.preview-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--color-preview-shell);
}
.preview-header,
.preview-footer,
.preview-actions {
  display: flex;
  align-items: center;
}
.page-indicator {
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: nowrap;
}
.preview-header {
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
}
.preview-identity {
  display: grid;
  min-width: 0;
  gap: 4px;
}
.eyebrow {
  color: var(--color-muted);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.preview-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}
.preview-actions button,
.slide-placeholder button,
.preview-footer button,
.export-controls button {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  font-size: 10px;
}
.preview-actions .export-button {
  border-color: #48b99c;
  background: #123f35;
  color: #d7fff3;
}
.preview-canvas {
  container-type: size;
  display: grid;
  min-height: 0;
  place-items: center;
  padding: 18px;
  background-image: radial-gradient(circle, #2a302f 1px, transparent 1px);
  background-size: 18px 18px;
}
.preview-content {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 0;
  overflow: hidden;
}
.preview-content > .preview-canvas {
  min-height: 0;
  overflow: hidden;
}
.preview-frame {
  aspect-ratio: 16 / 9;
  width: min(100cqw, calc(100cqh * 16 / 9));
  max-height: 100%;
  border: 0;
  border-radius: 4px;
  background: white;
  box-shadow: 0 18px 70px rgb(0 0 0 / 42%);
}
.capture-frame {
  position: fixed;
  top: 0;
  left: -10000px;
  width: 1440px;
  height: 900px;
  border: 0;
  pointer-events: none;
  z-index: 0;
}
.slide-placeholder {
  display: grid;
  aspect-ratio: 16 / 9;
  width: min(100%, 780px);
  place-content: center;
  gap: 13px;
  padding: 8%;
  border-radius: 4px;
  background: #f4f0e7;
  box-shadow: 0 18px 70px rgb(0 0 0 / 42%);
  color: #17211e;
  text-align: center;
}
.slide-kicker {
  color: #14705b;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
}
.slide-placeholder h2,
.slide-placeholder p {
  margin: 0;
}
.slide-placeholder h2 {
  font-family: Georgia, serif;
  font-size: clamp(22px, 3vw, 42px);
  font-weight: 500;
}
.slide-placeholder p {
  color: #58635f;
  font-size: 12px;
  line-height: 1.6;
}
.slide-placeholder button {
  justify-self: center;
  border-color: #14705b;
  color: #14705b;
}
.preview-footer {
  justify-content: space-between;
  gap: 8px;
  padding: 9px 16px;
  border-top: 1px solid var(--color-border);
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 9px;
}
.export-status {
  position: relative;
  z-index: 1;
  min-height: 0;
  max-height: min(30dvh, 260px);
  overflow: auto;
  display: grid;
  gap: 7px;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border);
  background: var(--color-preview-shell);
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 9px;
}
@media (max-width: 1100px) {
  .preview-canvas {
    padding: 12px;
  }
  .export-status {
    max-height: 34dvh;
    overflow: auto;
    background: var(--color-panel);
  }
}
.export-summary,
.export-detail,
.export-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.export-summary span,
.export-detail span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.export-status progress {
  width: 100%;
  height: 5px;
  accent-color: #48b99c;
}
.export-error,
.export-warnings {
  margin: 0;
  color: #ff9f8f;
  line-height: 1.45;
}
.export-warnings {
  color: #e5c46b;
}
.export-warnings summary {
  cursor: pointer;
  user-select: none;
}
.export-warnings ul {
  margin: 6px 0 0;
  padding-left: 18px;
}
.export-warnings strong {
  margin-left: 4px;
  color: #f3d98d;
}
.export-controls {
  justify-content: flex-end;
}
.preview-footer span:nth-child(2) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
