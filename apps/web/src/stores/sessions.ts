import {
  ApprovalRequestSchema,
  UnifiedAgentEventSchema,
} from '@fastppt/protocol'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { z } from 'zod'

import {
  createConnectivityRetry,
  isConnectivityError,
} from '../api/autoRetry.js'
import { useEventStream } from '../api/useEventStream.js'
import { useGatewayClient } from '../api/useGatewayClient.js'

import type {
  ApprovalDecision,
  ApprovalRequest,
  HarnessStatus,
  HarnessKind,
  SessionSummary,
  UnifiedAgentEvent,
  UnifiedMessage,
  SkillInstallStatus,
  McpConfigStatus,
  WorkspaceImageAsset,
  RunAuditRecord,
  SessionDeckProfile,
  SessionProfileRecord,
} from '@fastppt/protocol'

export const useSessionsStore = defineStore('sessions', () => {
  const client = useGatewayClient()
  const harnesses = shallowRef<readonly HarnessStatus[]>([])
  const selectedHarness = shallowRef<HarnessKind>('claude')
  const sessions = shallowRef<readonly SessionSummary[]>([])
  const skillStatuses = shallowRef<readonly SkillInstallStatus[]>([])
  const mcpStatuses = shallowRef<readonly McpConfigStatus[]>([])
  const selectedSessionId = shallowRef<string>()
  const persistedMessages = shallowRef<readonly UnifiedMessage[]>([])
  const pendingMessages = shallowRef<readonly PendingMessage[]>([])
  const messages = computed<readonly UnifiedMessage[]>(() => [
    ...persistedMessages.value,
    ...pendingMessages.value.map(({ message }) => message),
  ])
  const events = shallowRef<readonly UnifiedAgentEvent[]>([])
  const runAudit = shallowRef<RunAuditRecord>()
  const selectedProfile = shallowRef<SessionProfileRecord>()
  const approvals = shallowRef<readonly ApprovalRequest[]>([])
  const draft = shallowRef('')
  const attachments = shallowRef<readonly WorkspaceImageAsset[]>([])
  const attaching = shallowRef(false)
  const loading = shallowRef(false)
  const loadingMore = shallowRef(false)
  const nextCursor = shallowRef<string | null>(null)
  const sending = shallowRef(false)
  const error = shallowRef<string>()
  let selectionRestored = false
  let localMessageSequence = 0

  interface PendingMessage {
    message: UnifiedMessage
    runId?: string
    complete: boolean
    historyOffset: number
  }

  function eventText(event: UnifiedAgentEvent): string | undefined {
    if (
      !event.data ||
      typeof event.data !== 'object' ||
      Array.isArray(event.data)
    )
      return undefined
    const data = event.data as Record<string, unknown>
    const value =
      event.type === 'assistant.delta'
        ? data.delta
        : (data.content ?? data.text)
    return typeof value === 'string' && value ? value : undefined
  }

  function appendPendingMessage(
    role: UnifiedMessage['role'],
    content: string,
    options: { runId?: string; complete?: boolean } = {},
  ): string {
    const id = `local:${role}:${Date.now()}:${++localMessageSequence}`
    pendingMessages.value = [
      ...pendingMessages.value,
      {
        message: {
          id,
          role,
          content,
          createdAt: new Date().toISOString(),
        },
        ...(options.runId ? { runId: options.runId } : {}),
        complete: options.complete ?? true,
        historyOffset: persistedMessages.value.length,
      },
    ]
    return id
  }

  function bindPendingUserToRun(runId: string): void {
    const index = pendingMessages.value.findLastIndex(
      (entry) => entry.message.role === 'user' && !entry.runId,
    )
    if (index < 0) return
    pendingMessages.value = pendingMessages.value.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, runId } : entry,
    )
  }

  function applyAssistantEvent(event: UnifiedAgentEvent): void {
    if (
      (event.type !== 'assistant.delta' &&
        event.type !== 'assistant.message') ||
      !event.runId
    )
      return
    const text = eventText(event)
    if (!text) return
    const streamingIndex = pendingMessages.value.findLastIndex(
      (entry) =>
        entry.runId === event.runId &&
        entry.message.role === 'assistant' &&
        !entry.complete,
    )
    if (streamingIndex < 0) {
      appendPendingMessage('assistant', text, {
        runId: event.runId,
        complete: event.type === 'assistant.message',
      })
      return
    }
    pendingMessages.value = pendingMessages.value.map((entry, index) =>
      index === streamingIndex
        ? {
            ...entry,
            complete: event.type === 'assistant.message',
            message: {
              ...entry.message,
              content:
                event.type === 'assistant.delta'
                  ? `${entry.message.content}${text}`
                  : text,
            },
          }
        : entry,
    )
  }

  function setPersistedMessages(nextMessages: readonly UnifiedMessage[]): void {
    persistedMessages.value = nextMessages
    const matched = new Set<number>()
    pendingMessages.value = pendingMessages.value.filter((pending) => {
      const match = nextMessages.findIndex(
        (message, index) =>
          index >= pending.historyOffset &&
          !matched.has(index) &&
          message.role === pending.message.role &&
          message.content === pending.message.content,
      )
      if (match < 0) return true
      matched.add(match)
      return false
    })
  }

  const selectedHarnessStatus = computed(() =>
    harnesses.value.find((harness) => harness.kind === selectedHarness.value),
  )
  const selectedSkillStatuses = computed(() =>
    skillStatuses.value.filter(
      (status) => status.harness === selectedHarness.value,
    ),
  )
  const selectedMcpStatus = computed(() =>
    mcpStatuses.value.find(
      (status) => status.harness === selectedHarness.value,
    ),
  )
  const selectedSession = computed(() =>
    sessions.value.find((session) => session.id === selectedSessionId.value),
  )
  const activeRun = computed(
    () =>
      [...events.value]
        .reverse()
        .find(
          (event) =>
            event.type === 'run.started' ||
            event.type === 'run.completed' ||
            event.type === 'run.cancelled' ||
            event.type === 'run.failed',
        )?.type === 'run.started',
  )

  function updateSessionSummary(
    sessionId: string,
    patch: Partial<SessionSummary>,
  ): void {
    sessions.value = sessions.value.map((session) =>
      session.id === sessionId ? { ...session, ...patch } : session,
    )
  }

  function upsertSessionSummary(summary: SessionSummary): void {
    const existing = sessions.value.some((session) => session.id === summary.id)
    sessions.value = existing
      ? sessions.value.map((session) =>
          session.id === summary.id ? summary : session,
        )
      : [summary, ...sessions.value]
  }

  const retry = createConnectivityRetry()

  const stream = useEventStream({
    topics: ['sessions'],
    onEvent(serverEvent) {
      const parsed = UnifiedAgentEventSchema.safeParse(serverEvent.data)
      if (!parsed.success) return
      const event = parsed.data
      if (event.harness !== selectedHarness.value) return
      const updatedAt = event.timestamp
      if (event.type === 'run.started')
        updateSessionSummary(event.sessionId, { status: 'running', updatedAt })
      if (event.type === 'approval.requested')
        updateSessionSummary(event.sessionId, {
          status: 'waiting-approval',
          updatedAt,
        })
      if (event.type === 'approval.resolved')
        updateSessionSummary(event.sessionId, {
          status: 'running',
          updatedAt,
        })
      if (
        event.type === 'run.completed' ||
        event.type === 'run.cancelled' ||
        event.type === 'run.failed'
      )
        updateSessionSummary(event.sessionId, {
          status: event.type === 'run.failed' ? 'failed' : 'idle',
          updatedAt,
        })
      if (event.sessionId !== selectedSessionId.value) return
      events.value = [...events.value, event].slice(-200)
      if (event.type === 'run.started' && event.runId)
        bindPendingUserToRun(event.runId)
      applyAssistantEvent(event)
      if (
        event.runId &&
        (event.type.startsWith('skill.') ||
          event.type === 'run.completed' ||
          event.type === 'run.cancelled' ||
          event.type === 'run.failed')
      )
        void refreshRunAudit(event.sessionId)
      if (event.type === 'approval.requested') {
        const approval = ApprovalRequestSchema.safeParse(event.data)
        if (approval.success)
          approvals.value = [...approvals.value, approval.data]
      }
      if (event.type === 'approval.resolved') {
        const resolved = z
          .object({ approvalId: z.string().min(1) })
          .safeParse(event.data)
        if (resolved.success)
          approvals.value = approvals.value.filter(
            (approval) => approval.id !== resolved.data.approvalId,
          )
      }
      if (
        event.type === 'run.completed' ||
        event.type === 'run.cancelled' ||
        event.type === 'run.failed'
      ) {
        if (event.runId)
          approvals.value = approvals.value.filter(
            (approval) => approval.runId !== event.runId,
          )
        sending.value = false
        void refreshSelected(event.runId)
      }
    },
    onResync: resyncSessions,
  })

  async function resyncSessions(): Promise<void> {
    try {
      const [applicationState, page, managed] = await Promise.all([
        client.getApplicationState(),
        client.listSessions(selectedHarness.value),
        client.getManagedStatus(),
      ])
      const approvalSessions = new Set(
        applicationState.pendingApprovals
          .filter((approval) => approval.harness === selectedHarness.value)
          .map((approval) => approval.sessionId),
      )
      sessions.value = page.data.map((session) =>
        approvalSessions.has(session.id)
          ? { ...session, status: 'waiting-approval' as const }
          : session,
      )
      nextCursor.value = page.nextCursor
      skillStatuses.value = managed.skills
      mcpStatuses.value = managed.mcp
      const sessionId = selectedSessionId.value
      approvals.value = applicationState.pendingApprovals.filter(
        (approval) =>
          approval.harness === selectedHarness.value &&
          approval.sessionId === sessionId,
      )
      if (!sessionId) return
      const [session, latestRunAudit] = await Promise.all([
        client.getSession(selectedHarness.value, sessionId),
        client.getLatestRunAudit(selectedHarness.value, sessionId),
      ])
      setPersistedMessages(session.messages)
      runAudit.value = latestRunAudit
      upsertSessionSummary({
        ...session.summary,
        ...(approvals.value.length
          ? { status: 'waiting-approval' as const }
          : {}),
      })
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '无法恢复会话实时状态'
    }
  }

  async function load(signal?: AbortSignal): Promise<void> {
    retry.cancel()
    loading.value = true
    error.value = undefined
    try {
      const applicationState = await client.getApplicationState(signal)
      const restoringSelection = !selectionRestored
      if (restoringSelection && applicationState.recentHarness)
        selectedHarness.value = applicationState.recentHarness
      selectionRestored = true
      const [nextHarnesses, page, managed] = await Promise.all([
        client.listHarnesses(signal),
        client.listSessions(selectedHarness.value, signal),
        client.getManagedStatus(signal),
      ])
      harnesses.value = nextHarnesses
      const approvalSessions = new Set(
        applicationState.pendingApprovals
          .filter((approval) => approval.harness === selectedHarness.value)
          .map((approval) => approval.sessionId),
      )
      sessions.value = page.data.map((session) =>
        approvalSessions.has(session.id)
          ? { ...session, status: 'waiting-approval' as const }
          : session,
      )
      nextCursor.value = page.nextCursor
      skillStatuses.value = managed.skills
      mcpStatuses.value = managed.mcp
      const restoredSessionId =
        restoringSelection &&
        applicationState.recentSession?.harness === selectedHarness.value
          ? applicationState.recentSession.sessionId
          : undefined
      const initialSessionId =
        selectedSessionId.value ?? restoredSessionId ?? page.data[0]?.id
      if (initialSessionId && initialSessionId !== selectedSessionId.value)
        await selectSession(initialSessionId)
      approvals.value = applicationState.pendingApprovals.filter(
        (approval) =>
          approval.harness === selectedHarness.value &&
          approval.sessionId === selectedSessionId.value,
      )
      stream.connect()
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
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    const cursor = nextCursor.value
    if (!cursor || loading.value || loadingMore.value) return
    loadingMore.value = true
    error.value = undefined
    try {
      const page = await client.listSessions(
        selectedHarness.value,
        undefined,
        cursor,
      )
      const merged = new Map(
        sessions.value.map((session) => [session.id, session]),
      )
      for (const session of page.data) merged.set(session.id, session)
      sessions.value = [...merged.values()]
      nextCursor.value = page.nextCursor
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loadingMore.value = false
    }
  }

  async function selectSession(sessionId: string): Promise<void> {
    selectedSessionId.value = sessionId
    persistedMessages.value = []
    pendingMessages.value = []
    events.value = []
    approvals.value = []
    runAudit.value = undefined
    error.value = undefined
    try {
      await client.resumeSession(selectedHarness.value, sessionId)
      const [session, applicationState, latestRunAudit, profile] = await Promise.all([
        client.getSession(selectedHarness.value, sessionId),
        client.getApplicationState(),
        client.getLatestRunAudit(selectedHarness.value, sessionId),
        client
          .getSessionProfile(selectedHarness.value, sessionId)
          .catch(() => undefined),
      ])
      selectedProfile.value = profile
      setPersistedMessages(session.messages)
      runAudit.value = latestRunAudit
      approvals.value = applicationState.pendingApprovals.filter(
        (approval) =>
          approval.harness === selectedHarness.value &&
          approval.sessionId === sessionId,
      )
      upsertSessionSummary({
        ...session.summary,
        ...(approvals.value.length
          ? { status: 'waiting-approval' as const }
          : {}),
      })
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function createSession(input: {
    title: string
    profile: SessionDeckProfile
  }): Promise<void> {
    error.value = undefined
    try {
      const created = await client.createSession(
        selectedHarness.value,
        input.profile,
        input.title,
      )
      await load()
      await selectSession(created.sessionId)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function renameSelectedSession(alias: string): Promise<void> {
    const sessionId = selectedSessionId.value
    if (!sessionId) return
    error.value = undefined
    try {
      const updated = await client.updateSessionAlias(
        selectedHarness.value,
        sessionId,
        alias,
      )
      updateSessionSummary(updated.sessionId, { title: updated.alias })
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function forkSelectedSession(): Promise<void> {
    const sessionId = selectedSessionId.value
    if (!sessionId || !selectedHarnessStatus.value?.capabilities.sessionFork)
      return
    error.value = undefined
    try {
      const forked = await client.forkSession(selectedHarness.value, sessionId)
      selectedSessionId.value = undefined
      await selectSession(forked.sessionId)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function send(themeId?: string): Promise<void> {
    const content = draft.value.trim()
    const sessionId = selectedSessionId.value
    if (!content || !sessionId || sending.value) return
    const configuredThemeId =
      selectedProfile.value?.profile.theme.mode === 'registered'
        ? selectedProfile.value.profile.theme.themeId
        : themeId
    if (!configuredThemeId) {
      error.value = '当前没有可用的已注册主题。'
      return
    }
    sending.value = true
    error.value = undefined
    draft.value = ''
    const pendingUserId = appendPendingMessage('user', content)
    try {
      const result = await client.sendSessionMessage(
        selectedHarness.value,
        sessionId,
        content,
        configuredThemeId,
        attachments.value,
      )
      const runId = result.runId
      if (runId)
        pendingMessages.value = pendingMessages.value.map((entry) =>
          entry.message.id === pendingUserId ? { ...entry, runId } : entry,
        )
      await refreshRunAudit(sessionId)
      attachments.value = []
    } catch (cause) {
      sending.value = false
      draft.value = content
      pendingMessages.value = pendingMessages.value.filter(
        (entry) => entry.message.id !== pendingUserId,
      )
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function addAttachment(file: File): Promise<void> {
    if (attaching.value || attachments.value.length >= 4) return
    attaching.value = true
    error.value = undefined
    try {
      const asset = await client.uploadImageAsset(file)
      attachments.value = [...attachments.value, asset]
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      attaching.value = false
    }
  }

  function removeAttachment(path: string): void {
    attachments.value = attachments.value.filter(
      (attachment) => attachment.path !== path,
    )
  }

  async function cancel(): Promise<void> {
    if (!selectedSessionId.value) return
    try {
      await client.cancelSession(selectedHarness.value, selectedSessionId.value)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function resolveApproval(
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    try {
      await client.resolveApproval(approvalId, decision)
      approvals.value = approvals.value.filter(
        (approval) => approval.id !== approvalId,
      )
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function refreshSelected(runId?: string): Promise<void> {
    if (!selectedSessionId.value) return
    const harness = selectedHarness.value
    const sessionId = selectedSessionId.value
    for (const delay of [0, 150, 500, 1_000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      if (
        sessionId !== selectedSessionId.value ||
        harness !== selectedHarness.value
      )
        return
      try {
        const session = await client.getSession(harness, sessionId)
        setPersistedMessages(session.messages)
        if (
          !runId ||
          !pendingMessages.value.some((entry) => entry.runId === runId)
        )
          return
      } catch {
        // Keep the projected live transcript and retry while provider history settles.
      }
    }
  }

  async function refreshRunAudit(sessionId: string): Promise<void> {
    if (sessionId !== selectedSessionId.value) return
    try {
      runAudit.value = await client.getLatestRunAudit(
        selectedHarness.value,
        sessionId,
      )
    } catch {
      // Streaming events remain visible when the audit refresh is temporarily unavailable.
    }
  }

  function disconnect(): void {
    retry.cancel()
    stream.disconnect()
  }

  async function selectHarness(harness: HarnessKind): Promise<void> {
    if (selectedHarness.value === harness) return
    selectedHarness.value = harness
    selectedSessionId.value = undefined
    sessions.value = []
    nextCursor.value = null
    persistedMessages.value = []
    pendingMessages.value = []
    events.value = []
    runAudit.value = undefined
    approvals.value = []
    await load()
  }

  return {
    harnesses,
    selectedHarness,
    sessions,
    skillStatuses,
    mcpStatuses,
    selectedSkillStatuses,
    selectedMcpStatus,
    selectedSessionId,
    selectedSession,
    selectedHarnessStatus,
    messages,
    events,
    runAudit,
    selectedProfile,
    approvals,
    draft,
    attachments,
    attaching,
    loading,
    loadingMore,
    hasMoreSessions: computed(() => nextCursor.value !== null),
    sending,
    activeRun,
    error,
    streamStatus: stream.status,
    load,
    loadMore,
    selectSession,
    createSession,
    renameSelectedSession,
    forkSelectedSession,
    send,
    addAttachment,
    removeAttachment,
    cancel,
    resolveApproval,
    disconnect,
    selectHarness,
  }
})
