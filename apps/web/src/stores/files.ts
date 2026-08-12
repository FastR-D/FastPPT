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
    error.value = undefined
    externalChange.value = false
    try {
      const content = await client.readFile(path)
      selectedFile.value = content
      draft.value = content.content
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法读取文件'
    }
  }

  function updateDraft(content: string): void {
    draft.value = content
  }

  async function save(): Promise<void> {
    if (!selectedFile.value || !dirty.value || saving.value) return
    saving.value = true
    error.value = undefined
    try {
      const updated = await client.writeFile({
        path: selectedFile.value.path,
        content: draft.value,
        expectedRevision: selectedFile.value.revision,
      })
      selectedFile.value = updated
      draft.value = updated.content
      externalChange.value = false
    } catch (cause) {
      if (isGatewayError(cause) && cause.status === 409) {
        externalChange.value = true
        error.value =
          '保存冲突：文件已被 Agent 或其他编辑器修改。请复制当前草稿并重新加载。'
      } else {
        error.value = cause instanceof Error ? cause.message : '保存失败'
      }
    } finally {
      saving.value = false
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
    if (dirty.value) {
      externalChange.value = true
      return
    }
    void openFile(currentPath)
  }

  async function resyncWorkspace(): Promise<void> {
    await loadTree()
    const selected = selectedFile.value
    if (!selected) return
    try {
      const current = await client.readFile(selected.path)
      if (current.revision === selected.revision) return
      if (dirty.value) {
        externalChange.value = true
        return
      }
      selectedFile.value = current
      draft.value = current.content
      externalChange.value = false
    } catch (cause) {
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
