import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { WorkspaceService } from '../src/workspace-service.js'
import { WorkspaceWatcher } from '../src/workspace-watcher.js'

import type { WorkspaceFileEvent } from '@fastppt/protocol'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function nextBatch(
  watcher: WorkspaceWatcher,
  action: () => Promise<void>,
): Promise<readonly WorkspaceFileEvent[]> {
  const batch = new Promise<readonly WorkspaceFileEvent[]>((resolve) => {
    const unsubscribe = watcher.subscribe((events) => {
      unsubscribe()
      resolve(events)
    })
  })
  await action()
  return await batch
}

describe('WorkspaceWatcher', () => {
  it('reports proven inode-preserving renames', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fastppt-watcher-'))
    roots.push(root)
    await writeFile(join(root, 'before.md'), '# Before\n')
    const workspace = await WorkspaceService.create(root)
    const watcher = new WorkspaceWatcher(workspace, { debounceMs: 50 })
    await watcher.ready()
    try {
      const events = await nextBatch(watcher, () =>
        rename(join(root, 'before.md'), join(root, 'after.md')),
      )
      expect(events).toEqual([
        {
          type: 'renamed',
          path: 'after.md',
          previousPath: 'before.md',
          isDirectory: false,
        },
      ])
    } finally {
      await watcher.close()
    }
  })

  it('does not infer a rename from unrelated removal and addition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fastppt-watcher-'))
    roots.push(root)
    await writeFile(join(root, 'removed.md'), '# Removed\n')
    await mkdir(join(root, 'assets'))
    const workspace = await WorkspaceService.create(root)
    const watcher = new WorkspaceWatcher(workspace, { debounceMs: 50 })
    await watcher.ready()
    try {
      const events = await nextBatch(watcher, async () => {
        await rm(join(root, 'removed.md'))
        await writeFile(join(root, 'added.md'), '# Added\n')
      })
      expect(events).toEqual(
        expect.arrayContaining([
          { type: 'removed', path: 'removed.md', isDirectory: false },
          { type: 'added', path: 'added.md', isDirectory: false },
        ]),
      )
      expect(events).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'renamed' })]),
      )
    } finally {
      await watcher.close()
    }
  })
})
