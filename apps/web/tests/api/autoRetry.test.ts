import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createConnectivityRetry,
  isConnectivityError,
} from '../../src/api/autoRetry.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('isConnectivityError', () => {
  it('treats fetch network failures as retryable', () => {
    expect(isConnectivityError(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('does not retry gateway HTTP errors', () => {
    const httpError = new Error('Unauthorized')
    Object.assign(httpError, { status: 401 })
    expect(isConnectivityError(httpError)).toBe(false)
    expect(isConnectivityError(new Error('boom'))).toBe(false)
  })
})

describe('createConnectivityRetry', () => {
  it('runs after the first backoff step', () => {
    vi.useFakeTimers()
    const retry = createConnectivityRetry()
    const run = vi.fn()

    retry.schedule(run)
    expect(run).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('grows the delay exponentially and caps it', () => {
    vi.useFakeTimers()
    const retry = createConnectivityRetry()
    const run = vi.fn()
    const expectedDelays = [500, 1000, 2000, 4000, 8000, 10_000, 10_000]

    for (const delay of expectedDelays) {
      retry.schedule(run)
      const callsBefore = run.mock.calls.length
      vi.advanceTimersByTime(delay - 1)
      expect(run.mock.calls.length).toBe(callsBefore)
      vi.advanceTimersByTime(1)
      expect(run.mock.calls.length).toBe(callsBefore + 1)
    }
  })

  it('reset() restarts the backoff from the base delay', () => {
    vi.useFakeTimers()
    const retry = createConnectivityRetry()
    const run = vi.fn()

    retry.schedule(run)
    vi.advanceTimersByTime(500)
    retry.reset()
    retry.schedule(run)
    vi.advanceTimersByTime(500)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('cancel() prevents a pending retry from firing', () => {
    vi.useFakeTimers()
    const retry = createConnectivityRetry()
    const run = vi.fn()

    retry.schedule(run)
    retry.cancel()
    vi.advanceTimersByTime(60_000)
    expect(run).not.toHaveBeenCalled()
  })

  it('schedule() replaces any pending retry', () => {
    vi.useFakeTimers()
    const retry = createConnectivityRetry()
    const first = vi.fn()
    const second = vi.fn()

    retry.schedule(first)
    retry.schedule(second)
    vi.advanceTimersByTime(60_000)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
