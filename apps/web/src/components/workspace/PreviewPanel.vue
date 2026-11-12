<script setup lang="ts">
import {
  Aside,
  Box,
  Button,
  Disclosure,
  DisclosureTrigger,
  Field,
  Footer,
  Frame,
  Header,
  Heading,
  List,
  ListItem,
  Panel,
  Progress,
  SelectField,
  SelectOption,
  Text,
  TextField,
} from '@fastrd/ui-vue'
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
  negotiateSnapshotVersion,
} from '@fastppt/slidewave/browser'

import { resolveGatewayUrl } from '../../api/useGatewayClient.js'
import RegionSelector from './RegionSelector.vue'
import { useDetailsMenu } from '../../workspace/use-details-menu.js'
import { createPageWheelHandler } from '../../workspace/page-wheel.js'
import { Select as AppSelect, type SelectItem } from '@fastrd/ui-vue'
import ThemeRuleExceptionsPanel from './ThemeRuleExceptionsPanel.vue'

import type {
  SlideRegion,
  DeckSummary,
  BrowserInspectionJob,
  DeckValidationResult,
  ExportJob,
  SlidevProcessState,
  ThemeSummary,
} from '@fastppt/protocol'
import type { SlidewaveCaptureRequest } from '@fastppt/slidewave/browser'
import type { DeepReadonly } from 'vue'

const moreMenu = shallowRef<HTMLDetailsElement>()
const { menuStyle: moreMenuStyle } = useDetailsMenu(moreMenu, 290)

const props = defineProps<{
  deliveryDefaults?:
    { master: boolean; notes: boolean; animations: boolean } | undefined
  decks: readonly DeckSummary[]
  selectedDeckId: string | undefined
  theme: DeepReadonly<ThemeSummary> | undefined
  state: DeepReadonly<SlidevProcessState> | undefined
  loading: boolean
  error: string | undefined
  frameRevision: number
  requestedPage: number | undefined
  maxPage: number | undefined
  exportJob: DeepReadonly<ExportJob> | undefined
  inspectionJob: DeepReadonly<BrowserInspectionJob> | undefined
  validation: DeepReadonly<DeckValidationResult> | undefined
}>()

const emit = defineEmits<{
  editRegion: [input: { page: number; region: SlideRegion }]
  editPage: [page: number]
  selectDeck: [deckId: string]
  start: []
  restart: []
  stop: []
  refresh: []
  export: [
    options?: {
      policy?: 'editable' | 'strict-editable' | 'visual-fidelity'
      master?: boolean
      notes?: boolean
      animations?: boolean
      diagrams?: boolean
      review?: boolean
    },
  ]
  inspectQuality: [slide: number]
  ruleExceptionsChanged: []
  cancelExport: []
  reviewExport: [exportId: string, approved: boolean]
  retryExport: []
  downloadExport: []
  snapshot: [input: { exportId: string; snapshot: unknown }]
  captureProgress: [
    input: { exportId: string; completed: number; total: number },
  ]
  inspectionResult: [input: { inspectionId: string; result: unknown }]
  pageChange: [page: number]
}>()

const selectingRegion = shallowRef(false)
const slideBounds = shallowRef<SlideRegion>()
const slideAspect = shallowRef(16 / 9)
watch(() => props.selectedDeckId, () => { slideAspect.value = 16 / 9 })
watch(
  () => [props.selectedDeckId, props.frameRevision],
  () => {
    selectingRegion.value = false
    slideBounds.value = undefined
  },
)
function editRegion(region: SlideRegion): void {
  if (!canVisualEdit.value) return
  selectingRegion.value = false
  emit('editRegion', {
    page: currentPage.value ?? props.requestedPage ?? 1,
    region,
  })
}
const frame = useTemplateRef<HTMLIFrameElement>('frame')
const exportPolicy = shallowRef<
  'editable' | 'strict-editable' | 'visual-fidelity'
