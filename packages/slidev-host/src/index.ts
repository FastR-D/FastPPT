import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, lstat, readdir, rm, rmdir, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SlidevProcessStateSchema } from '@fastppt/protocol'

import type { SlidevError, SlidevProcessState } from '@fastppt/protocol'

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_STOP_TIMEOUT_MS = 5_000
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000

export interface SlidevStartInput {
  deckId: string
  entryFile: string
  themePackageRoot?: string
}

export interface SlidevCommand {
  command: string
  args: readonly string[]
  cwd: string
  env?: NodeJS.ProcessEnv
}

export interface SlidevHostOptions {
  commandFactory?: (
    input: SlidevStartInput,
    port: number,
    cacheDirectory: string,
  ) => SlidevCommand
  readyTimeoutMs?: number
  stopTimeoutMs?: number
  idleTimeoutMs?: number
  onState?: (state: SlidevProcessState) => void
  onLog?: (entry: SlidevLogEntry) => void
  fetchImplementation?: typeof fetch
  cacheRoot?: string
  runnerPath?: string
}

export interface SlidevLogEntry {
  deckId: string
  stream: 'stdout' | 'stderr'
  message: string
}

export interface SlidevEnvironmentStatus {
  status: 'available' | 'unavailable'
  version: string
  message?: string
}

interface ManagedProcess {
  input: SlidevStartInput
  child: ChildProcess
  state: SlidevProcessState
  output: string[]
  idleTimer: ReturnType<typeof setTimeout> | undefined
  expectedExit: boolean
  preserveCacheOnExit: boolean
  cacheDirectory: string
}

const SLIDEV_IMPORT_GLOB_PATTERN = /^import-glob\.[a-f\d]{10}\.ts$/

function cleanOutput(value: string): string[] {
  return value
    .replace(ANSI_PATTERN, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function minimalChildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keys = [
    'HOME',
    'LANG',
    'LC_ALL',
    'NODE_OPTIONS',
    'PATH',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TMPDIR',
  ]
  return Object.fromEntries(
    keys.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]]],
    ),
  )
}

async function allocatePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to allocate a loopback port'))
        return
      }
      const port = address.port
      server.close((error) => (error ? reject(error) : resolvePort(port)))
    })
  })
}

function defaultCommandFactory(
  input: SlidevStartInput,
  port: number,
  cacheDirectory: string,
  runnerPath = fileURLToPath(new URL('../runner.mjs', import.meta.url)),
): SlidevCommand {
  const themePackageRoot =
    input.themePackageRoot ??
    dirname(
      createRequire(import.meta.url).resolve(
        '@slidev/theme-default/package.json',
      ),
    )
  return {
    command: process.execPath,
    args: [
      runnerPath,
      input.entryFile,
      String(port),
      `/api/v1/preview/p${String(port)}/`,
      cacheDirectory,
      themePackageRoot,
    ],
    cwd: dirname(input.entryFile),
    env: minimalChildEnvironment(process.env),
  }
}

const SLIDEV_CACHE_ROOT = join(tmpdir(), 'fastppt-slidev')

async function isRealDirectory(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => undefined)
  return info?.isDirectory() === true && !info.isSymbolicLink()
}

export async function cleanupSlidevVirtualModules(
  deckRoot: string,
): Promise<number> {
  const nodeModules = join(deckRoot, 'node_modules')
  const slidevDirectory = join(nodeModules, '.slidev')
  const virtualDirectory = join(slidevDirectory, 'virtual')
  if (
    !(await isRealDirectory(nodeModules)) ||
    !(await isRealDirectory(slidevDirectory)) ||
    !(await isRealDirectory(virtualDirectory))
  )
    return 0

  const entries = await readdir(virtualDirectory, {
    withFileTypes: true,
  }).catch(() => [])
  let removed = 0
  for (const entry of entries) {
    if (!entry.isFile() || !SLIDEV_IMPORT_GLOB_PATTERN.test(entry.name))
      continue
    await unlink(join(virtualDirectory, entry.name)).catch(() => undefined)
    removed += 1
  }
  await rmdir(virtualDirectory).catch(() => undefined)
  await rmdir(slidevDirectory).catch(() => undefined)
  return removed
}

function cacheKey(input: SlidevStartInput): string {
  return createHash('sha256')
    .update(input.deckId)
    .update('\0')
    .update(input.entryFile)
    .digest('hex')
    .slice(0, 20)
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return !(
      cause instanceof Error &&
      'code' in cause &&
      cause.code === 'ESRCH'
    )
  }
}

