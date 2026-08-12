import type {
  ApprovalDecision,
  HarnessCapabilities,
  HarnessKind,
  HarnessStatus,
  SessionPage,
  UnifiedAgentEvent,
  UnifiedSession,
} from '@fastppt/protocol'

export interface ListSessionsInput {
  cwd: string
  cursor?: string
  limit?: number
}

export interface GetSessionInput {
  sessionId: string
}

export interface CreateSessionInput {
  cwd: string
  title?: string
}

export interface SessionReference {
  harness: HarnessKind
  sessionId: string
}

export interface ResumeSessionInput {
  sessionId: string
  cwd: string
}

export interface SessionHandle extends SessionReference {
  cwd: string
}

export interface MessageAttachment {
  type: 'image'
  path: string
}

export interface SkillInvocationInput {
  id: string
  name: string
  path: string
  version: string
}

export interface HarnessProcessLog {
  harness: HarnessKind
  stream: 'stderr'
  output: string
  sessionId?: string
  runId?: string
}

export type HarnessProcessLogHandler = (log: HarnessProcessLog) => void

export interface SendMessageInput {
  sessionId: string
  cwd: string
  content: string
  attachments: readonly MessageAttachment[]
  skills?: readonly SkillInvocationInput[]
  themeId?: string
  themeSkillId?: string
  themeSkillVersion?: string
}

export interface CancelRunInput {
  sessionId: string
  runId?: string
}

export interface ApprovalDecisionInput {
  approvalId: string
  decision: ApprovalDecision
}

export interface ForkSessionInput {
  sessionId: string
  cwd: string
}

export interface HarnessAdapter {
  readonly kind: HarnessKind
  getStatus(): Promise<HarnessStatus>
  getCapabilities(): Promise<HarnessCapabilities>
  listSessions(input: ListSessionsInput): Promise<SessionPage>
  getSession(input: GetSessionInput): Promise<UnifiedSession>
  createSession(input: CreateSessionInput): Promise<SessionReference>
  resumeSession(input: ResumeSessionInput): Promise<SessionHandle>
  sendMessage(input: SendMessageInput): AsyncIterable<UnifiedAgentEvent>
  cancelRun(input: CancelRunInput): Promise<void>
  approveRequest(input: ApprovalDecisionInput): Promise<void>
  forkSession?(input: ForkSessionInput): Promise<SessionReference>
  dispose(): Promise<void>
}

export class AsyncEventQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = []
  readonly #waiters: Array<(result: IteratorResult<T>) => void> = []
  #closed = false

  push(value: T): void {
    if (this.#closed) return
    const waiter = this.#waiters.shift()
    if (waiter) waiter({ done: false, value })
    else this.#values.push(value)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const waiter of this.#waiters.splice(0))
      waiter({ done: true, value: undefined })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.#values.shift()
        if (value !== undefined) return { done: false, value }
        if (this.#closed) return { done: true, value: undefined }
        return await new Promise<IteratorResult<T>>((resolve) =>
          this.#waiters.push(resolve),
        )
      },
    }
  }
}
