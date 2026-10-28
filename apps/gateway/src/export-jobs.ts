import { createHash, randomUUID } from 'node:crypto'
import { ThemeRulesDocumentSchema, themeRulesDigest, type ThemeRulesDocument } from '@fastppt/theme-registry'
import { evaluateExportReadback } from './theme-rule-readback.js'
import { applyRuleExceptions, blockingRuleIssue, ruleOptionsDigest } from './theme-rule-exceptions.js'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { resolveFontDescriptor } from '@fastppt/fonts/registry'
import { redactSensitiveText } from '@fastppt/logger'
import { HTML_SNAPSHOT_VERSIONS } from '@fastppt/slidewave/snapshot'
import { ExportJobSchema } from '@fastppt/protocol'
import {
  EditablePptxPolicyError,
  probeEditablePptxRuntime,
  writeEditablePptx,
} from '@fastppt/slidewave/server'
import type { NativeDiagramDocument, NativeMasterLayout, NativeSlideTransition } from '@fastppt/slidewave/server'

import type { ExportJob, ExportQaReport, SlidewaveSnapshot } from '@fastppt/protocol'

export interface ExportProgress {
  phase: string
  progress: number
}

export interface ExportDeckInput {
  snapshot: SlidewaveSnapshot
  outputPath: string
  title?: string
  signal: AbortSignal
  onProgress?: (progress: ExportProgress) => void
  options?: ExportOptions
  notes?: readonly string[]
  transitions?: readonly NativeSlideTransition[]
  themeColors?: readonly string[]
  themeFont?: string
  masterLayouts?: readonly string[]
  masterLayoutDefinitions?: readonly NativeMasterLayout[]
  slideLayouts?: readonly (string | undefined)[]
  placeholderBindings?: readonly { slide: number; target: string; index: number; geometry?: 'page' | 'layout'; textStyle?: 'page' | 'layout'; textBody?: 'page' | 'layout' }[]
  objectAnimations?: readonly { slide: number; target: string; kind: 'entrance_fade' | 'appear' | 'fly' | 'zoom' | 'emphasis_pulse' | 'teeter' | 'path_line' | 'path_arc' | 'exit_fade' | 'native'; path?: string; nativeXml?: string; nativeDurationMs?: number; trigger?: 'on-click' | 'with-previous' | 'after-previous'; delayMs?: number; durationMs?: number }[]
  animationEffects?: readonly string[]
  nativeDiagrams?: readonly { slide: number; diagramId?: string; document: NativeDiagramDocument }[]
}

export interface ExportOptions {
  policy?: 'editable' | 'strict-editable' | 'visual-fidelity' | undefined
  master?: boolean
  notes?: boolean
  animations?: boolean
  diagrams?: boolean
}

export interface ExportDeckResult {
  objects?: ExportJob['objects']
  outputPath: string
  warnings: Array<{ code: string; message: string; elementId?: string }>
  elementCount: number
  slideCount: number
  qa: ExportQaReport
}

export interface ExporterStatus {
  status: 'available' | 'unavailable'
  version: string
  message?: string
}

export interface EditablePptxExporter {
  getStatus(): Promise<ExporterStatus>
  export(input: ExportDeckInput): Promise<ExportDeckResult>
}

export class ExportServiceError extends Error {
  constructor(
    public readonly code: 'EXPORT_FAILED' | 'EXPORT_CANCELLED',
    message: string,
    public readonly logs: readonly string[] = [],
    public readonly objects?: ExportJob['objects'],
  ) {
    super(message)
    this.name = 'ExportServiceError'
  }
}

function boundedExportLogs(logs: readonly string[]): string[] {
  return logs
    .slice(0, 100)
    .map((line) => redactSensitiveText(line).slice(0, 2_000))
}

class WorkspaceSlidewaveExporter implements EditablePptxExporter {
  async getStatus(): Promise<ExporterStatus> {
    const status = await probeEditablePptxRuntime()
    return {
      status: status.status,
      version: status.version,
      message: `${status.byteLength} byte readiness PPTX`,
    }
  }

