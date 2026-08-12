import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

import {
  forkSession,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  query,
} from '@anthropic-ai/claude-agent-sdk'
import { AsyncEventQueue } from '@fastppt/harness-core'
import {
  ApprovalRequestSchema,
  HarnessCapabilitiesSchema,
  HarnessStatusSchema,
  SessionPageSchema,
  SessionSummarySchema,
  UnifiedAgentEventSchema,
  UnifiedMessageSchema,
  UnifiedSessionSchema,
} from '@fastppt/protocol'

import type {
  CanUseTool,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKSessionInfo,
  SDKUserMessage,
  SessionMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  ApprovalDecisionInput,
  CancelRunInput,
  CreateSessionInput,
  ForkSessionInput,
  GetSessionInput,
  HarnessAdapter,
  ListSessionsInput,
  ResumeSessionInput,
  SendMessageInput,
  SessionHandle,
  SessionReference,
  HarnessProcessLogHandler,
} from '@fastppt/harness-core'
import type {
  ApprovalRequest,
  HarnessCapabilities,
  HarnessStatus,
  SessionPage,
  SessionSummary,
  UnifiedAgentEvent,
  UnifiedMessage,
  UnifiedSession,
} from '@fastppt/protocol'

export const CLAUDE_AGENT_SDK_VERSION = '0.3.220'
export const CLAUDE_CODE_BUNDLED_VERSION = '2.1.220'
export const CLAUDE_VERIFIED_VERSION_RANGE = '>=2.1.215 <2.2.0'

interface ClaudeSdk {
  listSessions: typeof listSessions
  getSessionInfo: typeof getSessionInfo
  getSessionMessages: typeof getSessionMessages
  forkSession: typeof forkSession
  query: typeof query
}

interface ActiveRun {
  runId: string
  sessionId: string
  sequence: number
  queue: AsyncEventQueue<UnifiedAgentEvent>
  input: SendMessageInput
  abortController: AbortController
  query?: Query
  cancelRequested: boolean
}

interface PendingSession {
  cwd: string
  title?: string
  createdAt: number
}

interface PendingApproval {
  run: ActiveRun
  resolve: (result: PermissionResult) => void
  toolUseId: string
  input: Record<string, unknown>
  suggestions: Parameters<CanUseTool>[2]['suggestions']
}

export interface ClaudeAdapterOptions {
  sdk?: ClaudeSdk
  sdkVersion?: string
  claudeCodeVersion?: string
  onLog?: HarnessProcessLogHandler
  environment?: NodeJS.ProcessEnv
}

export class ClaudeAdapterError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ClaudeAdapterError'
  }
}

const defaultSdk: ClaudeSdk = {
  listSessions,
  getSessionInfo,
  getSessionMessages,
  forkSession,
  query,
}

function minimalEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const exactKeys = new Set([
    'HOME',
    'LANG',
    'LC_ALL',
    'NODE_OPTIONS',
    'PATH',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TMPDIR',
  ])
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) =>
        value !== undefined &&
        (exactKeys.has(key) ||
          key.startsWith('ANTHROPIC_') ||
          key.startsWith('CLAUDE_CODE_')),
    ),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function iso(milliseconds: number | undefined): string {
  return new Date(milliseconds ?? Date.now()).toISOString()
}

function summary(info: SDKSessionInfo): SessionSummary {
  return SessionSummarySchema.parse({
    id: info.sessionId,
    harness: 'claude',
    title: info.customTitle ?? info.summary ?? null,
    preview: info.firstPrompt ?? info.summary ?? '',
    cwd: info.cwd ?? '',
    createdAt: iso(info.createdAt ?? info.lastModified),
    updatedAt: iso(info.lastModified),
    status: 'idle',
  })
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) => {
      if (!isRecord(part)) return []
      if (typeof part.text === 'string') return [part.text]
      if (typeof part.content === 'string') return [part.content]
      return []
    })
    .join('\n')
}

