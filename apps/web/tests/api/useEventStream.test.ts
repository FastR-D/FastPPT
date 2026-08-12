import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useEventStream } from '../../src/api/useEventStream.js'

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readonly protocol: string
  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []

  constructor(url: string | URL, protocol: string | string[]) {
    super()
    this.url = String(url)
    this.protocol = Array.isArray(protocol) ? protocol.join(',') : protocol
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code = 1000, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED
    const event = new Event('close')
    Object.assign(event, { code, reason })
    this.dispatchEvent(event)
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  message(data: unknown): void {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(data) }),
    )
  }
}

describe('useEventStream reconnect recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('localStorage', {
      getItem: () => 'test-token',
      setItem: vi.fn(),
    })
    vi.stubGlobal('window', {
      location: { search: '', pathname: '/' },
      history: { replaceState: vi.fn() },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('resyncs authoritative state after every reconnect', async () => {
    const onEvent = vi.fn()
    const onResync = vi.fn()
    const stream = useEventStream({
      topics: ['workspace'],
      onEvent,
      onResync,
    })

    stream.connect()
    const first = FakeWebSocket.instances[0]!
    expect(first.url).toBe('ws://127.0.0.1:4317/api/v1/events')
    first.open()
    first.message({ type: 'subscribed', topics: ['workspace'], sequence: 4 })
    expect(onResync).not.toHaveBeenCalled()

    first.close(1006, 'network lost')
    await vi.advanceTimersByTimeAsync(500)
    const second = FakeWebSocket.instances[1]!
    second.open()
    second.message({ type: 'subscribed', topics: ['workspace'], sequence: 9 })
    expect(onResync).toHaveBeenLastCalledWith({
      previousSequence: 4,
      currentSequence: 9,
    })

    second.close(1006, 'gateway restarted')
    await vi.advanceTimersByTimeAsync(500)
    const third = FakeWebSocket.instances[2]!
    third.open()
    third.message({ type: 'subscribed', topics: ['workspace'], sequence: 0 })
    expect(onResync).toHaveBeenLastCalledWith({
      previousSequence: 9,
      currentSequence: 0,
    })
    expect(onResync).toHaveBeenCalledTimes(2)

    third.message({
      id: 'event-1',
      sequence: 1,
      timestamp: '2026-08-04T00:00:00.000Z',
      topic: 'workspace',
      type: 'file.changed',
      data: { path: 'slides.md' },
    })
    third.message({
      id: 'event-1',
      sequence: 1,
      timestamp: '2026-08-04T00:00:00.000Z',
      topic: 'workspace',
      type: 'file.changed',
      data: { path: 'slides.md' },
    })
    expect(onEvent).toHaveBeenCalledTimes(1)
    stream.disconnect()
  })
})
