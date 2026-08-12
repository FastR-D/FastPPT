import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'

export interface RpcCommand {
  command: string
  args: readonly string[]
  cwd: string
  env?: NodeJS.ProcessEnv
}

export interface JsonlRpcClientOptions {
  commandFactory: () => RpcCommand
  requestTimeoutMs?: number
  stopTimeoutMs?: number
  maxStderrLines?: number
  onStderrLine?: (line: string) => void
}

export interface RpcMessage {
  id?: string | number
  method?: string
  params?: unknown
  result?: unknown
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

interface PendingRequest {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  removeAbort?: () => void
}

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMessage(line: string): RpcMessage {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (cause) {
    throw new RpcError(
      'Codex app-server emitted invalid JSON',
      'INVALID_JSON',
      {
        line: line.slice(0, 1000),
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    )
  }
  if (!isRecord(value))
    throw new RpcError(
      'Codex app-server message must be an object',
      'INVALID_MESSAGE',
    )
  const error = isRecord(value.error)
    ? {
        ...(typeof value.error.code === 'number'
          ? { code: value.error.code }
          : {}),
        ...(typeof value.error.message === 'string'
          ? { message: value.error.message }
          : {}),
        ...('data' in value.error ? { data: value.error.data } : {}),
      }
    : undefined
  return {
    ...(typeof value.id === 'string' || typeof value.id === 'number'
      ? { id: value.id }
      : {}),
    ...(typeof value.method === 'string' ? { method: value.method } : {}),
    ...('params' in value ? { params: value.params } : {}),
    ...('result' in value ? { result: value.result } : {}),
    ...(error ? { error } : {}),
  }
}

export class JsonlRpcClient {
  readonly #options: Required<
    Pick<
      JsonlRpcClientOptions,
      'requestTimeoutMs' | 'stopTimeoutMs' | 'maxStderrLines'
    >
  > &
    Pick<JsonlRpcClientOptions, 'commandFactory'> & {
      onStderrLine: ((line: string) => void) | undefined
    }
  readonly #pending = new Map<string | number, PendingRequest>()
  readonly #messageListeners = new Set<(message: RpcMessage) => void>()
  readonly #exitListeners = new Set<(error: RpcError) => void>()
  readonly #protocolErrorListeners = new Set<(error: RpcError) => void>()
  readonly #stderr: string[] = []
  #child: ChildProcess | undefined
  #nextId = 1
  #expectedExit = false

  constructor(options: JsonlRpcClientOptions) {
    this.#options = {
      commandFactory: options.commandFactory,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      stopTimeoutMs: options.stopTimeoutMs ?? 5_000,
      maxStderrLines: options.maxStderrLines ?? 100,
      onStderrLine: options.onStderrLine,
    }
  }

  get running(): boolean {
    return this.#child !== undefined && this.#child.exitCode === null
  }

  get processId(): number | undefined {
    return this.#child?.pid
  }

  get stderr(): readonly string[] {
    return this.#stderr
  }

  onMessage(listener: (message: RpcMessage) => void): () => void {
    this.#messageListeners.add(listener)
    return () => this.#messageListeners.delete(listener)
  }

  onExit(listener: (error: RpcError) => void): () => void {
    this.#exitListeners.add(listener)
    return () => this.#exitListeners.delete(listener)
  }

  onProtocolError(listener: (error: RpcError) => void): () => void {
    this.#protocolErrorListeners.add(listener)
    return () => this.#protocolErrorListeners.delete(listener)
  }

  start(): void {
    if (this.running) return
    const command = this.#options.commandFactory()
    this.#expectedExit = false
    const child = spawn(command.command, [...command.args], {
      cwd: command.cwd,
      env: command.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.#child = child
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      if (!line.trim()) return
      try {
        this.#receive(parseMessage(line))
      } catch (cause) {
        const error =
          cause instanceof RpcError
            ? cause
            : new RpcError(String(cause), 'PROTOCOL_ERROR')
        for (const listener of this.#protocolErrorListeners) listener(error)
      }
    })
    const stderrLines = child.stderr
      ? createInterface({ input: child.stderr })
      : undefined
    stderrLines?.on('line', (line) => {
      const output = line.trim()
      if (!output) return
      this.#stderr.push(output)
      if (this.#stderr.length > this.#options.maxStderrLines)
        this.#stderr.splice(
          0,
          this.#stderr.length - this.#options.maxStderrLines,
        )
      this.#options.onStderrLine?.(output)
    })
    child.once('error', (cause) => this.#handleExit(cause.message))
    child.once('exit', (code, signal) => {
      if (this.#expectedExit) return
      this.#handleExit(
        `Codex app-server exited (${signal ?? `code ${String(code)}`})`,
      )
    })
  }

  async request<T>(
    method: string,
    params: unknown = {},
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    this.#assertRunning()
    const id = this.#nextId++
    const timeoutMs = options.timeoutMs ?? this.#options.requestTimeoutMs
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(
          new RpcError(`Codex RPC timed out: ${method}`, 'REQUEST_TIMEOUT', {
            method,
            timeoutMs,
          }),
        )
      }, timeoutMs)
      const pending: PendingRequest = { method, resolve, reject, timer }
      if (options.signal) {
        const abort = (): void => {
          clearTimeout(timer)
          this.#pending.delete(id)
          reject(
            new RpcError(`Codex RPC aborted: ${method}`, 'REQUEST_ABORTED'),
          )
        }
        options.signal.addEventListener('abort', abort, { once: true })
        pending.removeAbort = () =>
          options.signal?.removeEventListener('abort', abort)
      }
      this.#pending.set(id, pending)
    })
    this.#write({ id, method, params })
    return (await result) as T
  }

  notify(method: string, params: unknown = {}): void {
    this.#assertRunning()
    this.#write({ method, params })
  }

  respond(id: string | number, result: unknown): void {
    this.#assertRunning()
    this.#write({ id, result })
  }

  respondError(
    id: string | number,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    this.#assertRunning()
    this.#write({
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    })
  }

  async stop(): Promise<void> {
    const child = this.#child
    if (!child || child.exitCode !== null) {
      this.#child = undefined
      return
    }
    this.#expectedExit = true
    child.kill('SIGTERM')
    let exited = await this.#waitForExit(child)
    if (!exited) {
      child.kill('SIGKILL')
      exited = await this.#waitForExit(child)
    }
    if (!exited)
      throw new RpcError(
        'Codex app-server did not exit after SIGKILL',
        'PROCESS_STOP_FAILED',
        { pid: child.pid },
      )
    this.#child = undefined
    this.#rejectPending(
      new RpcError('Codex app-server was stopped', 'PROCESS_STOPPED'),
    )
  }

  async #waitForExit(child: ChildProcess): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true
    return await new Promise<boolean>((resolve) => {
      const onExit = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      const timer = setTimeout(() => {
        child.removeListener('exit', onExit)
        resolve(false)
      }, this.#options.stopTimeoutMs)
      child.once('exit', onExit)
    })
  }

  #assertRunning(): void {
    if (!this.running)
      throw new RpcError(
        'Codex app-server is not running',
        'PROCESS_NOT_RUNNING',
      )
  }

  #write(message: RpcMessage): void {
    const input = this.#child?.stdin
    if (!input?.writable)
      throw new RpcError(
        'Codex app-server stdin is unavailable',
        'STDIN_CLOSED',
      )
    input.write(`${JSON.stringify(message)}\n`)
  }

  #receive(message: RpcMessage): void {
    if (
      message.id !== undefined &&
      (message.result !== undefined || message.error)
    ) {
      const pending = this.#pending.get(message.id)
      if (pending) {
        this.#pending.delete(message.id)
        clearTimeout(pending.timer)
        pending.removeAbort?.()
        if (message.error)
          pending.reject(
            new RpcError(
              message.error.message ?? `Codex RPC failed: ${pending.method}`,
              'REMOTE_ERROR',
              {
                method: pending.method,
                remoteCode: message.error.code,
                data: message.error.data,
              },
            ),
          )
        else pending.resolve(message.result)
        return
      }
    }
    for (const listener of this.#messageListeners) listener(message)
  }

  #handleExit(message: string): void {
    this.#child = undefined
    const error = new RpcError(message, 'PROCESS_EXITED', {
      stderr: [...this.#stderr],
    })
    this.#rejectPending(error)
    for (const listener of this.#exitListeners) listener(error)
  }

  #rejectPending(error: RpcError): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.removeAbort?.()
      pending.reject(error)
    }
    this.#pending.clear()
  }
}
