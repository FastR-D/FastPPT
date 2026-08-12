import { relative, sep } from 'node:path'

import { watch, type FSWatcher } from 'chokidar'

import type { WorkspaceFileEvent } from '@fastppt/protocol'
import type { Stats } from 'node:fs'

import { normalizeRelativePath } from './path-policy.js'
import type { WorkspaceService } from './workspace-service.js'

export interface WorkspaceWatcherOptions {
  debounceMs?: number
  onError?: (error: Error) => void
}

type Listener = (events: readonly WorkspaceFileEvent[]) => void

interface PendingEvent {
  event: WorkspaceFileEvent
  identity?: string
}

function fileIdentity(stats: Stats | undefined): string | undefined {
  if (!stats || stats.ino === 0) return undefined
  return [
    stats.dev,
    stats.ino,
    stats.birthtimeMs,
    stats.isDirectory() ? 'directory' : 'file',
    stats.size,
  ].join(':')
}

export class WorkspaceWatcher {
  private readonly watcher: FSWatcher
  private readonly pending = new Map<string, PendingEvent>()
  private readonly identities = new Map<string, string>()
  private readonly listeners = new Set<Listener>()
  private readonly debounceMs: number
  private readonly readyPromise: Promise<void>
  private timer: ReturnType<typeof setTimeout> | undefined
  private initializing = true

  constructor(
    private readonly workspace: WorkspaceService,
    options: WorkspaceWatcherOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 120
    this.watcher = watch(workspace.root, {
      ignoreInitial: false,
      alwaysStat: true,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
      ignored: (absolutePath) => {
        const relativePath = relative(workspace.root, absolutePath)
          .split(sep)
          .join('/')
        return relativePath ? workspace.ignores(relativePath) : false
      },
    })
    this.readyPromise = new Promise((resolve, reject) => {
      this.watcher.once('ready', () => {
        this.initializing = false
        resolve()
      })
      this.watcher.on('error', (cause) => {
        const error =
          cause instanceof Error ? cause : new Error('Workspace watcher failed')
        if (this.initializing) {
          void this.watcher.close()
          reject(error)
          return
        }
        options.onError?.(error)
      })
    })
    this.watcher
      .on('add', (path, stats) => this.enqueue('added', path, false, stats))
      .on('change', (path, stats) =>
        this.enqueue('changed', path, false, stats),
      )
      .on('unlink', (path) => this.enqueue('removed', path, false))
      .on('addDir', (path, stats) => this.enqueue('added', path, true, stats))
      .on('unlinkDir', (path) => this.enqueue('removed', path, true))
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  ready(): Promise<void> {
    return this.readyPromise
  }

  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    await this.watcher.close()
  }

  private enqueue(
    type: 'added' | 'changed' | 'removed',
    absolutePath: string,
    isDirectory: boolean,
    stats?: Stats,
  ): void {
    const path = normalizeRelativePath(
      relative(this.workspace.root, absolutePath).split(sep).join('/'),
    )
    if (!path || this.workspace.ignores(path)) return
    const previousIdentity = this.identities.get(path)
    const identity = fileIdentity(stats) ?? previousIdentity
    if (type === 'removed') this.identities.delete(path)
    else if (identity) this.identities.set(path, identity)
    if (this.initializing) return
    this.pending.set(path, {
      event: { type, path, isDirectory },
      ...(identity ? { identity } : {}),
    })
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.debounceMs)
  }

  private flush(): void {
    this.timer = undefined
    const pending = [...this.pending.values()]
    this.pending.clear()
    const additionsByIdentity = new Map(
      pending.flatMap((candidate) =>
        candidate.event.type === 'added' && candidate.identity
          ? [[candidate.identity, candidate] as const]
          : [],
      ),
    )
    const consumed = new Set<PendingEvent>()
    const renamed: WorkspaceFileEvent[] = []
    for (const removed of pending) {
      if (removed.event.type !== 'removed' || !removed.identity) continue
      const added = additionsByIdentity.get(removed.identity)
      if (!added || added.event.isDirectory !== removed.event.isDirectory)
        continue
      consumed.add(removed)
      consumed.add(added)
      renamed.push({
        type: 'renamed',
        path: added.event.path,
        previousPath: removed.event.path,
        isDirectory: added.event.isDirectory,
      })
    }
    const coalesced = [
      ...pending
        .filter((candidate) => !consumed.has(candidate))
        .map(({ event }) => event),
      ...renamed,
    ]
    for (const listener of this.listeners) listener(coalesced)
  }
}