function historicalMessage(
  message: SessionMessage,
): UnifiedMessage | undefined {
  const payload = isRecord(message.message) ? message.message : {}
  const blocks = payload.content
  if (
    message.type === 'user' &&
    (message.parent_tool_use_id !== null ||
      (Array.isArray(blocks) &&
        blocks.some(
          (block) => isRecord(block) && block.type === 'tool_result',
        )))
  )
    return undefined
  const content = contentText(payload.content ?? message.message)
  if (!content.trim()) return undefined
  return UnifiedMessageSchema.parse({
    id: message.uuid,
    role: message.type,
    content,
    providerPayload: message,
  })
}

function toolKind(name: string): 'command' | 'file-change' {
  return ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)
    ? 'file-change'
    : 'command'
}

function commandFromInput(input: Record<string, unknown>): string | null {
  for (const key of ['command', 'cmd', 'description']) {
    if (typeof input[key] === 'string') return input[key]
  }
  return null
}

function affectedFilesFromInput(input: Record<string, unknown>): string[] {
  const paths = new Set<string>()
  for (const key of ['file_path', 'path', 'notebook_path']) {
    if (typeof input[key] === 'string' && input[key]) paths.add(input[key])
  }
  if (Array.isArray(input.edits))
    for (const edit of input.edits) {
      if (!isRecord(edit)) continue
      for (const key of ['file_path', 'path']) {
        if (typeof edit[key] === 'string' && edit[key]) paths.add(edit[key])
      }
    }
  return [...paths]
}

async function* multimodalPrompt(
  text: string,
  attachments: SendMessageInput['attachments'],
): AsyncIterable<SDKUserMessage> {
  const mediaTypes = {
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  } as const
  const images = await Promise.all(
    attachments.map(async (attachment) => {
      const mediaType =
        mediaTypes[
          extname(attachment.path).toLowerCase() as keyof typeof mediaTypes
        ]
      if (!mediaType)
        throw new ClaudeAdapterError(
          'Unsupported image attachment type',
          'INVALID_ATTACHMENT',
        )
      return {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: mediaType,
          data: (await readFile(attachment.path)).toString('base64'),
        },
      }
    }),
  )
  yield {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text }, ...images],
    },
    parent_tool_use_id: null,
  }
}

function compatibleVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  return match?.[1] === '2' && match[2] === '1' && Number(match[3]) >= 215
}

export class ClaudeAdapter implements HarnessAdapter {
  readonly kind = 'claude' as const
  readonly #sdk: ClaudeSdk
  readonly #sdkVersion: string
  readonly #claudeCodeVersion: string
  readonly #onLog: HarnessProcessLogHandler | undefined
  readonly #environment: NodeJS.ProcessEnv
  readonly #pendingSessions = new Map<string, PendingSession>()
  readonly #activeRuns = new Map<string, ActiveRun>()
  readonly #approvals = new Map<string, PendingApproval>()

  constructor(options: ClaudeAdapterOptions = {}) {
    this.#sdk = options.sdk ?? defaultSdk
    this.#sdkVersion = options.sdkVersion ?? CLAUDE_AGENT_SDK_VERSION
    this.#claudeCodeVersion =
      options.claudeCodeVersion ?? CLAUDE_CODE_BUNDLED_VERSION
    this.#onLog = options.onLog
    this.#environment = options.environment ?? process.env
  }

  async getCapabilities(): Promise<HarnessCapabilities> {
    return (await this.getStatus()).capabilities
  }

