import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

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
import { z } from 'zod'

import { JsonlRpcClient, RpcError } from './jsonl-rpc.js'

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
  SkillInvocationInput,
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
import type {
  JsonlRpcClientOptions,
  RpcCommand,
  RpcMessage,
} from './jsonl-rpc.js'

const execFileAsync = promisify(execFile)

export const CODEX_VERIFIED_VERSION_RANGE = '>=0.144.0 <0.147.0'

const ThreadSchema = z
  .object({
    id: z.string(),
    preview: z.string().default(''),
    cwd: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    status: z
      .object({ type: z.string() })
      .passthrough()
      .default({ type: 'notLoaded' }),
    name: z.string().nullable().default(null),
    turns: z.array(z.unknown()).default([]),
  })
  .passthrough()

const ThreadResponseSchema = z.object({ thread: ThreadSchema })
const ThreadListResponseSchema = z.object({
  data: z.array(ThreadSchema),
  nextCursor: z.string().nullable(),
})
const TurnResponseSchema = z.object({
  turn: z
    .object({
      id: z.string(),
      status: z.string(),
    })
    .passthrough(),
})

interface ActiveRun {
  runId: string
  sessionId: string
  turnId?: string
  sequence: number
  queue: AsyncEventQueue<UnifiedAgentEvent>
  input: SendMessageInput
  cancelRequested: boolean
}

interface PendingApproval {
  rpcId: string | number
  kind: 'command' | 'file-change'
  run: ActiveRun
}

export interface CodexAdapterOptions {
  codexCommand?: string
  commandFactory?: () => RpcCommand
  versionProvider?: () => Promise<string>
  requestTimeoutMs?: number
  stopTimeoutMs?: number
  onLog?: HarnessProcessLogHandler
  imageSkillPath?: string | false
}

const IMAGE_SKILL_NAME = 'imagegen'

function defaultImageSkillPath(
  environment: NodeJS.ProcessEnv,
): string | undefined {
  const codexHome = environment.CODEX_HOME
    ? resolve(environment.CODEX_HOME)
    : environment.HOME
      ? join(resolve(environment.HOME), '.codex')
      : undefined
  return codexHome
    ? join(codexHome, 'skills', '.system', IMAGE_SKILL_NAME)
    : undefined
}

function minimalEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keys = [
    'CODEX_HOME',
    'HOME',
    'LANG',
    'LC_ALL',
    'NODE_OPTIONS',
    'PATH',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TMPDIR',
  ]
  return Object.fromEntries(
    keys.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]]],
    ),
  )
}

