import { registerAnimationRoutes } from './animations.js'
import { ANIMATION_AUTHORING_GUIDANCE } from '@fastppt/animations'
import { registerResourceRoutes } from './resources.js'
import { RESOURCE_AUTHORING_GUIDANCE } from '@fastppt/resources'
import { PALETTE_AUTHORING_GUIDANCE } from '@fastppt/palettes'
import { registerPaletteRoutes } from './palettes.js'
import { withThemeAnchors } from './theme-anchors.js'
import { withGeneratedCandidates } from './import-candidates.js'
import { themeRuleSlides, type RuleMeasurement } from './theme-rule-context.js'
import { evaluateImportRuleApproval } from './theme-rule-approval.js'
import { applyRuleExceptions, authoredRuleDigest, blockingRuleIssue, ruleExceptionState, ruleIssueFingerprint, ruleOptionsDigest, sameRuleBinding, ThemeRuleExceptionStore } from './theme-rule-exceptions.js'
import { installThemeDirectory } from './theme-install.js'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, watch, type FSWatcher } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import {
  basename,
  dirname,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { createDatabase } from '@fastppt/database'
import {
  DiagramDocumentV1Schema,
  renderDiagram,
  validateDiagram,
} from '@fastppt/diagram-engine'
import { analyzePptx } from '@fastppt/pptx-import'
import {
  compileDeck,
  persistDeckIdentities,
} from '@fastppt/presentation-compiler'
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
import { parseSlidevDocument } from '@fastppt/markdown/parser'
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
  ThemeRuleApprovalReportSchema,
  ThemeRuleExceptionContextRequestSchema,
  ApproveThemeRuleExceptionSchema,
  ThemeRuleExceptionReviewSchema,
  ThemeRuleExceptionSchema,
  type ThemeRuleExceptionBinding,
  type ThemeRuleExceptionContextRequest,
  type ThemeRuleIssue,
  ThemeSkillDocumentSchema,
  ThemeSkillStatusSchema,
  WriteFileRequestSchema,
  UploadWorkspaceImageSchema,
  WorkspaceImageAssetSchema,
  WorkspaceInfoSchema,
  DeckSummarySchema,
  DeckValidationResultSchema,
  ApprovalDecisionRequestSchema,
  ApprovalRequestSchema,
  ApplicationStateSchema,
  CreateExportRequestSchema,
  DeckAnimationsDocumentSchema,
  DeckNotesDocumentSchema,
  ExportCapabilityReportSchema,
  PutDiagramDocumentSchema,
  CreationWizardSchema,
  CreationDecisionV1Schema,
  ReviewExportRequestSchema,
  ImportPptxThemeRequestSchema,
  ImportPptxThemeResultSchema,
  ImportPptxThemeStatusSchema,
  ImportAnalysisV1Schema,
  MasterSnapshotV1Schema,
  NativeMasterLayoutSchema,
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
  CreateImageRunRequestSchema,
  ImageAssetSchema,
  ImageRunSchema,
  RegisterImageAssetRequestSchema,
  SlidewaveSnapshotSchema,
  cuesToSrt,
  NarrationProviderStatusV1Schema,
  type ApiErrorBody,
  type WorkspaceInfo,
  type SessionDeckProfile,
} from '@fastppt/protocol'
import { cleanupStaleSlidevCaches, SlidevHost } from '@fastppt/slidev-host'
import { classifySlidevLogLine } from './slidev-logs.js'
import { ensureWorkspaceGitignore } from './workspace-gitignore.js'
import {
  evaluateThemeRules,
  loadThemeRegistry,
  ThemeRegistryError,
  ThemeRulesDocumentSchema,
  themeRulesDigest,
  themeContentDigest,
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

function imageMediaType(
  path: string,
  bytes: Buffer,
): 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp' {
  const extension = path.toLowerCase().split('.').pop()
  const matches = {
    gif:
      (bytes.subarray(0, 6).equals(Buffer.from('GIF87a')) ||
        bytes.subarray(0, 6).equals(Buffer.from('GIF89a'))) &&
      'image/gif',
    jpeg:
      bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) &&
      'image/jpeg',
    png:
      bytes
        .subarray(0, 8)
        .equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ) && 'image/png',
    webp:
      bytes.subarray(0, 4).equals(Buffer.from('RIFF')) &&
      bytes.subarray(8, 12).equals(Buffer.from('WEBP')) &&
      'image/webp',
  } as const
  const mediaType =
    extension === 'gif'
      ? matches.gif
      : extension === 'jpg' || extension === 'jpeg'
        ? matches.jpeg
        : extension === 'png'
          ? matches.png
          : extension === 'webp'
            ? matches.webp
            : false
  if (!mediaType)
    throw new WorkspaceError(
      'INVALID_REQUEST',
      'Image path extension or file signature is unsupported.',
      400,
    )
  return mediaType
}

