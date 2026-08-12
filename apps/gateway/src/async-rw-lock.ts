type Release = () => void

interface Waiter {
  kind: 'read' | 'write'
  resolve: (release: Release) => void
}

export class AsyncReadWriteLock {
  readonly #waiters: Waiter[] = []
  #readers = 0
  #writer = false

  acquireRead(): Promise<Release> {
    if (!this.#writer && this.#waiters.length === 0) {
      this.#readers += 1
      return Promise.resolve(this.#releaseReader())
    }
    return new Promise((resolve) => {
      this.#waiters.push({ kind: 'read', resolve })
      this.#drain()
    })
  }

  acquireWrite(): Promise<Release> {
    if (!this.#writer && this.#readers === 0 && this.#waiters.length === 0) {
      this.#writer = true
      return Promise.resolve(this.#releaseWriter())
    }
    return new Promise((resolve) => {
      this.#waiters.push({ kind: 'write', resolve })
      this.#drain()
    })
  }

  #drain(): void {
    if (this.#writer || this.#readers > 0) return
    const first = this.#waiters[0]
    if (!first) return
    if (first.kind === 'write') {
      this.#waiters.shift()
      this.#writer = true
      first.resolve(this.#releaseWriter())
      return
    }
    while (this.#waiters[0]?.kind === 'read') {
      const reader = this.#waiters.shift()
      if (!reader) return
      this.#readers += 1
      reader.resolve(this.#releaseReader())
    }
  }

  #releaseReader(): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      this.#readers -= 1
      this.#drain()
    }
  }

  #releaseWriter(): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      this.#writer = false
      this.#drain()
    }
  }
}
