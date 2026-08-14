import { randomUUID } from 'node:crypto'
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
import { ExportJobSchema } from '@fastppt/protocol'
import {
  probeEditablePptxRuntime,
  writeEditablePptx,
} from '@fastppt/slidewave/server'

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
}

export interface ExportDeckResult {
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
          ...(input.title ? { title: input.title } : {}),
          resolveFont: resolveFontDescriptor,
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
      )
    }
  }
}

export interface QueueExportInput {
  deckId: string
  title?: string
  outputName: string
  /** Require an explicit review confirmation before the export is published. */
  review?: boolean
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
    for (const name of children) {
      if (name.endsWith('.partial.pptx')) await rm(join(directory, name))
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
  readonly #jobs = new Map<string, QueuedExport>()
  readonly #queue: string[] = []
  #running: Promise<void> | undefined
  #disposed = false

  constructor(options: ExportJobManagerOptions) {
    this.#outputRoot = options.outputRoot
    this.#exporter = options.exporter ?? new WorkspaceSlidewaveExporter()
    this.#captureTimeoutMs = options.captureTimeoutMs ?? 120_000
    this.#onUpdate = options.onUpdate
    void this.#restore()
  }

  getStatus() {
    return this.#exporter.getStatus()
  }

  enqueue(input: QueueExportInput): ExportJob {
    if (this.#disposed) throw new Error('Export manager is closed')
    const id = randomUUID()
    const outputName = sanitizePptxFilename(input.outputName)
    const directory = join(this.#outputRoot, id)
    const queued: QueuedExport = {
      input: { ...input, outputName },
      outputPath: join(directory, outputName),
      partialPath: join(directory, `.${outputName}.partial.pptx`),
      controller: new AbortController(),
      captureTimer: undefined,
      job: ExportJobSchema.parse({
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
    return { path: queued.outputPath, name: queued.job.outputName }
  }

  async review(exportId: string, approved: boolean): Promise<ExportJob> {
    const queued = this.#jobs.get(exportId)
    if (!queued || queued.job.status !== 'review-required')
      throw new Error('Export is not awaiting review')
    if (!approved) {
      await rm(dirname(queued.partialPath), { recursive: true, force: true })
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
      void rm(dirname(queued.partialPath), { recursive: true, force: true }).catch(
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
    await this.#running
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
      })
      this.#update(queued, {
        warnings: result.warnings,
        slideCount: result.slideCount,
        elementCount: result.elementCount,
        qa: result.qa,
      })
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
      await rm(dirname(queued.partialPath), { recursive: true, force: true })
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

  #persist(queued: QueuedExport): Promise<void> {
    const directory = join(this.#outputRoot, queued.job.id)
    return writeFile(
      join(directory, JOB_STATE_FILE),
      `${JSON.stringify(
        {
          job: queued.job,
          snapshot: queued.snapshot,
          outputPath: queued.outputPath,
          partialPath: queued.partialPath,
          review: queued.input.review ?? false,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    ).catch(() => undefined)
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
        snapshot?: SlidewaveSnapshot
        outputPath?: string
        partialPath?: string
        review?: boolean
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
        }
      } catch {
        continue
      }
      const job = ExportJobSchema.safeParse(persisted.job)
      if (!job.success) continue
      const queued: QueuedExport = {
        input: {
          deckId: job.data.deckId,
          outputName: job.data.outputName,
          review: persisted.review ?? false,
        },
        outputPath: persisted.outputPath ?? join(directory, job.data.outputName),
        partialPath:
          persisted.partialPath ??
          join(directory, `.${job.data.outputName}.partial.pptx`),
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
    this.#update(queued, {
      status: 'queued',
      phase: 'resuming',
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