function versionIsCompatible(version: string): boolean {
  const match = /(?:codex-cli\s+)?(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (match?.[1] !== '0') return false
  const minor = Number(match[2])
  return minor >= 144 && minor < 147
}

function timestamp(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

function threadStatus(status: { type: string }): SessionSummary['status'] {
  if (status.type === 'active') return 'running'
  if (status.type === 'systemError') return 'failed'
  return 'idle'
}

function mapThread(thread: z.infer<typeof ThreadSchema>): SessionSummary {
  return SessionSummarySchema.parse({
    id: thread.id,
    harness: 'codex',
    title: thread.name,
    preview: thread.preview,
    cwd: thread.cwd,
    createdAt: timestamp(thread.createdAt),
    updatedAt: timestamp(thread.updatedAt),
    status: threadStatus(thread.status),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function affectedFilesFromParams(params: Record<string, unknown>): string[] {
  const values = [params.filePath, params.path, params.changes]
  const paths = new Set<string>()
  for (const value of values) {
    if (typeof value === 'string' && value) paths.add(value)
    if (Array.isArray(value))
      for (const item of value) {
        if (typeof item === 'string' && item) paths.add(item)
        else if (isRecord(item)) {
          const path = item.path ?? item.filePath
          if (typeof path === 'string' && path) paths.add(path)
        }
      }
  }
  return [...paths]
}

function itemMessages(turns: readonly unknown[]): UnifiedMessage[] {
  const messages: UnifiedMessage[] = []
  for (const turn of turns) {
    if (!isRecord(turn) || !Array.isArray(turn.items)) continue
    for (const item of turn.items) {
      if (!isRecord(item) || typeof item.id !== 'string') continue
      if (item.type === 'userMessage' && Array.isArray(item.content)) {
        const content = item.content
          .flatMap((part) =>
            isRecord(part) && typeof part.text === 'string' ? [part.text] : [],
          )
          .join('\n')
        messages.push(
          UnifiedMessageSchema.parse({
            id: item.id,
            role: 'user',
            content,
            providerPayload: item,
          }),
        )
      } else if (
        item.type === 'agentMessage' &&
        typeof item.text === 'string'
      ) {
        messages.push(
          UnifiedMessageSchema.parse({
            id: item.id,
            role: 'assistant',
            content: item.text,
            providerPayload: item,
          }),
        )
      } else if (
        item.type === 'commandExecution' &&
        typeof item.command === 'string'
      ) {
        messages.push(
          UnifiedMessageSchema.parse({
            id: item.id,
            role: 'tool',
            content: item.command,
            providerPayload: item,
          }),
        )
      }
    }
  }
  return messages
}

function messageThreadId(message: RpcMessage): string | undefined {
  return isRecord(message.params) && typeof message.params.threadId === 'string'
    ? message.params.threadId
    : undefined
}

function itemFromMessage(
  message: RpcMessage,
): Record<string, unknown> | undefined {
  return isRecord(message.params) && isRecord(message.params.item)
    ? message.params.item
    : undefined
}

export class CodexAdapter implements HarnessAdapter {
  readonly kind = 'codex' as const
  readonly #options: CodexAdapterOptions
  readonly #rpc: JsonlRpcClient
  readonly #activeRuns = new Map<string, ActiveRun>()
  readonly #approvals = new Map<string, PendingApproval>()
  readonly #imageSkillPath: string | undefined
  #initialized = false
  #connecting: Promise<void> | undefined

  constructor(options: CodexAdapterOptions = {}) {
    this.#options = options
    this.#imageSkillPath =
      options.imageSkillPath === false
        ? undefined
        : (options.imageSkillPath ?? defaultImageSkillPath(process.env))
    const codexCommand = options.codexCommand ?? 'codex'
    const rpcOptions: JsonlRpcClientOptions = {
      commandFactory:
        options.commandFactory ??
        (() => ({
          command: codexCommand,
          args: ['app-server', '--stdio', '--enable', 'image_generation'],
          cwd: process.cwd(),
          env: minimalEnvironment(process.env),
        })),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.stopTimeoutMs === undefined
        ? {}
        : { stopTimeoutMs: options.stopTimeoutMs }),
      ...(options.onLog
        ? {
            onStderrLine: (output: string) =>
              options.onLog?.({ harness: 'codex', stream: 'stderr', output }),
          }
        : {}),
    }
    this.#rpc = new JsonlRpcClient(rpcOptions)
    this.#rpc.onMessage((message) => this.#handleMessage(message))
    this.#rpc.onExit((error) => this.#handleDisconnect(error))
    this.#rpc.onProtocolError((error) => this.#handleProtocolError(error))
  }

  async getCapabilities(): Promise<HarnessCapabilities> {
    const status = await this.getStatus()
    return status.capabilities
  }

  async getStatus(): Promise<HarnessStatus> {
    const capabilities = HarnessCapabilitiesSchema.parse({
      sessionHistory: true,
      sessionFork: true,
      approvals: true,
      commandExecution: true,
      fileEdits: true,
      mcp: true,
      skillDiscovery: true,
      perRunSkillInvocation: true,
      skillInvocationObservation: false,
      imageInput: true,
      structuredEvents: true,
    })
    try {
      const version = await this.#readVersion()
      const compatible = versionIsCompatible(version)
      return HarnessStatusSchema.parse({
        kind: 'codex',
        status: compatible ? 'available' : 'degraded',
        version,
        verifiedVersionRange: CODEX_VERIFIED_VERSION_RANGE,
        compatible,
        capabilities: compatible
          ? capabilities
          : { ...capabilities, perRunSkillInvocation: false },
        ...(compatible
          ? {}
          : { message: `Unverified Codex version: ${version}` }),
      })
    } catch (cause) {
      return HarnessStatusSchema.parse({
        kind: 'codex',
        status: 'unavailable',
        compatible: false,
        verifiedVersionRange: CODEX_VERIFIED_VERSION_RANGE,
        capabilities: {
          ...capabilities,
          skillDiscovery: false,
          perRunSkillInvocation: false,
        },
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  async listSessions(input: ListSessionsInput): Promise<SessionPage> {
    await this.#connect()
    const response = ThreadListResponseSchema.parse(
      await this.#rpc.request('thread/list', {
        cwd: input.cwd,
        limit: input.limit ?? 50,
        ...(input.cursor ? { cursor: input.cursor } : {}),
        sortKey: 'updated_at',
        sortDirection: 'desc',
      }),
    )
    return SessionPageSchema.parse({
      data: response.data.map(mapThread),
      nextCursor: response.nextCursor,
    })
  }

  async getSession(input: GetSessionInput): Promise<UnifiedSession> {
    await this.#connect()
    const response = ThreadResponseSchema.parse(
      await this.#rpc.request('thread/read', {
        threadId: input.sessionId,
        includeTurns: true,
      }),
    )
    return UnifiedSessionSchema.parse({
      summary: mapThread(response.thread),
      messages: itemMessages(response.thread.turns),
    })
  }

  async createSession(input: CreateSessionInput): Promise<SessionReference> {
    await this.#connect()
    const response = ThreadResponseSchema.parse(
      await this.#rpc.request('thread/start', {
        cwd: input.cwd,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        serviceName: 'fastppt',
      }),
    )
    if (input.title)
      await this.#rpc.request('thread/name/set', {
        threadId: response.thread.id,
        name: input.title,
      })
    return { harness: 'codex', sessionId: response.thread.id }
  }

  async resumeSession(input: ResumeSessionInput): Promise<SessionHandle> {
    await this.#connect()
    const response = ThreadResponseSchema.parse(
      await this.#rpc.request('thread/resume', {
        threadId: input.sessionId,
        cwd: input.cwd,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      }),
    )
    return {
      harness: 'codex',
      sessionId: response.thread.id,
      cwd: input.cwd,
    }
  }

  async forkSession(input: ForkSessionInput): Promise<SessionReference> {
    await this.#connect()
    const response = ThreadResponseSchema.parse(
      await this.#rpc.request('thread/fork', {
        threadId: input.sessionId,
        cwd: input.cwd,
      }),
    )
    return { harness: 'codex', sessionId: response.thread.id }
  }

  sendMessage(input: SendMessageInput): AsyncIterable<UnifiedAgentEvent> {
    if (this.#activeRuns.has(input.sessionId))
      throw new RpcError(
        'A Codex turn is already active for this session',
        'RUN_ALREADY_ACTIVE',
        { sessionId: input.sessionId },
      )
    const run: ActiveRun = {
      runId: randomUUID(),
      sessionId: input.sessionId,
      sequence: 0,
      queue: new AsyncEventQueue<UnifiedAgentEvent>(),
      input,
      cancelRequested: false,
    }
    this.#activeRuns.set(input.sessionId, run)
    run.queue.push(this.#event(run, 'run.started', { cwd: input.cwd }))
    void this.#startTurn(run)
    return run.queue
  }

  async cancelRun(input: CancelRunInput): Promise<void> {
    const run = this.#activeRuns.get(input.sessionId)
    if (!run)
      throw new RpcError('No active Codex turn to cancel', 'RUN_NOT_ACTIVE')
    if (!run.turnId) {
      run.cancelRequested = true
      return
    }
    await this.#rpc.request('turn/interrupt', {
      threadId: input.sessionId,
      turnId: run.turnId,
    })
  }

  approveRequest(input: ApprovalDecisionInput): Promise<void> {
    const pending = this.#approvals.get(input.approvalId)
    if (!pending)
      throw new RpcError('Unknown or resolved approval', 'APPROVAL_NOT_FOUND', {
        approvalId: input.approvalId,
      })
    const decision =
      input.decision === 'approve'
        ? 'accept'
        : input.decision === 'approve-for-session'
          ? 'acceptForSession'
          : 'decline'
    this.#rpc.respond(pending.rpcId, { decision })
    this.#approvals.delete(input.approvalId)
    pending.run.queue.push(
      this.#event(pending.run, 'approval.resolved', {
        approvalId: input.approvalId,
        decision: input.decision,
      }),
    )
    return Promise.resolve()
  }

  async dispose(): Promise<void> {
    await this.#rpc.stop()
    for (const run of this.#activeRuns.values()) run.queue.close()
    this.#activeRuns.clear()
    this.#approvals.clear()
    this.#initialized = false
  }

  async #readVersion(): Promise<string> {
    if (this.#options.versionProvider)
      return await this.#options.versionProvider()
    const result = await execFileAsync(this.#options.codexCommand ?? 'codex', [
      '--version',
    ])
    return result.stdout.trim()
  }

  async #connect(): Promise<void> {
    if (this.#initialized && this.#rpc.running) return
    if (this.#connecting) return await this.#connecting
    this.#connecting = (async () => {
      const status = await this.getStatus()
      if (!status.compatible)
        throw new RpcError(
          status.message ?? 'Codex app-server version is unavailable',
          'UNSUPPORTED_VERSION',
        )
      this.#rpc.start()
      await this.#rpc.request('initialize', {
        clientInfo: {
          name: 'fastppt',
          title: 'FastPPT',
          version: '0.1.0',
        },
      })
      this.#rpc.notify('initialized', {})
      this.#initialized = true
    })()
    try {
      await this.#connecting
    } finally {
      this.#connecting = undefined
    }
  }

  async #startTurn(run: ActiveRun): Promise<void> {
    try {
      await this.#connect()
      await this.#rpc.request('thread/resume', {
        threadId: run.sessionId,
        cwd: run.input.cwd,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      })
      const imageSkill = await this.#imageSkill()
      const effectiveSkills = [
        ...(run.input.skills ?? []),
        ...(imageSkill &&
        !(run.input.skills ?? []).some(
          (skill) => skill.name === IMAGE_SKILL_NAME,
        )
          ? [imageSkill]
          : []),
      ]
      const markers = effectiveSkills.map((skill) => `$${skill.name}`).join(' ')
      const text = markers
        ? `${markers} ${run.input.content}`
        : run.input.content
      if (effectiveSkills.length)
        run.queue.push(
          this.#event(run, 'skill.discovery.confirmed', {
            skills: effectiveSkills,
            mechanism: 'codex-app-server:typed-skill-input',
          }),
        )
      if (effectiveSkills.length)
        run.queue.push(
          this.#event(run, 'skill.invocation.requested', {
            skills: effectiveSkills,
            mechanism: 'codex-app-server:typed-skill-input+$skill-name',
          }),
        )
      const response = TurnResponseSchema.parse(
        await this.#rpc.request('turn/start', {
          threadId: run.sessionId,
          cwd: run.input.cwd,
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'dangerFullAccess' },
          input: [
            { type: 'text', text, text_elements: [] },
            ...run.input.attachments.map((attachment) => ({
              type: 'localImage' as const,
              path: attachment.path,
            })),
            ...effectiveSkills.map((skill) => ({
              type: 'skill' as const,
              name: skill.name,
              path: skill.path,
            })),
          ],
        }),
      )
      run.turnId = response.turn.id
      if (effectiveSkills.length)
        run.queue.push(
          this.#event(run, 'skill.invocation.unknown', {
            skills: effectiveSkills,
            mechanism: 'codex-app-server:typed-skill-input+$skill-name',
            evidence: null,
            message:
              'The verified app-server version does not expose stable Skill execution evidence.',
          }),
        )
      if (run.cancelRequested)
        await this.#rpc.request('turn/interrupt', {
          threadId: run.sessionId,
          turnId: run.turnId,
        })
    } catch (cause) {
      if (run.input.skills?.length)
        run.queue.push(
          this.#event(run, 'skill.invocation.failed', {
            skills: run.input.skills,
            mechanism: 'codex-app-server:typed-skill-input+$skill-name',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
        )
      run.queue.push(
        this.#event(run, 'run.failed', {
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      run.queue.close()
      this.#activeRuns.delete(run.sessionId)
    }
  }

  async #imageSkill(): Promise<SkillInvocationInput | undefined> {
    if (!this.#imageSkillPath) return undefined
    if (this.#options.imageSkillPath === undefined) {
      try {
        await access(join(this.#imageSkillPath, 'SKILL.md'))
      } catch {
        return undefined
      }
    }
    return {
      id: IMAGE_SKILL_NAME,
      name: IMAGE_SKILL_NAME,
      path: this.#imageSkillPath,
      version: 'system',
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
      harness: 'codex',
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

  #handleMessage(message: RpcMessage): void {
    if (message.id !== undefined && message.method) {
      this.#handleServerRequest(message)
      return
    }
    if (!message.method) return
    const sessionId = messageThreadId(message)
    const run = sessionId ? this.#activeRuns.get(sessionId) : undefined
    if (!run) return
    const item = itemFromMessage(message)
    const providerPayload = message
    switch (message.method) {
      case 'turn/started': {
        if (isRecord(message.params) && isRecord(message.params.turn)) {
          const turnId = message.params.turn.id
          if (typeof turnId === 'string') run.turnId = turnId
        }
        break
      }
      case 'item/agentMessage/delta':
        run.queue.push(
          this.#event(
            run,
            'assistant.delta',
            {
              delta:
                isRecord(message.params) &&
                typeof message.params.delta === 'string'
                  ? message.params.delta
                  : '',
            },
            providerPayload,
          ),
        )
        break
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        run.queue.push(
          this.#event(
            run,
            'reasoning.delta',
            {
              delta:
                isRecord(message.params) &&
                typeof message.params.delta === 'string'
                  ? message.params.delta
                  : '',
            },
            providerPayload,
          ),
        )
        break
      case 'item/commandExecution/outputDelta':
        run.queue.push(
          this.#event(
            run,
            'command.output',
            {
              delta:
                isRecord(message.params) &&
                typeof message.params.delta === 'string'
                  ? message.params.delta
                  : '',
            },
            providerPayload,
          ),
        )
        break
      case 'item/started':
        this.#emitItem(run, item, true, providerPayload)
        break
      case 'item/completed':
        this.#emitItem(run, item, false, providerPayload)
        break
      case 'error':
        run.queue.push(
          this.#event(run, 'run.failed', message.params ?? {}, providerPayload),
        )
        break
      case 'turn/completed': {
        const turn =
          isRecord(message.params) && isRecord(message.params.turn)
            ? message.params.turn
            : undefined
        const status = turn?.status
        run.queue.push(
          this.#event(
            run,
            status === 'interrupted'
              ? 'run.cancelled'
              : status === 'failed'
                ? 'run.failed'
                : 'run.completed',
            turn ?? {},
            providerPayload,
          ),
        )
        run.queue.close()
        this.#activeRuns.delete(run.sessionId)
        break
      }
    }
  }

  #emitItem(
    run: ActiveRun,
    item: Record<string, unknown> | undefined,
    started: boolean,
    providerPayload: unknown,
  ): void {
    if (!item || typeof item.type !== 'string') return
    const type = item.type
    const eventType: UnifiedAgentEvent['type'] | undefined =
      type === 'commandExecution'
        ? started
          ? 'command.started'
          : 'command.completed'
        : type === 'fileChange'
          ? started
            ? 'file.change.proposed'
            : 'file.changed'
          : type === 'agentMessage' && !started
            ? 'assistant.message'
            : [
                  'mcpToolCall',
                  'dynamicToolCall',
                  'collabAgentToolCall',
                ].includes(type)
              ? started
                ? 'tool.started'
                : 'tool.completed'
              : undefined
    if (eventType)
      run.queue.push(this.#event(run, eventType, item, providerPayload))
  }

  #handleServerRequest(message: RpcMessage): void {
    if (message.id === undefined || !message.method) return
    const sessionId = messageThreadId(message)
    const run = sessionId ? this.#activeRuns.get(sessionId) : undefined
    const kind =
      message.method === 'item/commandExecution/requestApproval'
        ? 'command'
        : message.method === 'item/fileChange/requestApproval'
          ? 'file-change'
          : undefined
    if (!run || !kind) {
      this.#rpc.respondError(
        message.id,
        -32601,
        'FastPPT does not handle this request',
      )
      return
    }
    const params = isRecord(message.params) ? message.params : {}
    const approvalId = randomUUID()
    const approval: ApprovalRequest = ApprovalRequestSchema.parse({
      id: approvalId,
      harness: 'codex',
      sessionId: run.sessionId,
      runId: run.runId,
      kind,
      title: kind === 'command' ? 'Command approval' : 'File change approval',
      reason: typeof params.reason === 'string' ? params.reason : null,
      command: typeof params.command === 'string' ? params.command : null,
      cwd: typeof params.cwd === 'string' ? params.cwd : null,
      affectedFiles: affectedFilesFromParams(params),
      providerPayload: message,
    })
    this.#approvals.set(approvalId, { rpcId: message.id, kind, run })
    run.queue.push(this.#event(run, 'approval.requested', approval, message))
  }

  #handleDisconnect(error: RpcError): void {
    this.#initialized = false
    for (const run of this.#activeRuns.values()) {
      run.queue.push(
        this.#event(
          run,
          'harness.disconnected',
          { message: error.message, stderr: this.#rpc.stderr },
          error.details,
        ),
      )
      run.queue.close()
    }
    this.#activeRuns.clear()
    this.#approvals.clear()
  }

  #handleProtocolError(error: RpcError): void {
    for (const run of this.#activeRuns.values())
      run.queue.push(
        this.#event(run, 'run.failed', {
          message: error.message,
          code: error.code,
        }),
      )
  }
}
