import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, watch, type FSWatcher } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { createDatabase } from '@fastppt/database'
import { listCollections, searchIcons } from '@fastppt/icons'
import { resolveFastPptMcpCliEntry } from '@fastppt/fastppt-mcp'
import { runThemeExtraction } from '@fastppt/fastppt-mcp'
import { ManagedSkillInstaller, McpConfigManager } from '@fastppt/fastppt-skill'
import { ClaudeAdapter, ClaudeAdapterError } from '@fastppt/harness-claude'
import { CodexAdapter, RpcError } from '@fastppt/harness-codex'
import {
  createLoggerOptions,
  formatAccessLine,
  isPrettyLoggingEnabled,
  redactSensitiveText,
} from '@fastppt/logger'
import { SlidevFormatError, formatSlidevMarkdown } from '@fastppt/markdown'
import {
  FileContentSchema,
  MarkdownFormatResultSchema,
  FileNodeSchema,
  HealthResponseSchema,
  SlidevProcessStateSchema,
  IconCollectionSummarySchema,
  IconSearchResponseSchema,
  ThemeSummarySchema,
  ThemeSkillDocumentSchema,
  ThemeSkillStatusSchema,
  WriteFileRequestSchema,
  UploadWorkspaceImageSchema,
  WorkspaceImageAssetSchema,
  WorkspaceInfoSchema,
  DeckSummarySchema,
  ApprovalDecisionRequestSchema,
  ApprovalRequestSchema,
  ApplicationStateSchema,
  CreateExportRequestSchema, ReviewExportRequestSchema,
  ImportPptxThemeRequestSchema,
  ImportPptxThemeResultSchema,
  ImportPptxThemeStatusSchema,
  CreateSessionRequestSchema,
  SessionDeckProfileSchema,
  SessionProfileRecordSchema,
  HarnessKindSchema,
  HarnessStatusSchema,
  SendMessageRequestSchema,
  SessionPageSchema,
  UnifiedAgentEventSchema,
  UnifiedSessionSchema,
  UpdateSessionAliasRequestSchema,
  ExportJobSchema,
  BrowserInspectionJobSchema,
  BrowserQualityResultSchema,
  DeckQualityReportSchema,
  SlidewaveSnapshotSchema,
  type ApiErrorBody,
  type WorkspaceInfo,
  type SessionDeckProfile,
} from '@fastppt/protocol'
import { cleanupStaleSlidevCaches, SlidevHost } from '@fastppt/slidev-host'
import { classifySlidevLogLine } from './slidev-logs.js'
import { ensureWorkspaceGitignore } from './workspace-gitignore.js'
import {
  loadThemeRegistry,
  ThemeRegistryError,
  type ThemeRegistry,
} from '@fastppt/theme-registry'
import {
  resolveExistingPath,
  WorkspaceError,
  WorkspaceService,
  WorkspaceWatcher,
} from '@fastppt/workspace'
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify'
import httpProxy from 'http-proxy'
import WebSocket from 'ws'
import { z } from 'zod'

import { EventHub } from './event-hub.js'
import { BrowserInspectionManager } from './browser-delegation.js'
import { AsyncReadWriteLock } from './async-rw-lock.js'
import {
  cleanupAbandonedExportArtifacts,
  ExportJobManager,
} from './export-jobs.js'
import { HarnessRunLimiter, HarnessRunLimitError } from './run-limiter.js'
import { createStateCleanup } from './state-cleanup.js'

import type { GatewayConfig } from '@fastppt/config'
import type { HarnessAdapter } from '@fastppt/harness-core'
import type {
  DeckSummary,
  FileNode,
  ThemeSummary,
  UnifiedAgentEvent,
} from '@fastppt/protocol'
import type { ComponentHealthSchema } from '@fastppt/protocol'
import type { EditablePptxExporter } from './export-jobs.js'

export type { EditablePptxExporter, ExportDeckInput } from './export-jobs.js'

export interface GatewayOptions {
  harnesses?: Partial<Record<'claude' | 'codex', HarnessAdapter>>
  exporter?: EditablePptxExporter
  slidevHost?: SlidevHost
  watchThemes?: boolean
  commonSkillRoot?: string
  mcpServerEntry?: string
  mcpRuntimeArgs?: readonly string[]
  slidevRunnerPath?: string
}

type ComponentHealth = z.infer<typeof ComponentHealthSchema>

function profileDigest(profile: SessionDeckProfile): string {
  return createHash('sha256')
    .update(JSON.stringify(profile))
    .digest('base64url')
}

function sessionBrief(profile: SessionDeckProfile): string {
  return [
    '<fastppt-session-brief>',
    `conversation_mode: ${profile.conversationMode}`,
    `target: ${profile.target ? JSON.stringify(profile.target) : 'none'}`,
    `artifact_route: ${profile.artifactRoute}`,
    `audience: ${profile.audience}`,
    `communication_intent: ${profile.communicationIntent}`,
    `narrative_mode: ${profile.narrativeMode}`,
    `language: ${profile.language}`,
    `duration_minutes: ${profile.durationMinutes ?? 'unspecified'}`,
    `theme: ${
      profile.theme.mode === 'registered'
        ? profile.theme.themeId
        : 'preserve-source'
    }`,
    `preservation: ${JSON.stringify(profile.preservation)}`,
    `review_policy: ${profile.reviewPolicy}`,
    'Treat this brief as confirmed session configuration. Do not ask the user to repeat it unless the current request conflicts with it.',
    '</fastppt-session-brief>',
  ].join('\n')
}

const ADAPTER_NOT_FOUND_CODES = new Set([
  'APPROVAL_NOT_FOUND',
  'EXPORT_NOT_FOUND',
  'INSPECTION_NOT_FOUND',
  'RUN_NOT_ACTIVE',
  'RUN_NOT_FOUND',
  'SESSION_NOT_FOUND',
])

const ADAPTER_CONFLICT_CODES = new Set([
  'EXPORT_NOT_READY',
  'INSPECTION_NOT_READY',
  'RUN_ALREADY_ACTIVE',
])

const ADAPTER_UNAVAILABLE_CODES = new Set([
  'PROCESS_EXITED',
  'PROCESS_NOT_RUNNING',
  'PROCESS_STOPPED',
  'STDIN_CLOSED',
  'UNSUPPORTED_VERSION',
])

const ADAPTER_BAD_GATEWAY_CODES = new Set([
  'INVALID_JSON',
  'INVALID_MESSAGE',
  'PROTOCOL_ERROR',
  'RUN_START_FAILED',
])

const PUBLIC_BAD_GATEWAY_CODES = new Set([
  'SLIDEV_START_FAILED',
  'SLIDEV_BUILD_FAILED',
])

const PROXIED_SLIDEV_PATH = /^\/api\/v1\/preview\/p\d+(?:\/|\?|$)/

function adapterErrorStatus(code: string): number {
  if (PUBLIC_BAD_GATEWAY_CODES.has(code)) return 502
  if (ADAPTER_NOT_FOUND_CODES.has(code)) return 404
  if (ADAPTER_CONFLICT_CODES.has(code)) return 409
  if (code === 'REQUEST_TIMEOUT') return 504
  if (ADAPTER_UNAVAILABLE_CODES.has(code)) return 503
  if (ADAPTER_BAD_GATEWAY_CODES.has(code)) return 502
  return 400
}

function publicThemeError(error: ThemeRegistryError): {
  code: string
  statusCode: number
  retryable: boolean
  details: unknown
} {
  if (error.code === 'THEME_NOT_FOUND') {
    return {
      code: error.code,
      statusCode: 404,
      retryable: false,
      details: error.details,
    }
  }
  const code =
    error.code === 'PACKAGE_MISMATCH'
      ? 'THEME_SKILL_VERSION_MISMATCH'
      : 'THEME_SKILL_MAPPING_INVALID'
  return {
    code,
    statusCode: 503,
    retryable: false,
    details: { internalCode: error.code, cause: error.details },
  }
}

function requireSlidevReady(
  state: z.infer<typeof SlidevProcessStateSchema>,
  operation: 'preview' | 'export' | 'inspection',
): z.infer<typeof SlidevProcessStateSchema> {
  if (state.status === 'ready' && state.previewUrl) return state
  const code =
    state.lastError?.code === 'SLIDEV_EXITED'
      ? 'SLIDEV_BUILD_FAILED'
      : 'SLIDEV_START_FAILED'
  throw new RpcError(
    state.lastError?.message ?? `Slidev failed to start for ${operation}.`,
    code,
    {
      deckId: state.deckId,
      operation,
      internalCode: state.lastError?.code ?? 'SLIDEV_NOT_READY',
    },
  )
}

function adapterErrorRetryable(statusCode: number): boolean {
  return statusCode >= 500
}

function publicAdapterStatus(publicCode: string, internalCode: string): number {
  if (publicCode === 'THEME_SKILL_NOT_FOUND') return 404
  if (
    publicCode === 'THEME_SKILL_VERSION_MISMATCH' ||
    publicCode === 'THEME_SKILL_INSTALL_CONFLICT'
  )
    return 409
  return adapterErrorStatus(internalCode)
}

function publicAdapterError(
  code: string,
  details: unknown,
): { code: string; statusCode: number; retryable: boolean; details: unknown } {
  let publicCode = code
  if (code === 'RUN_ALREADY_ACTIVE') publicCode = 'SESSION_BUSY'
  else if (ADAPTER_UNAVAILABLE_CODES.has(code))
    publicCode = 'HARNESS_UNAVAILABLE'
  else if (ADAPTER_BAD_GATEWAY_CODES.has(code))
    publicCode =
      code === 'RUN_START_FAILED'
        ? 'THEME_SKILL_INVOCATION_FAILED'
        : 'HARNESS_PROTOCOL_ERROR'
  else if (code === 'SKILL_INSTALL_UNAVAILABLE') {
    const states = z
      .object({
        base: z.object({ state: z.string() }).optional(),
        theme: z.object({ state: z.string() }).optional(),
      })
      .safeParse(details)
    const values = states.success
      ? [states.data.base?.state, states.data.theme?.state]
      : []
    publicCode = values.includes('conflict')
      ? 'THEME_SKILL_INSTALL_CONFLICT'
      : values.includes('update-available')
        ? 'THEME_SKILL_VERSION_MISMATCH'
        : 'THEME_SKILL_NOT_FOUND'
  }
  const statusCode = publicAdapterStatus(publicCode, code)
  return {
    code: publicCode,
    statusCode,
    retryable: adapterErrorRetryable(statusCode),
    details:
      publicCode === code
        ? details
        : { internalCode: code, ...(details ? { cause: details } : {}) },
  }
}

