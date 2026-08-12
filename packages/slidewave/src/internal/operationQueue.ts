export type OperationCommit = () => unknown | Promise<unknown>

interface QueuedOperation {
  rasterPromise?: Promise<unknown>
  commit: OperationCommit
}

/**
 * Starts raster work eagerly, then commits operations in insertion order.
 * Draining the current batch before committing ensures that operations queued
 * by a commit are deferred until the next flush.
 */
export class OperationQueue {
  readonly #pending: QueuedOperation[] = []

  get size(): number {
    return this.#pending.length
  }

  enqueue(commit: OperationCommit): void {
    this.#pending.push({ commit })
  }

  enqueueAfter<T>(rasterPromise: Promise<T>, commit: OperationCommit): void {
    this.#pending.push({ rasterPromise, commit })
  }

  async flush(): Promise<void> {
    const batch = this.#pending.splice(0)
    if (batch.length === 0) return

    await Promise.all(batch.map((operation) => operation.rasterPromise))

    for (const operation of batch) {
      await operation.commit()
    }
  }
}
