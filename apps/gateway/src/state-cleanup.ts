import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export interface StateCleanupOptions {
  workspaceRoot: string
  /** Interval between sweeps in milliseconds; defaults to one hour. */
  intervalMs?: number
  /**
   * Entries older than this age (in milliseconds) are deleted during a
   * sweep; defaults to seven days.
   */
  maxAgeMs?: number
  onError?: (error: unknown) => void
}

export interface StateCleanup {
  /** Run one sweep immediately. */
  sweep(): Promise<void>
  /** Start the periodic timer. Calling again is a no-op. */
  start(): void
  /** Stop the periodic timer. */
  stop(): void
}

/**
 * Only non-persistent artifacts are swept. `state/` holds the SQLite audit
 * database and is never touched.
 */
const SWEEP_DIRECTORIES = ['cache', 'logs', 'runtime', 'exports'] as const

export function createStateCleanup(options: StateCleanupOptions): StateCleanup {
  const stateRoot = join(options.workspaceRoot, '.fastppt')
  const intervalMs = options.intervalMs ?? 3_600_000
  const maxAgeMs = options.maxAgeMs ?? 7 * 24 * 3_600_000
  let timer: ReturnType<typeof setInterval> | undefined

  async function sweep(): Promise<void> {
    for (const directory of SWEEP_DIRECTORIES) {
      const directoryPath = join(stateRoot, directory)
      let entries
      try {
        entries = await readdir(directoryPath, { withFileTypes: true })
      } catch {
        continue // Directory does not exist yet; that category has no artifacts.
      }
      for (const entry of entries) {
        const entryPath = join(directoryPath, entry.name)
        try {
          // lstat: never follow a symlink out of the state directory.
          const info = await lstat(entryPath)
          if (Date.now() - info.mtimeMs >= maxAgeMs)
            await rm(entryPath, { recursive: true, force: true })
        } catch {
          // Entry disappeared mid-sweep; treat as already cleaned.
        }
      }
    }
  }

  return {
    sweep,
    start() {
      if (timer) return
      timer = setInterval(() => {
        void sweep().catch((error) => options.onError?.(error))
      }, intervalMs)
      timer.unref()
    },
    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = undefined
    },
  }
}