  async export(input: ExportDeckInput): Promise<ExportDeckResult> {
    try {
      input.signal.throwIfAborted()
      input.onProgress?.({ phase: 'rendering-pptx', progress: 65 })
      const result = await writeEditablePptx(
        input.snapshot,
        input.outputPath,
        {
          ...(input.options?.policy ? { policy: input.options.policy } : {}),
          ...(input.title ? { title: input.title } : {}),
          resolveFont: resolveFontDescriptor,
          ...(input.notes ? { notes: input.notes } : {}),
          ...(input.transitions ? { transitions: input.transitions } : {}),
          ...(input.themeColors ? { themeColors: input.themeColors } : {}),
          ...(input.themeFont ? { themeFont: input.themeFont } : {}),
          ...(input.masterLayouts ? { masterLayouts: input.masterLayouts } : {}),
          ...(input.masterLayoutDefinitions ? { masterLayoutDefinitions: input.masterLayoutDefinitions } : {}),
          ...(input.slideLayouts ? { slideLayouts: input.slideLayouts } : {}),
          ...(input.placeholderBindings ? { placeholderBindings: input.placeholderBindings } : {}),
          ...(input.objectAnimations ? { objectAnimations: input.objectAnimations } : {}),
          ...(input.nativeDiagrams ? { nativeDiagrams: input.nativeDiagrams } : {}),
          ...(input.options?.master === false ? { master: false } : {}),
        },
      )
      input.signal.throwIfAborted()
      return { ...result, outputPath: input.outputPath }
    } catch (cause) {
      if (input.signal.aborted)
        throw new ExportServiceError(
          'EXPORT_CANCELLED',
          'The editable PPTX export was cancelled.',
        )
      if (cause instanceof ExportServiceError) throw cause
      throw new ExportServiceError(
        'EXPORT_FAILED',
        cause instanceof Error ? cause.message : String(cause),
        cause instanceof Error && cause.stack ? [cause.stack] : [],
        cause instanceof EditablePptxPolicyError ? cause.objects : undefined,
      )
    }
  }
}

export interface QueueExportInput {
  themeRules?: ExportJob['themeRules']
  ruleDocument?: ThemeRulesDocument
  deckId: string
  title?: string
  outputName: string
  /** Require an explicit review confirmation before the export is published. */
  review?: boolean
  options?: ExportOptions
  notes?: readonly string[]
  transitions?: readonly NativeSlideTransition[]
  themeColors?: readonly string[]
  themeFont?: string
  masterLayouts?: readonly string[]
  masterLayoutDefinitions?: readonly NativeMasterLayout[]
  slideLayouts?: readonly (string | undefined)[]
  placeholderBindings?: readonly { slide: number; target: string; index: number; geometry?: 'page' | 'layout'; textStyle?: 'page' | 'layout'; textBody?: 'page' | 'layout' }[]
  objectAnimations?: readonly { slide: number; target: string; kind: 'entrance_fade' | 'appear' | 'fly' | 'zoom' | 'emphasis_pulse' | 'teeter' | 'path_line' | 'path_arc' | 'exit_fade' | 'native'; path?: string; nativeXml?: string; nativeDurationMs?: number; trigger?: 'on-click' | 'with-previous' | 'after-previous'; delayMs?: number; durationMs?: number }[]
  animationEffects?: readonly string[]
  nativeDiagrams?: readonly { slide: number; diagramId?: string; document: NativeDiagramDocument }[]
}

interface QueuedExport {
  input: QueueExportInput
  job: ExportJob
  outputPath: string
  partialPath: string
  controller: AbortController
  captureTimer: ReturnType<typeof setTimeout> | undefined
  snapshot?: SlidewaveSnapshot
}

export interface ExportJobManagerOptions {
  outputRoot: string
  exporter?: EditablePptxExporter
  captureTimeoutMs?: number
  onUpdate?: (job: ExportJob) => void
  verifyRuleContext?: (job: ExportJob, options: ExportOptions | undefined) => Promise<void>
}

const EXPORT_OWNER_FILE = '.fastppt-export-owner.json'
const JOB_STATE_FILE = 'job.json'

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return !(
      cause instanceof Error &&
      'code' in cause &&
      cause.code === 'ESRCH'
    )
  }
}

async function activeOwner(directory: string): Promise<boolean> {
  try {
    const owner = JSON.parse(
      await readFile(join(directory, EXPORT_OWNER_FILE), 'utf8'),
    ) as { pid?: unknown }
    return (
      typeof owner.pid === 'number' &&
      Number.isInteger(owner.pid) &&
      owner.pid > 0 &&
      processExists(owner.pid)
    )
  } catch {
    return false
  }
}

async function activeLegacyGateway(outputRoot: string): Promise<boolean> {
  try {
    const runtime = JSON.parse(
      await readFile(join(dirname(outputRoot), 'runtime', 'gateway.json'), 'utf8'),
    ) as { pid?: unknown }
    return (
      typeof runtime.pid === 'number' &&
      Number.isInteger(runtime.pid) &&
      runtime.pid > 0 &&
      processExists(runtime.pid)
    )
  } catch {
    return false
  }
}