function sanitizePublicDiagnostics(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (depth >= 8) return '[TRUNCATED]'
  if (Array.isArray(value))
    return value.map((entry) => sanitizePublicDiagnostics(entry, depth + 1))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizePublicDiagnostics(entry, depth + 1),
      ]),
    )
  return value
}

function parseStoredJson(value: string | undefined): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

async function checkComponent(
  probe: () => Promise<ComponentHealth>,
): Promise<ComponentHealth> {
  try {
    return await probe()
  } catch (cause) {
    return {
      status: 'unavailable',
      message: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

function collectMarkdownPaths(nodes: readonly FileNode[]): string[] {
  return nodes.flatMap((node) =>
    node.type === 'directory'
      ? collectMarkdownPaths(node.children ?? [])
      : node.path.endsWith('.md')
        ? [node.path]
        : [],
  )
}

function readThemeId(markdown: string): string | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1]
  return /^theme:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(frontmatter ?? '')?.[1]
}

function isSlidevDeck(entryFile: string, markdown: string): boolean {
  return (
    basename(entryFile).toLowerCase() === 'slides.md' || !!readThemeId(markdown)
  )
}

function deckSlug(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 80) || 'presentation'
  )
}

function themeSummary(registry: ThemeRegistry, themeId: string): ThemeSummary {
  const theme = registry.resolve(themeId).manifest
  return ThemeSummarySchema.parse({
    themeId: theme.id,
    packageName: theme.packageName,
    displayName: theme.displayName,
    version: theme.version,
    description: theme.description,
    repositoryUrl: theme.repositoryUrl,
    skillId: theme.skill.id,
    skillVersion: theme.skill.version,
    layouts: theme.layouts,
    defaultAspectRatio: theme.defaultAspectRatio,
    supportedFeatures: theme.supportedFeatures,
    registryVersion: registry.version,
    available: true,
  })
}

function themeIdMentionedInPrompt(
  registry: ThemeRegistry,
  content: string,
  fallback: string,
): string {
  const normalized = content.toLowerCase()
  for (const theme of registry.themes) {
    const id = theme.manifest.id.toLowerCase()
    const shortId = id.replace(/^slidev-theme-/, '')
    if (normalized.includes(id) || normalized.includes(shortId)) return id
  }
  return fallback
}

function isClientHttpError(
  error: unknown,
): error is Error & { statusCode: number } {
  return (
    error instanceof Error &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  )
}

export function resolveSlidevWebSocketProtocol(
  protocol: string,
): 'vite-hmr' | 'vite-ping' | undefined {
  return protocol === 'vite-hmr' || protocol === 'vite-ping'
    ? protocol
    : undefined
}