>('editable')
const exportOptions = shallowRef({
  master: true,
  notes: true,
  animations: true,
  diagrams: true,
  review: true,
})
const exportProfileKey = 'fastppt.export-profile.v1'
const ruleExceptionOptions = computed(() => ({
  ...exportOptions.value,
  policy: exportPolicy.value,
}))
onMounted(() => {
  try {
    const saved = JSON.parse(
      localStorage.getItem(exportProfileKey) ?? '',
    ) as Partial<typeof exportOptions.value>
    exportOptions.value = {
      ...exportOptions.value,
      ...(Object.fromEntries(
        Object.keys(exportOptions.value).map((key) => [
          key,
          saved[key as keyof typeof saved] !== false,
        ]),
      ) as typeof exportOptions.value),
    }
  } catch {
    /* use defaults */
  }
  if (props.deliveryDefaults)
    exportOptions.value = { ...exportOptions.value, ...props.deliveryDefaults }
})
watch(
  () => props.deliveryDefaults,
  (defaults) => {
    if (defaults) exportOptions.value = { ...exportOptions.value, ...defaults }
  },
)
watch(
  exportOptions,
  (value) => localStorage.setItem(exportProfileKey, JSON.stringify(value)),
  { deep: true },
)
const ready = computed(
  () =>
    props.state?.deckId === props.selectedDeckId &&
    props.state?.status === 'ready' &&
    props.state.previewUrl,
)
const deckOptions = computed<readonly SelectItem[]>(() =>
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
const themeLabel = computed(() => (props.theme ? props.theme.displayName : ''))
const exporting = computed(() =>
  ['queued', 'running'].includes(props.exportJob?.status ?? ''),
)
const reviewing = computed(() => props.exportJob?.status === 'review-required')
const captureFrame = useTemplateRef<HTMLIFrameElement>('captureFrame')
const currentPage = shallowRef<number>()
const pendingPage = shallowRef(props.requestedPage)
const canVisualEdit = computed(
  () =>
    ready.value &&
    pendingPage.value === undefined &&
    currentPage.value !== undefined &&
    (!props.requestedPage || currentPage.value === props.requestedPage),
)
watch(
  () => props.requestedPage,
  () => {
    selectingRegion.value = false
  },
)
const pageInput = shallowRef('')
watch(() => [props.selectedDeckId, props.frameRevision], () => {
  pendingPage.value = props.requestedPage ?? 1
  currentPage.value = undefined
  pageInput.value = String(pendingPage.value)
})
const captureRequestId = shallowRef<string>()
const captureError = shallowRef<string>()
const captureConnected = shallowRef(false)
const captureSnapshotVersions = shallowRef<number[]>([1])
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
const exportStages = computed(() => {
  const phase = props.exportJob?.phase ?? ''
  const status = props.exportJob?.status ?? ''
  const failed = status === 'failed'
  const activeIndex =
    status === 'completed'
      ? 5
      : status === 'review-required'
        ? 4
        : phase === 'rendering-pptx'
          ? 3
          : phase === 'snapshot-received'
            ? 2
            : phase === 'awaiting-browser-capture'
              ? captureConnected.value
                ? 1
                : 0
              : status === 'running'
                ? 3
                : 0
  const stages = [
    [
      '准备捕获',
      captureConnected.value ? '捕获页面已就绪' : '等待捕获页面加载',
    ],
    [
      '逐页捕获',
      captureSlideCount.value > 0
        ? `正在捕获 ${capturedSlides.value}/${captureSlideCount.value} 页`
        : '等待捕获引擎连接',
    ],
    ['上传快照', '将页面结构发送到导出服务'],
    [
      '生成 PPTX',
      phase === 'checking-template-rules'
        ? '正在回读 PPTX 并复验模板规则'
        : '转换为可编辑元素并执行质量检查',
    ],
    ['等待确认', '检查 QA 结果并确认发布'],
    ['导出完成', 'PPTX 已可下载'],
  ]
  return stages.map(([label, description], index) => ({
    label,
    description,
    state:
      failed && index === activeIndex
        ? 'failed'
        : index < activeIndex || status === 'completed'
          ? 'completed'
          : index === activeIndex
            ? 'active'
            : 'pending',
  }))
})
const exportStage = computed(
  () =>
    exportStages.value.find((stage) => stage.state === 'failed') ??
    exportStages.value.find((stage) => stage.state === 'active') ??
    exportStages.value.at(-1),
)
const exportErrorMessage = computed(() => {
  const message = props.exportJob?.error?.message ?? captureError.value
  if (!message) return undefined
  if (message.includes('did not provide a Slidewave snapshot in time'))
    return '捕获页面未能及时连接 Slidewave 引擎。请重试导出；若仍失败，请重启预览后再试。'
  return message
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
  const snapshotVersion = negotiateSnapshotVersion(
    captureSnapshotVersions.value,
    props.exportJob?.snapshotVersions,
  )
  if (
    snapshotVersion === undefined &&
    props.inspectionJob?.status !== 'queued'
  ) {
    captureError.value =
      '捕获引擎与服务端没有共同的快照版本，请刷新预览后重试。'
    return
  }
  const requestId = captureRequestId.value ?? crypto.randomUUID()
  captureRequestId.value = requestId
  const message =
    props.inspectionJob?.status === 'queued'
      ? {
          type:
            props.inspectionJob.kind === 'quality'
              ? 'fastppt.slidewave.quality.request'
              : 'fastppt.slidewave.overflow.request',
          version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
          requestId,
          slide: props.inspectionJob.slide,
        }
      : {
          type: 'fastppt.slidewave.capture.request',
          version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
          requestId,
          theme: captureTheme(),
          snapshotVersion,
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

function sendPageToPreview(page: number): void {
  frame.value?.contentWindow?.postMessage(
    { target: 'slidev', type: 'navigate', no: page, clicks: 999999 },
    proxiedPreviewUrl.value
      ? new URL(proxiedPreviewUrl.value).origin
      : window.location.origin,
  )
}
function requestPreviewPage(page: number): void {
  const target = Math.max(1, Math.min(page, props.maxPage ?? page))
  pendingPage.value = target
  pageInput.value = String(target)
  sendPageToPreview(target)
}
const handlePageWheel = createPageWheelHandler((direction) => {
  const page = pendingPage.value ?? currentPage.value ?? props.requestedPage ?? 1
  const target = Math.max(1, Math.min(props.maxPage ?? page, page + direction))
  if (target !== page) requestPreviewPage(target)
}, () => Boolean(ready.value && props.maxPage))
function handleBackgroundWheel(event: WheelEvent): void {
  if (event.target instanceof Element && event.target.closest('.preview-stage')) return
  handlePageWheel(event)
}

function navigateToPage(): void {
  const requested = Number.parseInt(pageInput.value, 10)
  if (!Number.isInteger(requested) || requested < 1) {
    pageInput.value = currentPage.value ? String(currentPage.value) : ''
    return
  }
  const page = props.maxPage ? Math.min(requested, props.maxPage) : requested
  requestPreviewPage(page)
}

function handlePreviewKey(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
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
    slideBounds.value = event.data.bounds
    const size = event.data.slideSize
    if (size && size.width > 0 && size.height > 0 && Number.isFinite(size.width / size.height))
      slideAspect.value = size.width / size.height
    currentPage.value = event.data.page ?? undefined
    if (pendingPage.value !== undefined && event.data.page !== pendingPage.value) {
      sendPageToPreview(pendingPage.value)
      return
    }
    pendingPage.value = undefined
    if (event.data.page) emit('pageChange', event.data.page)
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
    captureSnapshotVersions.value = message.snapshotVersions ?? [1]
    captureConnected.value = true
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
  } else if (message.type === 'fastppt.slidewave.quality.completed') {
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
  captureConnected.value = false
  captureSnapshotVersions.value = [1]
  capturedSlides.value = 0
  captureSlideCount.value = 0
})
watch(currentPage, (page) => {
  selectingRegion.value = false
  pageInput.value = pendingPage.value !== undefined ? String(pendingPage.value) : page ? String(page) : ''
})
watch(
  () => props.requestedPage,
  (page) => {
    if (!page || page === currentPage.value) return
    requestPreviewPage(page)
  },
)
function forwardAnimationPreview(event: Event): void {
  const detail = (event as CustomEvent).detail as
    | { slide?: number; effect?: unknown; elapsedMs?: number; reset?: boolean }
    | undefined
  if ((!detail?.effect && !detail?.reset) || !frame.value?.contentWindow) return
  const savedMotion = localStorage.getItem('fastppt.motion-preference')
  const motionPreference =
    savedMotion === 'reduce' || savedMotion === 'full' ? savedMotion : 'system'
  frame.value.contentWindow.postMessage(
    {
      target: 'fastppt-preview',
      type: 'fastppt.slidewave.animation.preview',
      version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
      motionPreference,
      slide: detail.slide,
      effect: detail.effect,
      elapsedMs: detail.elapsedMs,
      reset: detail.reset,
    },
    proxiedPreviewUrl.value
      ? new URL(proxiedPreviewUrl.value).origin
      : window.location.origin,
  )
}
onMounted(() => {
  window.addEventListener('message', handleCaptureMessage)
  window.addEventListener('fastppt-animation-preview', forwardAnimationPreview)
})
onUnmounted(() => {
  window.removeEventListener('message', handleCaptureMessage)
  window.removeEventListener(
    'fastppt-animation-preview',
    forwardAnimationPreview,
  )
})
</script>

<template>
  <Aside class="preview-panel panel-surface">
    <Header class="preview-header">
      <Box class="preview-identity">
        <Text class="eyebrow">实时预览</Text>
        <AppSelect
          id="fastppt-preview-deck"
          size="xs"
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
      </Box>
      <Box class="preview-actions">
        <Field class="page-indicator">
          <Text>第</Text>
          <TextField
            v-model="pageInput"
            size="xs"
            type="number"
            min="1"
            :max="maxPage"
            inputmode="numeric"
            :disabled="!ready"
            aria-label="跳转到页码"
            placeholder="—"
            @focus="($event.target as HTMLInputElement).select()"
            @keydown.enter.prevent="navigateToPage"
            @change="navigateToPage"
          />
          <Text>页</Text>
        </Field>
        <Button
          variant="secondary"
          size="xs"
          type="button"
          :disabled="!ready"
          @click="$emit('refresh')"
        >
          刷新
        </Button>
        <Disclosure ref="moreMenu" class="preview-more">
          <DisclosureTrigger size="xs">更多</DisclosureTrigger>
          <Box class="preview-more-menu" :style="moreMenuStyle">
            <Button
              variant="secondary"
              type="button"
              :disabled="!ready"
              @click="emit('editPage', currentPage ?? requestedPage ?? 1)"
            >
              重做此页
            </Button>

            <Button
              variant="secondary"
              type="button"
              :disabled="!ready || inspectionJob?.status === 'queued'"
              @click="$emit('inspectQuality', currentPage ?? 1)"
            >
              {{ inspectionJob?.status === 'queued' ? '检查中…' : '质量检查' }}
            </Button>
            <Button
              variant="secondary"
              type="button"
              :disabled="!ready"
              @click="$emit('restart')"
            >
              重启预览
            </Button>
            <Button
              variant="secondary"
              type="button"
              :disabled="!ready"
              @click="$emit('stop')"
            >
              停止预览
            </Button>
            <Disclosure class="export-options">
              <DisclosureTrigger>导出选项</DisclosureTrigger>
              <Field>
                导出策略<SelectField v-model="exportPolicy">
                  <SelectOption value="editable"
                  >
                    可编辑优先（允许报告内降级）
                  </SelectOption
                  >
                  <SelectOption value="strict-editable">
                    严格可编辑（保留原生结构，拒绝图片降级）
                  </SelectOption>
                </SelectField>
              </Field
              ><Field
                v-for="option in [
                  { key: 'master', label: '母版' },
                  { key: 'notes', label: '备注' },
                  { key: 'animations', label: '动画' },
                  { key: 'diagrams', label: '图表' },
                  { key: 'review', label: '导出审查' },
                ]"
                :key="option.key"
              >
                <TextField
                  v-model="
                    exportOptions[option.key as keyof typeof exportOptions]
                  "
                  type="checkbox"
                />{{ option.label }}
              </Field>
            </Disclosure>
            <ThemeRuleExceptionsPanel
              v-if="selectedDeckId"
              :deck-id="selectedDeckId"
              :options="ruleExceptionOptions"
              :export-job="exportJob"
              @changed="emit('ruleExceptionsChanged')"
            />
          </Box>
        </Disclosure>
        <Button
          variant="primary"
          size="xs"
          type="button"
          :disabled="!canVisualEdit"
          :aria-pressed="selectingRegion"
          @click="selectingRegion = !selectingRegion"
        >
          {{ selectingRegion ? '取消框选' : '框选修改' }}
        </Button>
        <Button
          variant="primary"
          size="xs"
          class="export-button"
          type="button"
          :disabled="!ready || exporting"
          @click="$emit('export', { ...exportOptions, policy: exportPolicy })"
        >
          {{ exporting ? '导出中…' : '导出 PPTX' }}
        </Button>
      </Box>
    </Header>
    <Box class="preview-content">
      <Box
        class="preview-canvas"
        tabindex="0"
        aria-label="幻灯片预览，使用左右方向键翻页"
        @keydown="handlePreviewKey"
        @wheel="handleBackgroundWheel"
      >
        <Box v-if="ready" class="preview-stage" :style="{ '--preview-aspect': slideAspect }">
          <Frame
            :key="`${state?.previewUrl}-${frameRevision}`"
            ref="frame"
            class="preview-frame"
            :src="previewUrl"
            title="Slidev preview"
            sandbox="allow-scripts allow-same-origin"
            allow="screen-wake-lock"
            @load="requestPreviewPage(requestedPage ?? 1)"
          ></Frame>
          <RegionSelector
            :style="
              slideBounds
                ? {
                  left: `${slideBounds.x * 100}%`,
                  top: `${slideBounds.y * 100}%`,
                  width: `${slideBounds.width * 100}%`,
                  height: `${slideBounds.height * 100}%`,
                  right: 'auto',
                  bottom: 'auto',
                }
                : undefined
            "
            :enabled="selectingRegion"
            :page="currentPage ?? requestedPage ?? 1"
            :revision="frameRevision"
            :deck-id="selectedDeckId"
            @select="editRegion"
            @cancel="selectingRegion = false"
          />
        </Box>
        <Frame
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
        ></Frame>
        <Box v-if="!ready" class="slide-placeholder">
          <Text class="slide-kicker">FASTPPT / SLIDEV</Text>
          <Heading as="h2">
            {{
              loading ? '正在启动预览…' : '预览尚未运行'
            }}
          </Heading>
          <Text as="p">{{ statusMessage }}</Text>
          <Button
            v-if="!loading"
            variant="secondary"
            type="button"
            @click="$emit('start')"
          >
            启动预览
          </Button>
        </Box>
      </Box>
      <Panel
        v-if="
          inspectionJob?.kind === 'quality' &&
            inspectionJob.status === 'completed'
        "
        class="export-status"
        aria-live="polite"
      >
        <Box class="export-summary">
          <Text>第 {{ inspectionJob.slide }} 页质量报告</Text>
          <Text as="strong">
            {{
              'issues' in inspectionJob.result!
                ? inspectionJob.result.issues.length
                : 0
            }}
            项
          </Text>
        </Box>
        <List
          v-if="
            'issues' in inspectionJob.result! &&
              inspectionJob.result.issues.length
          "
        >
          <ListItem
            v-for="issue in inspectionJob.result.issues"
            :key="`${issue.code}-${issue.selector}`"
          >
            {{ issue.code }} · {{ issue.message }}
          </ListItem>
        </List>
        <Text v-else as="p">确定性文本与几何检查通过。</Text>
      </Panel>
      <Panel
        v-if="
          validation && (validation.themeRuleIssues.length || !validation.valid)
        "
        class="export-status theme-validation"
        aria-live="polite"
      >
        <Box class="export-summary">
          <Text>主题规则校验</Text>
          <Text as="strong">
            {{
              validation.valid
                ? validation.themeRuleIssues.some((issue) => issue.exception)
                  ? '可继续（含例外）'
                  : '通过（有提示）'
                : '需要修复'
            }}
          </Text>
        </Box>
        <List>
          <ListItem
            v-for="issue in validation.themeRuleIssues"
            :key="`${issue.ruleId}-${issue.code}-${issue.slide ?? 0}`"
          >
            {{ issue.ruleId }} · {{ issue.severity
            }}<Text v-if="issue.slide"> · 第 {{ issue.slide }} 页</Text> ·
            {{ issue.message }}
            <Text v-if="issue.suggestedFix" as="small">
              {{
                issue.suggestedFix
              }}
            </Text>
            <Text v-if="issue.exception" as="small">
              已批准例外：{{ issue.exception.reason }}
            </Text>
          </ListItem>
        </List>
      </Panel>
      <Panel v-if="exportJob" class="export-status" aria-live="polite">
        <Box class="export-summary">
          <Text>{{ exportJob.outputName }}</Text>
          <Text as="strong">{{ exportProgress }}%</Text>
        </Box>
        <Box class="export-stage-copy">
          <Text as="strong">{{ exportStage?.label }}</Text>
          <Text>{{ exportStage?.description }}</Text>
        </Box>
        <Progress :value="exportProgress" max="100">
          {{ exportProgress }}%
        </Progress>
        <List as="ol" class="export-timeline" aria-label="导出阶段">
          <ListItem
            v-for="stage in exportStages"
            :key="stage.label"
            :class="stage.state"
          >
            <Text class="stage-dot" aria-hidden="true"></Text>
            <Text>{{ stage.label }}</Text>
          </ListItem>
        </List>
        <Box class="export-detail">
          <Text v-if="captureSlideCount > 0">
            已捕获 {{ capturedSlides }}/{{ captureSlideCount }} 页
          </Text>
          <Text v-if="exportJob.slideCount !== undefined">
            {{ exportJob.slideCount }} 页
          </Text>
          <Text v-if="exportJob.elementCount !== undefined">
            {{ exportJob.elementCount }} 个已渲染源元素
          </Text>
        </Box>
        <Text v-if="exportErrorMessage" as="p" class="export-error">
          {{ exportErrorMessage }}
        </Text>
        <Disclosure v-if="exportJob.themeRules" class="export-warnings">
          <DisclosureTrigger>
            导出前模板规则 · {{ exportJob.themeRules.issues.length }} 个问题
          </DisclosureTrigger>
          <List>
            <ListItem
              v-for="(issue, index) in exportJob.themeRules.issues"
              :key="index"
            >
              <Text as="strong">{{ issue.ruleId }}</Text>
              <Text v-if="issue.slide"> · 第 {{ issue.slide }} 页</Text>
              · {{ issue.message }}
              <Box v-if="issue.source">来源：{{ issue.source }}</Box>
              <Box v-if="issue.suggestedFix">{{ issue.suggestedFix }}</Box>
              <Box v-if="issue.exception">
                已批准例外：{{ issue.exception.reason }}
              </Box>
            </ListItem>
          </List>
        </Disclosure>
        <Disclosure
          v-if="exportJob.themeRules?.readback"
          class="export-warnings"
          :open="exportJob.themeRules.readback.status !== 'passed'"
        >
          <DisclosureTrigger>
            PPTX 规则回读 ·
            {{
              exportJob.themeRules.readback.status === 'passed'
                ? '通过'
                : exportJob.themeRules.readback.status === 'failed'
                  ? '未通过'
                  : '有待审查问题'
            }}
          </DisclosureTrigger>
          <Text v-if="exportJob.themeRules.readback.error" as="p">
            {{ exportJob.themeRules.readback.error }}
          </Text>
          <List>
            <ListItem
              v-for="(issue, index) in exportJob.themeRules.readback.issues"
              :key="index"
            >
              <Text as="strong">{{ issue.ruleId }}</Text>
              <Text v-if="issue.slide"> · 第 {{ issue.slide }} 页</Text>
              · {{ issue.status === 'unverified' ? '缺少验证证据：' : ''
              }}{{ issue.message }}
              <Box v-if="issue.source">来源：{{ issue.source }}</Box>
              <Box v-if="issue.suggestedFix">{{ issue.suggestedFix }}</Box>
              <Box v-if="issue.exception">
                已批准例外：{{ issue.exception.reason }}
              </Box>
            </ListItem>
          </List>
        </Disclosure>
        <Disclosure v-if="exportJob.warnings.length" class="export-warnings">
          <DisclosureTrigger>
            导出警告 {{ exportJob.warnings.length }} 条 ·
            {{ groupedExportWarnings.length }} 类
          </DisclosureTrigger>
          <List>
            <ListItem
              v-for="warning in groupedExportWarnings"
              :key="`${warning.code}-${warning.message}`"
            >
              {{ warning.message }}
              <Text v-if="warning.count > 1" as="strong"
              >
                ×{{ warning.count }}
              </Text
              >
            </ListItem>
          </List>
        </Disclosure>
        <Disclosure v-if="exportJob.objects?.length" class="export-warnings">
          <DisclosureTrigger>
            逐对象输出报告 · {{ exportJob.objects.length }} 个源对象
          </DisclosureTrigger>
          <Text as="p">
            此报告记录生成操作；PowerPoint、WPS 与 Keynote 应用兼容性尚未验证。
          </Text>
          <List>
            <ListItem
              v-for="object in exportJob.objects"
              :key="`${object.slideId}:${object.elementId}`"
            >
              {{ object.slideId }} · {{ object.source.path }}：{{
                object.status
              }}
              （原生 {{ object.nativeCount }} / 图片 {{ object.imageCount }}）
              <Text v-if="object.semanticKind === 'table'">
                ·
                {{ object.semanticPreserved ? '原生表格' : '表格结构未保留' }} ·
                结构回读 {{ object.verification?.structure ?? 'unverified' }}
              </Text>
              <Text v-if="object.imageKinds && object.imageCount">
                · 矢量 {{ object.imageKinds.vector }} / 栅格
                {{ object.imageKinds.raster }} / 未知
                {{ object.imageKinds.unknown }}
              </Text>
              <Text v-if="object.layoutRepair">
                · 文本宽度修复建议
                {{ object.layoutRepair.source.width.toFixed(1) }} →
                {{ object.layoutRepair.proposed.width.toFixed(1) }} px（{{
                  object.layoutRepair.applied ? '已应用' : '未应用，保留源边界'
                }}）
              </Text>
              <Text v-if="object.fonts">
                · 字体请求 {{ object.fonts.requested.join(', ') || '未指定' }} →
                PPTX {{ object.fonts.emitted.join(', ') || '未输出'
                }}{{ object.fonts.substituted ? '（含字体映射）' : '' }}
              </Text>
              <Text v-if="object.reasons.length">
                — {{ object.reasons.join('；') }}
              </Text>
            </ListItem>
          </List>
        </Disclosure>
        <Disclosure
          v-if="exportJob.qa"
          class="export-qa"
          :class="{ fail: !exportJob.qa.ok }"
        >
          <DisclosureTrigger>
            <Text :class="exportJob.qa.ok ? 'qa-pass' : 'qa-fail'">
              {{ exportJob.qa.ok ? '✓ QA 通过' : '⚠ QA 未通过' }}
            </Text>
            · {{ exportJob.qa.issues.length }} 个问题
          </DisclosureTrigger>
          <List>
            <ListItem
              v-for="(issue, index) in exportJob.qa.issues"
              :key="index"
            >
              <Text v-if="issue.slide !== undefined">
                第 {{ issue.slide }} 页：
              </Text>
              {{ issue.message }}
            </ListItem>
          </List>
        </Disclosure>
        <Text v-if="reviewing" as="p" class="export-review-hint">
          请核对左侧预览与下方 QA，确认无误后发布导出。
        </Text>
        <Box class="export-controls">
          <Button
            v-if="exporting"
            variant="secondary"
            type="button"
            @click="$emit('cancelExport')"
          >
            取消导出
          </Button>
          <Button
            v-if="exportJob.status === 'failed'"
            variant="secondary"
            type="button"
            @click="$emit('retryExport')"
          >
            重试导出
          </Button>
          <template v-if="reviewing">
            <Button
              variant="secondary"
              type="button"
              @click="$emit('reviewExport', exportJob.id, false)"
            >
              拒绝导出
            </Button>
            <Button
              variant="primary"
              type="button"
              class="primary"
              @click="$emit('reviewExport', exportJob.id, true)"
            >
              确认导出
            </Button>
          </template>
          <Button
            v-if="exportJob.status === 'completed'"
            variant="secondary"
            type="button"
            @click="$emit('downloadExport')"
          >
            下载 PPTX
          </Button>
        </Box>
      </Panel>
    </Box>
    <Footer class="preview-footer">
      <Text>
        {{
          error
            ? '预览异常'
            : state?.status === 'ready'
              ? '预览已就绪'
              : state?.status === 'starting' || state?.status === 'restarting'
                ? '正在启动…'
                : state?.status === 'failed'
                  ? '启动失败'
                  : '预览未启动'
        }}
      </Text>
      <Text v-if="theme">{{ themeLabel }}</Text>
    </Footer>
  </Aside>
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
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}
.page-indicator input {
  width: 38px;
  text-align: center;
}
.preview-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel);
}
.preview-identity {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  gap: 10px;
}
.preview-identity :deep(.fastui-select) {
  flex: 1;
  min-width: 0;
  max-width: none;
}
.eyebrow {
  flex-shrink: 0;
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.preview-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}
.preview-more {
  position: relative;
}
.preview-more > summary {
  display: flex;
  align-items: center;
  height: var(--control-height-xs);
  padding: 1px 6px;
  font-size: 12px;
  line-height: 1.5;
  list-style: none;
  white-space: nowrap;
}
.preview-more-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 30;
  display: grid;
  gap: 8px;
  width: 290px;
  max-height: 75vh;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-panel);
  box-shadow: var(--shadow-popover);
}
.preview-more-menu > button {
  justify-content: flex-start;
  text-align: left;
}
.export-options {
  padding: 8px 0;
  border-top: 1px solid var(--color-border);
}
.export-options label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 12px;
}
.export-options select {
  width: 100%;
}
.preview-canvas {
  container-type: size;
  display: grid;
  min-height: 0;
  place-items: center;
  padding: 18px;
  background-image: radial-gradient(
    circle,
    var(--color-preview-dot) 1px,
    transparent 1px
  );
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
.preview-stage {
  position: relative;
  aspect-ratio: var(--preview-aspect);
  width: min(100cqw, calc(100cqh * var(--preview-aspect)));
  max-height: 100%;
}
.preview-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 4px;
  background: transparent;
  box-shadow: 0 4px 20px rgb(16 24 40 / 10%);
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
  background: var(--color-panel);
  box-shadow: 0 4px 20px rgb(16 24 40 / 10%);
  color: var(--color-text);
  text-align: center;
}
.slide-kicker {
  color: var(--color-accent-strong);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
}
.slide-placeholder h2,
.slide-placeholder p {
  margin: 0;
}
.slide-placeholder h2 {
  font-size: clamp(18px, 2vw, 26px);
  font-weight: 500;
}
.slide-placeholder p {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.6;
}
.slide-placeholder button {
  justify-self: center;
}
.preview-footer {
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  background: var(--color-panel-raised);
  border-top: 1px solid var(--color-border);
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 11px;
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
  font-size: 11px;
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
  accent-color: var(--color-accent-strong);
}
.export-stage-copy {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.export-stage-copy strong {
  color: var(--color-text);
  font-size: 11px;
}
.export-stage-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.export-timeline {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 5px;
  margin: 1px 0;
  padding: 0;
  list-style: none;
}
.export-timeline li {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
  color: var(--color-muted);
}
.export-timeline li span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stage-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border: 1px solid currentColor;
  border-radius: 50%;
}
.export-timeline li.completed {
  color: var(--color-accent-strong);
}
.export-timeline li.completed .stage-dot,
.export-timeline li.active .stage-dot {
  background: currentColor;
}
.export-timeline li.active {
  color: var(--color-accent-strong);
}
.export-timeline li.failed {
  color: var(--color-danger);
}
.export-error,
.export-warnings {
  margin: 0;
  color: var(--color-danger);
  line-height: 1.45;
}
.export-warnings {
  color: var(--color-warning);
}
.export-warnings summary {
  user-select: none;
}
.export-warnings ul {
  margin: 6px 0 0;
  padding-left: 18px;
}
.export-warnings strong {
  margin-left: 4px;
  color: var(--color-warning);
}
.export-review-hint {
  margin: 6px 0 0;
  color: var(--color-warning);
  font-size: 11px;
  line-height: 1.45;
}
.export-qa {
  margin: 6px 0 0;
  color: var(--color-success);
  line-height: 1.45;
}
.export-qa.fail {
  color: var(--color-danger);
}
.export-qa summary {
  user-select: none;
}
.export-qa ul {
  margin: 6px 0 0;
  padding-left: 18px;
  color: var(--color-muted);
}
.export-qa .qa-pass {
  color: var(--color-success);
}
.export-qa .qa-fail {
  color: var(--color-danger);
}
.export-controls {
  justify-content: flex-end;
}
.preview-footer span:nth-child(2) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-actions {
  min-width: 0;
  justify-content: flex-start;
  gap: 4px;
}
.preview-actions .export-button {
  margin-left: auto;
}
.preview-more-menu {
  max-width: calc(100vw - 32px);
}
@media (max-width: 600px) {
}
</style>