export async function cleanupAbandonedExportArtifacts(
  outputRoot: string,
): Promise<void> {
  let entries
  try {
    entries = await readdir(outputRoot, { withFileTypes: true })
  } catch {
    return
  }
  const legacyGatewayActive = await activeLegacyGateway(outputRoot)
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directory = join(outputRoot, entry.name)
    const info = await lstat(directory).catch(() => undefined)
    if (!info?.isDirectory() || info.isSymbolicLink()) continue
    const children = await readdir(directory).catch(() => [] as string[])
    const hasPartial = children.some((name) => name.endsWith('.partial.pptx'))
    if (
      hasPartial &&
      ((await activeOwner(directory)) ||
        (!children.includes(EXPORT_OWNER_FILE) && legacyGatewayActive))
    )
      continue
    let reviewArtifact: string | undefined
    try {
      const state = JSON.parse(await readFile(join(directory, JOB_STATE_FILE), 'utf8')) as { job?: unknown }
      const job = ExportJobSchema.safeParse(state.job)
      if (job.success && job.data.id === entry.name && job.data.status === 'review-required')
        reviewArtifact = `.${sanitizePptxFilename(job.data.outputName)}.partial.pptx`
    } catch { /* A missing or malformed state does not retain an abandoned artifact. */ }
    for (const name of children) {
      if (name.endsWith('.partial.pptx') && name !== reviewArtifact) await rm(join(directory, name))
    }
    await rm(join(directory, EXPORT_OWNER_FILE), { force: true })
    if ((await readdir(directory).catch(() => [] as string[])).length === 0)
      await rm(directory, { recursive: true, force: true })
  }
}

export function sanitizePptxFilename(value: string): string {
  const withoutControls = [...basename(value)]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
  const cleaned = withoutControls
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/^\.+/g, '')
    .slice(0, 140)
  const stem = cleaned.replace(/\.pptx$/i, '') || 'presentation'
  return `${stem}.pptx`
}

export class ExportJobManager {
  readonly #outputRoot: string
  readonly #exporter: EditablePptxExporter
  readonly #captureTimeoutMs: number
  readonly #onUpdate: ((job: ExportJob) => void) | undefined
  readonly #verifyRuleContext: ExportJobManagerOptions['verifyRuleContext']
  readonly #jobs = new Map<string, QueuedExport>()
  readonly #queue: string[] = []
  #running: Promise<void> | undefined
  #disposed = false
  readonly #writes = new Map<string, Promise<void>>()
  readonly #ready: Promise<void>

  constructor(options: ExportJobManagerOptions) {
    this.#outputRoot = options.outputRoot
    this.#exporter = options.exporter ?? new WorkspaceSlidewaveExporter()
    this.#captureTimeoutMs = options.captureTimeoutMs ?? 120_000
    this.#onUpdate = options.onUpdate
    this.#verifyRuleContext = options.verifyRuleContext
    this.#ready = this.#restore()
  }

  async ready(): Promise<void> {
    await this.#ready
  }

  getStatus() {
    return this.#exporter.getStatus()
  }

