import { access, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStateCleanup } from '../src/state-cleanup.js'

const DAY_MS = 24 * 3_600_000

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function createStateTree(root: string): Promise<void> {
  const stateRoot = join(root, '.fastppt')
  await mkdir(join(stateRoot, 'state'), { recursive: true })
  await mkdir(join(stateRoot, 'cache'), { recursive: true })
  await mkdir(join(stateRoot, 'runtime'), { recursive: true })
  await mkdir(join(stateRoot, 'exports', 'job-1'), { recursive: true })
  await writeFile(join(stateRoot, 'state', 'fastppt.sqlite'), 'audit')
  await writeFile(join(stateRoot, 'cache', 'stale-cache.bin'), 'x')
  await writeFile(join(stateRoot, 'cache', 'fresh-cache.bin'), 'y')
  await writeFile(join(stateRoot, 'runtime', 'stale.json'), '{}')
  await writeFile(join(stateRoot, 'exports', 'job-1', 'deck.pptx'), 'pptx')
  const old = new Date(Date.now() - 8 * DAY_MS)
  await utimes(join(stateRoot, 'cache', 'stale-cache.bin'), old, old)
  await utimes(join(stateRoot, 'runtime', 'stale.json'), old, old)
  await utimes(join(stateRoot, 'exports', 'job-1'), old, old)
}

describe('createStateCleanup', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('removes entries older than maxAgeMs and keeps fresh state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fastppt-cleanup-'))
    try {
      await createStateTree(root)
      const cleanup = createStateCleanup({ workspaceRoot: root })
      await cleanup.sweep()

      const stateRoot = join(root, '.fastppt')
      expect(await exists(join(stateRoot, 'cache', 'stale-cache.bin'))).toBe(
        false,
      )
      expect(await exists(join(stateRoot, 'cache', 'fresh-cache.bin'))).toBe(
        true,
      )
      expect(await exists(join(stateRoot, 'runtime', 'stale.json'))).toBe(
        false,
      )
      expect(await exists(join(stateRoot, 'exports', 'job-1'))).toBe(false)
      // state/ 是 SQLite 审计库,永远保留
      expect(await exists(join(stateRoot, 'state', 'fastppt.sqlite'))).toBe(
        true,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('tolerates a missing or partial state directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fastppt-cleanup-'))
    try {
      await expect(
        createStateCleanup({ workspaceRoot: root }).sweep(),
      ).resolves.toBeUndefined()
      await mkdir(join(root, '.fastppt', 'state'), { recursive: true })
      await expect(
        createStateCleanup({ workspaceRoot: root }).sweep(),
      ).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('never removes a target through a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fastppt-cleanup-'))
    try {
      const cache = join(root, '.fastppt', 'cache')
      const outside = join(root, 'keep-me.bin')
      await mkdir(cache, { recursive: true })
      await writeFile(outside, 'target')
      const old = new Date(Date.now() - 8 * DAY_MS)
      await utimes(outside, old, old)
      await symlink(outside, join(cache, 'escape-link'))

      const cleanup = createStateCleanup({ workspaceRoot: root })
      await cleanup.sweep()

      expect(await exists(outside)).toBe(true)
      expect(await exists(join(cache, 'escape-link'))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('sweeps on the configured interval until stopped', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(join(tmpdir(), 'fastppt-cleanup-'))
    try {
      const cache = join(root, '.fastppt', 'cache')
      await mkdir(cache, { recursive: true })
      const stale = join(cache, 'stale.bin')
      await writeFile(stale, 'x')
      const old = new Date(Date.now() - 8 * DAY_MS)
      await utimes(stale, old, old)

      const cleanup = createStateCleanup({
        workspaceRoot: root,
        intervalMs: 1_000,
      })
      cleanup.start()
      await vi.advanceTimersByTimeAsync(1_000)
      // sweep 内含真实 fs I/O,不随 fake-timer 微任务 flush 完成,轮询等待落定
      await vi.waitFor(async () => {
        expect(await exists(stale)).toBe(false)
      })

      const second = join(cache, 'second.bin')
      await writeFile(second, 'y')
      await utimes(second, old, old)
      cleanup.stop()
      await vi.advanceTimersByTimeAsync(3_000)
      expect(await exists(second)).toBe(true)
    } finally {
      vi.useRealTimers()
      await rm(root, { recursive: true, force: true })
    }
  })
})
