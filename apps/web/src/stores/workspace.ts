import { defineStore } from 'pinia'
import { computed, readonly, shallowRef } from 'vue'

import { createConnectivityRetry, isConnectivityError } from '../api/autoRetry.js'
import { useGatewayClient } from '../api/useGatewayClient.js'

import type { WorkspaceInfo } from '@fastppt/protocol'

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspace = shallowRef<WorkspaceInfo>()
  const error = shallowRef<string>()
  const loading = shallowRef(false)
  const { getWorkspace } = useGatewayClient()
  const retry = createConnectivityRetry()

  const displayName = computed(() => workspace.value?.name ?? '正在连接工作区')

  async function load(signal?: AbortSignal): Promise<void> {
    retry.cancel()
    loading.value = true
    error.value = undefined
    try {
      workspace.value = await getWorkspace(signal)
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
        cause instanceof Error ? cause.message : '无法连接 FastPPT Gateway'
    } finally {
      loading.value = false
    }
  }

  function disconnect(): void {
    retry.cancel()
  }

  return {
    workspace: readonly(workspace),
    error: readonly(error),
    loading: readonly(loading),
    displayName,
    load,
    disconnect,
  }
})
