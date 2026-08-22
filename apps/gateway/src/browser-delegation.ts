import { randomUUID } from 'node:crypto'

import {
  BrowserInspectionJobSchema,
  BrowserOverflowResultSchema,
  BrowserQualityResultSchema,
} from '@fastppt/protocol'

import type {
  BrowserInspectionJob,
} from '@fastppt/protocol'

interface PendingInspection {
  job: BrowserInspectionJob
  timer: ReturnType<typeof setTimeout>
}

export interface BrowserInspectionManagerOptions {
  timeoutMs: number
  onUpdate?: (job: BrowserInspectionJob) => void
}

export class BrowserInspectionManager {
  readonly #pending = new Map<string, PendingInspection>()
  readonly #completed = new Map<string, BrowserInspectionJob>()
  readonly #options: BrowserInspectionManagerOptions

  constructor(options: BrowserInspectionManagerOptions) {
    this.#options = options
  }

  enqueue(
    deckId: string,
    slide: number,
    kind: BrowserInspectionJob['kind'] = 'overflow',
    context: Pick<BrowserInspectionJob, 'revision' | 'themeId' | 'themeDigest' | 'profileDigest' | 'policy'> = {},
  ): BrowserInspectionJob {
    const job = BrowserInspectionJobSchema.parse({
      id: randomUUID(),
      deckId,
      slide,
      kind,
      ...context,
      status: 'queued',
      createdAt: new Date().toISOString(),
    })
    const timer = setTimeout(() => {
      this.#finish({
        ...job,
        status: 'failed',
        error: 'Browser capture timed out.',
      })
    }, this.#options.timeoutMs)
    timer.unref()
    this.#pending.set(job.id, { job, timer })
    this.#options.onUpdate?.(job)
    return job
  }

  submitResult(id: string, input: unknown): BrowserInspectionJob {
    const pending = this.#pending.get(id)
    if (!pending) throw new Error('Browser inspection is not awaiting capture.')
    try {
      return this.#finish({
        ...pending.job,
        status: 'completed',
        result:
          pending.job.kind === 'quality'
            ? BrowserQualityResultSchema.parse(input)
            : BrowserOverflowResultSchema.parse(input),
      })
    } catch (cause) {
      return this.#finish({
        ...pending.job,
        status: 'failed',
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  get(id: string): BrowserInspectionJob | undefined {
    return this.#pending.get(id)?.job ?? this.#completed.get(id)
  }

  pending(): BrowserInspectionJob[] {
    return [...this.#pending.values()].map(({ job }) =>
      BrowserInspectionJobSchema.parse(job),
    )
  }

  dispose(): void {
    for (const pending of this.#pending.values()) clearTimeout(pending.timer)
    this.#pending.clear()
  }

  #finish(job: BrowserInspectionJob): BrowserInspectionJob {
    const pending = this.#pending.get(job.id)
    if (pending) clearTimeout(pending.timer)
    this.#pending.delete(job.id)
    const parsed = BrowserInspectionJobSchema.parse(job)
    this.#completed.set(job.id, parsed)
    this.#options.onUpdate?.(parsed)
    return parsed
  }
}
