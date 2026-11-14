import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFilesStore } from '../../src/stores/files.js'

import type { ApiErrorBody, FileContent } from '@fastppt/protocol'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

// Only the browser's transport boundaries are replaced; client/schema/event handling stay real.
class Socket extends EventTarget {
  static readonly OPEN = 1
  static current: Socket
  readyState = 0

  constructor() {
    super()
    Socket.current = this
  }

  send(): void {}
  close(): void {}

  acknowledge(): void {
    this.readyState = Socket.OPEN
    this.dispatchEvent(new Event('open'))
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ type: 'subscribed', topics: ['workspace'], sequence: 0 }),
    }))
  }
}

interface PendingRequest {
  url: URL
  init: RequestInit | undefined
  reply: (body: unknown, status?: number) => void
}

let pending: PendingRequest[]
let tree: ReturnType<typeof deferred<Response>> | undefined
let store: ReturnType<typeof useFilesStore>

function file(path = 'a.md', content = 'original', revision = 'r1'): FileContent {
  return { path, content, revision, size: content.length, modifiedAt: '2026-11-10T00:00:00.000Z' }
}

function failure(status: number): ApiErrorBody {
  return { error: { code: status === 409 ? 'FILE_REVISION_CONFLICT' : 'INTERNAL_ERROR', message: 'request failed', retryable: false, requestId: 'test-request' } }
}

async function open(path = 'a.md', content = 'original', revision = 'r1'): Promise<void> {
  const opening = store.openFile(path)
  const request = pending.shift()!
  expect(request.url.searchParams.get('path')).toBe(path)
  request.reply(file(path, content, revision))
  await opening
}

async function reconnect(): Promise<void> {
  store.stop()
  const starting = store.start()
  Socket.current.acknowledge()
  await starting
}

beforeEach(() => {
  setActivePinia(createPinia())
  pending = []
  tree = undefined
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    const url = new URL(input)
    if (url.pathname === '/api/v1/workspace/files') {
      return tree?.promise ?? Promise.resolve(Response.json([]))
    }
    const response = deferred<Response>()
    pending.push({ url, init, reply: (body, status = 200) => response.resolve(Response.json(body, { status })) })
    return response.promise
  })
  store = useFilesStore()
})

afterEach(() => {
  store.stop()
  vi.unstubAllGlobals()
})