  getStatus(): Promise<HarnessStatus> {
    const compatible =
      this.#sdkVersion === CLAUDE_AGENT_SDK_VERSION &&
      compatibleVersion(this.#claudeCodeVersion)
    return Promise.resolve(
      HarnessStatusSchema.parse({
        kind: 'claude',
        status: compatible ? 'available' : 'degraded',
        version: `agent-sdk ${this.#sdkVersion} / Claude Code ${this.#claudeCodeVersion}`,
        verifiedVersionRange: `${CLAUDE_AGENT_SDK_VERSION}; Claude Code ${CLAUDE_VERIFIED_VERSION_RANGE}`,
        compatible,
        capabilities: HarnessCapabilitiesSchema.parse({
          sessionHistory: true,
          sessionFork: true,
          approvals: true,
          commandExecution: true,
          fileEdits: true,
          mcp: true,
          skillDiscovery: compatible,
          perRunSkillInvocation: compatible,
          skillInvocationObservation: false,
          imageInput: false,
          structuredEvents: true,
        }),
        ...(compatible
          ? {}
          : {
              message: `Unverified Claude Agent SDK or Claude Code version: ${this.#sdkVersion} / ${this.#claudeCodeVersion}`,
            }),
      }),
    )
  }

  async listSessions(input: ListSessionsInput): Promise<SessionPage> {
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new ClaudeAdapterError(
        'Invalid Claude session cursor',
        'INVALID_CURSOR',
      )
    const limit = input.limit ?? 50
    const reserved = [...this.#pendingSessions]
      .filter(([, pending]) => pending.cwd === input.cwd)
      .map(([sessionId, pending]) =>
        SessionSummarySchema.parse({
          id: sessionId,
          harness: 'claude',
          title: pending.title ?? null,
          preview: '',
          cwd: pending.cwd,
          createdAt: iso(pending.createdAt),
          updatedAt: iso(pending.createdAt),
          status: 'idle',
        }),
      )
    const reservedPage = reserved.slice(offset, offset + limit)
    const sdkOffset = Math.max(0, offset - reserved.length)
    const sdkLimit = limit - reservedPage.length
    const sessions = await this.#sdk.listSessions({
      dir: input.cwd,
      limit: sdkLimit + 1,
      offset: sdkOffset,
      includeWorktrees: false,
    })
    const data = [...reservedPage, ...sessions.map(summary)].slice(0, limit)
    return SessionPageSchema.parse({
      data,
      nextCursor:
        offset + data.length < reserved.length + sdkOffset + sessions.length
          ? String(offset + limit)
          : null,
    })
  }

