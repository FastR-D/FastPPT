import { describe, expect, it } from 'vitest'

import { OperationQueue } from '../../src/internal/operationQueue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('OperationQueue', () => {
  it('commits synchronous operations in insertion order', async () => {
    const queue = new OperationQueue()
    const commits: number[] = []

    queue.enqueue(() => commits.push(1))
    queue.enqueue(() => commits.push(2))

    await queue.flush()

    expect(commits).toEqual([1, 2])
    expect(queue.size).toBe(0)
  })

  it('waits for raster work in parallel before committing in order', async () => {
    const queue = new OperationQueue()
    const first = deferred<void>()
    const second = deferred<void>()
    const commits: string[] = []

    queue.enqueueAfter(first.promise, () => commits.push('first'))
    queue.enqueueAfter(second.promise, () => commits.push('second'))

    const flushing = queue.flush()
    second.resolve()
    await Promise.resolve()
    expect(commits).toEqual([])

    first.resolve()
    await flushing
    expect(commits).toEqual(['first', 'second'])
  })

  it('defers operations queued by a commit until the next flush', async () => {
    const queue = new OperationQueue()
    const commits: string[] = []

    queue.enqueue(() => {
      commits.push('first')
      queue.enqueue(() => commits.push('next batch'))
    })

    await queue.flush()
    expect(commits).toEqual(['first'])
    expect(queue.size).toBe(1)

    await queue.flush()
    expect(commits).toEqual(['first', 'next batch'])
  })

  it('does not commit a batch when raster work fails', async () => {
    const queue = new OperationQueue()
    const raster = deferred<void>()
    const commits: string[] = []

    queue.enqueueAfter(raster.promise, () => commits.push('commit'))
    const flushing = queue.flush()
    raster.reject(new Error('raster failed'))

    await expect(flushing).rejects.toThrow('raster failed')
    expect(commits).toEqual([])
    expect(queue.size).toBe(0)
  })
})