function imagePaths(source: string): string[] {
  const markdown = [
    ...source.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g),
  ]
  const html = [...source.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
  return [...markdown, ...html].map((match) => match[1] ?? '').filter(Boolean)
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
    ...(profile.creationDecisions
      ? [
          `creation_decisions: ${JSON.stringify(profile.creationDecisions)}`,
          'Preserve locked creation decisions. Ask for an explicit user revision before changing them.',
        ]
      : []),
    ...(profile.deliveryOptions
      ? [`delivery_options: ${JSON.stringify(profile.deliveryOptions)}`]
      : []),
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
  'THEME_RULES_STALE',
  'THEME_RULE_APPROVAL_FAILED',
  'THEME_RULE_EXCEPTION_STALE',
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
  let skillReport = await skillInstaller.reconcile({ cleanStale: true, unloadThemes: true })
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
    async verifyRuleContext(job, exportOptions) {
      const binding = job.themeRules?.binding
      if (!binding) return
      const deck = await resolveDeck(job.deckId)
      const current = await currentRuleBinding(deck, binding.profileDigest, exportOptions)
      if (!sameRuleBinding(binding, current)) throw new Error('Rule exception context changed. Review and export the current deck again.')
      const entries = await ruleExceptionStore.list(deck.id)
      for (const frozen of job.themeRules?.exceptions ?? []) {
        const live = entries.find(entry => entry.id === frozen.id)
        if (!live || ruleExceptionState(live, current) !== 'active' || JSON.stringify(live) !== JSON.stringify(frozen)) throw new Error('A frozen rule exception was revoked or changed. Export the current deck again.')
      }
    },
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
  await exportManager.ready()
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
    const sampleDirectory = join(workspace.root, 'theme-samples')
    const samplePaths = await readdir(sampleDirectory, {
      withFileTypes: true,
    })
      .then((entries) =>
        entries
          .filter(
            (entry) =>
              entry.isFile() &&
              entry.name.startsWith('slidev-theme-') &&
              entry.name.endsWith('.md'),
          )
          .map((entry) => `theme-samples/${entry.name}`),
      )
      .catch((cause: unknown) => {
        if (
          cause instanceof Error &&
          'code' in cause &&
          cause.code === 'ENOENT'
        )
          return []
        throw cause
      })
    const paths = [
      ...new Set([
        ...collectMarkdownPaths(await workspaceFiles.listFiles()),
        ...samplePaths,
      ]),
    ]
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

  const deckDocumentPath = (deckId: string, name: string): string =>
    join(config.workspaceRoot, '.fastppt', 'decks', deckId, name)
  const ruleExceptionStore = new ThemeRuleExceptionStore(deckId => deckDocumentPath(deckId, 'theme-rule-exceptions.json'))
  const readDeckDocument = async <T>(
    deckId: string,
    name: string,
    schema: z.ZodType<T>,
    fallback?: T,
  ): Promise<T> => {
    try {
      return schema.parse(
        JSON.parse(await readFile(deckDocumentPath(deckId, name), 'utf8')),
      )
    } catch (cause) {
      if (
        (cause as NodeJS.ErrnoException).code === 'ENOENT' &&
        fallback !== undefined
      )
        return fallback
      throw cause
    }
  }
  const writeDeckDocument = async (
    deckId: string,
    name: string,
    value: unknown,
  ): Promise<void> => {
    const target = deckDocumentPath(deckId, name)
    await mkdir(dirname(target), { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporary, target)
  }

  const compileWithThemeAnchors = async (
    deck: DeckSummary,
    markdown: string,
  ) => {
    const slides = compileDeck(markdown)
    if (!deck.themeId) return slides
    const theme = themeRegistry.resolve(deck.themeId)
    try {
      const definitions = z
        .array(NativeMasterLayoutSchema)
        .parse(
          JSON.parse(
            await readFile(
              join(theme.packageRoot, 'agent', 'native-layouts.json'),
              'utf8',
            ),
          ),
        )
      return withThemeAnchors(slides, definitions)
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')
        return slides
      throw cause
    }
  }

  const lockedMasterDigest = async (deckId: string): Promise<string | null> => {
    const snapshot = await readDeckDocument(deckId, 'theme-lock.json', MasterSnapshotV1Schema).catch((cause: unknown) => {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return undefined
      throw cause
    })
    return snapshot ? createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') : null
  }
  const currentRuleBinding = async (deck: DeckSummary, profileDigest: string | null, exportOptions?: unknown): Promise<ThemeRuleExceptionBinding> => {
    const theme = deck.themeId ? themeRegistry.resolve(deck.themeId) : undefined
    const rules = theme?.machineRulesPath ? ThemeRulesDocumentSchema.parse(JSON.parse(await readFile(theme.machineRulesPath, 'utf8'))) : undefined
    return {
      deckId: deck.id, revision: (await workspaceFiles.readTextFile(deck.entryFile)).revision,
      themeId: deck.themeId ?? null, themeDigest: theme ? await themeContentDigest(theme.packageRoot) : null,
      ruleDigest: rules ? themeRulesDigest(rules) : null, masterDigest: await lockedMasterDigest(deck.id),
      profileDigest, optionsDigest: ruleOptionsDigest(exportOptions), authoredDigest: await authoredRuleDigest(deckDocumentPath(deck.id, '')),
    }
  }
  const validateDeck = async (deck: DeckSummary, options: { phase?: 'validate' | 'quality' | 'export'; measurements?: RuleMeasurement[]; master?: boolean; profileDigest?: string | null; exportOptions?: unknown; applyExceptions?: boolean } = {}) => {
    const file = await workspaceFiles.readTextFile(deck.entryFile)
    const errors: Array<{ code: string; message: string }> = []
    let themeRuleIssues: ThemeRuleIssue[] = []
    let themeRuleDigest: string | null = null
    let compiledSlides = compileDeck(file.content)
    try {
      compiledSlides = await compileWithThemeAnchors(deck, file.content)
    } catch (cause) {
      errors.push({
        code: 'THEME_ANCHORS_INVALID',
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
    for (const slide of compiledSlides) {
      for (const diagnostic of slide.animation.diagnostics)
        errors.push({
          code: 'ANIMATION_DIAGNOSTIC',
          message: `Slide ${slide.slideId}: ${diagnostic}`,
        })
    }
    const animationDocument = await readDeckDocument(
      deck.id,
      'animations.json',
      DeckAnimationsDocumentSchema,
      { version: 1, animations: [] },
    )
    const notesDocument = await readDeckDocument(
      deck.id,
      'notes.json',
      DeckNotesDocumentSchema,
      { version: 1, notes: [] },
    )
    const notesBySlide = new Map(
      notesDocument.notes.map((note) => [note.slideId, note]),
    )
    const compiledById = new Map(
      compiledSlides.map((slide) => [slide.slideId, slide]),
    )
    for (const animation of animationDocument.animations) {
      const compiled = compiledById.get(animation.slideId)
      if (!compiled) {
        errors.push({
          code: 'ANIMATION_SLIDE_UNKNOWN',
          message: `Animation references missing slide: ${animation.slideId}`,
        })
        continue
      }
      for (const group of animation.groups) {
        if (!compiled.anchors.includes(group.id))
          errors.push({
            code: 'ANIMATION_TARGET_UNKNOWN',
            message: `Animation group target does not exist on ${animation.slideId}: ${group.id}`,
          })
        if (group.static && group.effects.length)
          errors.push({
            code: 'ANIMATION_STATIC_TARGET',
            message: `Static animation group has effects on ${animation.slideId}: ${group.id}`,
          })
        for (const effect of group.effects)
          if (
            effect.target !== group.id ||
            !compiled.anchors.includes(effect.target)
          )
            errors.push({
              code: 'ANIMATION_TARGET_UNKNOWN',
              message: `Animation effect target does not exist on ${animation.slideId}: ${effect.target}`,
            })
        if (
          notesBySlide.get(animation.slideId)?.spokenText.trim() &&
          group.effects.some((effect) => effect.trigger === 'on-click')
        )
          errors.push({
            code: 'ANIMATION_CLICK_WITH_NOTES',
            message: `On-click animation cannot be used on a narrated slide: ${animation.slideId}`,
          })
      }
    }
    const slideIds = new Set(compiledSlides.map((slide) => slide.slideId))
    const notedSlides = new Set<string>()
    for (const note of notesDocument.notes) {
      if (!slideIds.has(note.slideId))
        errors.push({
          code: 'NOTES_SLIDE_UNKNOWN',
          message: `Notes reference missing slide: ${note.slideId}`,
        })
      if (notedSlides.has(note.slideId))
        errors.push({
          code: 'NOTES_DUPLICATE_SLIDE',
          message: `Multiple notes entries reference: ${note.slideId}`,
        })
      notedSlides.add(note.slideId)
      for (const cue of note.cues) {
        if (
          cue.endSeconds < cue.startSeconds ||
          cue.endSeconds > note.estimatedSeconds
        )
          errors.push({
            code: 'NOTES_CUE_INVALID',
            message: `Invalid cue range on ${note.slideId}: ${cue.startSeconds}-${cue.endSeconds}`,
          })
      }
    }
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

      if (theme.machineRulesPath) {
        try {
          const rules = ThemeRulesDocumentSchema.parse(
            JSON.parse(
              await readFile(theme.machineRulesPath, 'utf8'),
            ) as unknown,
          )
          const definitionRaw = await readFile(join(theme.packageRoot, 'agent', 'native-layouts.json'), 'utf8').catch((cause: unknown) => {
            if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return undefined
            throw cause
          })
          const currentDefinitions = definitionRaw ? z.array(NativeMasterLayoutSchema).parse(JSON.parse(definitionRaw)) : undefined
          const locked = options.phase === 'export' ? await readDeckDocument(deck.id, 'theme-lock.json', MasterSnapshotV1Schema).catch(() => undefined) : undefined
          const definitions = options.master === false ? undefined : options.phase === 'export' ? locked?.layoutDefinitions : currentDefinitions
          const report = database.getQualityReport(deck.id)
          const savedMeasurements = report && report.revision === deck.revision && report.themeDigest === theme.contentDigest && report.themeRuleDigest === theme.machineRulesDigest && report.masterDigest === await lockedMasterDigest(deck.id) && (options.profileDigest === undefined || options.profileDigest === report.profileDigest) ? report.ruleMeasurements : []
          themeRuleIssues.push(
            ...evaluateThemeRules({
              document: rules,
              phase: options.phase ?? 'validate',
              slides: themeRuleSlides(compiledSlides, definitions, compiledSlides.map(slide => animationDocument.animations.find(entry => entry.slideId === slide.slideId) ?? slide.animation), options.measurements ?? savedMeasurements),
            }),
          )
          themeRuleDigest = theme.machineRulesDigest ?? null
        } catch (cause) {
          errors.push({
            code: 'THEME_RULES_INVALID',
            message: cause instanceof Error ? cause.message : String(cause),
          })
        }
      }
    }
    if (options.applyExceptions !== false && themeRuleIssues.length) {
      const exceptions = await ruleExceptionStore.list(deck.id)
      if (exceptions.length) themeRuleIssues = applyRuleExceptions(themeRuleIssues, exceptions, await currentRuleBinding(deck, options.profileDigest ?? null, options.exportOptions), 'export')
    }
    for (const issue of themeRuleIssues)
      if (blockingRuleIssue(issue))
        errors.push({
          code: issue.code,
          message: `${issue.message}${issue.slide === undefined ? '' : ` (slide ${issue.slide})`}`,
        })
    const imageAssets = new Map(
      database.listImageAssets(deck.id).map((asset) => [asset.path, asset]),
    )
    for (const assetPath of imagePaths(file.content)) {
      if (/^(?:https?:|data:)/i.test(assetPath)) {
        errors.push({
          code: 'ASSET_UNAVAILABLE',
          message: `Image asset must be workspace-relative: ${assetPath}`,
        })
        continue
      }
      const relativePath = posix.normalize(
        posix.join(
          posix.dirname(deck.entryFile.replaceAll('\\', '/')),
          assetPath,
        ),
      )
      try {
        const absolutePath = await resolveExistingPath(
          workspaceFiles.root,
          relativePath,
        )
        const registered = imageAssets.get(relativePath)
        if (!registered) continue
        if (registered.status !== 'accepted' || !registered.accepted) {
          errors.push({
            code: 'IMAGE_ASSET_UNACCEPTED',
            message: `Image asset has not been accepted: ${assetPath}`,
          })
          continue
        }
        const sha256 = createHash('sha256')
          .update(await readFile(absolutePath))
          .digest('hex')
        if (sha256 !== registered.sha256)
          errors.push({
            code: 'IMAGE_ASSET_CHANGED',
            message: `Image asset contents changed after acceptance: ${assetPath}`,
          })
      } catch {
        errors.push({
          code: 'ASSET_UNAVAILABLE',
          message: `Asset cannot be resolved: ${assetPath}`,
        })
      }
    }
    const diagramsRoot = deckDocumentPath(deck.id, 'diagrams')
    const diagramFiles = await readdir(diagramsRoot, {
      withFileTypes: true,
    }).catch(() => [])
    for (const entry of diagramFiles) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const diagramPath = join(diagramsRoot, entry.name)
      try {
        const document = DiagramDocumentV1Schema.parse(
          JSON.parse(await readFile(diagramPath, 'utf8')),
        )
        const diagramValidation = validateDiagram(document)
        if (!diagramValidation.ok)
          errors.push({
            code: 'DIAGRAM_INVALID',
            message: `${entry.name}: ${diagramValidation.issues.join(' ')}`,
          })
      } catch (cause) {
        errors.push({
          code: 'DIAGRAM_INVALID',
          message: `${entry.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
        })
      }
    }
    return {
      deckId: deck.id,
      revision: file.revision,
      valid: errors.length === 0,
      themeId: theme?.manifest.id,
      themeSkillId: theme?.manifest.skill.id,
      themeRuleDigest,
      themeRuleIssues,
      errors,
    }
  }

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    // Script-free resource iframes have opaque origins. Their local webfonts
    // need CORS, so allow only immutable font reads from that sandbox origin.
    const sandboxFont = origin === 'null' && (request.method === 'GET' || request.method === 'HEAD')
      && (/^\/api\/v1\/resources\/assets\/[a-f0-9]+\.woff2(?:\?|$)/.test(request.url) || /^\/api\/v1\/animations\/runtime\.js(?:\?|$)/.test(request.url))
    if (sandboxFont) return
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
          status: statuses.every((entry) => entry.state === 'installed' || entry.state === 'on-demand')
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
      const status = await skillInstaller.ensureTheme(input.harness, theme.id)
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
      throw new RpcError('Session profile was not found', 'SESSION_NOT_FOUND', {
        harness,
        sessionId,
      })
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
      const status = await skillInstaller.ensureTheme(harness, theme.id)
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
      let targetPageContext = ''
      if (sessionProfile?.profile.conversationMode === 'edit-page') {
        const target = sessionProfile.profile.target
        if (!target?.markdownPath || !target.slide) throw new RpcError('Single-page editing requires a Markdown path and slide number', 'INVALID_REQUEST')
        const file = await workspaceFiles.readTextFile(target.markdownPath)
        const page = parseSlidevDocument(file.content)[target.slide - 1]
        if (!page) throw new RpcError('Target slide no longer exists', 'INVALID_REQUEST')
        targetPageContext = `<fastppt-target-page>\n${JSON.stringify({ path: file.path, slide: target.slide, revision: file.revision, source: page.raw })}\n</fastppt-target-page>\n\n`
      }
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
        const skillStatus = await installerSnapshot.ensureTheme(
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
          content: `${RESOURCE_AUTHORING_GUIDANCE}\n\n${ANIMATION_AUTHORING_GUIDANCE}\n\n${PALETTE_AUTHORING_GUIDANCE}\n\n${sessionProfile ? sessionBrief(sessionProfile.profile) + '\n\n' : ''}${targetPageContext}${input.content}`,
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

  const isApprovedImportedTheme = (themeId: string): boolean =>
    Boolean(database.getAppSetting(`pptx-import-approved:${themeId}`)) ||
    (!database.getAppSetting(`pptx-import-pending:${themeId}`) &&
      !database.getLatestPptxImportJob(themeId))

  registerResourceRoutes(app)
  registerAnimationRoutes(app)
  registerPaletteRoutes(app, async (harness, prompt) => {
    const release = runLimiter.acquire(harness)
    const adapter = harnesses[harness]
    let timeout: ReturnType<typeof setTimeout> | undefined
    let sessionId: string | undefined
    let completed = false
    try {
      const session = await adapter.createSession({ cwd: workspace.root, title: '画盘配色推荐' })
      sessionId = session.sessionId
      const collect = async (): Promise<string> => {
        let text = ''
        for await (const event of adapter.sendMessage({ sessionId: session.sessionId, cwd: workspace.root, content: prompt, attachments: [], skills: [] })) {
          const data = event.data as { delta?: unknown; content?: unknown; message?: { content?: unknown } }
          if (event.type === 'assistant.delta' && typeof data.delta === 'string') text += data.delta
          if (event.type === 'assistant.message') {
            const content = data.content ?? data.message?.content
            if (typeof content === 'string') text = content
          }
          if (text.length > 64000) throw new Error('配色推荐结果过长，请缩小需求后重试。')
          if (event.type === 'run.failed' || event.type === 'run.cancelled') throw new Error('模型未完成配色推荐，请重试。')
          if (event.type === 'approval.requested') throw new Error('模型请求了额外操作，请重试配色推荐。')
        }
        completed = true
        return text
      }
      return await Promise.race([collect(), new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('配色推荐超时，请重试。')), 90000)
      })])
    } finally {
      clearTimeout(timeout)
      if (!completed && sessionId) await adapter.cancelRun({ sessionId }).catch(() => undefined)
      release()
    }
  })

  app.get('/api/v1/themes', () =>
    z
      .array(ThemeSummarySchema)
      .parse(
        themeRegistry.themes
          .filter((theme) => isApprovedImportedTheme(theme.manifest.id))
          .map((theme) => themeSummary(themeRegistry, theme.manifest.id)),
      ),
  )

  app.post('/api/v1/themes/rescan', async () => await reloadThemeRegistry())

  type ThemeImportStatus = z.infer<typeof ImportPptxThemeStatusSchema>
  const designStatuses = new Map<string, ThemeImportStatus>()
  const importDrafts = new Map<
    string,
    { jobId: string; themeDir: string; slug: string }
  >()

  const importDraftFor = (themeId: string) => {
    const remembered = importDrafts.get(themeId)
    if (remembered) return remembered
    const job = database.getLatestPptxImportJob(themeId)
    if (!job || job.status === 'approved') return undefined
    const themeDir = join(
      config.workspaceRoot,
      '.fastppt',
      'import-drafts',
      job.id,
      'themes',
      themeId,
    )
    return {
      jobId: job.id,
      themeDir,
      slug: themeId.replace(/^slidev-theme-/, ''),
    }
  }

  const readThemeArtifacts = async (
    themeId: string,
    themesRoot = config.themesRoot,
  ) => {
    const themeDir = join(themesRoot, themeId)
    const manifest = JSON.parse(
      await readFile(join(themeDir, 'agent', 'theme-manifest.json'), 'utf8'),
    ) as { layouts?: Array<{ id: string }> }
    const componentEntries = await import('node:fs/promises').then(
      ({ readdir }) => readdir(join(themeDir, 'components')).catch(() => []),
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

  const recordThemeImportJobStatus = (
    jobId: string | undefined,
    status: 'ready' | 'failed',
  ): void => {
    if (!jobId) return
    try {
      const job = database.getPptxImportJob(jobId)
      if (job)
        database.recordPptxImportJob({
          ...job,
          status,
          updatedAt: new Date().toISOString(),
        })
    } catch (cause) {
      app.log.debug(
        { jobId, cause },
        'Theme import job status was not persisted because the database is unavailable',
      )
    }
  }

  /**
   * Background enrichment: run a harness design session that proposes
   * a complete visual system for the just-imported theme. The agent reads the
   * extraction analysis and submits a structured design contract via
   * `design_theme_system`; completion reloads the registry.
   */
  async function runThemeDesignSession(
    harness: 'claude' | 'codex',
    themeId: string,
    themeDir: string,
    jobId?: string,
  ): Promise<void> {
    const before = await readThemeArtifacts(themeId)
    setThemeImportStatus(themeId, {
      stage: 'designing',
      designing: true,
      ...before,
      message: 'Harness 正在根据提取分析设计特色布局与组件。',
    })
    const skillStatus = await skillInstaller.ensureTheme(harness, themeId)
    const session = await harnesses[harness].createSession({
      cwd: workspace.root,
      title: `Design ${themeId} visual system`,
    })
    const content = [
      `Design a coherent Slidev visual system for the just-imported theme ${themeId}.`,
      `Read the extraction analysis at ${join(themeDir, 'EXTRACTION_ANALYSIS.md')} for the palette, fonts, typography, and suggested layouts/components.`,
      `Treat slide-level explicit colors and their frequencies as stronger evidence than generic Office accent slots. Do not introduce corporate blue or another fallback hue unless the analyzed slides actually use it.`,
      `Infer the source deck's visual grammar: whitespace, alignment, image dominance, numeric emphasis, density, and rhythm. Avoid generic card grids unless the source structure supports them.`,
      `Call the design_theme_system MCP tool exactly once with a complete version 1 design contract. Choose the actual palette, typography, spacing/radius geometry, 3-6 complementary semantic layouts, and 1-5 signature components from the source deck's recurring visual grammar.`,
      `Use the tool's controlled composition and component archetypes, but make the design decisions yourself: give every layout a concrete purpose and semantic regions, and every component a concrete purpose and useful variants. The submitted contract becomes tokens, Vue sources, and the Theme Skill.`,
      `After the design compiles, call create_theme_design_samples for ${themeId}. It writes a five-slide visual-review deck under theme-samples/ that exercises the generated cover, narrative, metrics, media, and closing treatments.`,
      `After both tool calls succeed, your turn is done — do not continue editing.`,
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
    // Consume the agent's turn; design_theme_system materializes the theme files.
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
    if (timedOut)
      throw new Error('Theme design session timed out after 240 seconds.')
    const designed = await readThemeArtifacts(themeId)
    try {
      await access(join(themeDir, 'agent', 'theme-design.json'))
      await access(join(workspace.root, 'theme-samples', `${themeId}.md`))
    } catch {
      throw new Error(
        'Harness completed without materializing a design contract and review deck.',
      )
    }

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
      (status) => status.themeId === themeId && status.state !== 'installed' && status.state !== 'on-demand',
    )
    if (unavailable.length > 0)
      throw new Error(
        `Theme Skill synchronization failed: ${unavailable[0]?.message}`,
      )

    setThemeImportStatus(themeId, {
      stage: 'validating',
      designing: true,
      ...designed,
      message: 'Theme Skill 已同步，正在校验主题结构并准备五页视觉审查样张。',
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
      message:
        '主题提取、设计系统、五页审查样张、Skill 同步与结构校验均已完成。',
    })
    recordThemeImportJobStatus(jobId, 'ready')
    app.log.info(
      { themeId, harness },
      'Theme design session completed; registry reloaded',
    )
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
    if (pptx.byteLength < 4 || pptx[0] !== 0x50 || pptx[1] !== 0x4b) {
      reply.code(400)
      return { error: 'The uploaded file is not a valid PPTX/ZIP package.' }
    }
    const importsDir = join(config.workspaceRoot, '.fastppt', 'import-drafts')
    await mkdir(importsDir, { recursive: true })
    const jobId = randomUUID()
    const draftRoot = join(importsDir, jobId, 'themes')
    await mkdir(draftRoot, { recursive: true })
    const createdAt = new Date().toISOString()
    database.recordPptxImportJob({
      id: jobId,
      themeId: 'pending',
      status: 'upload',
      decisions: [],
      createdAt,
      updatedAt: createdAt,
    })
    const pptxPath = join(importsDir, `${jobId}.pptx`)
    await writeFile(pptxPath, pptx)
    const extractorPath = join(repositoryRoot, 'scripts', 'extract-theme.mjs')
    try {
      const sourceAnalysis = await analyzePptx(pptx)
      const sourceAnalysisPath = join(importsDir, jobId, 'source-analysis.json')
      await writeFile(
        sourceAnalysisPath,
        `${JSON.stringify(sourceAnalysis, null, 2)}\n`,
        'utf8',
      )
      const { slug } = await runThemeExtraction({
        pptxPath,
        analysisPath: sourceAnalysisPath,
        ...(input.themeName !== undefined
          ? { themeName: input.themeName }
          : {}),
        themesRoot: draftRoot,
        extractorPath,
      })
      const themeId = `slidev-theme-${slug}`
      const themeDir = join(draftRoot, themeId)
      await mkdir(join(themeDir, 'reference'), { recursive: true })
      await copyFile(pptxPath, join(themeDir, 'reference', 'source.pptx'))
      importDrafts.set(themeId, { jobId, themeDir, slug })
      database.setAppSetting(`pptx-import-pending:${themeId}`, '1')
      await writeFile(
        join(themeDir, 'IMPORT_ANALYSIS.json'),
        `${JSON.stringify(sourceAnalysis, null, 2)}\n`,
        'utf8',
      )
      const extracted = await readThemeArtifacts(themeId, draftRoot)
      setThemeImportStatus(themeId, {
        stage: 'designing',
        designing: true,
        ...extracted,
        message: '基础主题已提取，准备启动 harness 特色设计。',
      })
      database.recordPptxImportJob({
        id: jobId,
        themeId,
        status: 'ready',
        sourceHash: createHash('sha256').update(pptx).digest('hex'),
        analysisPath: 'IMPORT_ANALYSIS.json',
        decisions: [],
        createdAt,
        updatedAt: new Date().toISOString(),
      })
      setThemeImportStatus(themeId, {
        stage: 'ready',
        designing: false,
        ...extracted,
        message: '基础主题已提取，等待审批后注册。',
      })
      return ImportPptxThemeResultSchema.parse({
        jobId,
        themeId,
        displayName: slug,
        packageName: `slidev-theme-${slug}`,
        skillId: `fastppt-theme-${slug}`,
        version: '0.1.0-extracted.1',
        slug,
        designing: false,
      })
    } catch (cause) {
      database.recordPptxImportJob({
        id: jobId,
        themeId: 'pending',
        status: 'failed',
        decisions: [],
        createdAt,
        updatedAt: new Date().toISOString(),
      })
      reply.code(400)
      return { error: cause instanceof Error ? cause.message : String(cause) }
    } finally {
      await rm(pptxPath, { force: true }).catch(() => undefined)
    }
  })
  app.post('/api/v1/pptx-import/jobs', async (request, reply) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/imports/pptx-theme',
      payload: request.body as Record<string, unknown>,
    })
    reply.code(response.statusCode)
    return response.json<unknown>()
  })

  app.get('/api/v1/imports/pptx-theme/:themeId', async (request) => {
    const { themeId } = z
      .object({ themeId: z.string().min(1) })
      .parse(request.params)
    const current = designStatuses.get(themeId)
    if (current) return current
    const draft = importDraftFor(themeId)
    const artifacts = await readThemeArtifacts(
      themeId,
      draft ? dirname(draft.themeDir) : config.themesRoot,
    )
    return ImportPptxThemeStatusSchema.parse({
      themeId,
      stage: 'ready',
      designing: false,
      ...artifacts,
      message: '主题已就绪。',
    })
  })

  app.get('/api/v1/imports/jobs/:jobId', (request) => {
    const { jobId } = z
      .object({ jobId: z.string().uuid() })
      .parse(request.params)
    const job = database.getPptxImportJob(jobId)
    if (!job)
      throw new WorkspaceError(
        'FILE_NOT_FOUND',
        'PPTX import job not found.',
        404,
      )
    return job
  })
  app.get('/api/v1/pptx-import/jobs/:jobId', (request) => {
    const { jobId } = z
      .object({ jobId: z.string().min(1) })
      .parse(request.params)
    const job = database.getPptxImportJob(jobId)
    if (!job)
      throw new WorkspaceError(
        'WORKSPACE_NOT_FOUND',
        'PPTX import job not found.',
        404,
      )
    return job
  })
  app.get('/api/v1/pptx-import/jobs', () => database.listPptxImportJobs())
  app.get('/api/v1/imports/jobs', (request) => {
    const query = z
      .object({ themeId: z.string().min(1).optional() })
      .parse(request.query)
    return database.listPptxImportJobs(query.themeId)
  })

  app.get('/api/v1/imports/pptx-theme/:themeId/analysis', async (request) => {
    const { themeId } = z
      .object({ themeId: z.string().min(1) })
      .parse(request.params)
    const draft = importDraftFor(themeId)
    const themeDir = draft?.themeDir ?? join(config.themesRoot, themeId)
    const storedAnalysis = await readFile(
      join(themeDir, 'IMPORT_ANALYSIS.json'),
      'utf8',
    ).catch(() => '')
    if (storedAnalysis)
      return withGeneratedCandidates(themeDir, ImportAnalysisV1Schema.parse(JSON.parse(storedAnalysis)))
    const analysisPath = join(themeDir, 'EXTRACTION_ANALYSIS.md')
    const analysisText = await readFile(analysisPath, 'utf8').catch(() => '')
    const artifacts = await readThemeArtifacts(
      themeId,
      draft ? dirname(themeDir) : config.themesRoot,
    )
    const sourceHash = createHash('sha256').update(analysisText).digest('hex')
    return ImportAnalysisV1Schema.parse({
      version: 1,
      sourceHash,
      extractedFeatures: {
        analysisMarkdown: analysisText,
        layouts: artifacts.layouts,
        components: artifacts.components,
      },
      candidateLayouts: artifacts.layouts.map((id) => ({ id, name: id })),
      unsupportedOoxml: analysisText.match(/unsupported[^\n]*/gi) ?? [],
      userOverrides: {},
    })
  })
  const importMutations = new Map<string, Promise<unknown>>()
  async function serializeImportMutation<T>(
    themeId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = importMutations.get(themeId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    importMutations.set(themeId, current)
    try {
      return await current
    } finally {
      if (importMutations.get(themeId) === current)
        importMutations.delete(themeId)
    }
  }
  async function saveImportDecisions(
    themeId: string,
    body: unknown,
    jobId?: string,
  ) {
    return serializeImportMutation(themeId, async () => {
      const decisions = z.array(CreationDecisionV1Schema).parse(body)
      if (decisions.some(item => item.stepId.startsWith('layout:')) &&
          !decisions.some(item => item.stepId.startsWith('layout:') && item.selected === 'keep') &&
          !['tokens', 'mirror', 'reference', 'fidelity'].includes(decisions.find(item => item.stepId === 'strategy')?.selected ?? 'standard'))
        throw new WorkspaceError('INVALID_REQUEST', 'Select at least one materialized layout or choose the tokens route.', 400)
      const draft = importDraftFor(themeId)
      if (!draft)
        throw new WorkspaceError(
          'FILE_NOT_FOUND',
          'Import draft is no longer available.',
          404,
        )
      const job = jobId
        ? database.getPptxImportJob(jobId)
        : database.getLatestPptxImportJob(themeId)
      if (jobId && draft.jobId !== jobId)
        throw new WorkspaceError(
          'INVALID_REQUEST',
          'Import task has been superseded by a newer draft.',
          409,
        )
      if (job?.approvedAt)
        throw new WorkspaceError(
          'INVALID_REQUEST',
          'Approved import decisions are immutable.',
          409,
        )
      if (
        new Set(decisions.map((decision) => decision.stepId)).size !==
        decisions.length
      )
        throw new WorkspaceError(
          'INVALID_REQUEST',
          'Import decision step IDs must be unique.',
          400,
        )
      const previousRaw = database.getAppSetting(
        `pptx-import-decisions:${themeId}`,
      )
      const previous = previousRaw
        ? z.array(CreationDecisionV1Schema).parse(JSON.parse(previousRaw))
        : []
      for (const decision of previous) {
        if (!decision.locked) continue
        const next = decisions.find((item) => item.stepId === decision.stepId)
        if (
          !next ||
          JSON.stringify({ ...next, timestamp: decision.timestamp }) !==
            JSON.stringify(decision)
        )
          throw new WorkspaceError(
            'INVALID_REQUEST',
            `Import decision is locked: ${decision.stepId}`,
            409,
          )
        next.timestamp = decision.timestamp
      }
      const analysisPath = join(draft.themeDir, 'IMPORT_ANALYSIS.json')
      const analysis = ImportAnalysisV1Schema.parse(
        JSON.parse(await readFile(analysisPath, 'utf8')),
      )
      const review = await withGeneratedCandidates(draft.themeDir, analysis)
      const manifest = z.object({ layouts: z.array(z.object({ id: z.string() })) }).parse(JSON.parse(await readFile(join(draft.themeDir, 'agent/theme-manifest.json'), 'utf8')))
      for (const decision of decisions.filter(item => item.stepId.startsWith('layout:') && item.selected === 'keep')) {
        const id = decision.stepId.slice('layout:'.length)
        const candidate = review.candidateLayouts.find(item => item.id === id)
        if ((candidate?.generated && candidate.generated.status !== 'complete') ||
            candidate?.semanticEvidence.some(item => item.kind === 'reachable-layout' && item.value === 'false') ||
            !manifest.layouts.some(layout => layout.id === (candidate?.name ?? id)))
          throw new WorkspaceError('INVALID_REQUEST', `Selected layout is not materialized: ${id}`, 400)
      }
      const pendingPath = `${analysisPath}.tmp`
      await writeFile(
        pendingPath,
        `${JSON.stringify({ ...analysis, userOverrides: { ...analysis.userOverrides, decisions } }, null, 2)}\n`,
        'utf8',
      )
      await rename(pendingPath, analysisPath)
      database.setAppSetting(
        `pptx-import-decisions:${themeId}`,
        JSON.stringify(decisions),
      )
      if (job)
        database.recordPptxImportJob({
          ...job,
          status: 'decide',
          decisions,
          updatedAt: new Date().toISOString(),
        })
      eventHub.publish('pptx-import', 'decisions-updated', {
        ...(jobId ? { jobId } : {}),
        themeId,
        decisions,
      })
      return { ...(jobId ? { jobId } : {}), themeId, decisions }
    })
  }
  app.post('/api/v1/imports/pptx-theme/:themeId/decisions', async (request) => {
    const { themeId } = z
      .object({ themeId: z.string().min(1) })
      .parse(request.params)
    return saveImportDecisions(themeId, request.body)
  })
  app.post('/api/v1/pptx-import/jobs/:jobId/decisions', async (request) => {
    const { jobId } = z
      .object({ jobId: z.string().min(1) })
      .parse(request.params)
    const job = database.getPptxImportJob(jobId)
    if (!job)
      throw new WorkspaceError(
        'WORKSPACE_NOT_FOUND',
        'PPTX import job not found.',
        404,
      )
    return saveImportDecisions(job.themeId, request.body, jobId)
  })
  async function approveThemeImport(themeId: string, jobId?: string) {
    return serializeImportMutation(themeId, async () => {
      const requestedJob = jobId
        ? database.getPptxImportJob(jobId)
        : database.getLatestPptxImportJob(themeId)
      if (requestedJob?.approvedAt)
        return { themeId, approvedAt: requestedJob.approvedAt }
      if (jobId && importDraftFor(themeId)?.jobId !== jobId)
        throw new WorkspaceError(
          'INVALID_REQUEST',
          'Import task has been superseded by a newer draft.',
          409,
        )
      const decisions = database.getAppSetting(
        `pptx-import-decisions:${themeId}`,
      )
      if (!decisions)
        throw new WorkspaceError(
          'INVALID_REQUEST',
          'Save import decisions before approval.',
          409,
        )
      const draft = importDraftFor(themeId)
      if (!draft)
        throw new WorkspaceError(
          'FILE_NOT_FOUND',
          'Import draft is no longer available.',
          404,
        )
      const target = join(config.themesRoot, themeId)
      const parsedDecisions = z
        .array(CreationDecisionV1Schema)
        .parse(JSON.parse(decisions))
      const requestedStrategy =
        parsedDecisions.find((item) => item.stepId === 'strategy')?.selected ??
        'editable'
      const strategy = requestedStrategy
      const route =
        strategy === 'editable'
          ? 'standard'
          : strategy === 'reference'
            ? 'mirror'
            : strategy
      if (
        route !== 'standard' &&
        route !== 'tokens' &&
        route !== 'mirror' &&
        route !== 'fidelity'
      ) {
        throw new WorkspaceError(
          'INVALID_REQUEST',
          'Unsupported PPTX import strategy.',
          400,
        )
      }
      const preserveReferenceDecision =
        parsedDecisions.find((item) => item.stepId === 'preserve-reference')
          ?.selected === 'keep'
      const preserveReference =
        preserveReferenceDecision || route === 'mirror' || route === 'fidelity'
      const selectedLayouts = parsedDecisions
        .filter(
          (item) =>
            item.stepId?.startsWith('layout:') && item.selected === 'keep',
        )
        .map((item) => item.stepId.slice('layout:'.length))
      const hasLayoutSelection = parsedDecisions.some(item => item.stepId.startsWith('layout:'))
      if (hasLayoutSelection && selectedLayouts.length === 0 && route === 'standard')
        throw new WorkspaceError('INVALID_REQUEST', 'Select at least one materialized layout or choose the tokens route.', 400)
      const layoutCandidatesRaw = await readFile(
        join(draft.themeDir, 'agent', 'layout-candidates.json'),
        'utf8',
      ).catch(() => '')
      const layoutCandidates = layoutCandidatesRaw
        ? (JSON.parse(layoutCandidatesRaw) as {
            candidates?: Array<{ id?: string; name?: string }>
          }).candidates ?? []
        : []
      const generatedLayoutBySource = new Map(
        layoutCandidates
          .filter(
            (candidate): candidate is { id: string; name: string } =>
              typeof candidate.id === 'string' &&
              typeof candidate.name === 'string',
          )
          .map((candidate) => [candidate.id, candidate.name]),
      )
      const selectedLayoutNames = selectedLayouts.map(
        (id) => generatedLayoutBySource.get(id) ?? id,
      )
      const draftManifest = z
        .object({ layouts: z.array(z.object({ id: z.string() })) })
        .passthrough()
        .parse(
          JSON.parse(
            await readFile(
              join(draft.themeDir, 'agent', 'theme-manifest.json'),
              'utf8',
            ),
          ),
        )
      if (
        selectedLayoutNames.some(
          (id) => !draftManifest.layouts.some((layout) => layout.id === id),
        )
      )
        throw new WorkspaceError(
          'INVALID_REQUEST',
          'Selected import layout does not exist in the draft.',
          400,
        )
      await installThemeDirectory(
        draft.themeDir,
        target,
        async (candidate) => {
          if (!preserveReference)
            await rm(join(candidate, 'reference'), {
              recursive: true,
              force: true,
            })
          if (hasLayoutSelection || route === 'tokens') {
            const manifestPath = join(candidate, 'agent', 'theme-manifest.json')
            const manifest = JSON.parse(
              await readFile(manifestPath, 'utf8'),
            ) as {
              layouts?: Array<{
                id: string
                label: string
                description?: string
              }>
            }
              const kept =
                manifest.layouts?.filter((layout) =>
                route === 'tokens' || !selectedLayoutNames.length
                  ? ![...generatedLayoutBySource.values()].includes(layout.id)
                  : selectedLayoutNames.includes(layout.id),
              ) ?? []
            if (kept.length)
              await writeFile(
                manifestPath,
                `${JSON.stringify({ ...manifest, layouts: kept }, null, 2)}\n`,
                'utf8',
              )
          }
          if (hasLayoutSelection || route === 'tokens') {
            const definitionPath = join(candidate, 'agent', 'native-layouts.json')
            const raw = await readFile(definitionPath, 'utf8').catch((cause: unknown) => {
              if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return undefined
              throw cause
            })
            if (raw) {
              const definitions = z.array(NativeMasterLayoutSchema).parse(JSON.parse(raw))
              await writeFile(definitionPath, `${JSON.stringify(route === 'tokens' ? [] : definitions.filter(layout => selectedLayoutNames.includes(layout.name)), null, 2)}\n`, 'utf8')
            }
          }
          const manifestPath = join(candidate, 'agent', 'theme-manifest.json')
          const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
            description?: string
            supportedFeatures?: Array<{
              id: string
              label: string
              description: string
            }>
          }
          const strategyMetadata = {
            version: 1,
            strategy,
            route,
            mode:
              route === 'tokens'
                ? 'token-only'
                : route === 'mirror'
                  ? 'mirror'
                  : route === 'fidelity'
                    ? 'fidelity'
                  : 'editable',
            generatedAt: new Date().toISOString(),
            selectedLayoutNames,
            note:
              route === 'tokens'
                ? 'Use this import for colors and fonts; layouts remain as an inspectable extraction but are not intended as a registered design system.'
                : route === 'mirror'
                  ? 'Use the preserved source PPTX as the visual reference; extracted layouts are provided for comparison.'
                  : route === 'fidelity'
                    ? 'Use the source pages as the visual baseline and review every reported degradation before editing.'
                  : 'Editable FastPPT theme generated from the extracted source.',
          }
          await writeFile(
            join(candidate, 'IMPORT_STRATEGY.json'),
            `${JSON.stringify(strategyMetadata, null, 2)}\n`,
            'utf8',
          )
          const feature =
            route === 'tokens'
              ? {
                  id: 'token-only',
                  label: 'Token-only import',
                  description:
                    'Colors and fonts extracted from the source PPTX.',
                }
              : route === 'mirror'
                ? {
                    id: 'reference-only',
                    label: 'Reference import',
                    description:
                      'Source PPTX retained as the visual reference.',
                  }
                : route === 'fidelity'
                  ? {
                      id: 'visual-fidelity-review',
                      label: 'Visual fidelity review',
                      description:
                        'Source pages remain the visual baseline and every known downgrade is recorded.',
                    }
                : undefined
          if (feature) {
            await writeFile(
              manifestPath,
              `${JSON.stringify(
                {
                  ...manifest,
                  description: `${manifest.description ?? 'Imported theme'} (${feature.label})`,
                  ...(manifest.supportedFeatures
                    ? {
                        supportedFeatures: [
                          ...manifest.supportedFeatures,
                          ...(manifest.supportedFeatures.some(
                            (item) => item.id === feature.id,
                          )
                            ? []
                            : [feature]),
                        ],
                      }
                    : {}),
                },
                null,
                2,
              )}\n`,
              'utf8',
            )
          }
          await writeFile(
            join(candidate, 'IMPORT_DECISIONS.json'),
            `${JSON.stringify({ version: 1, strategy, route, preserveReference, preserveReferenceDecision, selectedLayouts, selectedLayoutNames, decisions: parsedDecisions, approvedAt: new Date().toISOString() }, null, 2)}\n`,
            'utf8',
          )
          const ruleReview = await evaluateImportRuleApproval(candidate)
          const ruleReviewJson = `${JSON.stringify(ruleReview, null, 2)}\n`
          await writeFile(join(draft.themeDir, 'IMPORT_RULE_REVIEW.json'), ruleReviewJson, 'utf8')
          await writeFile(join(candidate, 'IMPORT_RULE_REVIEW.json'), ruleReviewJson, 'utf8')
          if (!ruleReview.valid)
            throw new RpcError('Selected import layouts violate the theme rules. Review the reported rules before registration.', 'THEME_RULE_APPROVAL_FAILED', { themeId, ruleReview })
        },
        async () => {
          await reloadThemeRegistry()
          themeRegistry.resolve(themeId)
        },
      )
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
      const recentHarness = database.getAppSetting('recentHarness')
      const designHarness: 'claude' | 'codex' | undefined =
        recentHarness === 'claude' || recentHarness === 'codex'
          ? recentHarness
          : undefined
      const approvedAt = new Date().toISOString()
      database.setAppSetting(`pptx-import-approved:${themeId}`, approvedAt)
      database.setAppSetting(`pptx-import-pending:${themeId}`, '')
      const job = database.getLatestPptxImportJob(themeId)
      if (job)
        database.recordPptxImportJob({
          ...job,
          status: 'approved',
          approvedAt,
          updatedAt: approvedAt,
        })
      eventHub.publish('pptx-import', 'approved', { themeId, approvedAt })
      importDrafts.delete(themeId)
      if (designHarness)
        void runThemeDesignSession(
          designHarness,
          themeId,
          target,
          job?.id,
        ).catch((cause: unknown) => {
          const message = cause instanceof Error ? cause.message : String(cause)
          app.log.warn(
            { themeId, cause: message },
            'Theme design session failed',
          )
        })
      return { themeId, approvedAt }
    })
  }
  app.post('/api/v1/imports/pptx-theme/:themeId/approve', async (request) => {
    const { themeId } = z
      .object({ themeId: z.string().min(1) })
      .parse(request.params)
    return approveThemeImport(themeId)
  })
  app.get('/api/v1/imports/pptx-theme/:themeId/rule-review', async (request) => {
    const { themeId } = z.object({ themeId: z.string().min(1) }).parse(request.params)
    const root = importDraftFor(themeId)?.themeDir ?? themeRegistry.resolve(themeId).packageRoot
    const report = await readFile(join(root, 'IMPORT_RULE_REVIEW.json'), 'utf8').catch((cause: unknown) => {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return undefined
      throw cause
    })
    return report ? ThemeRuleApprovalReportSchema.parse(JSON.parse(report)) : null
  })
  app.post('/api/v1/pptx-import/jobs/:jobId/approve', async (request) => {
    const { jobId } = z
      .object({ jobId: z.string().min(1) })
      .parse(request.params)
    const job = database.getPptxImportJob(jobId)
    if (!job)
      throw new WorkspaceError(
        'WORKSPACE_NOT_FOUND',
        'PPTX import job not found.',
        404,
      )
    return approveThemeImport(job.themeId, jobId)
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
    if (!isApprovedImportedTheme(themeId))
      throw new WorkspaceError(
        'FILE_NOT_FOUND',
        'Theme import is awaiting approval.',
        404,
      )
    return themeSummary(themeRegistry, themeId)
  })

  app.get('/api/v1/themes/:themeId/skill', async (request) => {
    const { themeId } = z
      .object({ themeId: z.string().min(1) })
      .parse(request.params)
    if (!isApprovedImportedTheme(themeId))
      throw new WorkspaceError(
        'FILE_NOT_FOUND',
        'Theme import is awaiting approval.',
        404,
      )
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

  app.get('/api/v1/decks/:deckId/notes', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const deck = await resolveDeck(deckId)
    const stored = await readDeckDocument(
      deckId,
      'notes.json',
      DeckNotesDocumentSchema,
      undefined,
    ).catch(() => undefined)
    if (stored) return stored
    const source = await workspaceFiles.readTextFile(deck.entryFile)
    return DeckNotesDocumentSchema.parse({
      version: 1,
      notes: compileDeck(source.content)
        .filter((slide) => slide.notes.spokenText.trim())
        .map((slide) => slide.notes),
    })
  })
  app.put('/api/v1/decks/:deckId/notes', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    await resolveDeck(deckId)
    const parsed = DeckNotesDocumentSchema.parse(request.body)
    const document = DeckNotesDocumentSchema.parse({
      ...parsed,
      notes: parsed.notes.map((note) => ({
        ...note,
        estimatedSeconds: Math.max(
          note.estimatedSeconds,
          ...note.cues.map((cue) => cue.endSeconds),
          0,
        ),
      })),
    })
    await writeDeckDocument(deckId, 'notes.json', document)
    eventHub.publish('notes', 'updated', {
      deckId,
      revision: (await resolveDeck(deckId)).revision,
      actor: 'user',
    })
    return document
  })
  app.get('/api/v1/decks/:deckId/notes.srt', async (request, reply) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const deck = await resolveDeck(deckId)
    const pages = compileDeck(
      (await workspaceFiles.readTextFile(deck.entryFile)).content,
    )
    const pageOrder = new Map(pages.map((page, index) => [page.slideId, index]))
    const stored = await readDeckDocument(
      deckId,
      'notes.json',
      DeckNotesDocumentSchema,
      { version: 1, notes: [] },
    )
    let offset = 0
    const cues = [...stored.notes]
      .sort(
        (a, b) =>
          (pageOrder.get(a.slideId) ?? Number.MAX_SAFE_INTEGER) -
          (pageOrder.get(b.slideId) ?? Number.MAX_SAFE_INTEGER),
      )
      .flatMap((note) => {
        const pageCues = note.cues.map((cue) => ({
          ...cue,
          startSeconds: cue.startSeconds + offset,
          endSeconds: cue.endSeconds + offset,
        }))
        offset += Math.max(
          note.estimatedSeconds,
          ...note.cues.map((cue) => cue.endSeconds),
          0,
        )
        return pageCues
      })
    return reply
      .header('content-disposition', `attachment; filename="${deckId}.srt"`)
      .type('text/plain; charset=utf-8')
      .send(cuesToSrt(cues))
  })
  app.get('/api/v1/narration/providers', () =>
    NarrationProviderStatusV1Schema.parse({
      version: 1,
      providers: [
        {
          provider: 'edge',
          configured: false,
          timing: 'provider',
          reason: 'Provider adapter is not enabled in this installation.',
        },
        {
          provider: 'elevenlabs',
          configured: false,
          timing: 'provider',
          reason: 'Provider adapter is not enabled in this installation.',
        },
        {
          provider: 'minimax',
          configured: false,
          timing: 'none',
          reason: 'Provider adapter is not enabled in this installation.',
        },
        {
          provider: 'qwen',
          configured: false,
          timing: 'none',
          reason: 'Provider adapter is not enabled in this installation.',
        },
        {
          provider: 'cosyvoice',
          configured: false,
          timing: 'provider',
          reason: 'Provider adapter is not enabled in this installation.',
        },
      ],
    }),
  )
  app.get('/api/v1/decks/:deckId/animations', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    await resolveDeck(deckId)
    return DeckAnimationsDocumentSchema.parse(
      await readDeckDocument(
        deckId,
        'animations.json',
        DeckAnimationsDocumentSchema,
        { version: 1, animations: [] },
      ),
    )
  })
  app.put('/api/v1/decks/:deckId/animations', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    await resolveDeck(deckId)
    const document = DeckAnimationsDocumentSchema.parse(request.body)
    for (const animation of document.animations) {
      for (const group of animation.groups)
        for (const effect of group.effects) {
          if (effect.durationMs <= 0 || effect.delayMs < 0)
            throw new WorkspaceError(
              'INVALID_REQUEST',
              'Animation timing must be non-negative.',
              400,
            )
        }
    }
    await writeDeckDocument(deckId, 'animations.json', document)
    eventHub.publish('animation', 'updated', {
      deckId,
      revision: (await resolveDeck(deckId)).revision,
      actor: 'user',
    })
    return document
  })
  app.get('/api/v1/decks/:deckId/diagrams/:diagramId', async (request) => {
    const { deckId, diagramId } = z
      .object({
        deckId: z.string().min(1),
        diagramId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
      })
      .parse(request.params)
    await resolveDeck(deckId)
    return DiagramDocumentV1Schema.parse(
      await readDeckDocument(
        deckId,
        `diagrams/${diagramId}.json`,
        DiagramDocumentV1Schema,
        {
          version: 1,
          kind: 'flowchart',
          nodes: [],
          edges: [],
          tasks: [],
          style: {
            width: 1200,
            height: 700,
            direction: 'lr',
            fontFamily: 'Arial',
          },
          acceptedRevision: 0,
        },
      ),
    )
  })
  app.put('/api/v1/decks/:deckId/diagrams/:diagramId', async (request) => {
    const { deckId, diagramId } = z
      .object({
        deckId: z.string().min(1),
        diagramId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
      })
      .parse(request.params)
    await resolveDeck(deckId)
    const document = DiagramDocumentV1Schema.parse(
      PutDiagramDocumentSchema.parse(request.body).document,
    )
    const result = validateDiagram(document)
    if (!result.ok)
      throw new WorkspaceError('INVALID_REQUEST', result.issues.join(' '), 400)
    await writeDeckDocument(deckId, `diagrams/${diagramId}.json`, document)
    const svgPath = deckDocumentPath(
      deckId,
      `assets/generated/${diagramId}.svg`,
    )
    await mkdir(dirname(svgPath), { recursive: true })
    await writeFile(svgPath, renderDiagram(document), 'utf8')
    eventHub.publish('diagram', 'updated', {
      deckId,
      diagramId,
      revision: (await resolveDeck(deckId)).revision,
      actor: 'user',
    })
    return document
  })
  app.post(
    '/api/v1/decks/:deckId/diagrams/:diagramId/insert',
    async (request) => {
      const { deckId, diagramId } = z
        .object({
          deckId: z.string().min(1),
          diagramId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
        })
        .parse(request.params)
      const input = z
        .object({
          alt: z.string().min(1).max(120).optional(),
          expectedRevision: z.string().min(1).optional(),
        })
        .parse(request.body ?? {})
      const deck = await resolveDeck(deckId)
      const document = DiagramDocumentV1Schema.parse(
        await readDeckDocument(
          deckId,
          `diagrams/${diagramId}.json`,
          DiagramDocumentV1Schema,
          undefined,
        ),
      )
      const svg = renderDiagram(document)
      const directory = posix.dirname(deck.entryFile.replaceAll('\\', '/'))
      const assetPath = `${directory === '.' ? '' : `${directory}/`}assets/generated/${diagramId}.svg`
      await workspaceFiles.writeTextFile({ path: assetPath, content: svg })
      const file = await workspaceFiles.readTextFile(deck.entryFile)
      const reference = `./assets/generated/${diagramId}.svg`
      if (!file.content.includes(`](${reference})`)) {
        const alt = (input.alt ?? `Diagram ${diagramId}`).replace(
          /[[\]\n\r]/g,
          ' ',
        )
        await workspaceFiles.writeTextFile({
          path: deck.entryFile,
          content: `${file.content.trimEnd()}\n\n<!-- fastppt-diagram:${diagramId} -->\n![${alt}](${reference})\n`,
          expectedRevision: input.expectedRevision ?? file.revision,
        })
      }
      eventHub.publish('diagram', 'inserted', {
        deckId,
        diagramId,
        assetPath,
        actor: 'user',
      })
      return { deckId, diagramId, assetPath, inserted: true }
    },
  )
  app.get('/api/v1/decks/:deckId/export-capabilities', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const deck = await resolveDeck(deckId)
    const animations = await readDeckDocument(
      deckId,
      'animations.json',
      DeckAnimationsDocumentSchema,
      { version: 1, animations: [] },
    )
    const master = deck.themeId
      ? themeRegistry.resolve(deck.themeId)
      : undefined
    const lockedMaster = await readDeckDocument(
      deckId,
      'theme-lock.json',
      MasterSnapshotV1Schema,
    ).catch(() => undefined)
    const themeChanged = Boolean(
      lockedMaster && master && lockedMaster.digest !== master.contentDigest,
    )
    const masterCapability = themeChanged ? 'unsupported' : 'partial'
    const notes = await readDeckDocument(
      deckId,
      'notes.json',
      DeckNotesDocumentSchema,
      { version: 1, notes: [] },
    )
    const diagramsRoot = deckDocumentPath(deck.id, 'diagrams')
    const diagramFiles = await readdir(diagramsRoot, {
      withFileTypes: true,
    }).catch(() => [])
    const diagramKinds = await Promise.all(
      diagramFiles
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(
          async (entry) =>
            DiagramDocumentV1Schema.parse(
              JSON.parse(
                await readFile(join(diagramsRoot, entry.name), 'utf8'),
              ),
            ).kind,
        ),
    )
    const unsupportedDiagramKinds = diagramKinds.filter(
      (kind) =>
        !['flowchart', 'org-chart', 'gantt', 'timeline', 'matrix'].includes(
          kind,
        ),
    )
    const diagramCapability = unsupportedDiagramKinds.length
      ? 'partial'
      : 'supported'
    const hasCues = notes.notes.some((note) =>
      note.cues.some(
        (cue) => cue.text.trim() && cue.endSeconds > cue.startSeconds,
      ),
    )
    const report = ExportCapabilityReportSchema.parse({
      version: 1,
      deckRevision: deck.revision,
      themeDigest: master?.contentDigest,
      capabilities: {
        pages: 'supported',
        notes: 'supported',
        narration_srt: hasCues ? 'supported' : 'partial',
        narration_audio: 'unsupported',
        animations: animations.animations.length ? 'partial' : 'supported',
        master: masterCapability,
        diagrams: diagramCapability,
      },
      warnings: [
        'Explicit native layouts preserve placeholder geometry; layouts without definitions share seed geometry. Content placeholder binding and full style inheritance remain incomplete.',
        ...(hasCues
          ? []
          : ['No valid narration cues are saved; SRT export will be empty.']),
        'Narration audio requires a configured provider; notes and SRT remain available offline.',
        ...(animations.animations.length
          ? [
              'Some object animation effects may require PowerPoint-specific timing support.',
            ]
          : []),
        ...(lockedMaster?.unsupported.length
          ? lockedMaster.unsupported.map(
              (item) => `Master limitation: ${item}.`,
            )
          : []),
        ...(unsupportedDiagramKinds.length
          ? [
              `${[...new Set(unsupportedDiagramKinds)].join(', ')} diagrams remain SVG assets; flowchart, org-chart, gantt, timeline, and matrix are expanded into editable native shapes.`,
            ]
          : []),
        ...(themeChanged
          ? [
              'Registered theme changed after theme-lock snapshot; refresh the master snapshot before export.',
            ]
          : []),
      ],
      blocks: themeChanged ? ['THEME_LOCK_STALE'] : [],
    })
    database.setAppSetting(
      `export-capabilities:${deckId}`,
      JSON.stringify({ savedAt: new Date().toISOString(), report }),
    )
    return report
  })
  app.get(
    '/api/v1/decks/:deckId/export-capabilities/history',
    async (request) => {
      const { deckId } = z
        .object({ deckId: z.string().min(1) })
        .parse(request.params)
      await resolveDeck(deckId)
      const raw = database.getAppSetting(`export-capabilities:${deckId}`)
      if (!raw) return { deckId, report: null, savedAt: null }
      try {
        const parsed = z
          .object({
            savedAt: z.iso.datetime(),
            report: ExportCapabilityReportSchema,
          })
          .parse(JSON.parse(raw))
        return { deckId, ...parsed }
      } catch {
        return { deckId, report: null, savedAt: null }
      }
    },
  )
  app.get('/api/v1/decks/:deckId/master', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const deck = await resolveDeck(deckId)
    if (!deck.themeId)
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'Deck has no registered theme.',
        400,
      )
    const theme = themeRegistry.resolve(deck.themeId)
    const css = await readFile(
      join(theme.packageRoot, 'styles', 'layout.css'),
      'utf8',
    ).catch(() => '')
    const fonts = [
      ...new Set(
        [
          ...css.matchAll(
            /(?:font-family|--[\w-]*font[\w-]*)\s*:\s*([^;]+);/gi,
          ),
        ].flatMap((match) =>
          (match[1] ?? '')
            .split(',')
            .map((font) => font.trim().replace(/^['"]|['"]$/g, ''))
            .filter(
              (font) =>
                font &&
                !/^(sans-serif|serif|monospace|inherit)$/i.test(font) &&
                !/^var\(/i.test(font),
            ),
        ),
      ),
    ]
    const colors = Object.fromEntries(
      [
        ...css.matchAll(
          /(--[\w-]*(?:color|blue|red|green|accent|text)[\w-]*)\s*:\s*(#[0-9a-f]{3,8})\b/gi,
        ),
      ].map((match) => [match[1]!, match[2]!.toUpperCase()]),
    )
    let layoutDefinitions:
      z.infer<typeof NativeMasterLayoutSchema>[] | undefined
    try {
      layoutDefinitions = z
        .array(NativeMasterLayoutSchema)
        .parse(
          JSON.parse(
            await readFile(
              join(theme.packageRoot, 'agent', 'native-layouts.json'),
              'utf8',
            ),
          ),
        )
    } catch (cause) {
      if (!(
        cause instanceof Error &&
        'code' in cause &&
        cause.code === 'ENOENT'
      ))
        throw cause
    }
    const masterGroups = new Map<string, string[]>()
    for (const name of new Set([
      ...theme.manifest.layouts.map((layout) => layout.id),
      ...(layoutDefinitions?.map((layout) => layout.name) ?? []),
    ])) {
      const masterId =
        layoutDefinitions?.find((layout) => layout.name === name)?.masterId ??
        'default'
      masterGroups.set(masterId, [...(masterGroups.get(masterId) ?? []), name])
    }
    const snapshot = MasterSnapshotV1Schema.parse({
      version: 1,
      themeId: theme.manifest.id,
      digest: theme.contentDigest,
      fonts,
      colors,
      masters: [...masterGroups].map(([id, layouts]) => ({
        id,
        layouts,
        placeholders: ['title', 'content'],
      })),
      ...(layoutDefinitions?.length ? { layoutDefinitions } : {}),
      unsupported: [],
    })
    await writeDeckDocument(deckId, 'theme-lock.json', snapshot)
    return snapshot
  })
  const identityInitializations = new Map<
    string,
    Promise<{
      deckId: string
      revision: string
      slides: ReturnType<typeof compileDeck>
    }>
  >()
  app.post('/api/v1/decks/:deckId/identities', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const pending = identityInitializations.get(deckId)
    if (pending) return pending
    const task = (async () => {
      const deck = await resolveDeck(deckId)
      const source = await workspaceFiles.readTextFile(deck.entryFile)
      const content = persistDeckIdentities(
        source.content,
        () => `slide-${randomUUID()}`,
      )
      const file =
        content === source.content
          ? source
          : await workspaceFiles.writeTextFile({
              path: deck.entryFile,
              content,
              expectedRevision: source.revision,
            })
      return {
        deckId,
        revision: file.revision,
        slides: await compileWithThemeAnchors(deck, file.content),
      }
    })()
    identityInitializations.set(deckId, task)
    try {
      return await task
    } finally {
      identityInitializations.delete(deckId)
    }
  })
  app.get('/api/v1/decks/:deckId/ir', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const deck = await resolveDeck(deckId)
    const source = await workspaceFiles.readTextFile(deck.entryFile)
    return {
      deckId,
      revision: source.revision,
      motionPreset: deck.themeId
        ? (themeRegistry.resolve(deck.themeId).manifest.motionPreset ??
          'static')
        : 'static',
      slides: await compileWithThemeAnchors(deck, source.content),
    }
  })
  app.post('/api/v1/diagrams/validate', (request) => {
    const document = DiagramDocumentV1Schema.parse(
      PutDiagramDocumentSchema.parse(request.body).document,
    )
    return validateDiagram(document)
  })
  app.post('/api/v1/diagrams/render', (request) => {
    const document = DiagramDocumentV1Schema.parse(
      PutDiagramDocumentSchema.parse(request.body).document,
    )
    const result = validateDiagram(document)
    if (!result.ok)
      throw new WorkspaceError('INVALID_REQUEST', result.issues.join(' '), 400)
    return { svg: renderDiagram(document) }
  })
  app.post('/api/v1/creation-wizards', () => {
    const id = randomUUID()
    const wizard = CreationWizardSchema.parse({
      id,
      version: 1,
      status: 'draft',
      currentStep: 'task',
      decisions: [],
      updatedAt: new Date().toISOString(),
    })
    database.setAppSetting(`creation-wizard:${id}`, JSON.stringify(wizard))
    eventHub.publish('creation-wizard', 'created', wizard)
    return wizard
  })
  app.get('/api/v1/creation-wizards/:wizardId', (request) => {
    const { wizardId } = z
      .object({ wizardId: z.string().min(1) })
      .parse(request.params)
    const raw = database.getAppSetting(`creation-wizard:${wizardId}`)
    if (!raw)
      throw new WorkspaceError(
        'FILE_NOT_FOUND',
        `Creation wizard not found: ${wizardId}`,
        404,
      )
    return CreationWizardSchema.parse(JSON.parse(raw))
  })
  app.patch('/api/v1/creation-wizards/:wizardId/steps', (request) => {
    const { wizardId } = z
      .object({ wizardId: z.string().min(1) })
      .parse(request.params)
    const raw = database.getAppSetting(`creation-wizard:${wizardId}`)
    if (!raw)
      throw new WorkspaceError(
        'FILE_NOT_FOUND',
        `Creation wizard not found: ${wizardId}`,
        404,
      )
    const current = CreationWizardSchema.parse(JSON.parse(raw))
    if (current.status !== 'draft')
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'Committed creation decisions are immutable.',
        409,
      )
    const input = z
      .object({
        currentStep: z.string().min(1).optional(),
        decision: CreationDecisionV1Schema.optional(),
      })
      .parse(request.body)
    if (input.decision) {
      const existing = current.decisions.find(
        (decision) => decision.stepId === input.decision?.stepId,
      )
      if (
        existing?.locked &&
        JSON.stringify(existing) !== JSON.stringify(input.decision)
      )
        throw new WorkspaceError(
          'INVALID_REQUEST',
          `Creation decision is locked: ${existing.stepId}`,
          409,
        )
    }
    const wizard = CreationWizardSchema.parse({
      ...current,
      currentStep: input.currentStep ?? current.currentStep,
      decisions: input.decision
        ? [
            ...current.decisions.filter(
              (d) => d.stepId !== input.decision?.stepId,
            ),
            input.decision,
          ]
        : current.decisions,
      updatedAt: new Date().toISOString(),
    })
    database.setAppSetting(
      `creation-wizard:${wizardId}`,
      JSON.stringify(wizard),
    )
    eventHub.publish('creation-wizard', 'updated', wizard)
    return wizard
  })
  app.post('/api/v1/creation-wizards/:wizardId/commit', (request) => {
    const { wizardId } = z
      .object({ wizardId: z.string().min(1) })
      .parse(request.params)
    const raw = database.getAppSetting(`creation-wizard:${wizardId}`)
    if (!raw)
      throw new WorkspaceError(
        'FILE_NOT_FOUND',
        `Creation wizard not found: ${wizardId}`,
        404,
      )
    const current = CreationWizardSchema.parse(JSON.parse(raw))
    if (current.status === 'committed') return current
    if (current.status !== 'draft')
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'Only draft wizards can be committed.',
        409,
      )
    const wizard = CreationWizardSchema.parse({
      ...current,
      status: 'committed',
      profileDigest: createHash('sha256')
        .update(JSON.stringify(current.decisions))
        .digest('hex'),
      updatedAt: new Date().toISOString(),
    })
    database.setAppSetting(
      `creation-wizard:${wizardId}`,
      JSON.stringify(wizard),
    )
    eventHub.publish('creation-wizard', 'committed', wizard)
    return wizard
  })

  app.get('/api/v1/decks/:deckId/image-runs', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    await resolveDeck(deckId)
    return z.array(ImageRunSchema).parse(database.listImageRuns(deckId))
  })

  app.post('/api/v1/decks/:deckId/image-runs', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const input = CreateImageRunRequestSchema.parse(request.body)
    const deck = await resolveDeck(deckId)
    for (const assetId of input.inputAssetIds) {
      const asset = database.getImageAsset(assetId)
      if (!asset || asset.deckId !== deck.id)
        throw new WorkspaceError(
          'FILE_NOT_FOUND',
          `Image input asset is unavailable: ${assetId}`,
          404,
        )
    }
    const now = new Date().toISOString()
    const imageRun = ImageRunSchema.parse({
      id: randomUUID(),
      deckId: deck.id,
      deckRevision: deck.revision,
      slide: input.slide,
      purpose: input.purpose,
      prompt: input.prompt,
      status: 'draft',
      inputAssetIds: input.inputAssetIds,
      createdAt: now,
      updatedAt: now,
    })
    database.recordImageRun(imageRun)
    eventHub.publish(`deck:${deck.id}`, 'image.run.created', imageRun)
    eventHub.publish('workspace', 'image.run.created', imageRun)
    return imageRun
  })

  app.get('/api/v1/image-runs/:imageRunId', (request) => {
    const { imageRunId } = z
      .object({ imageRunId: z.string().uuid() })
      .parse(request.params)
    const imageRun = database.getImageRun(imageRunId)
    if (!imageRun)
      throw new WorkspaceError('FILE_NOT_FOUND', 'Image run not found.', 404)
    return ImageRunSchema.parse(imageRun)
  })

  app.get('/api/v1/decks/:deckId/image-assets', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    await resolveDeck(deckId)
    return z.array(ImageAssetSchema).parse(database.listImageAssets(deckId))
  })

  app.post('/api/v1/decks/:deckId/image-assets', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const input = RegisterImageAssetRequestSchema.parse(request.body)
    const deck = await resolveDeck(deckId)
    const absolutePath = await resolveExistingPath(
      workspaceFiles.root,
      input.path,
    )
    const bytes = await readFile(absolutePath)
    const mediaType = imageMediaType(input.path, bytes)
    let imageRun
    if (input.runId) {
      imageRun = database.getImageRun(input.runId)
      if (!imageRun || imageRun.deckId !== deck.id)
        throw new WorkspaceError('FILE_NOT_FOUND', 'Image run not found.', 404)
      if (!['draft', 'candidate-ready'].includes(imageRun.status))
        throw new WorkspaceError(
          'INVALID_REQUEST',
          'Image run is no longer accepting candidates.',
          409,
        )
    }
    const imageAsset = ImageAssetSchema.parse({
      id: randomUUID(),
      deckId: deck.id,
      ...(input.runId ? { runId: input.runId } : {}),
      path: input.path.replaceAll('\\', '/'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mediaType,
      source: input.source,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.license ? { license: input.license } : {}),
      ...(input.attribution ? { attribution: input.attribution } : {}),
      status: 'candidate',
      accepted: false,
      createdAt: new Date().toISOString(),
    })
    database.recordImageAsset(imageAsset)
    if (imageRun) {
      const updatedRun = ImageRunSchema.parse({
        ...imageRun,
        status: 'candidate-ready',
        updatedAt: new Date().toISOString(),
      })
      database.recordImageRun(updatedRun)
      eventHub.publish(
        `deck:${deck.id}`,
        'image.run.candidate-ready',
        updatedRun,
      )
    }
    eventHub.publish(`deck:${deck.id}`, 'image.asset.registered', imageAsset)
    eventHub.publish('workspace', 'image.asset.registered', imageAsset)
    return imageAsset
  })

  app.post('/api/v1/image-assets/:imageAssetId/decision', (request) => {
    const { imageAssetId } = z
      .object({ imageAssetId: z.string().uuid() })
      .parse(request.params)
    const { accepted } = z.object({ accepted: z.boolean() }).parse(request.body)
    const asset = database.getImageAsset(imageAssetId)
    if (!asset)
      throw new WorkspaceError('FILE_NOT_FOUND', 'Image asset not found.', 404)
    const imageRun = asset.runId ? database.getImageRun(asset.runId) : undefined
    if (asset.runId && !imageRun)
      throw new WorkspaceError('FILE_NOT_FOUND', 'Image run not found.', 404)
    if (asset.status !== 'candidate')
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'Image candidate has already received a final decision.',
        409,
      )
    if (imageRun && imageRun.status !== 'candidate-ready')
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'Image run is no longer accepting decisions.',
        409,
      )
    const updatedAsset = ImageAssetSchema.parse({
      ...asset,
      status: accepted ? 'accepted' : 'rejected',
      accepted,
    })
    database.recordImageAsset(updatedAsset)
    if (imageRun) {
      const updatedRun = ImageRunSchema.parse({
        ...imageRun,
        status: accepted ? 'accepted' : 'candidate-ready',
        updatedAt: new Date().toISOString(),
      })
      database.recordImageRun(updatedRun)
      eventHub.publish(
        `deck:${updatedRun.deckId}`,
        accepted ? 'image.asset.accepted' : 'image.asset.rejected',
        { imageRun: updatedRun, imageAsset: updatedAsset },
      )
    }
    eventHub.publish(
      'workspace',
      accepted ? 'image.asset.accepted' : 'image.asset.rejected',
      updatedAsset,
    )
    return updatedAsset
  })

  app.post('/api/v1/decks/:deckId/validate', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    return DeckValidationResultSchema.parse(
      await validateDeck(await resolveDeck(deckId)),
    )
  })

  const reviewRuleExceptions = async (deck: DeckSummary, input: ThemeRuleExceptionContextRequest) => {
    const binding = await currentRuleBinding(deck, input.profileDigest, input.options)
    let issues: ThemeRuleIssue[]
    if (input.phase === 'readback') {
      const job = input.exportId ? exportManager.get(input.exportId) : undefined
      if (!job || job.deckId !== deck.id || !['failed', 'completed', 'review-required'].includes(job.status) || !job.themeRules?.binding || !job.themeRules.readback || job.themeRules.readback.error)
        throw new RpcError('A completed rule readback report is required; artifact integrity failures cannot be excepted.', 'INVALID_REQUEST')
      if (!sameRuleBinding(binding, job.themeRules.binding)) throw new RpcError('The exported report is stale. Export the current deck before granting a readback exception.', 'THEME_RULE_EXCEPTION_STALE')
      issues = job.themeRules.readback.issues
    } else {
      issues = (await validateDeck(deck, { phase: 'export', profileDigest: input.profileDigest, master: input.options.master, exportOptions: input.options, applyExceptions: false })).themeRuleIssues
    }
    if (!sameRuleBinding(binding, await currentRuleBinding(deck, input.profileDigest, input.options))) throw new RpcError('The deck changed while checking rule evidence. Review it again.', 'THEME_RULE_EXCEPTION_STALE')
    const entries = await ruleExceptionStore.list(deck.id)
    return ThemeRuleExceptionReviewSchema.parse({
      binding, phase: input.phase,
      issues: applyRuleExceptions(issues, entries, binding, input.phase).map(issue => ({ fingerprint: ruleIssueFingerprint(issue), issue })),
      entries: entries.map(exception => ({ exception, state: ruleExceptionState(exception, binding) })),
    })
  }
  app.post('/api/v1/decks/:deckId/rule-exceptions/review', async request => {
    const { deckId } = z.object({ deckId: z.string().min(1) }).parse(request.params)
    return reviewRuleExceptions(await resolveDeck(deckId), ThemeRuleExceptionContextRequestSchema.parse(request.body ?? {}))
  })
  app.post('/api/v1/decks/:deckId/rule-exceptions', async request => {
    const { deckId } = z.object({ deckId: z.string().min(1) }).parse(request.params)
    const input = ApproveThemeRuleExceptionSchema.parse(request.body)
    return ThemeRuleExceptionSchema.parse(await ruleExceptionStore.approve(deckId, async () => {
      const review = await reviewRuleExceptions(await resolveDeck(deckId), input)
      if (!sameRuleBinding(review.binding, input.expectedBinding)) throw new RpcError('The rule context changed. Review the current issue before granting an exception.', 'THEME_RULE_EXCEPTION_STALE')
      const found = review.issues.find(entry => entry.fingerprint === input.issueFingerprint)
      if (!found) throw new RpcError('The requested rule issue is not present in the current evidence.', 'INVALID_REQUEST')
      return { binding: review.binding, phase: input.phase, issue: found.issue, reason: input.reason }
    }))
  })
  app.post('/api/v1/decks/:deckId/rule-exceptions/:exceptionId/revoke', async request => {
    const { deckId, exceptionId } = z.object({ deckId: z.string().min(1), exceptionId: z.string().uuid() }).parse(request.params)
    await resolveDeck(deckId)
    if (!(await ruleExceptionStore.list(deckId)).some(entry => entry.id === exceptionId)) throw new WorkspaceError('FILE_NOT_FOUND', 'Rule exception not found.', 404)
    return ThemeRuleExceptionSchema.parse(await ruleExceptionStore.revoke(deckId, exceptionId))
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
    const exportSource = await workspaceFiles.readTextFile(deck.entryFile)
    const exportSlides = compileDeck(exportSource.content)
    const notesDocument =
      input.options?.notes === false
        ? undefined
        : await (async () => {
            const stored = await readDeckDocument(
              deckId,
              'notes.json',
              DeckNotesDocumentSchema,
              undefined,
            ).catch(() => undefined)
            if (stored) return stored
            const source = await workspaceFiles.readTextFile(deck.entryFile)
            return DeckNotesDocumentSchema.parse({
              version: 1,
              notes: compileDeck(source.content)
                .filter((slide) => slide.notes.spokenText.trim())
                .map((slide) => slide.notes),
            })
          })()
    const animationsDocument =
      input.options?.animations === false
        ? undefined
        : await readDeckDocument(
            deckId,
            'animations.json',
            DeckAnimationsDocumentSchema,
            { version: 1, animations: [] },
          )
    if (animationsDocument) {
      const sourceContent = await workspaceFiles.readTextFile(deck.entryFile)
      const bySlide = new Map(compileDeck(sourceContent.content).map(slide => [slide.slideId, slide.animation]))
      for (const animation of animationsDocument.animations) bySlide.set(animation.slideId, animation)
      animationsDocument.animations = [...bySlide.values()]
    }
    const nativeDiagrams =
      input.options?.diagrams === false
        ? []
        : await (async () => {
            const root = deckDocumentPath(deckId, 'diagrams')
            const entries = await readdir(root, { withFileTypes: true }).catch(
              () => [],
            )
            const markdown = (await workspaceFiles.readTextFile(deck.entryFile))
              .content
            const pages = compileDeck(markdown).map((slide) => slide.markdown)
            return (
              await Promise.all(
                entries
                  .filter(
                    (entry) => entry.isFile() && entry.name.endsWith('.json'),
                  )
                  .map(async (entry) => {
                    const diagramId = entry.name.slice(0, -'.json'.length)
                    const document = DiagramDocumentV1Schema.parse(
                      JSON.parse(
                        await readFile(join(root, entry.name), 'utf8'),
                      ),
                    )
                    if (
                      ![
                        'flowchart',
                        'org-chart',
                        'gantt',
                        'timeline',
                        'matrix',
                      ].includes(document.kind)
                    )
                      return undefined
                    const marker = `fastppt-diagram:${diagramId}`
                    const fallback = `assets/generated/${diagramId}.svg`
                    const slide =
                      pages.findIndex(
                        (page) =>
                          page.includes(marker) || page.includes(fallback),
                      ) + 1
                    if (slide === 0) return undefined
                    return {
                      slide,
                      diagramId,
                      document: {
                        kind: document.kind,
                        style: document.style,
                        nodes: document.nodes.map((node) => ({
                          id: node.id,
                          label: node.label,
                          ...(node.x === undefined ? {} : { x: node.x }),
                          ...(node.y === undefined ? {} : { y: node.y }),
                          ...(node.color === undefined
                            ? {}
                            : { color: node.color }),
                        })),
                        edges: document.edges.map((edge) => ({
                          from: edge.from,
                          to: edge.to,
                          ...(edge.label === undefined
                            ? {}
                            : { label: edge.label }),
                        })),
                        ...(['gantt', 'timeline'].includes(document.kind)
                          ? {
                              tasks: document.tasks.map((task) => ({
                                id: task.id,
                                label: task.label,
                                start: task.start,
                                end: task.end,
                              })),
                            }
                          : {}),
                      },
                    }
                  }),
              )
            ).filter(
              (entry): entry is NonNullable<typeof entry> =>
                entry !== undefined,
            )
          })()
    const validation = await validateDeck(deck, { phase: 'export', profileDigest: input.profileDigest ?? null, exportOptions: input.options, ...(input.options?.master === undefined ? {} : { master: input.options.master }) })
    if (!validation.valid)
      throw new RpcError(
        'Deck validation found blocking issues. Fix them before export.',
        'DECK_VALIDATION_FAILED',
        { deckId, revision: deck.revision, errors: validation.errors, themeRuleIssues: validation.themeRuleIssues },
      )
    const currentMaster = deck.themeId
      ? themeRegistry.resolve(deck.themeId)
      : undefined
    const lockedMaster = await readDeckDocument(
      deckId,
      'theme-lock.json',
      MasterSnapshotV1Schema,
    ).catch(() => undefined)
    if (
      lockedMaster &&
      currentMaster &&
      lockedMaster.digest !== currentMaster.contentDigest
    )
      throw new RpcError(
        'The registered theme changed after the master snapshot was locked. Refresh the master snapshot before export.',
        'THEME_LOCK_STALE',
        {
          deckId,
          expectedDigest: currentMaster.contentDigest,
          lockedDigest: lockedMaster.digest,
        },
      )
    const availableLayouts = new Set([
      ...(lockedMaster?.masters.flatMap((master) => master.layouts) ?? []),
      ...(lockedMaster?.layoutDefinitions?.map((layout) => layout.name) ?? []),
    ])
    const slideLayouts =
      input.options?.master === false
        ? undefined
        : exportSlides.map((slide) =>
            availableLayouts.has(slide.layout) ? slide.layout : undefined,
          )
    const placeholderBindings =
      input.options?.master === false
        ? []
        : exportSlides.flatMap((slide, index) =>
            slide.placeholderBindings.map((binding) => ({
              ...binding,
              slide: index + 1,
            })),
          )
    for (const binding of placeholderBindings) {
      const layoutName = slideLayouts?.[binding.slide - 1]
      const layout = lockedMaster?.layoutDefinitions?.find(
        (item) => item.name === layoutName,
      )
      const slot = layout?.placeholders.find(
        (slot) => slot.index === binding.index,
      )
      if (!slot)
        throw new RpcError(
          'Placeholder binding requires a matching locked native layout slot.',
          'INVALID_REQUEST',
          {
            slide: binding.slide,
            target: binding.target,
            index: binding.index,
          },
        )
      if (binding.textStyle === 'layout' && !slot.textStyle)
        throw new RpcError(
          'Text style inheritance requires defaults on the locked layout placeholder.',
          'INVALID_REQUEST',
          {
            slide: binding.slide,
            target: binding.target,
            index: binding.index,
          },
        )
      if (binding.textBody === 'layout' && (!slot.textBody || slot.type === 'pic'))
        throw new RpcError(
          'Text body inheritance requires defaults on the locked layout placeholder.',
          'INVALID_REQUEST',
          { slide: binding.slide, target: binding.target, index: binding.index },
        )
    }
    const policy = input.reviewPolicy ?? 'fast'
    if (policy !== 'fast') {
      const report = database.getQualityReport(deckId)
      const currentTheme = deck.themeId
        ? themeRegistry.resolve(deck.themeId)
        : undefined
      const stale =
        !report ||
        report.revision !== deck.revision ||
        report.profileDigest !== (input.profileDigest ?? null) ||
        report.themeDigest !== (currentTheme?.contentDigest ?? null) ||
        report.masterDigest !== await lockedMasterDigest(deckId) ||
        report.themeRuleDigest !== (validation.themeRuleDigest ?? null)
      const priorBlockers = report?.issues.filter(issue => issue.severity === 'error') ?? []
      const onlyExceptedRules = priorBlockers.length > 0 && priorBlockers.every(issue => issue.layer === 'schema') && validation.valid
      if (stale || (!report?.ok && !onlyExceptedRules))
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
    const ruleDocument = currentMaster?.machineRulesPath
      ? ThemeRulesDocumentSchema.parse(JSON.parse(await readFile(currentMaster.machineRulesPath, 'utf8')))
      : undefined
    if ((ruleDocument ? themeRulesDigest(ruleDocument) : null) !== validation.themeRuleDigest)
      throw new RpcError('Theme rules changed after validation. Validate the deck again.', 'THEME_RULES_STALE', { deckId })
    const ruleBinding = ruleDocument ? await currentRuleBinding(deck, input.profileDigest ?? null, input.options) : undefined
    if (ruleBinding && (ruleBinding.revision !== validation.revision || ruleBinding.ruleDigest !== validation.themeRuleDigest || ruleBinding.themeDigest !== currentMaster?.contentDigest)) throw new RpcError('The rule context changed after validation. Validate the current deck again.', 'THEME_RULE_EXCEPTION_STALE')
    const ruleExceptions = ruleBinding ? (await ruleExceptionStore.list(deckId)).filter(entry => ruleExceptionState(entry, ruleBinding) === 'active') : []
    return ExportJobSchema.parse(
      exportManager.enqueue({
        deckId,
        ...(ruleDocument ? { ruleDocument } : {}),
        themeRules: { revision: deck.revision, digest: validation.themeRuleDigest, stage: 'pre-export', issues: validation.themeRuleIssues, ...(ruleBinding ? { binding: ruleBinding, exceptions: ruleExceptions } : {}) },
        title: deck.name,
        outputName: input.outputName,
        review: input.review ?? false,
        ...(input.options ? { options: input.options } : {}),
        ...(notesDocument
          ? {
              notes: exportSlides.map(
                (slide) =>
                  notesDocument.notes.find(
                    (note) => note.slideId === slide.slideId,
                  )?.spokenText ?? '',
              ),
            }
          : {}),
        ...(animationsDocument
          ? {
              transitions: exportSlides.map(
                (slide) =>
                  animationsDocument.animations.find(
                    (animation) => animation.slideId === slide.slideId,
                  )?.transition ?? slide.animation.transition,
              ),
            }
          : {}),
        ...(lockedMaster
          ? { themeColors: Object.values(lockedMaster.colors) }
          : {}),
        ...(lockedMaster?.fonts[0] ? { themeFont: lockedMaster.fonts[0] } : {}),
        ...(lockedMaster
          ? {
              masterLayouts: lockedMaster.masters.flatMap(
                (master) => master.layouts,
              ),
            }
          : {}),
        ...(lockedMaster?.layoutDefinitions
          ? { masterLayoutDefinitions: lockedMaster.layoutDefinitions }
          : {}),
        ...(slideLayouts?.some((name) => name !== undefined)
          ? { slideLayouts }
          : {}),
        ...(placeholderBindings.length ? { placeholderBindings } : {}),
        ...(animationsDocument
          ? {
              objectAnimations: animationsDocument.animations.flatMap(
                (animation) => {
                  const slide =
                    exportSlides.findIndex(
                      (page) => page.slideId === animation.slideId,
                    ) + 1
                  if (!slide) return []
                  return animation.groups.flatMap(group => group.effects).map((effect, index) => ({ effect, index })).sort((a,b) => Number(a.effect.params.sourceOrder ?? a.index) - Number(b.effect.params.sourceOrder ?? b.index)).flatMap(({ effect }) => {
                      if (
                        ![
                          'entrance_fade',
                          'appear',
                          'fly',
                          'zoom',
                          'emphasis_pulse',
                          'teeter',
                          'path_line',
                          'path_arc',
                          'exit_fade',
                          'native',
                        ].includes(effect.kind)
                      )
                        return []
                      return [
                        {
                          slide: Number(slide),
                          target: effect.target,
                          kind: effect.kind,
                          ...(typeof effect.params.path === 'string'
                            ? { path: effect.params.path }
                            : {}),
                          ...(typeof effect.params.nativeXml === 'string' ? { nativeXml: effect.params.nativeXml, ...(typeof effect.params.sourceDurationMs === 'number' ? { nativeDurationMs: effect.params.sourceDurationMs } : {}) } : {}),
                          trigger: effect.trigger,
                          delayMs: effect.delayMs,
                          durationMs: effect.durationMs,
                        },
                      ]
                    })
                },
              ),
            }
          : {}),
        ...(animationsDocument
          ? {
              animationEffects: animationsDocument.animations.flatMap(
                (animation) =>
                  animation.groups.flatMap((group) =>
                    group.effects.map((effect) => effect.kind),
                  ),
              ),
            }
          : {}),
        ...(nativeDiagrams.length ? { nativeDiagrams } : {}),
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
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    const input = z
      .object({
        slide: z.number().int().positive(),
        policy: z.enum(['fast', 'standard', 'strict']).default('standard'),
        profileDigest: z.string().min(1).nullable().default(null),
      })
      .parse(request.body)
    const deck = await resolveDeck(deckId)
    const themeDigest = deck.themeId
      ? themeRegistry.resolve(deck.themeId).contentDigest
      : null
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
      inspectionManager.enqueue(deckId, input.slide, 'quality', {
        revision: deck.revision,
        themeId: deck.themeId ?? null,
        themeDigest,
        masterDigest: await lockedMasterDigest(deckId),
        profileDigest: input.profileDigest,
        policy: input.policy,
      }),
    )
  })

  app.get('/api/v1/decks/:deckId/quality-report', async (request) => {
    const { deckId } = z
      .object({ deckId: z.string().min(1) })
      .parse(request.params)
    await resolveDeck(deckId)
    const report = database.getQualityReport(deckId)
    if (!report)
      throw new RpcError(
        'Quality report was not found.',
        'QUALITY_REPORT_NOT_FOUND',
        { deckId },
      )
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

  app.post('/api/v1/inspections/:inspectionId/result', async (request) => {
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
      const deck = await resolveDeck(completed.deckId)
      const currentTheme = deck.themeId ? themeRegistry.resolve(deck.themeId) : undefined
      const masterDigest = await lockedMasterDigest(deck.id)
      const previous = database.getQualityReport(deck.id)
      const fresh = previous && previous.revision === deck.revision && previous.themeDigest === (currentTheme?.contentDigest ?? null) && previous.masterDigest === masterDigest && previous.themeRuleDigest === (currentTheme?.machineRulesDigest ?? null) && previous.profileDigest === (completed.profileDigest ?? null)
      const currentCapture = completed.revision === deck.revision && completed.themeDigest === (currentTheme?.contentDigest ?? null) && (completed.masterDigest ?? null) === masterDigest
      const ruleMeasurements = [
        ...(fresh && currentCapture ? previous.ruleMeasurements.filter(entry => entry.slide !== completed.slide) : []),
        ...(currentCapture && result.ruleMeasurement ? [result.ruleMeasurement] : []),
      ]
      const browserIssues = [
        ...(fresh && currentCapture ? previous.issues.filter(issue => issue.layer !== 'schema' && issue.slide !== completed.slide) : []),
        ...result.issues,
      ]
      const validation = await validateDeck(deck, { phase: 'quality', measurements: ruleMeasurements, profileDigest: completed.profileDigest ?? null })
      const themeRuleQualityIssues = validation.themeRuleIssues.map(
        (issue) => ({
          layer: 'schema' as const,
          severity: issue.severity,
          code: issue.code,
          message: issue.message,
          ...(issue.slide === undefined ? {} : { slide: issue.slide }),
          suggestedFix: issue.suggestedFix,
        }),
      )
      database.recordQualityReport(
        DeckQualityReportSchema.parse({
          version: 1,
          deckId: completed.deckId,
          revision: completed.revision,
          themeId: completed.themeId ?? null,
          themeDigest: completed.themeDigest ?? null,
          masterDigest: completed.masterDigest ?? null,
          profileDigest: completed.profileDigest ?? null,
          checkedAt: new Date().toISOString(),
          policy: completed.policy ?? 'standard',
          ok:
            currentCapture && !browserIssues.some((issue) => issue.severity === 'error') &&
            !validation.themeRuleIssues.some(
              blockingRuleIssue,
            ),
          issues: [...browserIssues, ...themeRuleQualityIssues],
          themeRuleDigest: validation.themeRuleDigest,
          themeRuleIssues: validation.themeRuleIssues,
          ruleMeasurements,
        }),
      )
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
    let verifiedPath: string | undefined
    if (exportManager.get(exportId)) {
      try { verifiedPath = (await exportManager.download(exportId)).path }
      catch (cause) { throw new RpcError(cause instanceof Error ? cause.message : 'Export verification failed.', 'EXPORT_NOT_READY', { exportId }) }
    } else if (persisted.job.themeRules?.digest) {
      throw new RpcError('Export rule evidence could not be restored. Export the deck again.', 'EXPORT_NOT_READY', { exportId })
    }
    const outputPath = await resolveExistingPath(
      exportRoot,
      relative(exportRoot, verifiedPath ?? persisted.outputPath),
    )
    const fallbackName = persisted.job.outputName.replace(/[^\x20-\x7e]|["\\]/g, '_')
    const encodedName = encodeURIComponent(persisted.job.outputName).replace(
      /['()*]/g,
      character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    reply
      .type(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      )
      .header(
        'content-disposition',
        `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
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