  async getSession(input: GetSessionInput): Promise<UnifiedSession> {
    const info = await this.#sdk.getSessionInfo(input.sessionId)
    const pending = this.#pendingSessions.get(input.sessionId)
    if (!info && pending)
      return UnifiedSessionSchema.parse({
        summary: {
          id: input.sessionId,
          harness: 'claude',
          title: pending.title ?? null,
          preview: '',
          cwd: pending.cwd,
          createdAt: iso(pending.createdAt),
          updatedAt: iso(pending.createdAt),
          status: 'idle',
        },
        messages: [],
      })
    if (!info)
      throw new ClaudeAdapterError(
        'Claude session not found',
        'SESSION_NOT_FOUND',
        {
          sessionId: input.sessionId,
        },
      )
    const messages = await this.#sdk.getSessionMessages(input.sessionId, {
      ...(info.cwd ? { dir: info.cwd } : {}),
      includeSystemMessages: true,
    })
    return UnifiedSessionSchema.parse({
      summary: summary(info),
      messages: messages.flatMap((message) => {
        const unified = historicalMessage(message)
        return unified ? [unified] : []
      }),
    })
  }

  createSession(input: CreateSessionInput): Promise<SessionReference> {
    const sessionId = randomUUID()
    this.#pendingSessions.set(sessionId, {
      cwd: input.cwd,
      createdAt: Date.now(),
      ...(input.title ? { title: input.title } : {}),
    })
    return Promise.resolve({ harness: 'claude', sessionId })
  }

  async resumeSession(input: ResumeSessionInput): Promise<SessionHandle> {
    const info = await this.#sdk.getSessionInfo(input.sessionId, {
      dir: input.cwd,
    })
    if (!info && !this.#pendingSessions.has(input.sessionId))
      throw new ClaudeAdapterError(
        'Claude session not found',
        'SESSION_NOT_FOUND',
        {
          sessionId: input.sessionId,
        },
      )
    return { harness: 'claude', sessionId: input.sessionId, cwd: input.cwd }
  }

  async forkSession(input: ForkSessionInput): Promise<SessionReference> {
    const result = await this.#sdk.forkSession(input.sessionId, {
      dir: input.cwd,
    })
    return { harness: 'claude', sessionId: result.sessionId }
  }

  sendMessage(input: SendMessageInput): AsyncIterable<UnifiedAgentEvent> {
    if (this.#activeRuns.has(input.sessionId))
      throw new ClaudeAdapterError(
        'A Claude turn is already active for this session',
        'RUN_ALREADY_ACTIVE',
      )
    const run: ActiveRun = {
      runId: randomUUID(),
      sessionId: input.sessionId,
      sequence: 0,
      queue: new AsyncEventQueue<UnifiedAgentEvent>(),
      input,
      abortController: new AbortController(),
      cancelRequested: false,
    }
    this.#activeRuns.set(input.sessionId, run)
    run.queue.push(this.#event(run, 'run.started', { cwd: input.cwd }))
    void this.#runQuery(run)
    return run.queue
  }

  async cancelRun(input: CancelRunInput): Promise<void> {
    const run = this.#activeRuns.get(input.sessionId)
    if (!run)
      throw new ClaudeAdapterError(
        'No active Claude turn to cancel',
        'RUN_NOT_ACTIVE',
      )
    run.cancelRequested = true
    run.abortController.abort()
    if (run.query) await run.query.interrupt()
  }

  approveRequest(input: ApprovalDecisionInput): Promise<void> {
    const pending = this.#approvals.get(input.approvalId)
    if (!pending)
      throw new ClaudeAdapterError(
        'Unknown or resolved Claude approval',
        'APPROVAL_NOT_FOUND',
        { approvalId: input.approvalId },
      )
    const approved = input.decision !== 'reject'
    pending.resolve(
      approved
        ? {
            behavior: 'allow',
            updatedInput: pending.input,
            toolUseID: pending.toolUseId,
            ...(input.decision === 'approve-for-session' && pending.suggestions
              ? { updatedPermissions: pending.suggestions }
              : {}),
          }
        : {
            behavior: 'deny',
            message: 'The user rejected this operation in FastPPT.',
            toolUseID: pending.toolUseId,
          },
    )
    this.#approvals.delete(input.approvalId)
    pending.run.queue.push(
      this.#event(pending.run, 'approval.resolved', {
        approvalId: input.approvalId,
        decision: input.decision,
      }),
    )
    return Promise.resolve()
  }

  dispose(): Promise<void> {
    for (const run of this.#activeRuns.values()) {
      run.abortController.abort()
      run.query?.close()
      run.queue.close()
    }
    for (const pending of this.#approvals.values())
      pending.resolve({
        behavior: 'deny',
        message: 'FastPPT closed while approval was pending.',
        toolUseID: pending.toolUseId,
      })
    this.#activeRuns.clear()
    this.#approvals.clear()
    return Promise.resolve()
  }

  async #runQuery(run: ActiveRun): Promise<void> {
    const pending = this.#pendingSessions.get(run.sessionId)
    const markers = (run.input.skills ?? [])
      .map((skill) => `/${skill.name}`)
      .join('\n')
    const prompt = markers
      ? `${markers}\n\n${run.input.content}`
      : run.input.content
    const options: Options = {
      cwd: run.input.cwd,
      abortController: run.abortController,
      canUseTool: this.#permissionHandler(run),
      includePartialMessages: true,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      persistSession: true,
      settingSources: ['user', 'project'],
      sessionId: run.sessionId,
      ...(pending?.title ? { title: pending.title } : {}),
      ...(pending ? {} : { resume: run.sessionId }),
      ...(run.input.skills?.length
        ? { skills: run.input.skills.map((skill) => skill.name) }
        : {}),
      env: {
        ...minimalEnvironment(this.#environment),
        CLAUDE_AGENT_SDK_CLIENT_APP: 'fastppt/0.1.0',
      },
      stderr: (data) => {
        for (const line of data.split(/\r?\n/)) {
          const output = line.trim()
          if (!output) continue
          this.#onLog?.({
            harness: 'claude',
            stream: 'stderr',
            output,
            sessionId: run.sessionId,
            runId: run.runId,
          })
        }
      },
    }
    try {
      const activeQuery = this.#sdk.query({
        prompt:
          run.input.attachments.length > 0
            ? multimodalPrompt(prompt, run.input.attachments)
            : prompt,
        options,
      })
      run.query = activeQuery
      if (run.input.skills?.length) {
        const skills = run.input.skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          path: skill.path,
          version: skill.version,
        }))
        run.queue.push(
          this.#event(run, 'skill.discovery.confirmed', {
            skills,
            mechanism: 'claude-agent-sdk:project-settings+skills-allowlist',
          }),
        )
        run.queue.push(
          this.#event(run, 'skill.invocation.requested', {
            skills,
            mechanism: 'claude-agent-sdk:/skill-name',
          }),
        )
        run.queue.push(
          this.#event(run, 'skill.invocation.unknown', {
            skills,
            mechanism: 'claude-agent-sdk:/skill-name',
            evidence: null,
            message:
              'The verified SDK version does not expose stable Skill execution evidence.',
          }),
        )
      }
      if (run.cancelRequested) await activeQuery.interrupt()
      for await (const message of activeQuery) this.#handleMessage(run, message)
      if (this.#activeRuns.has(run.sessionId)) {
        run.queue.push(
          this.#event(
            run,
            run.cancelRequested ? 'run.cancelled' : 'run.completed',
            {},
          ),
        )
      }
    } catch (cause) {
      if (run.input.skills?.length)
        run.queue.push(
          this.#event(run, 'skill.invocation.failed', {
            skills: run.input.skills,
            mechanism: 'claude-agent-sdk:/skill-name',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
        )
      run.queue.push(
        this.#event(run, run.cancelRequested ? 'run.cancelled' : 'run.failed', {
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      )
    } finally {
      this.#pendingSessions.delete(run.sessionId)
      this.#finishRun(run)
    }
  }

  #permissionHandler(run: ActiveRun): CanUseTool {
    return (toolName, input, options) =>
      new Promise<PermissionResult>((resolve) => {
        if (options.signal.aborted) {
          resolve({
            behavior: 'deny',
            message: 'The operation was cancelled.',
            toolUseID: options.toolUseID,
          })
          return
        }
        const approvalId = randomUUID()
        const kind = toolKind(toolName)
        const approval: ApprovalRequest = ApprovalRequestSchema.parse({
          id: approvalId,
          harness: 'claude',
          sessionId: run.sessionId,
          runId: run.runId,
          kind,
          title:
            options.title ??
            options.displayName ??
            (kind === 'command' ? 'Command approval' : 'File change approval'),
          reason: options.description ?? options.decisionReason ?? null,
          command: commandFromInput(input),
          cwd: run.input.cwd,
          affectedFiles: affectedFilesFromInput(input),
          providerPayload: { toolName, input, options },
        })
        this.#approvals.set(approvalId, {
          run,
          resolve,
          toolUseId: options.toolUseID,
          input,
          suggestions: options.suggestions,
        })
        options.signal.addEventListener(
          'abort',
          () => {
            if (!this.#approvals.delete(approvalId)) return
            resolve({
              behavior: 'deny',
              message: 'The operation was cancelled.',
              toolUseID: options.toolUseID,
            })
          },
          { once: true },
        )
        run.queue.push(
          this.#event(
            run,
            'approval.requested',
            approval,
            approval.providerPayload,
          ),
        )
      })
  }

  #handleMessage(run: ActiveRun, message: SDKMessage): void {
    if (message.type === 'stream_event') {
      const event = message.event as unknown
      if (isRecord(event) && event.type === 'content_block_delta') {
        const delta = isRecord(event.delta) ? event.delta : {}
        if (delta.type === 'text_delta' && typeof delta.text === 'string')
          run.queue.push(
            this.#event(run, 'assistant.delta', { delta: delta.text }, message),
          )
        if (
          (delta.type === 'thinking_delta' ||
            delta.type === 'signature_delta') &&
          typeof (delta.thinking ?? delta.signature) === 'string'
        )
          run.queue.push(
            this.#event(
              run,
              'reasoning.delta',
              { delta: delta.thinking ?? delta.signature },
              message,
            ),
          )
      }
      return
    }
    if (message.type === 'assistant') {
      const blocks = message.message.content as unknown
      const text = contentText(blocks)
      if (text)
        run.queue.push(
          this.#event(run, 'assistant.message', { content: text }, message),
        )
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (!isRecord(block) || block.type !== 'tool_use') continue
          const name = typeof block.name === 'string' ? block.name : ''
          const eventType =
            name === 'Bash'
              ? 'command.started'
              : toolKind(name) === 'file-change'
                ? 'file.change.proposed'
                : 'tool.started'
          run.queue.push(this.#event(run, eventType, block, message))
        }
      }
      return
    }
    if (message.type === 'tool_progress') {
      run.queue.push(
        this.#event(
          run,
          message.tool_name === 'Bash' ? 'command.output' : 'tool.updated',
          message,
          message,
        ),
      )
      return
    }
    if (message.type === 'user') {
      const blocks = message.message.content as unknown
      if (!Array.isArray(blocks)) return
      for (const block of blocks) {
        if (!isRecord(block) || block.type !== 'tool_result') continue
        run.queue.push(this.#event(run, 'tool.completed', block, message))
      }
      return
    }
    if (message.type === 'system' && message.subtype === 'permission_denied') {
      run.queue.push(this.#event(run, 'tool.completed', message, message))
      return
    }
    if (message.type === 'result') {
      run.queue.push(
        this.#event(
          run,
          message.subtype === 'success' ? 'run.completed' : 'run.failed',
          message,
          message,
        ),
      )
      this.#finishRun(run)
    }
  }

  #event(
    run: ActiveRun,
    type: UnifiedAgentEvent['type'],
    data: unknown,
    providerPayload?: unknown,
  ): UnifiedAgentEvent {
    run.sequence += 1
    return UnifiedAgentEventSchema.parse({
      eventId: randomUUID(),
      sequence: run.sequence,
      harness: 'claude',
      sessionId: run.sessionId,
      runId: run.runId,
      ...(run.input.themeId ? { themeId: run.input.themeId } : {}),
      ...(run.input.themeSkillId
        ? { themeSkillId: run.input.themeSkillId }
        : {}),
      ...(run.input.themeSkillVersion
        ? { themeSkillVersion: run.input.themeSkillVersion }
        : {}),
      timestamp: new Date().toISOString(),
      type,
      data,
      ...(providerPayload === undefined ? {} : { providerPayload }),
    })
  }

  #finishRun(run: ActiveRun): void {
    if (this.#activeRuns.get(run.sessionId) !== run) return
    this.#activeRuns.delete(run.sessionId)
    for (const [approvalId, pending] of this.#approvals) {
      if (pending.run !== run) continue
      this.#approvals.delete(approvalId)
      pending.resolve({
        behavior: 'deny',
        message: 'The Claude turn ended before approval was resolved.',
        toolUseID: pending.toolUseId,
      })
    }
    run.queue.close()
  }
}