  enqueue(input: QueueExportInput): ExportJob {
    if (this.#disposed) throw new Error('Export manager is closed')
    if (input.ruleDocument && (!input.themeRules || themeRulesDigest(input.ruleDocument) !== input.themeRules.digest)) throw new Error('Export rule document does not match its validated digest')
    if (input.themeRules?.digest && !input.ruleDocument) throw new Error('Export requires the validated rule document')
    if (input.themeRules?.exceptions?.length && (!input.themeRules.binding || !this.#verifyRuleContext)) throw new Error('Rule exceptions require a bound context and live verifier')
    const id = randomUUID()
    const outputName = sanitizePptxFilename(input.outputName)
    const directory = join(this.#outputRoot, id)
    const queued: QueuedExport = {
      input: structuredClone({ ...input, outputName }),
      outputPath: join(directory, outputName),
      partialPath: join(directory, `.${outputName}.partial.pptx`),
      controller: new AbortController(),
      captureTimer: undefined,
      job: ExportJobSchema.parse({
        snapshotVersions: HTML_SNAPSHOT_VERSIONS,
        ...(input.themeRules ? { themeRules: input.themeRules } : {}),
        id,
        deckId: input.deckId,
        format: 'editable-pptx',
        outputName,
        status: 'queued',
        phase: 'awaiting-browser-capture',
        progress: 5,
        createdAt: new Date().toISOString(),
        warnings: [],
      }),
    }
    queued.captureTimer = setTimeout(
      () => this.#captureTimedOut(queued),
      this.#captureTimeoutMs,
    )
    queued.captureTimer.unref()
    this.#jobs.set(id, queued)
    void this.#persist(queued)
    this.#emit(queued)
    return queued.job
  }

  submitSnapshot(exportId: string, snapshot: SlidewaveSnapshot): ExportJob {
    const queued = this.#jobs.get(exportId)
    if (!queued) throw new Error('Export job was not found')
    if (
      queued.job.status !== 'queued' ||
      queued.job.phase !== 'awaiting-browser-capture'
    )
      throw new Error('Export job is not waiting for a browser snapshot')
    if (queued.captureTimer) clearTimeout(queued.captureTimer)
    queued.captureTimer = undefined
    queued.snapshot = snapshot
    this.#update(queued, { phase: 'snapshot-received', progress: 25 })
    this.#queue.push(exportId)
    this.#pump()
    return queued.job
  }

  reportCaptureProgress(
    exportId: string,
    completed: number,
    total: number,
  ): ExportJob {
    const queued = this.#jobs.get(exportId)
    if (!queued) throw new Error('Export job was not found')
    if (
      queued.job.status !== 'queued' ||
      queued.job.phase !== 'awaiting-browser-capture'
    )
      throw new Error('Export job is not waiting for browser capture')
    this.#refreshCaptureTimeout(queued)
    const capturedSlideCount = Math.max(
      queued.job.capturedSlideCount ?? 0,
      completed,
    )
    return this.#update(queued, {
      progress: Math.round(5 + (capturedSlideCount / total) * 20),
      slideCount: total,
      capturedSlideCount,
    })
  }

  get(exportId: string): ExportJob | undefined {
    return this.#jobs.get(exportId)?.job
  }

  pendingBrowserCapture(): ExportJob[] {
    return [...this.#jobs.values()]
      .map((queued) => queued.job)
      .filter(
        (job) =>
          job.status === 'queued' && job.phase === 'awaiting-browser-capture',
      )
      .map((job) => ExportJobSchema.parse(job))
  }

  async download(exportId: string): Promise<{ path: string; name: string }> {
    const queued = this.#jobs.get(exportId)
    if (!queued || queued.job.status !== 'completed')
      throw new Error('Export is not available for download')
    const file = await stat(queued.outputPath)
    if (!file.isFile()) throw new Error('Export output is missing')
    await this.#verifyRuleArtifact(queued, queued.outputPath)
    return { path: queued.outputPath, name: queued.job.outputName }
  }

  async review(exportId: string, approved: boolean): Promise<ExportJob> {
    const queued = this.#jobs.get(exportId)
    if (!queued || queued.job.status !== 'review-required')
      throw new Error('Export is not awaiting review')
    if (!approved) {
      await this.#removeArtifacts(queued)
      this.#update(queued, {
        status: 'failed',
        phase: 'rejected',
        completedAt: new Date().toISOString(),
        error: {
          code: 'EXPORT_REJECTED',
          message: 'The export was rejected during visual review.',
        },
      })
      return queued.job
    }
    await this.#verifyRuleArtifact(queued, queued.partialPath)
    await rename(queued.partialPath, queued.outputPath)
    await rm(join(dirname(queued.outputPath), EXPORT_OWNER_FILE), {
      force: true,
    })
    this.#update(queued, {
      status: 'completed',
      phase: 'completed',
      progress: 100,
      completedAt: new Date().toISOString(),
      downloadUrl: `/api/v1/exports/${queued.job.id}/download`,
    })
    return queued.job
  }

  cancel(exportId: string): ExportJob | undefined {
    const queued = this.#jobs.get(exportId)
    if (!queued) return undefined
    if (queued.captureTimer) clearTimeout(queued.captureTimer)
    queued.captureTimer = undefined
    if (queued.job.status === 'queued') {
      const index = this.#queue.indexOf(exportId)
      if (index >= 0) this.#queue.splice(index, 1)
      queued.controller.abort()
      this.#update(queued, {
        status: 'cancelled',
        phase: 'cancelled',
        completedAt: new Date().toISOString(),
      })
    } else if (queued.job.status === 'review-required') {
      void this.#removeArtifacts(queued).catch(
        () => undefined,
      )
      this.#update(queued, {
        status: 'cancelled',
        phase: 'cancelled',
        completedAt: new Date().toISOString(),
      })
    } else if (queued.job.status === 'running') queued.controller.abort()
    return queued.job
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    for (const queued of this.#jobs.values()) {
      if (queued.captureTimer) clearTimeout(queued.captureTimer)
      if (queued.job.status === 'queued' || queued.job.status === 'running')
        queued.controller.abort()
    }
    await this.#ready
    await this.#running
    await Promise.all(this.#writes.values())
  }

  #captureTimedOut(queued: QueuedExport): void {
    if (queued.job.status !== 'queued') return
    queued.captureTimer = undefined
    this.#update(queued, {
      status: 'failed',
      phase: 'failed',
      completedAt: new Date().toISOString(),
      error: {
        code: 'EXPORT_CAPTURE_TIMEOUT',
        message: 'The browser did not provide a Slidewave snapshot in time.',
      },
    })
  }

  #refreshCaptureTimeout(queued: QueuedExport): void {
    if (queued.captureTimer) clearTimeout(queued.captureTimer)
    queued.captureTimer = setTimeout(
      () => this.#captureTimedOut(queued),
      this.#captureTimeoutMs,
    )
    queued.captureTimer.unref()
  }

  #pump(): void {
    if (this.#running !== undefined || this.#disposed) return
    this.#running = this.#drain().finally(() => {
      this.#running = undefined
      if (this.#queue.length && !this.#disposed) this.#pump()
    })
  }

  async #drain(): Promise<void> {
    for (;;) {
      const id = this.#queue.shift()
      if (!id || this.#disposed) return
      const queued = this.#jobs.get(id)
      if (!queued || queued.job.status !== 'queued' || !queued.snapshot)
        continue
      await this.#run(queued)
    }
  }

  async #run(queued: QueuedExport): Promise<void> {
    const snapshot = queued.snapshot
    if (!snapshot) return
    this.#update(queued, {
      status: 'running',
      phase: 'starting',
      progress: 35,
      startedAt: new Date().toISOString(),
    })
    try {
      if (queued.input.themeRules?.digest && (!queued.input.ruleDocument || themeRulesDigest(queued.input.ruleDocument) !== queued.input.themeRules.digest))
        throw new ExportServiceError('EXPORT_FAILED', 'The validated export rule document is missing or changed.')
      await this.#assertRuleContext(queued)
      const outputDirectory = join(this.#outputRoot, queued.job.id)
      await mkdir(outputDirectory, { recursive: true })
      await writeFile(
        join(outputDirectory, EXPORT_OWNER_FILE),
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
        { mode: 0o600 },
      )
      const result = await this.#exporter.export({
        snapshot,
        outputPath: queued.partialPath,
        ...(queued.input.title ? { title: queued.input.title } : {}),
        signal: queued.controller.signal,
        onProgress: ({ phase, progress }) =>
          this.#update(queued, { phase, progress }),
        ...(queued.input.options ? { options: queued.input.options } : {}),
        ...(queued.input.notes ? { notes: queued.input.notes } : {}),
        ...(queued.input.transitions ? { transitions: queued.input.transitions } : {}),
        ...(queued.input.themeColors ? { themeColors: queued.input.themeColors } : {}),
        ...(queued.input.themeFont ? { themeFont: queued.input.themeFont } : {}),
        ...(queued.input.masterLayouts ? { masterLayouts: queued.input.masterLayouts } : {}),
        ...(queued.input.masterLayoutDefinitions ? { masterLayoutDefinitions: queued.input.masterLayoutDefinitions } : {}),
          ...(queued.input.slideLayouts ? { slideLayouts: queued.input.slideLayouts } : {}),
          ...(queued.input.placeholderBindings ? { placeholderBindings: queued.input.placeholderBindings } : {}),
        ...(queued.input.objectAnimations ? { objectAnimations: queued.input.objectAnimations } : {}),
        ...(queued.input.animationEffects ? { animationEffects: queued.input.animationEffects } : {}),
        ...(queued.input.nativeDiagrams ? { nativeDiagrams: queued.input.nativeDiagrams } : {}),
      })
      const capabilityWarnings = Object.entries(queued.input.options ?? {})
        .filter(([, enabled]) => enabled)
        .filter(([kind]) => kind === 'notes' || kind === 'animations')
        .map(([kind]) => ({ code: `PPTX_${kind.toUpperCase()}_PARTIAL`, message: `${kind} export is partially supported by the current editable PPTX renderer.` }))
      const nativeAnimationEffects = new Set(['entrance_fade', 'appear', 'fly', 'zoom', 'emphasis_pulse', 'teeter', 'exit_fade', 'path_line', 'path_arc', 'native'])
      const animationWarnings = [...new Set(queued.input.animationEffects ?? [])]
        .filter((kind) => !nativeAnimationEffects.has(kind))
        .map((kind) => ({ code: 'PPTX_OBJECT_ANIMATION_UNSUPPORTED', message: `Object animation effect is not exported natively: ${kind}.` }))
      this.#update(queued, {
        warnings: [...result.warnings, ...capabilityWarnings, ...animationWarnings],
        slideCount: result.slideCount,
        elementCount: result.elementCount,
        qa: result.qa,
        objects: result.objects,
      })
      if (queued.input.ruleDocument && queued.job.themeRules) {
        queued.controller.signal.throwIfAborted()
        this.#update(queued, { phase: 'checking-template-rules', progress: 90 })
        const bytes = await readFile(queued.partialPath)
        let readback: NonNullable<NonNullable<ExportJob['themeRules']>['readback']>
        try {
          readback = await evaluateExportReadback(bytes, queued.input.ruleDocument, snapshot)
          const rules = queued.job.themeRules
          if (rules.binding) {
            readback.issues = applyRuleExceptions(readback.issues, rules.exceptions ?? [], rules.binding, 'readback')
            readback.status = readback.issues.some(blockingRuleIssue) ? 'failed' : readback.issues.length ? 'issues' : 'passed'
          }
        } catch (cause) {
          readback = { source: 'pptx-xml', sha256: createHash('sha256').update(bytes).digest('hex'), checkedAt: new Date().toISOString(), status: 'failed', issues: [], slides: [], error: cause instanceof Error ? cause.message : String(cause) }
        }
        this.#update(queued, { themeRules: { ...queued.job.themeRules, stage: 'post-export', readback } })
        if (readback.status === 'failed') throw new ExportServiceError('EXPORT_FAILED', 'PPTX template rule readback failed.', readback.error ? [readback.error] : readback.issues.filter(blockingRuleIssue).map(issue => `${issue.ruleId}: ${issue.message}`), result.objects)
        await this.#assertRuleContext(queued)
        queued.controller.signal.throwIfAborted()
      }
      if (queued.input.review) {
        // Visual confirmation gate: keep the partial, wait for explicit approval.
        this.#update(queued, {
          status: 'review-required',
          phase: 'awaiting-review',
          progress: 92,
        })
        return
      }
      await rename(queued.partialPath, queued.outputPath)
      await rm(join(outputDirectory, EXPORT_OWNER_FILE), { force: true })
      this.#update(queued, {
        status: 'completed',
        phase: 'completed',
        progress: 100,
        completedAt: new Date().toISOString(),
        downloadUrl: `/api/v1/exports/${queued.job.id}/download`,
      })
    } catch (cause) {
      await this.#removeArtifacts(queued)
      const error = queued.controller.signal.aborted
        ? new ExportServiceError(
            'EXPORT_CANCELLED',
            'The editable PPTX export was cancelled.',
          )
        : cause instanceof ExportServiceError
          ? cause
          : new ExportServiceError(
              'EXPORT_FAILED',
              cause instanceof Error ? cause.message : String(cause),
            )
      this.#update(queued, {
        objects: error.objects,
        status: error.code === 'EXPORT_CANCELLED' ? 'cancelled' : 'failed',
        phase: error.code === 'EXPORT_CANCELLED' ? 'cancelled' : 'failed',
        completedAt: new Date().toISOString(),
        error: {
          code: error.code,
          message: redactSensitiveText(error.message).slice(0, 2_000),
          ...(error.logs.length ? { logs: boundedExportLogs(error.logs) } : {}),
        },
      })
    }
  }

  #update(queued: QueuedExport, patch: Partial<ExportJob>): ExportJob {
    queued.job = ExportJobSchema.parse({ ...queued.job, ...patch })
    void this.#persist(queued)
    this.#emit(queued)
    return queued.job
  }

  async #verifyRuleArtifact(queued: QueuedExport, path: string): Promise<void> {
    if (!queued.job.themeRules?.digest) return
    const report = queued.job.themeRules.readback
    const hash = createHash('sha256').update(await readFile(path)).digest('hex')
    await this.#assertRuleContext(queued).catch(cause => {
      this.#update(queued, { status: 'failed', phase: 'failed', downloadUrl: undefined, error: { code: 'EXPORT_RULE_CONTEXT_STALE', message: cause instanceof Error ? cause.message : String(cause) } })
      throw cause
    })
    const rules = queued.job.themeRules
    const issues = report ? rules.binding ? applyRuleExceptions(report.issues, rules.exceptions ?? [], rules.binding, 'readback') : report.issues.map(({ exception: _exception, ...issue }) => { void _exception; return issue }) : []
    if (queued.input.ruleDocument && themeRulesDigest(queued.input.ruleDocument) === rules.digest && rules.stage === 'post-export' && report && report.status !== 'failed' && !report.error && !issues.some(blockingRuleIssue) && report.sha256 === hash) return
    this.#update(queued, { status: 'failed', phase: 'failed', downloadUrl: undefined, error: { code: 'EXPORT_RULE_ARTIFACT_STALE', message: 'The PPTX has no valid rule readback for its current contents. Export it again.' } })
    throw new Error('Export rule readback is missing or stale')
  }

  async #assertRuleContext(queued: QueuedExport): Promise<void> {
    const rules = queued.job.themeRules
    if (!rules) return
    if (rules.exceptions?.length && (!rules.binding || !this.#verifyRuleContext)) throw new Error('Rule exceptions have no live context verifier')
    if (!rules.binding) return
    if (rules.binding.deckId !== queued.job.deckId || rules.binding.revision !== rules.revision || rules.binding.ruleDigest !== rules.digest || rules.binding.optionsDigest !== ruleOptionsDigest(queued.input.options)) throw new Error('Frozen rule context does not match the export inputs')
    const issues = applyRuleExceptions(rules.issues, rules.exceptions ?? [], rules.binding, 'export')
    if (issues.some(blockingRuleIssue)) throw new Error('A pre-export rule exception is missing or invalid')
    await this.#verifyRuleContext?.(ExportJobSchema.parse(queued.job), queued.input.options)
  }

  #persist(queued: QueuedExport): Promise<void> {
    const directory = join(this.#outputRoot, queued.job.id)
    const content = `${JSON.stringify(
        {
          job: queued.job,
          ruleDocument: queued.input.ruleDocument,
          snapshot: queued.snapshot,
          outputPath: queued.outputPath,
          partialPath: queued.partialPath,
          review: queued.input.review ?? false,
          options: queued.input.options ?? {},
          notes: queued.input.notes ?? [],
          transitions: queued.input.transitions ?? [],
          masterLayouts: queued.input.masterLayouts ?? [],
          masterLayoutDefinitions: queued.input.masterLayoutDefinitions ?? [],
          slideLayouts: queued.input.slideLayouts,
          placeholderBindings: queued.input.placeholderBindings,
          animationEffects: queued.input.animationEffects ?? [],
          title: queued.input.title,
          themeColors: queued.input.themeColors,
          themeFont: queued.input.themeFont,
          objectAnimations: queued.input.objectAnimations,
          nativeDiagrams: queued.input.nativeDiagrams,
        },
        null,
        2,
      )}\n`
    const previous = this.#writes.get(queued.job.id) ?? Promise.resolve()
    const write = previous.then(async () => {
      await mkdir(directory, { recursive: true })
      const temporaryPath = join(directory, `${JOB_STATE_FILE}.tmp`)
      await writeFile(temporaryPath, content, { mode: 0o600 })
      await rename(temporaryPath, join(directory, JOB_STATE_FILE))
    }).catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause)
      queued.job = ExportJobSchema.parse({ ...queued.job, warnings: [...queued.job.warnings.filter((warning) => warning.code !== 'export-state-write-failed'), { code: 'export-state-write-failed', message: `Cannot persist export recovery state: ${redactSensitiveText(message)}` }] })
      this.#emit(queued)
    })
    this.#writes.set(queued.job.id, write)
    return write
  }

  async #removeArtifacts(queued: QueuedExport): Promise<void> {
    await Promise.all([
      rm(queued.partialPath, { force: true }),
      rm(queued.outputPath, { force: true }),
      rm(join(dirname(queued.outputPath), EXPORT_OWNER_FILE), { force: true }),
    ])
  }

  /** Rebuild in-memory jobs from persisted `job.json` state after a restart. */
  async #restore(): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(this.#outputRoot, { withFileTypes: true }).then(
        (list) => list.filter((e) => e.isDirectory()).map((e) => e.name),
      )
    } catch {
      return
    }
    for (const id of entries) {
      const directory = join(this.#outputRoot, id)
      let persisted: {
        job?: unknown
        ruleDocument?: unknown
        snapshot?: SlidewaveSnapshot
        outputPath?: string
        partialPath?: string
        review?: boolean
        options?: ExportOptions
        notes?: readonly string[]
        transitions?: readonly NativeSlideTransition[]
        masterLayouts?: readonly string[]
  masterLayoutDefinitions?: readonly NativeMasterLayout[]
  slideLayouts?: readonly (string | undefined)[]
  placeholderBindings?: readonly { slide: number; target: string; index: number; geometry?: 'page' | 'layout'; textStyle?: 'page' | 'layout'; textBody?: 'page' | 'layout' }[]
        animationEffects?: readonly string[]
        title?: string
        themeColors?: QueueExportInput['themeColors']
        themeFont?: string
        objectAnimations?: QueueExportInput['objectAnimations']
        nativeDiagrams?: QueueExportInput['nativeDiagrams']
      }
      try {
        persisted = JSON.parse(
          await readFile(join(directory, JOB_STATE_FILE), 'utf8'),
        ) as {
          job?: unknown
          snapshot?: SlidewaveSnapshot
          outputPath?: string
          partialPath?: string
          review?: boolean
          options?: ExportOptions
        }
      } catch {
        continue
      }
      const job = ExportJobSchema.safeParse(persisted.job)
      if (!job.success || job.data.id !== id || this.#jobs.has(id)) continue
      const ruleDocument = ThemeRulesDocumentSchema.safeParse(persisted.ruleDocument)
      const queued: QueuedExport = {
        input: {
          deckId: job.data.deckId,
          ...(job.data.themeRules ? { themeRules: job.data.themeRules } : {}),
          ...(ruleDocument.success ? { ruleDocument: ruleDocument.data } : {}),
          outputName: job.data.outputName,
          review: persisted.review ?? false,
          ...(persisted.options ? { options: persisted.options } : {}),
          ...(persisted.notes ? { notes: persisted.notes } : {}),
          ...(persisted.transitions ? { transitions: persisted.transitions } : {}),
          ...(persisted.masterLayouts ? { masterLayouts: persisted.masterLayouts } : {}),
          ...(persisted.masterLayoutDefinitions ? { masterLayoutDefinitions: persisted.masterLayoutDefinitions } : {}),
          ...(persisted.slideLayouts ? { slideLayouts: persisted.slideLayouts.map(name => name ?? undefined) } : {}),
          ...(persisted.placeholderBindings ? { placeholderBindings: persisted.placeholderBindings } : {}),
          ...(persisted.animationEffects ? { animationEffects: persisted.animationEffects } : {}),
          ...(persisted.title ? { title: persisted.title } : {}),
          ...(persisted.themeColors ? { themeColors: persisted.themeColors } : {}),
          ...(persisted.themeFont ? { themeFont: persisted.themeFont } : {}),
          ...(persisted.objectAnimations ? { objectAnimations: persisted.objectAnimations } : {}),
          ...(persisted.nativeDiagrams ? { nativeDiagrams: persisted.nativeDiagrams } : {}),
        },
        outputPath: join(directory, sanitizePptxFilename(job.data.outputName)),
        partialPath: join(directory, `.${sanitizePptxFilename(job.data.outputName)}.partial.pptx`),
        controller: new AbortController(),
        captureTimer: undefined,
        ...(persisted.snapshot !== undefined
          ? { snapshot: persisted.snapshot }
          : {}),
        job: job.data,
      }
      // A job interrupted mid-capture or mid-run cannot resume the browser, so it
      // is recorded as failed with a retry available from the persisted snapshot.
      if (
        job.data.status === 'queued' ||
        job.data.status === 'running'
      ) {
        void rm(join(directory, EXPORT_OWNER_FILE), { force: true })
        this.#update(queued, {
          status: 'failed',
          phase: 'interrupted',
          completedAt: new Date().toISOString(),
          error: {
            code: 'EXPORT_INTERRUPTED',
            message:
              '导出在网关重启时中断，可从已保存快照重试。',
          },
        })
      }
      if (queued.job.status === 'completed' || queued.job.status === 'review-required') {
        const artifactPath = queued.job.status === 'completed' ? queued.outputPath : queued.partialPath
        const artifact = await lstat(artifactPath).catch(() => undefined)
        if (!artifact?.isFile() || artifact.isSymbolicLink() || artifact.size === 0) {
          this.#update(queued, {
            status: 'failed', phase: 'artifact-missing', downloadUrl: undefined,
            completedAt: new Date().toISOString(),
            error: { code: 'EXPORT_ARTIFACT_MISSING', message: '导出产物缺失或不可用，可从已保存快照重试。' },
          })
        }
      }
      this.#jobs.set(id, queued)
      this.#emit(queued)
    }
  }

  /**
   * Resume a failed/interrupted export from its persisted snapshot: re-run the
   * conversion (and review gate if enabled) without a fresh browser capture.
   */
  retry(exportId: string): ExportJob {
    const queued = this.#jobs.get(exportId)
    if (!queued) throw new Error('Export job was not found')
    if (!queued.snapshot)
      throw new Error('Export has no persisted snapshot to resume from')
    if (queued.job.status !== 'failed' && queued.job.status !== 'cancelled')
      throw new Error('Export is not in a resumable state')
    queued.controller = new AbortController()
    this.#update(queued, {
      status: 'queued',
      phase: 'resuming',
      objects: undefined,
      qa: undefined,
      warnings: [],
      ...(queued.input.themeRules ? { themeRules: { ...queued.input.themeRules, stage: 'pre-export', readback: undefined } } : {}),
      elementCount: undefined,
      slideCount: undefined,
      downloadUrl: undefined,
      progress: 25,
      error: undefined,
      completedAt: undefined,
    })
    this.#queue.push(exportId)
    this.#pump()
    return queued.job
  }

  #emit(queued: QueuedExport): void {
    this.#onUpdate?.(ExportJobSchema.parse(queued.job))
  }
}
