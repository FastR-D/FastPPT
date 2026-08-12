import { ServerEventSchema } from '@fastppt/protocol'
import { readonly, shallowRef } from 'vue'
import { z } from 'zod'

import { resolveGatewayUrl } from './useGatewayClient.js'

import type { ServerEvent } from '@fastppt/protocol'

const SubscriptionAckSchema = z.object({
  type: z.literal('subscribed'),
  topics: z.array(z.string()),
  sequence: z.number().int().nonnegative(),
})

function parseJson(data: string): unknown {
  return JSON.parse(data) as unknown
}

export interface EventStreamOptions {
  topics: readonly string[]
  onEvent: (event: ServerEvent) => void
  onResync?: (context: EventStreamResyncContext) => void | Promise<void>
}

export interface EventStreamResyncContext {
  previousSequence: number
  currentSequence: number
}

export function useEventStream(options: EventStreamOptions) {
  const status = shallowRef<'disconnected' | 'connecting' | 'connected'>(
    'disconnected',
  )
  const closeReason = shallowRef<string>()
  let socket: WebSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectAttempt = 0
  let stopped = true
  let lastSequence = 0
  let acknowledgedConnection = false
  let hasConnected = false
  let topics = [...options.topics]

  function subscribe(): void {
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ type: 'subscribe', topics }))
  }

  function connect(): void {
    stopped = false
    if (socket && socket.readyState <= WebSocket.OPEN) return
    status.value = 'connecting'
    const eventUrl = new URL('/api/v1/events', resolveGatewayUrl())
    eventUrl.protocol = eventUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    socket = new WebSocket(eventUrl)
    socket.addEventListener('open', () => {
      acknowledgedConnection = false
      reconnectAttempt = 0
      closeReason.value = undefined
      status.value = 'connected'
      subscribe()
    })
    socket.addEventListener('message', (message) => {
      if (typeof message.data !== 'string') return
      const payload = parseJson(message.data)
      const acknowledgement = SubscriptionAckSchema.safeParse(payload)
      if (acknowledgement.success) {
        if (!acknowledgedConnection) {
          acknowledgedConnection = true
          if (hasConnected) {
            void options.onResync?.({
              previousSequence: lastSequence,
              currentSequence: acknowledgement.data.sequence,
            })
          }
          hasConnected = true
        }
        lastSequence = acknowledgement.data.sequence
        return
      }
      const parsed = ServerEventSchema.safeParse(payload)
      if (!parsed.success || parsed.data.sequence <= lastSequence) return
      lastSequence = parsed.data.sequence
      options.onEvent(parsed.data)
    })
    socket.addEventListener('close', (event) => {
      socket = undefined
      status.value = 'disconnected'
      closeReason.value = event.reason || `连接关闭 (${event.code})`
      if (stopped) return
      const delay = Math.min(500 * 2 ** reconnectAttempt++, 10_000)
      reconnectTimer = setTimeout(connect, delay)
    })
  }

  function disconnect(): void {
    stopped = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = undefined
    socket?.close(1000, 'Client closed')
    socket = undefined
    status.value = 'disconnected'
  }

  function setTopics(nextTopics: readonly string[]): void {
    topics = [...new Set(nextTopics)]
    subscribe()
  }

  return {
    status: readonly(status),
    closeReason: readonly(closeReason),
    connect,
    disconnect,
    setTopics,
  }
}
