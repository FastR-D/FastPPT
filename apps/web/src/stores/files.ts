import { defineStore } from 'pinia'
import { computed, readonly, shallowRef } from 'vue'

import { createConnectivityRetry, isConnectivityError } from '../api/autoRetry.js'
import { useEventStream } from '../api/useEventStream.js'
import { useGatewayClient } from '../api/useGatewayClient.js'

import type { FileContent, FileNode, ServerEvent } from '@fastppt/protocol'

interface GatewayError extends Error {
  code?: string
  status?: number
}

function isGatewayError(cause: unknown): cause is GatewayError {
  return cause instanceof Error
}

export const useFilesStore = defineStore('files', () => {
  const files = shallowRef<FileNode[]>([])
  const selectedFile = shallowRef<FileContent>()
  const draft = shallowRef('')
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef<string>()
  const externalChange = shallowRef(false)
  const latestEvent = shallowRef<ServerEvent>()
  const client = useGatewayClient()
  const retry = createConnectivityRetry()
  // A reopen starts a new session even when its path is unchanged.
  let session = { opening: false }
  let readVersion = 0
  let draftVersion = 0

  const dirty = computed(
    () =>
      selectedFile.value !== undefined &&
      draft.value !== selectedFile.value.content,
  )

  async function loadTree(signal?: AbortSignal): Promise<void> {
    retry.cancel()
    loading.value = true
    try {
      files.value = await client.listFiles(signal)
      retry.reset()
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (isConnectivityError(cause)) {
        error.value = '无法连接 FastPPT Gateway，正在自动重连…'
        retry.schedule(() => {
          if (!signal?.aborted) void loadTree(signal)
        })
        return
      }
      error.value =
        cause instanceof Error ? cause.message : '无法读取工作区文件'
    } finally {
      loading.value = false
    }
  }

  async function openFile(path: string): Promise<void> {
    const openedSession = { opening: true }
    session = openedSession
    saving.value = false
    error.value = undefined
    externalChange.value = false
    if (selectedFile.value?.path !== path) {
      selectedFile.value = undefined
      draft.value = ''
    }
    const edits = draftVersion
    try {
      const content = await client.readFile(path)
      if (session !== openedSession) return
      selectedFile.value = content
      if (draftVersion === edits) draft.value = content.content
    } catch (cause) {
      if (session !== openedSession) return
      error.value = cause instanceof Error ? cause.message : '无法读取文件'
    } finally {
      openedSession.opening = false
    }
  }

  function updateDraft(content: string): void {
    if (draft.value !== content) draftVersion++
    draft.value = content
  }

  async function save(): Promise<void> {
    if (!selectedFile.value || session.opening || !dirty.value || saving.value)
      return
    const savedSession = session
    const selected = selectedFile.value
    const content = draft.value
    const edits = draftVersion
    // Reads begun before this write cannot replace its acknowledged baseline.
    readVersion++
    saving.value = true
    error.value = undefined
    try {
      const updated = await client.writeFile({
        path: selected.path,
        content,
        expectedRevision: selected.revision,
      })
      if (session !== savedSession) return
      selectedFile.value = updated
      if (draftVersion === edits) draft.value = updated.content
      externalChange.value = false
    } catch (cause) {
      if (session !== savedSession) return
      if (isGatewayError(cause) && cause.status === 409) {
        externalChange.value = true
        error.value =
          '保存冲突：文件已被 Agent 或其他编辑器修改。请复制当前草稿并重新加载。'
      } else {
        error.value = cause instanceof Error ? cause.message : '保存失败'
      }
    } finally {
      if (session === savedSession) saving.value = false
    }
  }

  function handleWorkspaceEvent(event: ServerEvent): void {
    latestEvent.value = event
    void loadTree()
    const currentPath = selectedFile.value?.path
    const eventPath =
      typeof event.data === 'object' && event.data && 'path' in event.data
        ? String(event.data.path)
        : undefined
    if (!currentPath || eventPath !== currentPath) return
    if (dirty.value || saving.value) {
      externalChange.value = true
      return
    }
    void openFile(currentPath)
  }

  async function resyncWorkspace(): Promise<void> {
    const syncedSession = session
    const selected = selectedFile.value
    const read = ++readVersion
    const ownsRead = () =>
      session === syncedSession &&
      !session.opening &&
      readVersion === read &&
      selectedFile.value === selected &&
      !saving.value
    await loadTree()
    if (!selected || !ownsRead()) return
    try {
      const current = await client.readFile(selected.path)
      if (!ownsRead()) return
      if (current.revision === selected.revision) return
      if (dirty.value) {
        externalChange.value = true
        return
      }
      selectedFile.value = current
      draft.value = current.content
      externalChange.value = false
    } catch (cause) {
      if (!ownsRead()) return
      error.value = cause instanceof Error ? cause.message : '无法重新同步文件'
    }
  }

  const eventStream = useEventStream({
    topics: ['workspace'],
    onEvent: handleWorkspaceEvent,
    onResync: resyncWorkspace,
  })

  async function start(signal?: AbortSignal): Promise<void> {
    eventStream.connect()
    await loadTree(signal)
  }

  function stop(): void {
    retry.cancel()
    eventStream.disconnect()
  }

  return {
    files: readonly(files),
    selectedFile: readonly(selectedFile),
    draft: readonly(draft),
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    externalChange: readonly(externalChange),
    latestEvent: readonly(latestEvent),
    connectionStatus: eventStream.status,
    closeReason: eventStream.closeReason,
    dirty,
    loadTree,
    openFile,
    updateDraft,
    save,
    start,
    stop,
  }
})
