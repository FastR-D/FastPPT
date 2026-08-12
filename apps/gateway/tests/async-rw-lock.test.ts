import { describe, expect, it } from 'vitest'

import { AsyncReadWriteLock } from '../src/async-rw-lock.js'

describe('AsyncReadWriteLock', () => {
  it('allows concurrent readers and waits to grant a writer', async () => {
    const lock = new AsyncReadWriteLock()
    const releaseFirst = await lock.acquireRead()
    const releaseSecond = await lock.acquireRead()
    let writerEntered = false
    const writer = lock.acquireWrite().then((release) => {
      writerEntered = true
      return release
    })
    await Promise.resolve()
    expect(writerEntered).toBe(false)
    releaseFirst()
    await Promise.resolve()
    expect(writerEntered).toBe(false)
    releaseSecond()
    const releaseWriter = await writer
    expect(writerEntered).toBe(true)
    releaseWriter()
  })

  it('does not let later readers bypass a queued writer', async () => {
    const lock = new AsyncReadWriteLock()
    const order: string[] = []
    const releaseReader = await lock.acquireRead()
    const writer = lock.acquireWrite().then((release) => {
      order.push('write')
      return release
    })
    const reader = lock.acquireRead().then((release) => {
      order.push('read')
      return release
    })
    releaseReader()
    const releaseWriter = await writer
    expect(order).toEqual(['write'])
    releaseWriter()
    const releaseLaterReader = await reader
    expect(order).toEqual(['write', 'read'])
    releaseLaterReader()
  })
})