export async function createGateway(
  config: GatewayConfig,
  options: GatewayOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: createLoggerOptions(),
    bodyLimit: 512 * 1024 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
  })
  // Replace Fastify's "incoming request" + "request completed" pair with one
  // compact access-log line per request, e.g.
  //   GET /api/v1/workspace/files 200 12.5ms
  app.addHook('onResponse', (request, reply, done) => {
    if (reply.statusCode < 400 && PROXIED_SLIDEV_PATH.test(request.url)) {
      done()
      return
    }
    const durationMs = reply.elapsedTime ?? 0
    const fields = {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      durationMs,
      remoteAddress: request.ip,
    }
    const message = isPrettyLoggingEnabled()
      ? formatAccessLine({
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          durationMs,
        })
      : `${request.method} ${request.url} ${reply.statusCode} ${durationMs.toFixed(1)}ms`
    if (reply.statusCode >= 500) request.log.warn(fields, message)
    else request.log.info(fields, message)
    done()
  })
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } })
  await ensureWorkspaceGitignore(config.workspaceRoot)
  const database = createDatabase(
    join(config.workspaceRoot, '.fastppt', 'state', 'fastppt.sqlite'),
  )
  const expiredApprovals = database.expirePendingApprovals('gateway-restarted')
  if (expiredApprovals > 0)
    app.log.info(
      { expiredApprovals },
      'Expired approvals from the previous Gateway process',
    )
  const workspaceId = createHash('sha256')
    .update(config.workspaceRoot)
    .digest('hex')
    .slice(0, 20)
  const workspaceFiles = await WorkspaceService.create(config.workspaceRoot)
  const runLimiter = new HarnessRunLimiter(config.maxConcurrentRunsPerHarness)
  const workspaceWatcher = new WorkspaceWatcher(workspaceFiles, {
    onError: (error) =>
      app.log.error({ err: error }, 'Workspace watcher failed'),
  })
  await workspaceWatcher.ready()
  const stateCleanup = createStateCleanup({
    workspaceRoot: config.workspaceRoot,
    intervalMs: config.cleanupIntervalMs ?? 3_600_000,
    maxAgeMs: config.cleanupMaxAgeMs ?? 7 * 24 * 3_600_000,
    onError: (error) => app.log.warn({ error }, 'FastPPT state cleanup failed'),
  })
  await stateCleanup.sweep()
  await cleanupStaleSlidevCaches()
  stateCleanup.start()
  const eventHub = new EventHub()
  const publishAgentEvent = (event: UnifiedAgentEvent): void => {
    eventHub.publish('sessions', event.type, event)
    if (event.runId) eventHub.publish(`run:${event.runId}`, event.type, event)
  }
  const runtimeDirectory = join(config.workspaceRoot, '.fastppt', 'runtime')
  const runtimeFile = join(runtimeDirectory, 'gateway.json')
  const runtimeNonce = randomUUID()
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 })
  await chmod(runtimeDirectory, 0o700)
  const runtimeTemporary = `${runtimeFile}.${runtimeNonce}.tmp`
  await writeFile(
    runtimeTemporary,
    `${JSON.stringify({
      version: 1,
      nonce: runtimeNonce,
      url: `http://${config.host}:${config.port}`,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      delegationTimeoutMs: config.exportTimeoutMs,
    })}\n`,
    { mode: 0o600 },
  )
  await rename(runtimeTemporary, runtimeFile)
  const onHarnessLog = (log: {
    harness: 'claude' | 'codex'
    stream: 'stderr'
    output: string
    sessionId?: string
    runId?: string
  }): void => {
    app.log.info(
      { workspaceId, ...log, output: redactSensitiveText(log.output) },
      'Harness process output',
    )
  }
  const harnesses: Record<'claude' | 'codex', HarnessAdapter> = {
    claude:
      options.harnesses?.claude ?? new ClaudeAdapter({ onLog: onHarnessLog }),
    codex:
      options.harnesses?.codex ?? new CodexAdapter({ onLog: onHarnessLog }),
  }
  const approvalHarnesses = new Map<string, HarnessAdapter>()
  const approvalRuns = new Map<string, string>()
  const clearRunApprovals = (runId: string, decision: string): void => {
    for (const [approvalId, approvalRunId] of approvalRuns) {
      if (approvalRunId !== runId) continue
      approvalRuns.delete(approvalId)
      approvalHarnesses.delete(approvalId)
      database.resolveApproval(approvalId, decision)
    }
  }
  let themeRegistry = await loadThemeRegistry(config.themesRoot)
  const repositoryRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../..',
  )
  const commonSkillRoot =
    options.commonSkillRoot ?? join(repositoryRoot, 'packages', 'fastppt-skill')
  const createSkillInstaller = (registry: ThemeRegistry) =>
    new ManagedSkillInstaller({
      workspaceRoot: config.workspaceRoot,
      commonSkillRoot,
      registry,
      enabled: true,
    })
  let skillInstaller = createSkillInstaller(themeRegistry)
  let skillReport = await skillInstaller.reconcile({ cleanStale: true })
  database.recordManagedInstallations(skillReport.statuses)
  const themeStateLock = new AsyncReadWriteLock()
  app.log.info(
    // {
    //   registryVersion: themeRegistry.version,
    //   skills: skillReport.statuses,
    //   cleanedStaleDirectories: skillReport.cleanedStaleDirectories,
    //   staleManagedDirectories: skillReport.staleManagedDirectories,
    // },
    'FastPPT managed Skill plan reconciled',
  )
  let registryReloadTail: Promise<void> = Promise.resolve()
  const reloadThemeRegistry = async (): Promise<{
    changed: boolean
    previousVersion: string
    registryVersion: string
  }> => {
    const operation = registryReloadTail.then(async () => {
      const releaseThemeState = await themeStateLock.acquireWrite()
      try {
        const previousVersion = themeRegistry.version
        const candidate = await loadThemeRegistry(config.themesRoot)
        if (candidate.version === previousVersion)
          return {
            changed: false,
            previousVersion,
            registryVersion: previousVersion,
          }
        const candidateInstaller = createSkillInstaller(candidate)
        const candidateReport = await candidateInstaller.reconcile({
          cleanStale: true,
        })
        themeRegistry = candidate
        skillInstaller = candidateInstaller
        skillReport = candidateReport
        database.recordManagedInstallations(candidateReport.statuses)
        app.log.info(
          {
            previousVersion,
            registryVersion: candidate.version,
            skills: candidateReport.statuses,
            cleanedStaleDirectories: candidateReport.cleanedStaleDirectories,
            staleManagedDirectories: candidateReport.staleManagedDirectories,
          },
          'Theme registry atomically reloaded',
        )
        eventHub.publish('workspace', 'themes.reloaded', {
          previousVersion,
          registryVersion: candidate.version,
        })
        return {
          changed: true,
          previousVersion,
          registryVersion: candidate.version,
        }
      } finally {
        releaseThemeState()
      }
    })
    registryReloadTail = operation.then(
      () => undefined,
      () => undefined,
    )
    return await operation
  }
  let themeWatcher: FSWatcher | undefined
  let themeReloadTimer: NodeJS.Timeout | undefined
  if (options.watchThemes ?? process.env.NODE_ENV !== 'production') {
    themeWatcher = watch(config.themesRoot, { recursive: true }, () => {
      if (themeReloadTimer) clearTimeout(themeReloadTimer)
      themeReloadTimer = setTimeout(() => {
        void reloadThemeRegistry().catch((cause: unknown) => {
          app.log.error(
            { err: cause, registryVersion: themeRegistry.version },
            'Theme registry reload rejected; retaining the previous version',
          )
        })
      }, 150)
    })
  }
  const mcpConfigManager = new McpConfigManager({
    workspaceRoot: config.workspaceRoot,
    themesRoot: config.themesRoot,
    commonSkillRoot,
    serverEntry: options.mcpServerEntry ?? resolveFastPptMcpCliEntry(),
    runtimeArgs: options.mcpRuntimeArgs ?? process.execArgv,
  })
  const mcpStatuses = await mcpConfigManager.reconcile()
  app.log.info(
    { workspaceId, installations: mcpStatuses },
    'FastPPT MCP configuration reconciled',
  )
  const slidevHost =
    options.slidevHost ??
    new SlidevHost({
      ...(options.slidevRunnerPath
        ? { runnerPath: options.slidevRunnerPath }
        : {}),
      onState(state) {
        eventHub.publish('preview', 'preview.state', state)
        eventHub.publish(`deck:${state.deckId}`, 'preview.state', state)
        app.log.info(
          {
            workspaceId,
            deckId: state.deckId,
            status: state.status,
            ...(state.pid ? { pid: state.pid } : {}),
            ...(state.port ? { port: state.port } : {}),
            ...(state.lastError ? { error: state.lastError } : {}),
          },
          'Slidev process state changed',
        )
      },
      onLog(entry) {
        const message = redactSensitiveText(entry.message)
        if (!message.trim()) return
        const fields = {
          workspaceId,
          deckId: entry.deckId,
          stream: entry.stream,
        }
        switch (classifySlidevLogLine(entry.stream, message)) {
          case 'error':
            app.log.error(fields, message)
            break
          case 'warn':
            app.log.warn(fields, message)
            break
          default:
            app.log.debug(fields, message)
        }
      },
    })
  const exportRoot = join(config.workspaceRoot, '.fastppt', 'exports')
  await cleanupAbandonedExportArtifacts(exportRoot)
  const recoveredExports = database.recoverInterruptedExports()
  if (recoveredExports.length)
    app.log.warn(
      { exports: recoveredExports.map((job) => job.id) },
      'Recovered interrupted export jobs as failed',
    )
  const exportManager = new ExportJobManager({
    outputRoot: exportRoot,
    ...(options.exporter ? { exporter: options.exporter } : {}),
    captureTimeoutMs: config.exportTimeoutMs,
    onUpdate(job) {
      database.recordExportJob(job, join(exportRoot, job.id, job.outputName))
      eventHub.publish(`export:${job.id}`, 'export.updated', job)
      eventHub.publish(`deck:${job.deckId}`, 'export.updated', job)
      if (job.status === 'queued' && job.phase === 'awaiting-browser-capture')
        eventHub.publish('browser-delegation', 'export.capture.requested', job)
      app.log.info(
        {
          exportId: job.id,
          deckId: job.deckId,
          status: job.status,
          phase: job.phase,
          progress: job.progress,
          ...(job.error ? { error: job.error } : {}),
        },
        'Editable PPTX export updated',
      )
    },
  })
  const inspectionManager = new BrowserInspectionManager({
    timeoutMs: config.exportTimeoutMs,
    onUpdate(job) {
      eventHub.publish(
        `browser-inspection:${job.id}`,
        'inspection.updated',
        job,
      )
      if (job.status === 'queued')
        eventHub.publish(
          'browser-delegation',
          'inspection.capture.requested',
          job,
        )
    },
  })
  const startedAt = new Date().toISOString()
  const workspace: WorkspaceInfo = WorkspaceInfoSchema.parse({
    id: workspaceId,
    name: config.workspaceName,
    root: config.workspaceRoot,
    readOnly: false,
    startedAt,
  })
  database.recordWorkspace(workspace)

  const previewProxy = httpProxy.createProxyServer({ ws: true })

  const proxySlidevResponse = async (
    port: number,
    upstreamPath: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const active = slidevHost
      .listStates()
      .some(
        (state) =>
          state.port === port &&
          ['starting', 'ready', 'restarting'].includes(state.status),
      )
    if (!active)
      throw new RpcError(
        'Slidev preview is not active.',
        'SLIDEV_NOT_RUNNING',
        { port },
      )
    request.raw.url = upstreamPath
    const bufferedBody =
      request.body === undefined
        ? undefined
        : Buffer.from(
            typeof request.body === 'string'
              ? request.body
              : JSON.stringify(request.body),
          )
    if (bufferedBody)
      request.raw.headers['content-length'] = String(bufferedBody.length)
    reply.hijack()
    previewProxy.web(
      request.raw,
      reply.raw,
      {
        target: `http://127.0.0.1:${String(port)}`,
        ...(bufferedBody ? { buffer: Readable.from([bufferedBody]) } : {}),
      },
      (cause) => {
        request.log.error({ err: cause, port }, 'Slidev preview proxy failed')
        if (!reply.raw.headersSent) reply.raw.writeHead(502)
        reply.raw.end()
      },
    )
    return reply
  }
  const proxySlidevPreview = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const { portSegment } = z
      .object({ portSegment: z.string().regex(/^p?\d+$/) })
      .parse(request.params)
    if (!portSegment.startsWith('p')) {
      const incomingUrl = new URL(request.raw.url ?? '/', 'http://gateway')
      const pathname = incomingUrl.pathname.replace(
        `/api/v1/preview/${portSegment}`,
        `/api/v1/preview/p${portSegment}`,
      )
      return reply.redirect(`${pathname}${incomingUrl.search}`, 307)
    }
    const port = z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .parse(portSegment.slice(1))
    const incomingUrl = new URL(request.raw.url ?? '/', 'http://gateway')
    return await proxySlidevResponse(
      port,
      `${incomingUrl.pathname}${incomingUrl.search}`,
      request,
      reply,
    )
  }
  const proxySlidevWebSocket = (
    socket: WebSocket,
    request: FastifyRequest,
  ): void => {
    const { portSegment } = z
      .object({ portSegment: z.string().regex(/^p\d+$/) })
      .parse(request.params)
    const port = Number(portSegment.slice(1))
    const active = slidevHost
      .listStates()
      .some(
        (state) =>
          state.port === port &&
          ['starting', 'ready', 'restarting'].includes(state.status),
      )
    if (!active) {
      socket.close(1008, 'Slidev preview is not active.')
      return
    }
    const upstream = new WebSocket(
      `ws://127.0.0.1:${String(port)}${request.raw.url ?? '/'}`,
      resolveSlidevWebSocketProtocol(socket.protocol),
    )
    const pendingMessages: Array<{
      data: WebSocket.RawData
      isBinary: boolean
    }> = []
    let downstreamClosed = false
    socket.on('message', (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN)
        upstream.send(data, { binary: isBinary })
      else if (upstream.readyState === WebSocket.CONNECTING)
        pendingMessages.push({ data, isBinary })
    })
    upstream.on('open', () => {
      if (downstreamClosed) {
        upstream.close()
        return
      }
      for (const message of pendingMessages)
        upstream.send(message.data, { binary: message.isBinary })
      pendingMessages.length = 0
    })
    upstream.on('message', (data, isBinary) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(data, { binary: isBinary })
    })
    socket.on('close', (code, reason) => {
      downstreamClosed = true
      pendingMessages.length = 0
      if (upstream.readyState === WebSocket.OPEN) upstream.close(code, reason)
    })
    upstream.on('close', (code, reason) => {
      if (socket.readyState !== WebSocket.OPEN) return
      if (code === 1005 || code === 1006) socket.terminate()
      else socket.close(code, reason)
    })
    socket.on('error', () => upstream.terminate())
    upstream.on('error', (cause) => {
      if (!downstreamClosed) {
        request.log.error(
          { err: cause, port },
          'Slidev preview WebSocket failed',
        )
        if (socket.readyState === WebSocket.OPEN)
          socket.close(1011, 'Slidev preview WebSocket failed.')
      }
    })
  }
  app.get('/api/v1/preview/:portSegment', proxySlidevPreview)
  app.route({
    method: 'GET',
    url: '/api/v1/preview/:portSegment/*',
    handler: proxySlidevPreview,
    wsHandler: proxySlidevWebSocket,
  })
  const proxySlidevRootResource = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const referer = request.headers.referer
    const match = referer?.match(/\/api\/v1\/preview\/p(\d+)\//)
    const activePorts = slidevHost
      .listStates()
      .filter((state) => state.status === 'ready' && state.port)
      .map((state) => state.port as number)
    const port = match?.[1]
      ? Number(match[1])
      : activePorts.length === 1
        ? activePorts[0]
        : undefined
    if (!port) return reply.callNotFound()
    return await proxySlidevResponse(
      port,
      request.raw.url ?? '/',
      request,
      reply,
    )
  }
  app.get('/*', proxySlidevRootResource)
  app.post('/@server-reactive/*', proxySlidevRootResource)
  const listDecks = async (): Promise<DeckSummary[]> => {
    const paths = collectMarkdownPaths(await workspaceFiles.listFiles())
    const candidates = await Promise.all(
      paths.map(async (entryFile) => {
        const file = await workspaceFiles.readTextFile(entryFile)
        if (!isSlidevDeck(entryFile, file.content)) return undefined
        const themeId = readThemeId(file.content)
        return DeckSummarySchema.parse({
          id: createHash('sha256').update(entryFile).digest('hex').slice(0, 20),
          name: basename(entryFile, '.md'),
          entryFile,
          themeId,
          revision: file.revision,
          modifiedAt: file.modifiedAt,
        })
      }),
    )
    const decks = candidates.filter((deck) => deck !== undefined)
    const sorted = decks.sort((left, right) =>
      left.entryFile.localeCompare(right.entryFile),
    )
    database.recordDecks(workspace.id, sorted)
    return sorted
  }

  const resolveDeck = async (deckId: string): Promise<DeckSummary> => {
    const deck = (await listDecks()).find(
      (candidate) => candidate.id === deckId,
    )
    if (!deck)
      throw new WorkspaceError(
        'FILE_NOT_FOUND',
        `Deck not found: ${deckId}`,
        404,
      )
    return deck
  }

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (!origin || config.allowedWebOrigins.includes(origin)) return
    request.log.warn({ origin }, 'Rejected browser origin')
    const body: ApiErrorBody = {
      error: {
        code: 'INVALID_REQUEST',
        message: 'Origin is not allowed',
        retryable: false,
        requestId: request.id,
      },
    }
    return reply.code(403).send(body)
  })

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.allowedWebOrigins.includes(origin)) {
        callback(null, true)
        return
      }
      callback(null, false)
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type'],
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof WorkspaceError) {
      const body: ApiErrorBody = {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          retryable: error.code === 'FILE_REVISION_CONFLICT',
          requestId: request.id,
        },
      }
      void reply.code(error.statusCode).send(body)
      return
    }
    if (error instanceof ThemeRegistryError) {
      const normalized = publicThemeError(error)
      const body: ApiErrorBody = {
        error: {
          code: normalized.code,
          message: error.message,
          details: normalized.details,
          retryable: normalized.retryable,
          requestId: request.id,
        },
      }
      void reply.code(normalized.statusCode).send(body)
      return
    }
    if (error instanceof z.ZodError) {
      const body: ApiErrorBody = {
        error: {
          code: 'INVALID_REQUEST',
          message: 'The request is invalid.',
          details: error.issues,
          retryable: false,
          requestId: request.id,
        },
      }
      void reply.code(400).send(body)
      return
    }
    if (error instanceof SlidevFormatError) {
      const body: ApiErrorBody = {
        error: {
          code: 'INVALID_REQUEST',
          message: error.message,
          ...(error.location ? { details: error.location } : {}),
          retryable: false,
          requestId: request.id,
        },
      }
      void reply.code(400).send(body)
      return
    }
    if (error instanceof HarnessRunLimitError) {
      const body: ApiErrorBody = {
        error: {
          code: 'HARNESS_RUN_LIMIT_REACHED',
          message: error.message,
          details: { harness: error.harness, limit: error.limit },
          retryable: true,
          requestId: request.id,
        },
      }
      void reply.code(429).send(body)
      return
    }
    if (error instanceof RpcError) {
      const normalized = publicAdapterError(error.code, error.details)
      const body: ApiErrorBody = {
        error: {
          code: normalized.code,
          message: redactSensitiveText(error.message),
          details: sanitizePublicDiagnostics(normalized.details),
          retryable: normalized.retryable,
          requestId: request.id,
        },
      }
      void reply.code(normalized.statusCode).send(body)
      return
    }
    if (error instanceof ClaudeAdapterError) {
      const normalized = publicAdapterError(error.code, error.details)
      const body: ApiErrorBody = {
        error: {
          code: normalized.code,
          message: redactSensitiveText(error.message),
          details: sanitizePublicDiagnostics(normalized.details),
          retryable: normalized.retryable,
          requestId: request.id,
        },
      }
      void reply.code(normalized.statusCode).send(body)
      return
    }
    if (isClientHttpError(error)) {
      const body: ApiErrorBody = {
        error: {
          code: 'INVALID_REQUEST',
          message: error.message,
          retryable: false,
          requestId: request.id,
        },
      }
      void reply.code(error.statusCode).send(body)
      return
    }
    request.log.error({ err: error }, 'Unhandled Gateway request error')
    const body: ApiErrorBody = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred.',
        retryable: false,
        requestId: request.id,
      },
    }
    void reply.code(500).send(body)
  })

  app.get('/health', () =>
    HealthResponseSchema.parse({ status: 'ok', version: '0.1.0' }),
  )

  app.get('/ready', async () => {
    const [
      sqlite,
      workspaceStatus,
      claude,
      codex,
      slidev,
      slidewave,
      themes,
      skills,
      mcp,
    ] = await Promise.all([
      checkComponent(() =>
        Promise.resolve({
          status: database.healthcheck() ? 'ok' : 'unavailable',
        }),
      ),
      checkComponent(async () => {
        await access(config.workspaceRoot, constants.R_OK | constants.W_OK)
        const readinessProbePath = join(
          config.workspaceRoot,
          `.fastppt-readiness-${randomUUID()}`,
        )
        try {
          await writeFile(readinessProbePath, 'fastppt readiness probe\n', {
            flag: 'wx',
          })
          const content = await readFile(readinessProbePath, 'utf8')
          if (content !== 'fastppt readiness probe\n')
            throw new Error('Workspace readiness probe content mismatch.')
        } finally {
          await rm(readinessProbePath, { force: true })
        }
        return { status: 'ok' }
      }),
      checkComponent(async () => {
        const status = await harnesses.claude.getStatus()
        return {
          status:
            status.status === 'available'
              ? 'ok'
              : status.status === 'degraded'
                ? 'degraded'
                : 'unavailable',
          message: status.message ?? status.version,
        }
      }),
      checkComponent(async () => {
        const status = await harnesses.codex.getStatus()
        return {
          status:
            status.status === 'available'
              ? 'ok'
              : status.status === 'degraded'
                ? 'degraded'
                : 'unavailable',
          message: status.message ?? status.version,
        }
      }),
      checkComponent(async () => {
        const status = await slidevHost.getEnvironmentStatus()
        return {
          status: status.status === 'available' ? 'ok' : 'unavailable',
          message: status.message ?? status.version,
        }
      }),
      checkComponent(async () => {
        const status = await exportManager.getStatus()
        return {
          status: status.status === 'available' ? 'ok' : 'unavailable',
          message: status.message ?? status.version,
        }
      }),
      checkComponent(async () => {
        const current = await loadThemeRegistry(config.themesRoot)
        return {
          status: current.themes.length ? 'ok' : 'unavailable',
          message: `${current.themes.length} registered themes (${current.version})`,
        }
      }),
      checkComponent(async () => {
        const statuses = (
          await Promise.all([
            skillInstaller.inspect('claude'),
            skillInstaller.inspect('codex'),
          ])
        ).flat()
        return {
          status: statuses.every((entry) => entry.state === 'installed')
            ? 'ok'
            : 'degraded',
          message: `${statuses.filter((entry) => entry.state === 'installed').length}/${statuses.length} managed Skills installed`,
        }
      }),
      checkComponent(async () => {
        const statuses = await Promise.all([
          mcpConfigManager.inspect('claude'),
          mcpConfigManager.inspect('codex'),
        ])
        return {
          status: statuses.some((entry) => entry.state === 'conflict')
            ? 'degraded'
            : statuses.some((entry) => entry.state === 'missing')
              ? 'unavailable'
              : 'ok',
          message: statuses
            .map((entry) => `${entry.harness}:${entry.state}`)
            .join(', '),
        }
      }),
    ])
    const components: Record<string, ComponentHealth> = {
      sqlite,
      workspace: workspaceStatus,
      claude,
      codex,
      slidev,
      themes,
      skills,
      mcp,
      slidewave,
    }
    return HealthResponseSchema.parse({
      status: Object.values(components).every(
        (component) => component.status === 'ok',
      )
        ? 'ok'
        : 'degraded',
      version: '0.1.0',
      components,
    })
  })

  app.get('/api/v1/workspace', () => workspace)

  app.get('/api/v1/workspace/files', async () =>
    z.array(FileNodeSchema).parse(await workspaceFiles.listFiles()),
  )

  app.get('/api/v1/workspace/files/content', async (request) => {
    const query = z.object({ path: z.string().min(1) }).parse(request.query)
    return FileContentSchema.parse(
      await workspaceFiles.readTextFile(query.path),
    )
  })

  app.put('/api/v1/workspace/files/content', async (request) => {
    const input = WriteFileRequestSchema.parse(request.body)
    return FileContentSchema.parse(await workspaceFiles.writeTextFile(input))
  })

  app.post('/api/v1/workspace/assets/images', async (request) => {
    const input = UploadWorkspaceImageSchema.parse(request.body)
    const bytes = Buffer.from(input.base64, 'base64')
    return WorkspaceImageAssetSchema.parse(
      await workspaceFiles.writeImageAsset({
        name: input.name,
        mediaType: input.mediaType,
        bytes,
      }),
    )
  })

  app.get('/api/v1/harnesses', async () => {
    return z
      .array(HarnessStatusSchema)
      .parse(
        await Promise.all([
          harnesses.claude.getStatus(),
          harnesses.codex.getStatus(),
        ]),
      )
  })

  app.get('/api/v1/application-state', () => {
    const recentHarness = HarnessKindSchema.safeParse(
      database.getAppSetting('recentHarness'),
    )
    const recentSessionValue = database.getAppSetting('recentSession')
    const recentSession = recentSessionValue
      ? ApplicationStateSchema.shape.recentSession.safeParse(
          parseStoredJson(recentSessionValue),
        )
      : undefined
    const recentThemeValue = database.getAppSetting('recentTheme')
    const recentTheme = recentThemeValue
      ? themeRegistry.themes.some(
          (theme) => theme.manifest.id === recentThemeValue,
        )
        ? recentThemeValue
        : undefined
      : undefined
    const pendingApprovals = database
      .getPendingApprovals()
      .map((record) => ApprovalRequestSchema.safeParse(record.payload))
      .filter(
        (result) => result.success && approvalHarnesses.has(result.data.id),
      )
      .map((result) => result.data)
    return ApplicationStateSchema.parse({
      ...(recentHarness.success ? { recentHarness: recentHarness.data } : {}),
      ...(recentSession?.success ? { recentSession: recentSession.data } : {}),
      ...(recentTheme ? { recentTheme } : {}),
      pendingApprovals,
      pendingBrowserExports: exportManager.pendingBrowserCapture(),
      pendingBrowserInspections: inspectionManager.pending(),
    })
  })

  app.get('/api/v1/harnesses/:harness/status', async (request) => {
    const { harness } = z
      .object({ harness: HarnessKindSchema })
      .parse(request.params)
    return HarnessStatusSchema.parse(await harnesses[harness].getStatus())
  })

  app.get('/api/v1/sessions', async (request) => {
    const query = z
      .object({
        harness: HarnessKindSchema.default('codex'),
        cursor: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query)
    const page = await harnesses[query.harness].listSessions({
      cwd: workspace.root,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    })
    return SessionPageSchema.parse({
      ...page,
      data: page.data.map((session) => ({
        ...session,
        title:
          database.getSessionAlias(query.harness, session.id) ?? session.title,
      })),
    })
  })

  app.get('/api/v1/sessions/:harness/:sessionId', async (request) => {
    const { harness, sessionId } = z
      .object({ harness: HarnessKindSchema, sessionId: z.string().min(1) })
      .parse(request.params)
    const session = await harnesses[harness].getSession({ sessionId })
    return UnifiedSessionSchema.parse({
      ...session,
      summary: {
        ...session.summary,
        title:
          database.getSessionAlias(harness, sessionId) ?? session.summary.title,
      },
    })
  })

  app.put('/api/v1/sessions/:harness/:sessionId/alias', async (request) => {
    const { harness, sessionId } = z
      .object({ harness: HarnessKindSchema, sessionId: z.string().min(1) })
      .parse(request.params)
    const { alias } = UpdateSessionAliasRequestSchema.parse(request.body)
    await harnesses[harness].getSession({ sessionId })
    database.recordSessionAlias(harness, sessionId, alias)
    return { harness, sessionId, alias }
  })

  app.post('/api/v1/sessions', async (request) => {
    const input = CreateSessionRequestSchema.parse(request.body)
    let themeSkillId: string | null = null
    let themeSkillVersion: string | null = null
    if (input.profile.theme.mode === 'registered') {
      const theme = themeRegistry.resolve(input.profile.theme.themeId).manifest
      const status = await skillInstaller.themeStatus(
        input.harness,
        theme.id,
      )
      if (!status.available)
        throw new RpcError(
          'The selected theme and its managed Skills are not available',
          'SKILL_INSTALL_UNAVAILABLE',
          status,
        )
      themeSkillId = theme.skill.id
      themeSkillVersion = theme.skill.version
    } else if (
      !['fill-native-pptx', 'enhance-native-pptx'].includes(
        input.profile.artifactRoute,
      )
    ) {
      throw new RpcError(
        'Only native PPTX fill or enhancement sessions may preserve the source theme',
        'INVALID_REQUEST',
      )
    }
    const session = await harnesses[input.harness].createSession({
      cwd: workspace.root,
      ...(input.title ? { title: input.title } : {}),
    })
    const timestamp = new Date().toISOString()
    database.recordSessionProfile(
      SessionProfileRecordSchema.parse({
        harness: input.harness,
        sessionId: session.sessionId,
        profile: input.profile,
        profileDigest: profileDigest(input.profile),
        registryVersion: themeRegistry.version,
        themeSkillId,
        themeSkillVersion,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    )
    if (input.title)
      database.recordSessionAlias(input.harness, session.sessionId, input.title)
    database.setAppSetting('recentHarness', input.harness)
    database.setAppSetting(
      'recentSession',
      JSON.stringify({ harness: input.harness, sessionId: session.sessionId }),
    )
    return session
  })

  app.get('/api/v1/sessions/:harness/:sessionId/profile', (request) => {
    const { harness, sessionId } = z
      .object({ harness: HarnessKindSchema, sessionId: z.string().min(1) })
      .parse(request.params)
    const profile = database.getSessionProfile(harness, sessionId)
    if (!profile)
      throw new RpcError(
        'Session profile was not found',
        'SESSION_NOT_FOUND',
        { harness, sessionId },
      )
    return profile
  })

  app.put('/api/v1/sessions/:harness/:sessionId/profile', async (request) => {
    const { harness, sessionId } = z
      .object({ harness: HarnessKindSchema, sessionId: z.string().min(1) })
      .parse(request.params)
    const profile = SessionDeckProfileSchema.parse(request.body)
    await harnesses[harness].getSession({ sessionId })
    const current = database.getSessionProfile(harness, sessionId)
    let themeSkillId: string | null = null
    let themeSkillVersion: string | null = null
    if (profile.theme.mode === 'registered') {
      const theme = themeRegistry.resolve(profile.theme.themeId).manifest
      const status = await skillInstaller.themeStatus(harness, theme.id)
      if (!status.available)
        throw new RpcError(
          'The selected theme and its managed Skills are not available',
          'SKILL_INSTALL_UNAVAILABLE',
          status,
        )
      themeSkillId = theme.skill.id
      themeSkillVersion = theme.skill.version
    }
    const timestamp = new Date().toISOString()
    const record = SessionProfileRecordSchema.parse({
      harness,
      sessionId,
      profile,
      profileDigest: profileDigest(profile),
      registryVersion: themeRegistry.version,
      themeSkillId,
      themeSkillVersion,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
    database.recordSessionProfile(record)
    return record
  })

  app.post('/api/v1/sessions/:harness/:sessionId/resume', async (request) => {
    const { harness, sessionId } = z
      .object({ harness: HarnessKindSchema, sessionId: z.string().min(1) })
      .parse(request.params)
    const resumed = await harnesses[harness].resumeSession({
      sessionId,
      cwd: workspace.root,
    })
    database.setAppSetting('recentHarness', harness)
    database.setAppSetting(
      'recentSession',
      JSON.stringify({ harness, sessionId }),
    )
    return resumed
  })

  app.post('/api/v1/sessions/:harness/:sessionId/fork', async (request) => {
    const { harness, sessionId } = z
      .object({ harness: HarnessKindSchema, sessionId: z.string().min(1) })
      .parse(request.params)
    const adapter = harnesses[harness]
    if (!adapter.forkSession)
      throw new RpcError(
        `${harness} session fork is unavailable`,
        'UNSUPPORTED',
      )
    const forked = await adapter.forkSession({
      sessionId,
      cwd: workspace.root,
    })
    const sourceProfile = database.getSessionProfile(harness, sessionId)
    if (sourceProfile) {
      const timestamp = new Date().toISOString()
      database.recordSessionProfile({
        ...sourceProfile,
        sessionId: forked.sessionId,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
    database.setAppSetting('recentHarness', harness)
    database.setAppSetting(
      'recentSession',
      JSON.stringify({ harness, sessionId: forked.sessionId }),
    )
    return forked
  })

  app.post('/api/v1/sessions/:harness/:sessionId/cancel', async (request) => {
    const { harness, sessionId } = z
      .object({ harness: HarnessKindSchema, sessionId: z.string().min(1) })
      .parse(request.params)
    await harnesses[harness].cancelRun({ sessionId })
    return { cancelled: true }
  })

  app.post(
    '/api/v1/sessions/:harness/:sessionId/messages',
    async (request, reply) => {
      const { harness, sessionId } = z
        .object({ harness: HarnessKindSchema, sessionId: z.string().min(1) })
        .parse(request.params)
      const input = SendMessageRequestSchema.parse(request.body)
      const sessionProfile = database.getSessionProfile(harness, sessionId)
      if (!sessionProfile && !input.themeId)
        throw new RpcError(
          'This legacy session has no FastPPT configuration. Configure it before sending a message.',
          'INVALID_REQUEST',
          { harness, sessionId },
        )
      const attachments = await Promise.all(
        input.attachments.map(async (attachment) => ({
          type: attachment.type,
          path: await workspaceFiles.resolveImageAttachment(attachment.path),
        })),
      )
      const adapter = harnesses[harness]
      const releaseRunSlot = runLimiter.acquire(harness)
      let releaseThemeState: (() => void) | undefined
      let slotOwnedByBackgroundStream = false
      try {
        releaseThemeState = await themeStateLock.acquireRead()
        const registrySnapshot = themeRegistry
        const installerSnapshot = skillInstaller
        const configuredThemeId =
          sessionProfile?.profile.theme.mode === 'registered'
            ? sessionProfile.profile.theme.themeId
            : input.themeId
        if (
          sessionProfile?.profile.theme.mode === 'registered' &&
          input.themeId &&
          input.themeId !== sessionProfile.profile.theme.themeId
        )
          throw new RpcError(
            'Message theme does not match the configured session theme',
            'THEME_SKILL_MAPPING_INVALID',
            {
              configuredThemeId: sessionProfile.profile.theme.themeId,
              requestedThemeId: input.themeId,
            },
          )
        if (!configuredThemeId)
          throw new RpcError(
            'Native source-preserving routes are not yet supported by the Slidev generation runtime',
            'UNSUPPORTED',
          )
        const requestedThemeId = themeIdMentionedInPrompt(
          registrySnapshot,
          input.content,
          configuredThemeId,
        )
        const registeredTheme = registrySnapshot.resolve(requestedThemeId)
        const capabilities = await adapter.getCapabilities()
        if (!capabilities.skillDiscovery || !capabilities.perRunSkillInvocation)
          throw new RpcError(
            `${harness} cannot form a verified per-run Skill invocation`,
            'HARNESS_SKILLS_UNSUPPORTED',
            { harness, capabilities },
          )
        const skillStatus = await installerSnapshot.themeStatus(
          harness,
          registeredTheme.manifest.id,
        )
        if (!skillStatus.available)
          throw new RpcError(
            'The required managed FastPPT Skills are not available',
            'SKILL_INSTALL_UNAVAILABLE',
            skillStatus,
          )
        const pageEditSkill =
          sessionProfile?.profile.conversationMode === 'edit-page'
            ? (await installerSnapshot.inspect(harness)).find(
                (status) => status.skillId === 'fastppt-page-edit',
              )
            : undefined
        if (pageEditSkill && pageEditSkill.state !== 'installed')
          throw new RpcError(
            'The managed single-page editing Skill is not available',
            'SKILL_INSTALL_UNAVAILABLE',
            pageEditSkill,
          )
        database.setAppSetting('recentHarness', harness)
        database.setAppSetting(
          'recentSession',
          JSON.stringify({ harness, sessionId }),
        )
        database.setAppSetting('recentTheme', registeredTheme.manifest.id)
        const eventStream = adapter.sendMessage({
          sessionId,
          cwd: workspace.root,
          content: sessionProfile
            ? `${sessionBrief(sessionProfile.profile)}\n\n${input.content}`
            : input.content,
          attachments,
          themeId: registeredTheme.manifest.id,
          themeSkillId: registeredTheme.manifest.skill.id,
          themeSkillVersion: registeredTheme.manifest.skill.version,
          skills: [
            {
              id: skillStatus.base.skillId,
              name: skillStatus.base.skillId,
              path: skillStatus.base.targetPath,
              version: skillStatus.base.expectedVersion,
            },
            {
              id: skillStatus.theme.skillId,
              name: skillStatus.theme.skillId,
              path: skillStatus.theme.targetPath,
              version: skillStatus.theme.expectedVersion,
            },
            ...(pageEditSkill
              ? [
                  {
                    id: pageEditSkill.skillId,
                    name: pageEditSkill.skillId,
                    path: pageEditSkill.targetPath,
                    version: pageEditSkill.expectedVersion,
                  },
                ]
              : []),
          ],
        })
        const iterator = eventStream[Symbol.asyncIterator]()
        const first = await iterator.next()
        if (first.done)
          throw new RpcError(
            'Codex run ended before it started',
            'RUN_START_FAILED',
          )
        const firstEvent = UnifiedAgentEventSchema.parse(first.value)
        if (firstEvent.type === 'approval.requested') {
          const approval = ApprovalRequestSchema.parse(firstEvent.data)
          approvalHarnesses.set(approval.id, adapter)
          approvalRuns.set(approval.id, approval.runId)
          database.recordApproval({
            approvalId: approval.id,
            harness: firstEvent.harness,
            sessionId: firstEvent.sessionId,
            ...(firstEvent.runId ? { runId: firstEvent.runId } : {}),
            requestedAt: firstEvent.timestamp,
            payload: approval,
          })
        }
        const auditedFirstEvent = sessionProfile
          ? UnifiedAgentEventSchema.parse({
              ...firstEvent,
              data: {
                ...(firstEvent.data &&
                typeof firstEvent.data === 'object' &&
                !Array.isArray(firstEvent.data)
                  ? firstEvent.data
                  : {}),
                sessionProfile: sessionProfile.profile,
                profileDigest: sessionProfile.profileDigest,
              },
            })
          : firstEvent
        database.recordAgentEvent(
          auditedFirstEvent,
          registrySnapshot.version,
          'resolved',
        )
        publishAgentEvent(auditedFirstEvent)
        slotOwnedByBackgroundStream = true
        void (async () => {
          try {
            for (;;) {
              const next = await iterator.next()
              if (next.done) break
              const event = UnifiedAgentEventSchema.parse(next.value)
              if (event.type === 'approval.requested') {
                const approval = ApprovalRequestSchema.parse(event.data)
                approvalHarnesses.set(approval.id, adapter)
                approvalRuns.set(approval.id, approval.runId)
                database.recordApproval({
                  approvalId: approval.id,
                  harness: event.harness,
                  sessionId: event.sessionId,
                  ...(event.runId ? { runId: event.runId } : {}),
                  requestedAt: event.timestamp,
                  payload: approval,
                })
              } else if (event.type === 'approval.resolved') {
                const data = z
                  .object({ approvalId: z.string() })
                  .safeParse(event.data)
                if (data.success) {
                  approvalHarnesses.delete(data.data.approvalId)
                  approvalRuns.delete(data.data.approvalId)
                  database.resolveApproval(
                    data.data.approvalId,
                    'provider-resolved',
                  )
                }
              }
              if (
                event.runId &&
                [
                  'run.completed',
                  'run.cancelled',
                  'run.failed',
                  'harness.disconnected',
                ].includes(event.type)
              )
                clearRunApprovals(event.runId, 'provider-ended')
              database.recordAgentEvent(event, registrySnapshot.version)
              publishAgentEvent(event)
            }
          } catch (cause) {
            request.log.error(
              { err: cause, harness },
              'Harness event stream failed',
            )
          } finally {
            if (firstEvent.runId)
              clearRunApprovals(firstEvent.runId, 'provider-ended')
            releaseThemeState?.()
            releaseRunSlot()
          }
        })()
        return reply.code(202).send({ runId: firstEvent.runId })
      } finally {
        if (!slotOwnedByBackgroundStream) {
          releaseThemeState?.()
          releaseRunSlot()
        }
      }
    },
  )

  app.post('/api/v1/approvals/:approvalId/resolve', async (request) => {
    const { approvalId } = z
      .object({ approvalId: z.string().min(1) })
      .parse(request.params)
    const input = ApprovalDecisionRequestSchema.parse(request.body)
    const adapter = approvalHarnesses.get(approvalId)
    if (!adapter)
      throw new RpcError('Unknown or resolved approval', 'APPROVAL_NOT_FOUND', {
        approvalId,
      })
    await adapter.approveRequest({ approvalId, decision: input.decision })
    approvalHarnesses.delete(approvalId)
    approvalRuns.delete(approvalId)
    database.resolveApproval(approvalId, input.decision)
    return { resolved: true }
  })

  app.get('/api/v1/runs/:runId/audit', (request) => {
    const { runId } = z
      .object({ runId: z.string().min(1) })
      .parse(request.params)
    const audit = database.getRunAudit(runId)
    if (!audit)
      throw new RpcError('Run audit record was not found', 'RUN_NOT_FOUND', {
        runId,
      })
    return audit
  })

  app.get(
    '/api/v1/sessions/:harness/:sessionId/runs/latest',
    (request, reply) => {
      const { harness, sessionId } = z
        .object({ harness: HarnessKindSchema, sessionId: z.string().min(1) })
        .parse(request.params)
      const audit = database.getLatestRunAudit(harness, sessionId)
      return audit ?? reply.code(204).send()
    },
  )

  app.get('/api/v1/themes', () =>
    z
      .array(ThemeSummarySchema)
      .parse(
        themeRegistry.themes.map((theme) =>
          themeSummary(themeRegistry, theme.manifest.id),
        ),
      ),
  )

  app.post('/api/v1/themes/rescan', async () => await reloadThemeRegistry())

  type ThemeImportStatus = z.infer<typeof ImportPptxThemeStatusSchema>
  const designStatuses = new Map<string, ThemeImportStatus>()

  const readThemeArtifacts = async (themeId: string) => {
    const themeDir = join(config.themesRoot, themeId)
    const manifest = JSON.parse(
      await readFile(join(themeDir, 'agent', 'theme-manifest.json'), 'utf8'),
    ) as { layouts?: Array<{ id: string }> }
    const componentEntries = await import('node:fs/promises').then(({ readdir }) =>
      readdir(join(themeDir, 'components')).catch(() => []),
    )
    return {
      layouts: (manifest.layouts ?? []).map((layout) => layout.id),
      components: componentEntries
        .filter((entry) => entry.endsWith('.vue'))
        .map((entry) => entry.slice(0, -4)),
    }
  }

  const setThemeImportStatus = (
    themeId: string,
    update: Omit<ThemeImportStatus, 'themeId'>,
  ): void => {
    designStatuses.set(
      themeId,
      ImportPptxThemeStatusSchema.parse({ themeId, ...update }),
    )
  }

  /**
   * Background enrichment: run a harness design session that proposes
   * characteristic Slidev layouts + components for the just-imported theme.
   * The agent reads the extraction analysis and submits a structured design via
   * the `design_theme_layouts` MCP tool; completion reloads the registry.
   */
  async function runThemeDesignSession(
    harness: 'claude' | 'codex',
    themeId: string,
    themeDir: string,
  ): Promise<void> {
    const before = await readThemeArtifacts(themeId)
    setThemeImportStatus(themeId, {
      stage: 'designing',
      designing: true,
      ...before,
      message: 'Harness 正在根据提取分析设计特色布局与组件。',
    })
    const skillStatus = await skillInstaller.themeStatus(harness, themeId)
    const session = await harnesses[harness].createSession({
      cwd: workspace.root,
      title: `Design ${themeId} layouts`,
    })
    const content = [
      `Design characteristic Slidev layouts and components for the just-imported theme ${themeId}.`,
      `Read the extraction analysis at ${join(themeDir, 'EXTRACTION_ANALYSIS.md')} for the palette, fonts, typography, and suggested layouts/components.`,
      `Treat slide-level explicit colors and their frequencies as stronger evidence than generic Office accent slots. Do not introduce corporate blue or another fallback hue unless the analyzed slides actually use it.`,
      `Infer the source deck's visual grammar: whitespace, alignment, image dominance, numeric emphasis, density, and rhythm. Avoid generic card grids unless the source structure supports them.`,
      `Call the design_theme_layouts MCP tool with a structured list: 3-6 complementary layouts and 1-3 components that cover the source deck's recurring information structures.`,
      `Use the kinds listed in the tool schema and write a concrete hint per item describing content limits, slot usage, and when the author should choose it. These hints are synchronized into the Theme Skill.`,
      `After submitting the design, your turn is done — do not continue editing.`,
    ].join('\n')
    const stream = harnesses[harness].sendMessage({
      sessionId: session.sessionId,
      cwd: workspace.root,
      content,
      attachments: [],
      themeId,
      themeSkillId: skillStatus.theme.skillId,
      themeSkillVersion: skillStatus.theme.expectedVersion,
      skills: [
        {
          id: skillStatus.base.skillId,
          name: skillStatus.base.skillId,
          path: skillStatus.base.targetPath,
          version: skillStatus.base.expectedVersion,
        },
        {
          id: skillStatus.theme.skillId,
          name: skillStatus.theme.skillId,
          path: skillStatus.theme.targetPath,
          version: skillStatus.theme.expectedVersion,
        },
      ],
    })
    // Consume the agent's turn; the design_theme_layouts call materializes files.
    // Bound the session so a stalled agent cannot dangle the background task.
    let timedOut = false
    await Promise.race([
      (async () => {
        for await (const event of stream) {
          void event // progress is intentionally not surfaced for the background enrichment
        }
      })(),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          timedOut = true
          resolve()
        }, 240_000),
      ),
    ])
    if (timedOut) throw new Error('Theme design session timed out after 240 seconds.')
    const designed = await readThemeArtifacts(themeId)
    if (
      designed.layouts.length <= before.layouts.length &&
      designed.components.length <= before.components.length
    )
      throw new Error('Harness completed without materializing layouts or components.')

    setThemeImportStatus(themeId, {
      stage: 'syncing',
      designing: true,
      ...designed,
      message: '特色设计已生成，正在同步更新后的 Theme Skill。',
    })
    await reloadThemeRegistry()
    const refreshed = await skillInstaller.reconcile({ cleanStale: true })
    database.recordManagedInstallations(refreshed.statuses)
    const unavailable = refreshed.statuses.filter(
      (status) => status.themeId === themeId && status.state !== 'installed',
    )
    if (unavailable.length > 0)
      throw new Error(`Theme Skill synchronization failed: ${unavailable[0]?.message}`)

    setThemeImportStatus(themeId, {
      stage: 'validating',
      designing: true,
      ...designed,
      message: 'Theme Skill 已同步，正在校验主题结构与注册信息。',
    })
    themeRegistry.resolve(themeId)
    await Promise.all([
      access(join(themeDir, 'styles', 'index.ts')),
      access(join(themeDir, 'agent', 'SKILL.md')),
      ...designed.layouts.map((layout) =>
        access(join(themeDir, 'layouts', `${layout}.vue`)),
      ),
    ])
    setThemeImportStatus(themeId, {
      stage: 'ready',
      designing: false,
      ...designed,
      message: '主题提取、特色设计、Skill 同步与结构校验均已完成。',
    })
    app.log.info({ themeId, harness }, 'Theme design session completed; registry reloaded')
  }

  app.post('/api/v1/imports/pptx-theme', async (request, reply) => {
    const input = ImportPptxThemeRequestSchema.parse(request.body)
    const pptx = Buffer.from(input.dataBase64, 'base64')
    if (pptx.byteLength === 0) {
      reply.code(400)
      return { error: 'The uploaded PPTX is empty or could not be decoded.' }
    }
    if (pptx.byteLength > 200 * 1024 * 1024) {
      reply.code(413)
      return { error: 'The uploaded PPTX exceeds the 200 MiB import limit.' }
    }
    if (
      pptx.byteLength < 4 ||
      pptx[0] !== 0x50 ||
      pptx[1] !== 0x4b
    ) {
      reply.code(400)
      return { error: 'The uploaded file is not a valid PPTX/ZIP package.' }
    }
    const importsDir = join(config.workspaceRoot, '.fastppt', 'imports')
    await mkdir(importsDir, { recursive: true })
    const pptxPath = join(importsDir, `${randomUUID()}.pptx`)
    await writeFile(pptxPath, pptx)
    const extractorPath = join(
      repositoryRoot,
      'scripts',
      'extract-theme.mjs',
    )
    try {
      const { slug } = await runThemeExtraction({
        pptxPath,
        ...(input.themeName !== undefined ? { themeName: input.themeName } : {}),
        themesRoot: config.themesRoot,
        extractorPath,
      })
      await reloadThemeRegistry()
      const theme = themeRegistry.resolve(`slidev-theme-${slug}`)
      // A newly created theme depends on @fastppt/fonts; in the dev repo the
      // workspace link needs a `pnpm install`. Best-effort and background so an
      // unavailable package manager never blocks the import.
      if (
        config.themesRoot === repositoryRoot ||
        config.themesRoot.startsWith(`${repositoryRoot}${sep}`)
      ) {
        const install = spawn('pnpm', ['install'], {
          cwd: repositoryRoot,
          stdio: 'ignore',
        })
        install.on('error', () => undefined)
      }
      const themeId = theme.manifest.id
      const themeDir = join(config.themesRoot, themeId)
      const extracted = await readThemeArtifacts(themeId)
      setThemeImportStatus(themeId, {
        stage: 'designing',
        designing: true,
        ...extracted,
        message: '基础主题已提取，准备启动 harness 特色设计。',
      })
      const recentHarness = database.getAppSetting('recentHarness')
      const designHarness: 'claude' | 'codex' | undefined =
        recentHarness === 'claude' || recentHarness === 'codex'
          ? recentHarness
          : 'claude'
      if (designHarness) {
        // Optional background enrichment: a harness session designs characteristic
        // layouts/components. Completion reloads the registry and publishes
        // `themes.reloaded`, so the frontend catalog updates automatically.
        runThemeDesignSession(designHarness, themeId, themeDir)
          .catch((cause: unknown) => {
            const message = cause instanceof Error ? cause.message : String(cause)
            const current = designStatuses.get(themeId)
            setThemeImportStatus(themeId, {
              stage: 'failed',
              designing: false,
              layouts: current?.layouts ?? extracted.layouts,
              components: current?.components ?? extracted.components,
              message: '主题基础提取已保留，但特色设计流程未完成。',
              error: message,
            })
            app.log.warn(
              { themeId, cause: message },
              'Theme design session failed; base theme retained',
            )
          })
      } else {
        setThemeImportStatus(themeId, {
          stage: 'ready',
          designing: false,
          ...extracted,
          message: '基础主题提取和结构校验已完成。',
        })
      }
      return ImportPptxThemeResultSchema.parse({
        themeId,
        displayName: theme.manifest.displayName,
        packageName: theme.manifest.packageName,
        skillId: theme.manifest.skill.id,
        version: theme.manifest.version,
        slug,
        designing: designHarness !== undefined,
      })
    } catch (cause) {
      reply.code(400)
      return { error: cause instanceof Error ? cause.message : String(cause) }
    } finally {
      await rm(pptxPath, { force: true }).catch(() => undefined)
    }
  })

  app.get('/api/v1/imports/pptx-theme/:themeId', async (request) => {
    const { themeId } = z
      .object({ themeId: z.string().min(1) })
      .parse(request.params)
    const current = designStatuses.get(themeId)
    if (current) return current
    const artifacts = await readThemeArtifacts(themeId)
    return ImportPptxThemeStatusSchema.parse({
      themeId,
      stage: 'ready',
      designing: false,
      ...artifacts,
      message: '主题已就绪。',
    })
  })

  app.get('/api/v1/icons', async () => {
    const collections = await listCollections()
    return z.array(IconCollectionSummarySchema).parse(collections)
  })

  app.get('/api/v1/icons/search', async (request) => {
    const { q, limit } = z
      .object({
        q: z.string().default(''),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(request.query)
    const results = await searchIcons(q, { limit })
    return IconSearchResponseSchema.parse({ query: q, limit, results })
  })

  app.get('/api/v1/themes/:themeId', (request) => {
    const { themeId } = z
      .object({ themeId: z.string().min(1) })
      .parse(request.params)
    return themeSummary(themeRegistry, themeId)
  })

  app.get('/api/v1/themes/:themeId/skill', async (request) => {
    const { themeId } = z
      .object({ themeId: z.string().min(1) })
      .parse(request.params)
    const theme = themeRegistry.resolve(themeId)
    return ThemeSkillDocumentSchema.parse({
      themeId: theme.manifest.id,
      skillId: theme.manifest.skill.id,
      version: theme.manifest.skill.version,
      fileName: 'SKILL.md',
      content: await readFile(theme.skillPath, 'utf8'),
    })
  })

  app.get('/api/v1/themes/:themeId/skill-status', async (request) => {
    const { themeId } = z
      .object({ themeId: z.string().min(1) })
      .parse(request.params)
    const { harness } = z
      .object({ harness: HarnessKindSchema })
      .parse(request.query)
    themeRegistry.resolve(themeId)
    return ThemeSkillStatusSchema.parse(
      await skillInstaller.themeStatus(harness, themeId),
    )
  })

  app.get('/api/v1/managed/status', async () => ({
    registryVersion: themeRegistry.version,
    skills: await Promise.all([
      skillInstaller.inspect('claude'),
      skillInstaller.inspect('codex'),
    ]).then((statuses) => statuses.flat()),
    mcp: await Promise.all([
      mcpConfigManager.inspect('claude'),
      mcpConfigManager.inspect('codex'),
    ]),
  }))

  app.get('/api/v1/decks', async () =>
    z.array(DeckSummarySchema).parse(await listDecks()),
  )

  app.get('/api/v1/decks/:deckId', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    return DeckSummarySchema.parse(await resolveDeck(deckId))
  })

  app.post('/api/v1/decks', async (request) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(120),
        themeId: z.string().min(1),
      })
      .parse(request.body)
    const theme = themeRegistry.resolve(input.themeId).manifest
    const existing = new Set((await listDecks()).map((deck) => deck.entryFile))
    const stem = deckSlug(input.name)
    let entryFile = `${stem}.md`
    for (let suffix = 2; existing.has(entryFile); suffix++)
      entryFile = `${stem}-${suffix}.md`
    await workspaceFiles.writeTextFile({
      path: entryFile,
      content: `---\ntheme: ${theme.packageName}\naspectRatio: ${theme.defaultAspectRatio ?? '16/9'}\ntitle: ${input.name}\n---\n\n# ${input.name}\n`,
    })
    const deck = (await listDecks()).find(
      (candidate) => candidate.entryFile === entryFile,
    )
    if (!deck) throw new Error('Created deck could not be discovered')
    return DeckSummarySchema.parse(deck)
  })

  app.put('/api/v1/decks/:deckId/markdown', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const input = z
      .object({
        content: z.string(),
        expectedRevision: z.string().min(1).optional(),
      })
      .parse(request.body)
    const deck = await resolveDeck(deckId)
    return FileContentSchema.parse(
      await workspaceFiles.writeTextFile({
        path: deck.entryFile,
        content: input.content,
        ...(input.expectedRevision
          ? { expectedRevision: input.expectedRevision }
          : {}),
      }),
    )
  })

  app.post('/api/v1/decks/:deckId/validate', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const deck = await resolveDeck(deckId)
    const file = await workspaceFiles.readTextFile(deck.entryFile)
    const errors: Array<{ code: string; message: string }> = []
    let theme: ReturnType<ThemeRegistry['resolve']> | undefined
    if (!deck.themeId)
      errors.push({
        code: 'THEME_NOT_FOUND',
        message: 'Deck theme is missing.',
      })
    else {
      try {
        theme = themeRegistry.resolve(deck.themeId)
      } catch (cause) {
        errors.push({
          code: 'THEME_NOT_FOUND',
          message: cause instanceof Error ? cause.message : String(cause),
        })
      }
    }
    if (theme) {
      const layouts = new Set(theme.manifest.layouts.map((layout) => layout.id))
      for (const match of file.content.matchAll(
        /^layout:\s*['"]?([^'"\s]+)['"]?\s*$/gm,
      )) {
        const layout = match[1]
        if (layout && !layouts.has(layout))
          errors.push({
            code: 'LAYOUT_UNAVAILABLE',
            message: `Layout is not registered for ${theme.manifest.id}: ${layout}`,
          })
      }
    }
    return {
      deckId,
      revision: file.revision,
      valid: errors.length === 0,
      themeId: theme?.manifest.id,
      themeSkillId: theme?.manifest.skill.id,
      errors,
    }
  })

  app.post('/api/v1/decks/:deckId/format', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const input = z
      .object({
        expectedRevision: z.string().min(1).optional(),
        dryRun: z.boolean().default(false),
      })
      .parse(request.body ?? {})
    const deck = await resolveDeck(deckId)
    const file = await workspaceFiles.readTextFile(deck.entryFile)
    const content = await formatSlidevMarkdown(file.content)
    const changed = content !== file.content
    if (input.dryRun || !changed)
      return MarkdownFormatResultSchema.parse({
        path: file.path,
        content,
        revision: file.revision,
        changed,
        dryRun: input.dryRun,
        written: false,
      })
    const written = FileContentSchema.parse(
      await workspaceFiles.writeTextFile({
        path: deck.entryFile,
        content,
        expectedRevision: input.expectedRevision ?? file.revision,
      }),
    )
    return MarkdownFormatResultSchema.parse({
      path: written.path,
      content: written.content,
      revision: written.revision,
      changed: true,
      dryRun: false,
      written: true,
    })
  })

  app.post('/api/v1/decks/:deckId/preview/start', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const deck = await resolveDeck(deckId)
    const themePackageRoot = deck.themeId
      ? themeRegistry.resolve(deck.themeId).packageRoot
      : undefined
    const entryFile = await resolveExistingPath(
      workspaceFiles.root,
      deck.entryFile,
    )
    return requireSlidevReady(
      SlidevProcessStateSchema.parse(
        await slidevHost.start({
          deckId,
          entryFile,
          ...(themePackageRoot ? { themePackageRoot } : {}),
        }),
      ),
      'preview',
    )
  })

  app.post('/api/v1/decks/:deckId/preview/restart', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const deck = await resolveDeck(deckId)
    const state = slidevHost.getState(deckId)
    if (state.status === 'stopped') {
      const themePackageRoot = deck.themeId
        ? themeRegistry.resolve(deck.themeId).packageRoot
        : undefined
      const entryFile = await resolveExistingPath(
        workspaceFiles.root,
        deck.entryFile,
      )
      return requireSlidevReady(
        SlidevProcessStateSchema.parse(
          await slidevHost.start({
            deckId,
            entryFile,
            ...(themePackageRoot ? { themePackageRoot } : {}),
          }),
        ),
        'preview',
      )
    }
    return requireSlidevReady(
      SlidevProcessStateSchema.parse(await slidevHost.restart(deckId)),
      'preview',
    )
  })

  app.post('/api/v1/decks/:deckId/preview/stop', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    await resolveDeck(deckId)
    return SlidevProcessStateSchema.parse(await slidevHost.stop(deckId))
  })

  app.get('/api/v1/decks/:deckId/preview/status', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    await resolveDeck(deckId)
    slidevHost.touch(deckId)
    return SlidevProcessStateSchema.parse(slidevHost.getState(deckId))
  })

  app.post('/api/v1/decks/:deckId/exports', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const input = CreateExportRequestSchema.parse(request.body)
    const deck = await resolveDeck(deckId)
    const policy = input.reviewPolicy ?? 'fast'
    if (policy !== 'fast') {
      const report = database.getQualityReport(deckId)
      const stale =
        !report ||
        report.revision !== deck.revision ||
        report.profileDigest !== (input.profileDigest ?? null)
      if (stale || !report?.ok)
        throw new RpcError(
          stale
            ? 'A current quality inspection is required before export.'
            : 'Quality inspection found blocking issues. Fix them before export.',
          stale ? 'QUALITY_REPORT_REQUIRED' : 'QUALITY_GATE_FAILED',
          { deckId, revision: deck.revision, policy },
        )
    }
    const themePackageRoot = deck.themeId
      ? themeRegistry.resolve(deck.themeId).packageRoot
      : undefined
    const current = slidevHost.getState(deckId)
    const state =
      current.status === 'ready'
        ? current
        : await slidevHost.start({
            deckId,
            entryFile: await resolveExistingPath(
              workspaceFiles.root,
              deck.entryFile,
            ),
            ...(themePackageRoot ? { themePackageRoot } : {}),
          })
    requireSlidevReady(state, 'export')
    return ExportJobSchema.parse(
      exportManager.enqueue({
        deckId,
        title: deck.name,
        outputName: input.outputName,
        review: input.review ?? false,
      }),
    )
  })

  app.post('/api/v1/decks/:deckId/inspections/overflow', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const { slide } = z
      .object({ slide: z.number().int().positive() })
      .parse(request.body)
    const deck = await resolveDeck(deckId)
    const themePackageRoot = deck.themeId
      ? themeRegistry.resolve(deck.themeId).packageRoot
      : undefined
    const current = slidevHost.getState(deckId)
    const state =
      current.status === 'ready'
        ? current
        : await slidevHost.start({
            deckId,
            entryFile: await resolveExistingPath(
              workspaceFiles.root,
              deck.entryFile,
            ),
            ...(themePackageRoot ? { themePackageRoot } : {}),
          })
    requireSlidevReady(state, 'inspection')
    return BrowserInspectionJobSchema.parse(
      inspectionManager.enqueue(deckId, slide),
    )
  })

  app.post('/api/v1/decks/:deckId/inspections/quality', async (request) => {
    const { deckId } = z.object({ deckId: z.string().min(1) }).parse(request.params)
    const input = z.object({
      slide: z.number().int().positive(),
      policy: z.enum(['fast', 'standard', 'strict']).default('standard'),
      profileDigest: z.string().min(1).nullable().default(null),
    }).parse(request.body)
    const deck = await resolveDeck(deckId)
    const themeDigest = deck.themeId
      ? createHash('sha256').update(deck.themeId).digest('hex')
      : null
    const themePackageRoot = deck.themeId
      ? themeRegistry.resolve(deck.themeId).packageRoot
      : undefined
    const current = slidevHost.getState(deckId)
    const state = current.status === 'ready' ? current : await slidevHost.start({
      deckId,
      entryFile: await resolveExistingPath(workspaceFiles.root, deck.entryFile),
      ...(themePackageRoot ? { themePackageRoot } : {}),
    })
    requireSlidevReady(state, 'inspection')
    return BrowserInspectionJobSchema.parse(inspectionManager.enqueue(
      deckId,
      input.slide,
      'quality',
      {
        revision: deck.revision,
        themeId: deck.themeId ?? null,
        themeDigest,
        profileDigest: input.profileDigest,
        policy: input.policy,
      },
    ))
  })

  app.get('/api/v1/decks/:deckId/quality-report', async (request) => {
    const { deckId } = z.object({ deckId: z.string().min(1) }).parse(request.params)
    await resolveDeck(deckId)
    const report = database.getQualityReport(deckId)
    if (!report)
      throw new RpcError('Quality report was not found.', 'QUALITY_REPORT_NOT_FOUND', { deckId })
    return DeckQualityReportSchema.parse(report)
  })

  app.get('/api/v1/inspections/:inspectionId', (request) => {
    const { inspectionId } = z
      .object({ inspectionId: z.string().uuid() })
      .parse(request.params)
    const job = inspectionManager.get(inspectionId)
    if (!job)
      throw new RpcError(
        'Browser inspection was not found.',
        'INSPECTION_NOT_FOUND',
        {
          inspectionId,
        },
      )
    return BrowserInspectionJobSchema.parse(job)
  })

  app.post('/api/v1/inspections/:inspectionId/result', (request) => {
    const { inspectionId } = z
      .object({ inspectionId: z.string().uuid() })
      .parse(request.params)
    const inspection = inspectionManager.get(inspectionId)
    if (!inspection)
      throw new RpcError(
        'Browser inspection was not found.',
        'INSPECTION_NOT_FOUND',
        { inspectionId },
      )
    if (inspection.status !== 'queued')
      throw new RpcError(
        'Browser inspection is not awaiting capture.',
        'INSPECTION_NOT_READY',
        { inspectionId, status: inspection.status },
      )
    const completed = inspectionManager.submitResult(inspectionId, request.body)
    if (completed.kind === 'quality' && completed.status === 'completed') {
      const result = BrowserQualityResultSchema.parse(completed.result)
      database.recordQualityReport(DeckQualityReportSchema.parse({
        version: 1,
        deckId: completed.deckId,
        revision: completed.revision,
        themeId: completed.themeId ?? null,
        themeDigest: completed.themeDigest ?? null,
        profileDigest: completed.profileDigest ?? null,
        checkedAt: new Date().toISOString(),
        policy: completed.policy ?? 'standard',
        ok: !result.issues.some((issue) => issue.severity === 'error'),
        issues: result.issues,
      }))
    }
    return BrowserInspectionJobSchema.parse(completed)
  })

  app.post('/api/v1/exports/:exportId/snapshot', (request) => {
    const { exportId } = z
      .object({ exportId: z.string().uuid() })
      .parse(request.params)
    const snapshot = SlidewaveSnapshotSchema.parse(request.body)
    try {
      return ExportJobSchema.parse(
        exportManager.submitSnapshot(exportId, snapshot),
      )
    } catch (cause) {
      throw new RpcError(
        cause instanceof Error ? cause.message : String(cause),
        'EXPORT_NOT_READY',
        { exportId },
      )
    }
  })

  app.post('/api/v1/exports/:exportId/capture-progress', (request) => {
    const { exportId } = z
      .object({ exportId: z.string().uuid() })
      .parse(request.params)
    const { completed, total } = z
      .object({
        completed: z.number().int().nonnegative(),
        total: z.number().int().positive(),
      })
      .refine((value) => value.completed <= value.total)
      .parse(request.body)
    try {
      return ExportJobSchema.parse(
        exportManager.reportCaptureProgress(exportId, completed, total),
      )
    } catch (cause) {
      throw new RpcError(
        cause instanceof Error ? cause.message : String(cause),
        'EXPORT_NOT_READY',
        { exportId },
      )
    }
  })

  app.get('/api/v1/exports/:exportId', (request) => {
    const { exportId } = z
      .object({ exportId: z.string().uuid() })
      .parse(request.params)
    const job =
      exportManager.get(exportId) ?? database.getExportJob(exportId)?.job
    if (!job)
      throw new RpcError('Export job was not found.', 'EXPORT_NOT_FOUND', {
        exportId,
      })
    return ExportJobSchema.parse(job)
  })

  app.post('/api/v1/exports/:exportId/review', async (request, reply) => {
    const { exportId } = z
      .object({ exportId: z.string().min(1) })
      .parse(request.params)
    const { approved } = ReviewExportRequestSchema.parse(request.body)
    try {
      return ExportJobSchema.parse(
        await exportManager.review(exportId, approved),
      )
    } catch (cause) {
      reply.code(400)
      return { error: cause instanceof Error ? cause.message : String(cause) }
    }
  })

  app.post('/api/v1/exports/:exportId/retry', async (request, reply) => {
    const { exportId } = z
      .object({ exportId: z.string().min(1) })
      .parse(request.params)
    try {
      return ExportJobSchema.parse(exportManager.retry(exportId))
    } catch (cause) {
      reply.code(400)
      return { error: cause instanceof Error ? cause.message : String(cause) }
    }
  })

  app.post('/api/v1/exports/:exportId/cancel', (request) => {
    const { exportId } = z
      .object({ exportId: z.string().uuid() })
      .parse(request.params)
    const job = exportManager.cancel(exportId)
    if (!job)
      throw new RpcError('Export job was not found.', 'EXPORT_NOT_FOUND', {
        exportId,
      })
    return ExportJobSchema.parse(job)
  })

  app.get('/api/v1/exports/:exportId/download', async (request, reply) => {
    const { exportId } = z
      .object({ exportId: z.string().uuid() })
      .parse(request.params)
    const persisted = database.getExportJob(exportId)
    if (!persisted)
      throw new RpcError('Export job was not found.', 'EXPORT_NOT_FOUND', {
        exportId,
      })
    if (persisted.job.status !== 'completed')
      throw new RpcError(
        'Export is not available for download.',
        'EXPORT_NOT_READY',
        { exportId, status: persisted.job.status },
      )
    const outputPath = await resolveExistingPath(
      exportRoot,
      relative(exportRoot, persisted.outputPath),
    )
    reply
      .type(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      )
      .header(
        'content-disposition',
        `attachment; filename="${persisted.job.outputName}"`,
      )
    return reply.send(createReadStream(outputPath))
  })

  app.get('/api/v1/events', { websocket: true }, (socket) => {
    eventHub.connect(socket)
  })

  const unsubscribeWatcher = workspaceWatcher.subscribe((events) => {
    for (const event of events) {
      eventHub.publish('workspace', `file.${event.type}`, event)
      app.log.info(
        {
          workspaceId,
          path: event.path,
          eventType: event.type,
          isDirectory: event.isDirectory,
          ...('previousPath' in event
            ? { previousPath: event.previousPath }
            : {}),
        },
        'Workspace file event',
      )
    }
  })

  app.addHook('onClose', async () => {
    stateCleanup.stop()
    if (themeReloadTimer) clearTimeout(themeReloadTimer)
    themeWatcher?.close()
    unsubscribeWatcher()
    await Promise.all(
      [...new Set(Object.values(harnesses))].map((adapter) =>
        adapter.dispose(),
      ),
    )
    await registryReloadTail
    await exportManager.dispose()
    inspectionManager.dispose()
    await slidevHost.close()
    eventHub.close()
    await workspaceWatcher.close()
    database.close()
    try {
      const runtime = JSON.parse(await readFile(runtimeFile, 'utf8')) as {
        nonce?: unknown
      }
      if (runtime.nonce === runtimeNonce) await rm(runtimeFile, { force: true })
    } catch {
      // Another Gateway may have replaced the runtime descriptor.
    }
  })

  return app
}