async function portIsListening(port: number): Promise<boolean> {
  return await new Promise((resolveListening) => {
    const socket = connect({ host: '127.0.0.1', port })
    const finish = (listening: boolean): void => {
      socket.destroy()
      resolveListening(listening)
    }
    socket.setTimeout(150, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

export async function cleanupStaleSlidevCaches(
  cacheRoot = SLIDEV_CACHE_ROOT,
): Promise<void> {
  let entries
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const entryPath = join(cacheRoot, entry.name)
    const info = await lstat(entryPath).catch(() => undefined)
    if (!info?.isDirectory() || info.isSymbolicLink()) continue
    const ownerPid = /^pid-(\d+)(?:-|$)/.exec(entry.name)?.[1]
    if (ownerPid) {
      if (!processExists(Number(ownerPid)))
        await rm(entryPath, { recursive: true, force: true })
      continue
    }
    if (/^\d+$/.test(entry.name)) {
      const active = await portIsListening(Number(entry.name))
      if (!active) await rm(entryPath, { recursive: true, force: true })
    }
  }
  await rmdir(cacheRoot).catch(() => undefined)
}

export async function probeSlidevEnvironment(): Promise<SlidevEnvironmentStatus> {
  try {
    const require = createRequire(import.meta.url)
    const cliPath = require.resolve('@slidev/cli/bin/slidev.mjs')
    await access(cliPath)
    await access(require.resolve('@slidev/theme-default/package.json'))
    await access(fileURLToPath(new URL('../runner.mjs', import.meta.url)))
    const manifestPath = require.resolve('@slidev/cli/package.json')
    const manifest = require(manifestPath) as {
      version?: unknown
    }
    return {
      status: 'available',
      version:
        typeof manifest.version === 'string'
          ? `@slidev/cli ${manifest.version}`
          : '@slidev/cli',
    }
  } catch (cause) {
    return {
      status: 'unavailable',
      version: '@slidev/cli unavailable',
      message: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

export class SlidevHost {
  readonly #processes = new Map<string, ManagedProcess>()
  readonly #commandFactory: NonNullable<SlidevHostOptions['commandFactory']>
  readonly #readyTimeoutMs: number
  readonly #stopTimeoutMs: number
  readonly #idleTimeoutMs: number
  readonly #onState: NonNullable<SlidevHostOptions['onState']>
  readonly #onLog: NonNullable<SlidevHostOptions['onLog']>
  readonly #fetch: typeof fetch
  readonly #cacheRoot: string
  readonly #cacheOwner: string
  #cleanupStarted = false

  constructor(options: SlidevHostOptions = {}) {
    this.#commandFactory =
      options.commandFactory ??
      ((input, port, cacheDirectory) =>
        defaultCommandFactory(input, port, cacheDirectory, options.runnerPath))
    this.#readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    this.#stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.#onState = options.onState ?? (() => undefined)
    this.#onLog = options.onLog ?? (() => undefined)
    this.#fetch = options.fetchImplementation ?? fetch
    this.#cacheRoot = options.cacheRoot ?? SLIDEV_CACHE_ROOT
    this.#cacheOwner = `pid-${String(process.pid)}-${randomUUID()}`
  }

  getState(deckId: string): SlidevProcessState {
    return (
      this.#processes.get(deckId)?.state ?? {
        deckId,
        status: 'stopped',
      }
    )
  }

  getEnvironmentStatus(): Promise<SlidevEnvironmentStatus> {
    return probeSlidevEnvironment()
  }

  listStates(): readonly SlidevProcessState[] {
    return [...this.#processes.values()].map((process) => process.state)
  }

  async start(input: SlidevStartInput): Promise<SlidevProcessState> {
    if (!this.#cleanupStarted) {
      this.#cleanupStarted = true
      await cleanupStaleSlidevCaches(this.#cacheRoot)
    }
    const current = this.#processes.get(input.deckId)
    if (
      current &&
      (current.state.status === 'starting' || current.state.status === 'ready')
    ) {
      this.touch(input.deckId)
      return current.state
    }

    await cleanupSlidevVirtualModules(dirname(input.entryFile))

    const port = await allocatePort()
    const previewUrl = `http://127.0.0.1:${port}/`
    const cacheDirectory = join(
      this.#cacheRoot,
      this.#cacheOwner,
      `deck-${cacheKey(input)}`,
    )
    const command = this.#commandFactory(input, port, cacheDirectory)
    const child = spawn(command.command, [...command.args], {
      cwd: command.cwd,
      env: command.env ?? minimalChildEnvironment(process.env),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const managed: ManagedProcess = {
      input,
      child,
      state: SlidevProcessStateSchema.parse({
        deckId: input.deckId,
        pid: child.pid,
        port,
        status: 'starting',
        previewUrl,
        startedAt: new Date().toISOString(),
      }),
      output: [],
      idleTimer: undefined,
      expectedExit: false,
      preserveCacheOnExit: false,
      cacheDirectory,
    }
    this.#processes.set(input.deckId, managed)
    this.#emit(managed)

    const appendOutput = (
      stream: SlidevLogEntry['stream'],
      chunk: Buffer,
    ): void => {
      const lines = cleanOutput(chunk.toString('utf8'))
      managed.output.push(...lines)
      if (managed.output.length > 100)
        managed.output.splice(0, managed.output.length - 100)
      for (const message of lines)
        this.#onLog({ deckId: input.deckId, stream, message })
    }
    child.stdout?.on('data', (chunk: Buffer) => appendOutput('stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => appendOutput('stderr', chunk))
    child.once('error', (error) =>
      this.#markFailed(managed, 'SLIDEV_SPAWN_FAILED', error.message),
    )
    child.once('exit', (code, signal) => {
      void this.#cleanupProcessArtifacts(managed, !managed.preserveCacheOnExit)
      if (managed.expectedExit) return
      this.#markFailed(
        managed,
        'SLIDEV_EXITED',
        `Slidev exited unexpectedly (${signal ?? `code ${String(code)}`})`,
      )
    })

    try {
      await this.#waitUntilReady(managed)
      if (managed.state.status === 'failed') return managed.state
      managed.state = SlidevProcessStateSchema.parse({
        ...managed.state,
        status: 'ready',
        lastError: undefined,
      })
      this.#emit(managed)
      this.touch(input.deckId)
      return managed.state
    } catch (cause) {
      this.#markFailed(
        managed,
        'SLIDEV_START_TIMEOUT',
        cause instanceof Error ? cause.message : String(cause),
      )
      await this.#terminate(managed)
      await this.#cleanupProcessArtifacts(managed, true)
      return managed.state
    }
  }

  async restart(deckId: string): Promise<SlidevProcessState> {
    const managed = this.#processes.get(deckId)
    if (!managed)
      throw new Error(`Cannot restart unknown Slidev deck: ${deckId}`)
    const input = managed.input
    managed.state = SlidevProcessStateSchema.parse({
      ...managed.state,
      status: 'restarting',
    })
    this.#emit(managed)
    managed.preserveCacheOnExit = true
    await this.#terminate(managed)
    await this.#cleanupProcessArtifacts(managed, false)
    this.#processes.delete(deckId)
    return await this.start(input)
  }

  async stop(deckId: string): Promise<SlidevProcessState> {
    const managed = this.#processes.get(deckId)
    if (!managed) return { deckId, status: 'stopped' }
    await this.#terminate(managed)
    await this.#cleanupProcessArtifacts(managed, true)
    managed.state = { deckId, status: 'stopped' }
    this.#emit(managed)
    this.#processes.delete(deckId)
    return managed.state
  }

  touch(deckId: string): void {
    const managed = this.#processes.get(deckId)
    if (!managed || managed.state.status !== 'ready') return
    if (managed.idleTimer) clearTimeout(managed.idleTimer)
    managed.idleTimer = setTimeout(
      () => void this.stop(deckId),
      this.#idleTimeoutMs,
    )
    managed.idleTimer.unref()
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.#processes.keys()].map(async (deckId) => this.stop(deckId)),
    )
  }

  #emit(managed: ManagedProcess): void {
    this.#onState(managed.state)
  }

  #markFailed(managed: ManagedProcess, code: string, message: string): void {
    if (managed.state.status === 'failed') return
    const lastError: SlidevError = {
      code,
      message,
      output: [...managed.output],
    }
    managed.state = SlidevProcessStateSchema.parse({
      ...managed.state,
      status: 'failed',
      lastError,
    })
    this.#emit(managed)
  }

  async #waitUntilReady(managed: ManagedProcess): Promise<void> {
    const deadline = Date.now() + this.#readyTimeoutMs
    let lastError = 'Slidev did not answer its health probe'
    while (Date.now() < deadline) {
      if (managed.state.status === 'failed')
        throw new Error(managed.state.lastError?.message)
      try {
        const response = await this.#fetch(managed.state.previewUrl ?? '', {
          signal: AbortSignal.timeout(1000),
        })
        if (response.ok) return
        lastError = `Slidev health probe returned ${response.status}`
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : String(cause)
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
    }
    throw new Error(`Slidev readiness timed out: ${lastError}`)
  }

  async #terminate(managed: ManagedProcess): Promise<void> {
    if (managed.idleTimer) clearTimeout(managed.idleTimer)
    managed.idleTimer = undefined
    managed.expectedExit = true
    if (managed.child.exitCode !== null || managed.child.signalCode !== null)
      return
    managed.child.kill('SIGTERM')
    let exited = await this.#waitForExit(managed.child)
    if (!exited) {
      managed.child.kill('SIGKILL')
      exited = await this.#waitForExit(managed.child)
    }
    if (!exited)
      throw new Error(
        `Slidev process ${String(managed.child.pid)} did not exit after SIGKILL`,
      )
  }

  async #cleanupProcessArtifacts(
    managed: ManagedProcess,
    removeCache: boolean,
  ): Promise<void> {
    await cleanupSlidevVirtualModules(dirname(managed.input.entryFile))
    if (!removeCache) return
    await rm(managed.cacheDirectory, { recursive: true, force: true })
    await rmdir(dirname(managed.cacheDirectory)).catch(() => undefined)
    await rmdir(this.#cacheRoot).catch(() => undefined)
  }

  async #waitForExit(child: ChildProcess): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true
    return await new Promise<boolean>((resolveExit) => {
      const onExit = (): void => {
        clearTimeout(timer)
        resolveExit(true)
      }
      const timer = setTimeout(() => {
        child.removeListener('exit', onExit)
        resolveExit(false)
      }, this.#stopTimeoutMs)
      child.once('exit', onExit)
    })
  }
}
