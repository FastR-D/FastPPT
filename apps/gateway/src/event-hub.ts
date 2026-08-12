import { randomUUID } from 'node:crypto'

import { ClientSubscriptionSchema, ServerEventSchema } from '@fastppt/protocol'

import type { ServerEvent } from '@fastppt/protocol'
import type { RawData, WebSocket } from 'ws'

const MAX_BUFFERED_BYTES = 1024 * 1024

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown
}

function decodeMessage(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}

export class EventHub {
  private readonly subscriptions = new Map<WebSocket, Set<string>>()
  private readonly alive = new WeakSet<WebSocket>()
  private sequence = 0
  private readonly heartbeat: ReturnType<typeof setInterval>

  constructor() {
    this.heartbeat = setInterval(() => {
      for (const socket of this.subscriptions.keys()) {
        if (!this.alive.has(socket)) {
          socket.terminate()
          continue
        }
        this.alive.delete(socket)
        socket.ping()
      }
    }, 30_000)
    this.heartbeat.unref()
  }

  connect(socket: WebSocket): void {
    this.subscriptions.set(socket, new Set())
    this.alive.add(socket)
    socket.on('pong', () => this.alive.add(socket))
    socket.on('message', (data) => this.receive(socket, data))
    socket.on('close', () => this.subscriptions.delete(socket))
    socket.on('error', () => this.subscriptions.delete(socket))
  }

  publish(topic: string, type: string, data: unknown): ServerEvent {
    const event = ServerEventSchema.parse({
      id: randomUUID(),
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      topic,
      type,
      data,
    })
    const serialized = JSON.stringify(event)
    for (const [socket, topics] of this.subscriptions) {
      if (!topics.has(topic)) continue
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        socket.close(1013, 'Client is too slow')
        continue
      }
      if (socket.readyState === socket.OPEN) socket.send(serialized)
    }
    return event
  }

  close(): void {
    clearInterval(this.heartbeat)
    for (const socket of this.subscriptions.keys()) {
      socket.close(1001, 'FastPPT Gateway is shutting down')
    }
    this.subscriptions.clear()
  }

  private receive(socket: WebSocket, data: RawData): void {
    try {
      const subscription = ClientSubscriptionSchema.parse(
        parseJson(decodeMessage(data)),
      )
      this.subscriptions.set(socket, new Set(subscription.topics))
      socket.send(
        JSON.stringify({
          type: 'subscribed',
          topics: subscription.topics,
          sequence: this.sequence,
        }),
      )
    } catch {
      socket.close(1008, 'Invalid subscription message')
    }
  }
}
