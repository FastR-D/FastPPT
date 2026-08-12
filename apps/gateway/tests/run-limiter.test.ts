import { describe, expect, it } from 'vitest'

import { HarnessRunLimitError, HarnessRunLimiter } from '../src/run-limiter.js'

describe('HarnessRunLimiter', () => {
  it('limits each Harness independently and releases idempotently', () => {
    const limiter = new HarnessRunLimiter(1)
    const releaseCodex = limiter.acquire('codex')
    expect(() => limiter.acquire('codex')).toThrow(HarnessRunLimitError)
    const releaseClaude = limiter.acquire('claude')
    expect(limiter.active('codex')).toBe(1)
    expect(limiter.active('claude')).toBe(1)
    releaseCodex()
    releaseCodex()
    expect(limiter.active('codex')).toBe(0)
    expect(() => limiter.acquire('codex')).not.toThrow()
    releaseClaude()
  })
})