describe('file response ownership', () => {
  it('preserves typing during save and uses the acknowledged revision on the next save', async () => {
    await open()
    store.updateDraft('submitted')
    const saving = store.save()
    const first = pending.shift()!
    expect(typeof first.init?.body).toBe('string')
    expect(JSON.parse(first.init?.body as string)).toEqual({ path: 'a.md', content: 'submitted', expectedRevision: 'r1' })
    store.updateDraft('newer draft')
    first.reply(file('a.md', 'submitted', 'r2'))
    await saving
    expect(store.selectedFile?.revision).toBe('r2')
    expect(store.draft).toBe('newer draft')
    expect(store.dirty).toBe(true)

    const next = store.save()
    const second = pending.shift()!
    expect(typeof second.init?.body).toBe('string')
    expect(JSON.parse(second.init?.body as string)).toEqual({ path: 'a.md', content: 'newer draft', expectedRevision: 'r2' })
    second.reply(file('a.md', 'newer draft', 'r3'))
    await next
    expect(store.dirty).toBe(false)
    expect(store.saving).toBe(false)
  })

  for (const destination of ['b.md', 'a-b-a', 'reload']) {
    it.each([200, 409, 500])(`ignores an old save after ${destination} (status %s)`, async (status) => {
      await open()
      store.updateDraft('submitted')
      const oldSave = store.save()
      const oldRequest = pending.shift()!
      if (destination !== 'reload') await open('b.md')
      if (destination !== 'b.md') await open('a.md', 'reloaded', 'reload-revision')
      store.updateDraft('current draft')
      const selected = store.selectedFile
      oldRequest.reply(status === 200 ? file('a.md', 'submitted', 'r2') : failure(status), status)
      await oldSave
      expect(store.selectedFile).toBe(selected)
      expect(store.draft).toBe('current draft')
      expect(store.dirty).toBe(true)
      expect(store.externalChange).toBe(false)
      expect(store.error).toBeUndefined()
    })
  }

  it('lets a new session save while an old save is pending and keeps its saving state', async () => {
    await open()
    store.updateDraft('old draft')
    const oldSave = store.save()
    const oldRequest = pending.shift()!
    await open('b.md')
    store.updateDraft('B draft')
    const currentSave = store.save()
    expect(pending).toHaveLength(1)
    const currentRequest = pending.shift()!
    oldRequest.reply(failure(409), 409)
    await oldSave
    expect(store.saving).toBe(true)
    expect(store.error).toBeUndefined()
    currentRequest.reply(file('b.md', 'B draft', 'b2'))
    await currentSave
    expect(store.selectedFile?.path).toBe('b.md')
    expect(store.dirty).toBe(false)
    expect(store.saving).toBe(false)
  })

  it('keeps the current draft and reports a current-session conflict', async () => {
    await open()
    store.updateDraft('submitted')
    const saving = store.save()
    store.updateDraft('newer')
    pending.shift()!.reply(failure(409), 409)
    await saving
    expect(store.draft).toBe('newer')
    expect(store.selectedFile?.revision).toBe('r1')
    expect(store.externalChange).toBe(true)
    expect(store.error).toBeDefined()
  })

  it.each([200, 500])('ignores a superseded open response (status %s)', async (status) => {
    const oldOpen = store.openFile('a.md')
    const oldRequest = pending.shift()!
    await open('b.md')
    store.updateDraft('B draft')
    oldRequest.reply(status === 200 ? file() : failure(status), status)
    await oldOpen
    expect(store.selectedFile?.path).toBe('b.md')
    expect(store.draft).toBe('B draft')
    expect(store.error).toBeUndefined()
  })

  it('preserves input made while a reload is pending', async () => {
    await open()
    const reloading = store.openFile('a.md')
    store.updateDraft('typed during reload')
    pending.shift()!.reply(file('a.md', 'disk content', 'r2'))
    await reloading
    expect(store.selectedFile?.revision).toBe('r2')
    expect(store.draft).toBe('typed during reload')
    expect(store.dirty).toBe(true)
  })

  it.each(['switch', 'reload', 'typing', 'already-dirty', 'saved', 'newer-resync', 'error'])('guards reconnect resync after %s', async (action) => {
    await open()
    await store.start()
    Socket.current.acknowledge()
    if (action === 'already-dirty') store.updateDraft('unsaved')
    await reconnect()
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    const oldRead = pending.shift()!
    if (action === 'switch' || action === 'error') await open('b.md')
    if (action === 'reload') await open('a.md', 'reloaded', 'reload-revision')
    if (action === 'typing') store.updateDraft('typed during resync')
    if (action === 'saved') {
      store.updateDraft('saved content')
      const saving = store.save()
      pending.shift()!.reply(file('a.md', 'saved content', 'saved-revision'))
      await saving
    }
    if (action === 'newer-resync') {
      await reconnect()
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      pending.shift()!.reply(file('a.md', 'newer resync', 'newer-revision'))
      await vi.waitFor(() => expect(store.selectedFile?.revision).toBe('newer-revision'))
    }
    const selected = store.selectedFile
    const draft = store.draft
    oldRead.reply(action === 'error' ? failure(500) : file('a.md', 'stale disk', 'stale-revision'), action === 'error' ? 500 : 200)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await vi.waitFor(() => {
      if (action === 'typing' || action === 'already-dirty') expect(store.externalChange).toBe(true)
      else expect(store.externalChange).toBe(false)
      expect(store.selectedFile).toBe(selected)
      expect(store.draft).toBe(draft)
      expect(store.error).toBeUndefined()
    })
  })

  it('does not acquire a new selection after waiting for the resync tree', async () => {
    await open()
    await store.start()
    Socket.current.acknowledge()
    tree = deferred<Response>()
    store.stop()
    const starting = store.start()
    Socket.current.acknowledge()
    await open('b.md')
    tree.resolve(Response.json([]))
    await starting
    // Flush the real client's JSON/async continuation before checking for a stale read.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pending).toHaveLength(0)
    expect(store.selectedFile?.path).toBe('b.md')
  })

  it('refreshes a clean current session on reconnect', async () => {
    await open()
    await store.start()
    Socket.current.acknowledge()
    await reconnect()
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending.shift()!.reply(file('a.md', 'external edit', 'r2'))
    await vi.waitFor(() => expect(store.draft).toBe('external edit'))
    expect(store.selectedFile?.revision).toBe('r2')
    expect(store.dirty).toBe(false)
  })

  it.each(['a.md', 'b.md'])('finishes opening %s when reconnecting during its read', async (path) => {
    await open()
    await store.start()
    Socket.current.acknowledge()
    const opening = store.openFile(path)
    const request = pending.shift()!
    await reconnect()
    expect(pending).toHaveLength(0)
    request.reply(file(path, 'opened content', 'r2'))
    await opening
    expect(store.selectedFile?.path).toBe(path)
    expect(store.draft).toBe('opened content')
    expect(store.dirty).toBe(false)
  })

  it('waits for a reload baseline before allowing a save', async () => {
    await open()
    const opening = store.openFile('a.md')
    const request = pending.shift()!
    store.updateDraft('typed during reload')
    await store.save()
    expect(pending).toHaveLength(0)
    request.reply(file('a.md', 'reloaded', 'r2'))
    await opening
    const saving = store.save()
    const write = pending.shift()!
    expect(JSON.parse(write.init?.body as string)).toEqual({ path: 'a.md', content: 'typed during reload', expectedRevision: 'r2' })
    write.reply(file('a.md', 'typed during reload', 'r3'))
    await saving
    expect(store.dirty).toBe(false)
  })

  it('keeps the save session when a file event arrives after reverting the draft', async () => {
    await open()
    await store.start()
    Socket.current.acknowledge()
    store.updateDraft('submitted')
    const saving = store.save()
    const request = pending.shift()!
    store.updateDraft('original')
    expect(store.dirty).toBe(false)
    Socket.current.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        id: 'file-event', sequence: 1, timestamp: '2026-11-10T00:00:00.000Z',
        topic: 'workspace', type: 'file.changed', data: { path: 'a.md' },
      }),
    }))
    expect(pending).toHaveLength(0)
    expect(store.saving).toBe(true)
    request.reply(file('a.md', 'submitted', 'r2'))
    await saving
    expect(store.selectedFile?.revision).toBe('r2')
    expect(store.draft).toBe('original')
    expect(store.dirty).toBe(true)
  })
})
