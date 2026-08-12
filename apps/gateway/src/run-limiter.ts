import type { HarnessKind } from '@fastppt/protocol'

export class HarnessRunLimitError extends Error {
  constructor(
    readonly harness: HarnessKind,
    readonly limit: number,
  ) {
    super(`The ${harness} Harness already has ${limit} active run(s).`)
    this.name = 'HarnessRunLimitError'
  }
}

export class HarnessRunLimiter {
  readonly #limit: number
  readonly #active = new Map<HarnessKind, number>()

  constructor(limit: number) {
    this.#limit = limit
  }

  acquire(harness: HarnessKind): () => void {
    const active = this.#active.get(harness) ?? 0
    if (active >= this.#limit)
      throw new HarnessRunLimitError(harness, this.#limit)
    this.#active.set(harness, active + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = (this.#active.get(harness) ?? 1) - 1
      if (remaining > 0) this.#active.set(harness, remaining)
      else this.#active.delete(harness)
    }
  }

  active(harness: HarnessKind): number {
    return this.#active.get(harness) ?? 0
  }
}
