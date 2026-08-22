import {
  BrowserInspectionJobSchema,
  ExportJobSchema,
  SlidevProcessStateSchema,
  WorkspaceFileEventSchema,
} from '@fastppt/protocol'
import { defineStore } from 'pinia'
import { computed, readonly, shallowRef } from 'vue'

import {
  createConnectivityRetry,
  isConnectivityError,
} from '../api/autoRetry.js'
import { useEventStream } from '../api/useEventStream.js'
import { useGatewayClient } from '../api/useGatewayClient.js'

import type {
  DeckSummary,
  MarkdownFormatResult,
  ExportJob,
  BrowserInspectionJob,
  ServerEvent,
  SlidevProcessState,
  ThemeSummary,
} from '@fastppt/protocol'

export function resolvePreferredThemeId(
  themeIds: readonly string[],
  recentTheme?: string,
  currentTheme?: string,
): string | undefined {
  return (
    themeIds.find((themeId) => themeId === recentTheme) ??
    themeIds.find((themeId) => themeId === currentTheme) ??
    themeIds[0]
  )
}

export const usePreviewStore = defineStore('preview', () => {
  const themes = shallowRef<ThemeSummary[]>([])
  const decks = shallowRef<DeckSummary[]>([])
  const selectedDeckId = shallowRef<string>()
  const preferredThemeId = shallowRef<string>()
  const state = shallowRef<SlidevProcessState>()
  const loading = shallowRef(false)
  const error = shallowRef<string>()
  const frameRevision = shallowRef(0)
  const exportJob = shallowRef<ExportJob>()
  const inspectionJob = shallowRef<BrowserInspectionJob>()
  let exportPoll: ReturnType<typeof setTimeout> | undefined
  let deckRefreshTimer: ReturnType<typeof setTimeout> | undefined
  let previewDesired = true
  const client = useGatewayClient()
  const previewTopics = ['preview', 'browser-delegation', 'workspace'] as const

  const selectedDeck = computed(() =>
    decks.value.find((deck) => deck.id === selectedDeckId.value),
  )
  const activeThemeId = computed(
    () => selectedDeck.value?.themeId ?? preferredThemeId.value,
  )
  const selectedTheme = computed(() =>
    themes.value.find((theme) => theme.themeId === activeThemeId.value),
  )

  function reconcilePreferredTheme(
    nextThemes: readonly ThemeSummary[],
    recentTheme?: string,
  ): void {
    preferredThemeId.value = resolvePreferredThemeId(
      nextThemes.map((theme) => theme.themeId),
      recentTheme,
      preferredThemeId.value,
    )
  }

  async function acceptDelegatedDeck(deckId: string): Promise<void> {
    if (selectedDeckId.value === deckId && state.value?.status === 'ready')
      return
    selectedDeckId.value = deckId
    state.value = undefined
    await startPreview()
  }

  function deckSelectionFallback(
    nextDecks: readonly DeckSummary[],
    recentTheme?: string,
  ): string | undefined {
    return (
      nextDecks.find((deck) => deck.id === selectedDeckId.value)?.id ??
      nextDecks.find((deck) => deck.themeId === recentTheme)?.id ??
      nextDecks.find((deck) => deck.entryFile === 'slides.md')?.id ??
      nextDecks[0]?.id
    )
  }

  async function refreshDecks(): Promise<void> {
    try {
      const nextDecks = await client.listDecks()
      decks.value = nextDecks
      const nextSelection = deckSelectionFallback(nextDecks)
      if (nextSelection === selectedDeckId.value) return
      selectedDeckId.value = nextSelection
      state.value = undefined
      if (nextSelection) await startPreview()
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '刷新 Deck 列表失败'
    }
  }

  function scheduleDeckRefresh(): void {
    if (deckRefreshTimer) clearTimeout(deckRefreshTimer)
    deckRefreshTimer = setTimeout(() => {
      deckRefreshTimer = undefined
      void refreshDecks()
    }, 150)
  }

  function handlePreviewEvent(event: ServerEvent): void {
    if (event.topic === 'workspace') {
      const fileEvent = WorkspaceFileEventSchema.safeParse(event.data)
      if (
        fileEvent.success &&
        !fileEvent.data.isDirectory &&
        [fileEvent.data.path, fileEvent.data.previousPath].some((path) =>
          path?.toLowerCase().endsWith('.md'),
        )
      )
        scheduleDeckRefresh()
      return
    }
    if (event.topic === 'browser-delegation') {
      const exportRequest = ExportJobSchema.safeParse(event.data)
      if (
        event.type === 'export.capture.requested' &&
        exportRequest.success &&
        exportRequest.data.deckId === selectedDeckId.value
      ) {
        exportJob.value = exportRequest.data
        eventStream.setTopics([
          ...previewTopics,
          `export:${exportRequest.data.id}`,
        ])
        scheduleExportPoll()
        void acceptDelegatedDeck(exportRequest.data.deckId)
        return
      }
      const inspectionRequest = BrowserInspectionJobSchema.safeParse(event.data)
      if (
        event.type === 'inspection.capture.requested' &&
        inspectionRequest.success &&
        inspectionRequest.data.deckId === selectedDeckId.value
      ) {
        inspectionJob.value = inspectionRequest.data
        void acceptDelegatedDeck(inspectionRequest.data.deckId)
      }
      return
    }
    if (event.topic.startsWith('export:')) {
      const parsed = ExportJobSchema.safeParse(event.data)
      if (parsed.success && parsed.data.id === exportJob.value?.id) {
        exportJob.value = parsed.data
        scheduleExportPoll()
      }
      return
    }
    const parsed = SlidevProcessStateSchema.safeParse(event.data)
    if (!parsed.success || parsed.data.deckId !== selectedDeckId.value) return
    state.value = parsed.data
  }

  const retry = createConnectivityRetry()

  const eventStream = useEventStream({
    topics: previewTopics,
    onEvent: handlePreviewEvent,
    onResync: resyncPreview,
  })

  async function resyncPreview(): Promise<void> {
    try {
      const [nextThemes, nextDecks, applicationState] = await Promise.all([
        client.listThemes(),
        client.listDecks(),
        client.getApplicationState(),
      ])
      themes.value = nextThemes
      reconcilePreferredTheme(nextThemes, applicationState.recentTheme)
      decks.value = nextDecks
      const nextSelection = deckSelectionFallback(
        nextDecks,
        applicationState.recentTheme,
      )
      if (nextSelection !== selectedDeckId.value) state.value = undefined
      selectedDeckId.value = nextSelection
      const delegatedExport = applicationState.pendingBrowserExports[0]
      const delegatedInspection = applicationState.pendingBrowserInspections[0]
      if (delegatedExport) {
        exportJob.value = delegatedExport
        eventStream.setTopics([
          ...previewTopics,
          `export:${delegatedExport.id}`,
        ])
        scheduleExportPoll()
        await acceptDelegatedDeck(delegatedExport.deckId)
      }
      if (delegatedInspection) {
        inspectionJob.value = delegatedInspection
        await acceptDelegatedDeck(delegatedInspection.deckId)
      }
      if (exportJob.value) await refreshExport()
      if (selectedDeckId.value) {
        state.value = await client.getPreviewStatus(selectedDeckId.value)
        if (previewDesired && state.value.status === 'stopped')
          state.value = await client.previewAction(
            selectedDeckId.value,
            'start',
          )
      }
      error.value = undefined
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '无法恢复预览实时状态'
    }
  }

  function scheduleExportPoll(): void {
    if (exportPoll) clearTimeout(exportPoll)
    exportPoll = undefined
    if (
      !exportJob.value ||
      !['queued', 'running'].includes(exportJob.value.status)
    )
      return
    exportPoll = setTimeout(() => {
      void refreshExport()
    }, 500)
  }

  async function refreshExport(): Promise<void> {
    if (!exportJob.value) return
    try {
      exportJob.value = await client.getExport(exportJob.value.id)
      scheduleExportPoll()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '读取导出状态失败'
    }
  }

  async function load(signal?: AbortSignal): Promise<void> {
    retry.cancel()
    loading.value = true
    error.value = undefined
    try {
      const [nextThemes, nextDecks, applicationState] = await Promise.all([
        client.listThemes(signal),
        client.listDecks(signal),
        client.getApplicationState(signal),
      ])
      themes.value = nextThemes
      reconcilePreferredTheme(nextThemes, applicationState.recentTheme)
      decks.value = nextDecks
      selectedDeckId.value = deckSelectionFallback(
        nextDecks,
        applicationState.recentTheme,
      )
      eventStream.connect()
      if (selectedDeckId.value) await startPreview()
      retry.reset()
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (isConnectivityError(cause)) {
        error.value = '无法连接 FastPPT Gateway，正在自动重连…'
        retry.schedule(() => {
          if (!signal?.aborted) void load(signal)
        })
        return
      }
      error.value =
        cause instanceof Error ? cause.message : '无法启动 Slidev 预览'
    } finally {
      loading.value = false
    }
  }

  async function perform(action: 'start' | 'restart' | 'stop'): Promise<void> {
    if (!selectedDeckId.value) return
    previewDesired = action !== 'stop'
    loading.value = true
    error.value = undefined
    try {
      state.value = await client.previewAction(selectedDeckId.value, action)
      if (state.value.status === 'failed')
        error.value = state.value.lastError?.message ?? 'Slidev 启动失败'
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '预览操作失败'
    } finally {
      loading.value = false
    }
  }

  async function startPreview(): Promise<void> {
    await perform('start')
  }

  async function restartPreview(): Promise<void> {
    await perform('restart')
  }

  async function stopPreview(): Promise<void> {
    await perform('stop')
  }

  async function selectDeck(deckId: string): Promise<void> {
    if (deckId === selectedDeckId.value && state.value?.status === 'ready')
      return
    selectedDeckId.value = deckId
    previewDesired = true
    state.value = undefined
    exportJob.value = undefined
    inspectionJob.value = undefined
    captureRequestIdReset()
    eventStream.setTopics(previewTopics)
    await startPreview()
  }

  function captureRequestIdReset(): void {
    // Capture request state is owned by PreviewPanel's job-keyed iframe.
  }

  async function startExport(): Promise<void> {
    if (!selectedDeckId.value || !selectedDeck.value) return
    error.value = undefined
    try {
      exportJob.value = await client.createExport(
        selectedDeckId.value,
        `${selectedDeck.value.name}.pptx`,
        true,
      )
      eventStream.setTopics([...previewTopics, `export:${exportJob.value.id}`])
      scheduleExportPoll()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '创建导出任务失败'
    }
  }

  async function inspectQuality(slide: number): Promise<void> {
    if (!selectedDeckId.value) return
    error.value = undefined
    try {
      inspectionJob.value = await client.createQualityInspection(
        selectedDeckId.value,
        slide,
      )
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '创建质量检查失败'
    }
  }

  async function retryExport(): Promise<void> {
    if (!exportJob.value) return
    try {
      exportJob.value = await client.retryExport(exportJob.value.id)
      scheduleExportPoll()
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '重试导出失败'
    }
  }

  async function reviewExport(exportId: string, approved: boolean): Promise<void> {
    if (!exportJob.value) return
    try {
      exportJob.value = await client.reviewExport(exportId, approved)
      scheduleExportPoll()
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '确认导出失败'
    }
  }

  async function cancelExport(): Promise<void> {
    if (!exportJob.value) return
    try {
      exportJob.value = await client.cancelExport(exportJob.value.id)
      scheduleExportPoll()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '取消导出失败'
    }
  }

  async function submitExportSnapshot(
    exportId: string,
    snapshot: unknown,
  ): Promise<void> {
    try {
      exportJob.value = await client.submitExportSnapshot(exportId, snapshot)
      scheduleExportPoll()
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '上传 Slidewave 快照失败'
    }
  }

  async function reportExportCaptureProgress(
    exportId: string,
    completed: number,
    total: number,
  ): Promise<void> {
    try {
      exportJob.value = await client.reportExportCaptureProgress(
        exportId,
        completed,
        total,
      )
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '更新导出进度失败'
    }
  }

  async function submitInspectionResult(
    inspectionId: string,
    result: unknown,
  ): Promise<void> {
    try {
      inspectionJob.value = await client.submitInspectionResult(
        inspectionId,
        result,
      )
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '上传浏览器检查快照失败'
    }
  }

  async function downloadExport(): Promise<void> {
    if (exportJob.value?.status !== 'completed') return
    try {
      await client.downloadExport(exportJob.value)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '下载导出文件失败'
    }
  }

  function refreshFrame(): void {
    frameRevision.value++
  }

  function disconnect(): void {
    retry.cancel()
    if (exportPoll) clearTimeout(exportPoll)
    exportPoll = undefined
    if (deckRefreshTimer) clearTimeout(deckRefreshTimer)
    deckRefreshTimer = undefined
    eventStream.disconnect()
  }

  function connect(): void {
    eventStream.connect()
  }

  async function formatDeckFile(
    entryFile: string,
    expectedRevision?: string,
  ): Promise<MarkdownFormatResult | undefined> {
    const deck = decks.value.find(
      (candidate) => candidate.entryFile === entryFile,
    )
    if (!deck) {
      error.value = '当前文件不是已发现的 Slidev Deck'
      return undefined
    }
    loading.value = true
    error.value = undefined
    try {
      return await client.formatDeck(deck.id, expectedRevision)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '格式化失败'
      return undefined
    } finally {
      loading.value = false
    }
  }

  return {
    themes: readonly(themes),
    decks: readonly(decks),
    selectedDeckId: readonly(selectedDeckId),
    selectedDeck,
    activeThemeId,
    selectedTheme,
    state: readonly(state),
    loading: readonly(loading),
    error: readonly(error),
    frameRevision: readonly(frameRevision),
    exportJob: readonly(exportJob),
    inspectionJob: readonly(inspectionJob),
    connectionStatus: eventStream.status,
    load,
    selectDeck,
    startPreview,
    restartPreview,
    stopPreview,
    refreshFrame,
    startExport,
    inspectQuality,
    reviewExport,
    retryExport,
    cancelExport,
    submitExportSnapshot,
    reportExportCaptureProgress,
    submitInspectionResult,
    downloadExport,
    formatDeckFile,
    disconnect,
    connect,
  }
})
