import {
  cpSync,
  mkdtempSync as createTemporaryDirectorySync,
  readFileSync,
  existsSync,
  writeFileSync,
} from 'node:fs'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

import {
  DeckSummarySchema,
  ApplicationStateSchema,
  FileContentSchema,
  HealthResponseSchema,
  MarkdownFormatResultSchema,
  ServerEventSchema,
  WorkspaceInfoSchema,
  HarnessCapabilitiesSchema,
  HarnessStatusSchema,
  SessionPageSchema,
  ThemeSkillDocumentSchema,
  ThemeSummarySchema,
  UnifiedAgentEventSchema,
  UnifiedSessionSchema,
  SlidewaveSnapshotSchema,
  ImportPptxThemeResultSchema,
} from '@fastppt/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CodexAdapter, RpcError } from '@fastppt/harness-codex'
import { SlidevHost } from '@fastppt/slidev-host'

import { createGateway, resolveSlidevWebSocketProtocol } from '../src/app.js'

import WebSocket, { type RawData } from 'ws'

import type { FastifyInstance } from 'fastify'
import type {
  ApprovalDecisionInput,
  CancelRunInput,
  CreateSessionInput,
  ForkSessionInput,
  GetSessionInput,
  HarnessAdapter,
  ListSessionsInput,
  ResumeSessionInput,
  SendMessageInput,
  SessionHandle,
  SessionReference,
} from '@fastppt/harness-core'
import type {
  HarnessCapabilities,
  HarnessStatus,
  SessionPage,
  UnifiedAgentEvent,
  UnifiedSession,
  HarnessKind,
} from '@fastppt/protocol'
import type {
  EditablePptxExporter,
  ExportDeckInput,
} from '../src/export-jobs.js'

const configuredSessionProfile = {
  version: 1 as const,
  artifactRoute: 'generate' as const,
  audience: 'Test audience',
  communicationIntent: 'briefing' as const,
  narrativeMode: 'briefing' as const,
  language: 'en-US' as const,
  durationMinutes: 10,
  theme: { mode: 'registered' as const, themeId: 'slidev-theme-academy' },
  preservation: {
    wording: 'free' as const,
    pageCount: 'free' as const,
    pageOrder: 'free' as const,
    visualStructure: 'free' as const,
  },
  reviewPolicy: 'standard' as const,
}

const exportSnapshot = SlidewaveSnapshotSchema.parse({
  version: 1,
  source: 'slidev',
  slides: [
    {
      version: 1,
      id: '1',
      width: 1280,
      height: 720,
      elements: [],
      warnings: [],
    },
  ],
  warnings: [],
})

const openApps: FastifyInstance[] = []
const temporaryDirectories = new Set<string>()

describe('Slidev preview WebSocket protocol', () => {
  it.each([
    ['vite-hmr', 'vite-hmr'],
    ['vite-ping', 'vite-ping'],
    ['', undefined],
    ['unknown', undefined],
  ] as const)('forwards %s as %s', (input, expected) => {
    expect(resolveSlidevWebSocketProtocol(input)).toBe(expected)
  })
})

function mkdtempSync(prefix: string): string {
  const directory = createTemporaryDirectorySync(prefix)
  temporaryDirectories.add(directory)
  return directory
}
const themesRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../themes',
)

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

function readZipEntry(archive: Buffer, entryName: string): Buffer {
  const endSignature = 0x06054b50
  let endOffset = archive.length - 22
  while (endOffset >= 0 && archive.readUInt32LE(endOffset) !== endSignature)
    endOffset--
  if (endOffset < 0) throw new Error('PPTX ZIP end record was not found')
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16)
  const entryCount = archive.readUInt16LE(endOffset + 10)
  let offset = centralDirectoryOffset
  for (let index = 0; index < entryCount; index++) {
    if (archive.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('PPTX ZIP central directory is malformed')
    const compression = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const localOffset = archive.readUInt32LE(offset + 42)
    const name = archive
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8')
    if (name === entryName) {
      if (archive.readUInt32LE(localOffset) !== 0x04034b50)
        throw new Error('PPTX ZIP local entry is malformed')
      const localNameLength = archive.readUInt16LE(localOffset + 26)
      const localExtraLength = archive.readUInt16LE(localOffset + 28)
      const contentOffset =
        localOffset + 30 + localNameLength + localExtraLength
      const compressed = archive.subarray(
        contentOffset,
        contentOffset + compressedSize,
      )
      if (compression === 0) return compressed
      if (compression === 8) return inflateRawSync(compressed)
      throw new Error(`Unsupported PPTX ZIP compression method ${compression}`)
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`PPTX ZIP entry ${entryName} was not found`)
}

function createThemeFixture(): string {
  const fixtureThemes = mkdtempSync(join(tmpdir(), 'fastppt-themes-'))
  cpSync(themesRoot, fixtureThemes, { recursive: true })
  const third = join(fixtureThemes, 'slidev-theme-fixture')
  cpSync(join(themesRoot, 'slidev-theme-landing'), third, {
    recursive: true,
  })
  const packagePath = join(third, 'package.json')
  const packageJson = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(readFileSync(packagePath, 'utf8')) as unknown)
  packageJson.name = 'slidev-theme-fixture'
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
  const manifestPath = join(third, 'agent', 'theme-manifest.json')
  const manifest = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown)
  const skill = z.record(z.string(), z.unknown()).parse(manifest.skill)
  manifest.id = 'slidev-theme-fixture'
  manifest.packageName = 'slidev-theme-fixture'
  manifest.displayName = 'Fixture theme'
  skill.id = 'fastppt-theme-fixture'
  manifest.skill = skill
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const skillPath = join(third, 'agent', 'SKILL.md')
  writeFileSync(
    skillPath,
    readFileSync(skillPath, 'utf8').replaceAll(
      'fastppt-theme-landing',
      'fastppt-theme-fixture',
    ),
  )
  return fixtureThemes
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()))
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
  temporaryDirectories.clear()
})

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for WebSocket event')),
      3000,
    )
    socket.once('message', (data: RawData) => {
      clearTimeout(timeout)
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString('utf8')
          : data.toString('utf8')
      resolve(JSON.parse(text) as unknown)
    })
  })
}

async function makeApp(
  root: string,
  harness?: HarnessAdapter,
  selectedThemesRoot = themesRoot,
  exporter?: EditablePptxExporter,
  slidevHost?: SlidevHost,
): Promise<FastifyInstance> {
  const app = await createGateway(
    {
      host: '127.0.0.1',
      port: 4317,
      allowedWebOrigins: ['http://127.0.0.1:4318'],
      workspaceRoot: root,
      workspaceName: 'test-workspace',
      themesRoot: selectedThemesRoot,
      exportTimeoutMs: 120_000,
      maxConcurrentRunsPerHarness: 1,
    },
    {
      watchThemes: false,
      ...(harness ? { harnesses: { [harness.kind]: harness } } : {}),
      ...(exporter ? { exporter } : {}),
      ...(slidevHost ? { slidevHost } : {}),
    },
  )
  openApps.push(app)
  return app
}

class FakeExporter implements EditablePptxExporter {
  getStatus() {
    return Promise.resolve({
      status: 'available' as const,
      version: 'slidewave fixture',
    })
  }

  async export(input: ExportDeckInput) {
    input.onProgress?.({ phase: 'capturing-slides', progress: 50 })
    await mkdir(dirname(input.outputPath), { recursive: true })
    await writeFile(input.outputPath, 'fixture editable pptx')
    return {
      outputPath: input.outputPath,
      warnings: [],
      elementCount: 7,
      slideCount: 2,
      qa: { ok: true, slideCount: 2, issues: [] },
    }
  }
}

class FakeCodexHarness implements HarnessAdapter {
  constructor(
    readonly kind: HarnessKind = 'codex',
    readonly capabilityOverrides: Partial<HarnessCapabilities> = {},
  ) {}
  approved: ApprovalDecisionInput | undefined
  cancelled: CancelRunInput | undefined
  sent: SendMessageInput | undefined
  listed: ListSessionsInput | undefined

  getStatus(): Promise<HarnessStatus> {
    return Promise.resolve(
      HarnessStatusSchema.parse({
        kind: this.kind,
        status: 'available',
        version:
          this.kind === 'codex'
            ? 'codex-cli 0.144.5-fixture'
            : 'agent-sdk 0.3.220 / Claude Code 2.1.220-fixture',
        verifiedVersionRange: '>=0.144.0 <0.145.0',
        compatible: true,
        capabilities: this.capabilities(),
      }),
    )
  }

  getCapabilities(): Promise<HarnessCapabilities> {
    return Promise.resolve(this.capabilities())
  }

  listSessions(input: ListSessionsInput): Promise<SessionPage> {
    this.listed = input
    return Promise.resolve(
      SessionPageSchema.parse({ data: [this.summary()], nextCursor: null }),
    )
  }

  getSession(_input: GetSessionInput): Promise<UnifiedSession> {
    void _input
    return Promise.resolve(
      UnifiedSessionSchema.parse({
        summary: this.summary(),
        messages: [{ id: 'message-1', role: 'user', content: 'Hello' }],
      }),
    )
  }

  createSession(_input: CreateSessionInput): Promise<SessionReference> {
    void _input
    return Promise.resolve({ harness: this.kind, sessionId: 'session-created' })
  }

  resumeSession(input: ResumeSessionInput): Promise<SessionHandle> {
    return Promise.resolve({
      harness: this.kind,
      sessionId: input.sessionId,
      cwd: input.cwd,
    })
  }

  forkSession(_input: ForkSessionInput): Promise<SessionReference> {
    void _input
    return Promise.resolve({ harness: this.kind, sessionId: 'session-forked' })
  }

  async *sendMessage(
    input: SendMessageInput,
  ): AsyncIterable<UnifiedAgentEvent> {
    await Promise.resolve()
    this.sent = input
    const base = {
      harness: this.kind,
      sessionId: input.sessionId,
      runId: 'run-fixture',
      timestamp: new Date().toISOString(),
    }
    yield UnifiedAgentEventSchema.parse({
      ...base,
      eventId: 'event-1',
      sequence: 1,
      type: 'run.started',
      data: {},
    })
    yield UnifiedAgentEventSchema.parse({
      ...base,
      eventId: 'event-2',
      sequence: 2,
      type: 'skill.discovery.confirmed',
      themeId: input.themeId,
      themeSkillId: input.themeSkillId,
      themeSkillVersion: input.themeSkillVersion,
      data: {
        skills: input.skills,
        mechanism: `${this.kind}-fixture:skill-discovery`,
        simulated: true,
      },
    })
    yield UnifiedAgentEventSchema.parse({
      ...base,
      eventId: 'event-3',
      sequence: 3,
      type: 'skill.invocation.requested',
      themeId: input.themeId,
      themeSkillId: input.themeSkillId,
      themeSkillVersion: input.themeSkillVersion,
      data: {
        skills: input.skills,
        mechanism: `${this.kind}-fixture:documented-invocation`,
        simulated: true,
      },
    })
    yield UnifiedAgentEventSchema.parse({
      ...base,
      eventId: 'event-4',
      sequence: 4,
      type: 'skill.invocation.unknown',
      themeId: input.themeId,
      themeSkillId: input.themeSkillId,
      themeSkillVersion: input.themeSkillVersion,
      data: {
        skills: input.skills,
        mechanism: `${this.kind}-fixture:documented-invocation`,
        evidence: null,
        simulated: true,
      },
    })
    yield UnifiedAgentEventSchema.parse({
      ...base,
      eventId: 'event-5',
      sequence: 5,
      type: 'assistant.delta',
      data: { delta: 'Fixture stream' },
    })
    yield UnifiedAgentEventSchema.parse({
      ...base,
      eventId: 'event-6',
      sequence: 6,
      type: 'approval.requested',
      data: {
        id: 'approval-fixture',
        harness: this.kind,
        sessionId: input.sessionId,
        runId: 'run-fixture',
        kind: 'command',
        title: 'Command approval',
        reason: 'Test',
        command: 'pnpm test',
        cwd: input.cwd,
        providerPayload: {},
      },
    })
    yield UnifiedAgentEventSchema.parse({
      ...base,
      eventId: 'event-7',
      sequence: 7,
      type: 'run.completed',
      data: {},
    })
  }

  cancelRun(input: CancelRunInput): Promise<void> {
    this.cancelled = input
    return Promise.resolve()
  }

  approveRequest(input: ApprovalDecisionInput): Promise<void> {
    this.approved = input
    return Promise.resolve()
  }

  dispose(): Promise<void> {
    return Promise.resolve()
  }

  private capabilities(): HarnessCapabilities {
    return HarnessCapabilitiesSchema.parse({
      sessionHistory: true,
      sessionFork: true,
      approvals: true,
      commandExecution: true,
      fileEdits: true,
      mcp: true,
      skillDiscovery: true,
      perRunSkillInvocation: true,
      skillInvocationObservation: false,
      imageInput: true,
      structuredEvents: true,
      ...this.capabilityOverrides,
    })
  }

  private summary(): SessionPage['data'][number] {
    return SessionPageSchema.shape.data.element.parse({
      id: 'session-fixture',
      harness: this.kind,
      title: 'Fixture session',
      preview: 'Hello',
      cwd: '/fixture',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:01:00.000Z',
      status: 'idle',
    })
  }
}

class BlockingHarness extends FakeCodexHarness {
  readonly #releases: Array<() => void> = []
  #runCounter = 0

  override async *sendMessage(
    input: SendMessageInput,
  ): AsyncIterable<UnifiedAgentEvent> {
    this.sent = input
    const runId = `blocking-run-${++this.#runCounter}`
    const base = {
      harness: this.kind,
      sessionId: input.sessionId,
      runId,
      timestamp: new Date().toISOString(),
    }
    yield UnifiedAgentEventSchema.parse({
      ...base,
      eventId: `${runId}-started`,
      sequence: 1,
      type: 'run.started',
      data: {},
    })
    await new Promise<void>((resolveRun) => this.#releases.push(resolveRun))
    yield UnifiedAgentEventSchema.parse({
      ...base,
      eventId: `${runId}-completed`,
      sequence: 2,
      type: 'run.completed',
      data: {},
    })
  }

  releaseNext(): void {
    this.#releases.shift()?.()
  }

  override dispose(): Promise<void> {
    for (const release of this.#releases.splice(0)) release()
    return Promise.resolve()
  }
}

class ApprovalBlockingHarness extends FakeCodexHarness {
  #release: (() => void) | undefined

  override async *sendMessage(
    input: SendMessageInput,
  ): AsyncIterable<UnifiedAgentEvent> {
    this.sent = input
    const base = {
      harness: this.kind,
      sessionId: input.sessionId,
      runId: 'approval-blocking-run',
      timestamp: new Date().toISOString(),
    }
    yield UnifiedAgentEventSchema.parse({
      ...base,
      eventId: 'approval-blocking-started',
      sequence: 1,
      type: 'run.started',
      data: {},
    })
    yield UnifiedAgentEventSchema.parse({
      ...base,
      eventId: 'approval-blocking-requested',
      sequence: 2,
      type: 'approval.requested',
      data: {
        id: 'approval-blocking',
        harness: this.kind,
        sessionId: input.sessionId,
        runId: 'approval-blocking-run',
        kind: 'command',
        title: 'Blocking approval',
        reason: 'Test pending approval recovery',
        command: 'pnpm test',
        cwd: input.cwd,
        affectedFiles: [],
        providerPayload: {},
      },
    })
    await new Promise<void>((resolveRun) => {
      this.#release = resolveRun
    })
    yield UnifiedAgentEventSchema.parse({
      ...base,
      eventId: 'approval-blocking-completed',
      sequence: 3,
      type: 'run.completed',
      data: {},
    })
  }

  override approveRequest(input: ApprovalDecisionInput): Promise<void> {
    this.approved = input
    this.#release?.()
    this.#release = undefined
    return Promise.resolve()
  }

  override dispose(): Promise<void> {
    this.#release?.()
    this.#release = undefined
    return Promise.resolve()
  }
}

class UnavailableHarness extends FakeCodexHarness {
  override getStatus(): Promise<HarnessStatus> {
    return Promise.reject(new Error(`${this.kind} executable was not found`))
  }
}

class ErrorHarness extends FakeCodexHarness {
  constructor(
    private readonly error: RpcError,
    kind: HarnessKind = 'codex',
  ) {
    super(kind)
  }

  override listSessions(): Promise<SessionPage> {
    return Promise.reject(this.error)
  }
}

class InvocationFailureHarness extends FakeCodexHarness {
  override sendMessage(
    input: SendMessageInput,
  ): AsyncIterable<UnifiedAgentEvent> {
    this.sent = input
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined }),
      }),
    }
  }
}

class MissingSessionHarness extends FakeCodexHarness {
  override getSession(): Promise<UnifiedSession> {
    return Promise.reject(
      new RpcError('Session fixture was not found', 'SESSION_NOT_FOUND', {
        sessionId: 'missing-session',
      }),
    )
  }
}

class UnexpectedErrorHarness extends FakeCodexHarness {
  override listSessions(): Promise<SessionPage> {
    return Promise.reject(new Error('private-stack-marker'))
  }
}

describe('gateway', () => {
  it('exposes health without authentication', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const app = await makeApp(root)
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
  })

  it('reports real readiness and degrades without failing for one Harness', async () => {
    const healthyRoot = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const healthy = await createGateway(
      {
        host: '127.0.0.1',
        port: 4317,
        allowedWebOrigins: ['http://127.0.0.1:4318'],
        workspaceRoot: healthyRoot,
        workspaceName: 'test-workspace',
        themesRoot,
        exportTimeoutMs: 120_000,
        maxConcurrentRunsPerHarness: 1,
      },
      {
        watchThemes: false,
        harnesses: {
          claude: new FakeCodexHarness('claude'),
          codex: new FakeCodexHarness('codex'),
        },
        exporter: new FakeExporter(),
      },
    )
    openApps.push(healthy)
    const healthyResponse = await healthy.inject({
      method: 'GET',
      url: '/ready',
    })
    expect(healthyResponse.statusCode).toBe(200)
    expect(HealthResponseSchema.parse(healthyResponse.json())).toMatchObject({
      status: 'ok',
      components: {
        sqlite: { status: 'ok' },
        workspace: { status: 'ok' },
        claude: { status: 'ok' },
        codex: { status: 'ok' },
        slidev: { status: 'ok' },
        slidewave: { status: 'ok' },
      },
    })

    const degradedRoot = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const degraded = await createGateway(
      {
        host: '127.0.0.1',
        port: 4317,
        allowedWebOrigins: ['http://127.0.0.1:4318'],
        workspaceRoot: degradedRoot,
        workspaceName: 'test-workspace',
        themesRoot,
        exportTimeoutMs: 120_000,
        maxConcurrentRunsPerHarness: 1,
      },
      {
        watchThemes: false,
        harnesses: {
          claude: new UnavailableHarness('claude'),
          codex: new FakeCodexHarness('codex'),
        },
        exporter: new FakeExporter(),
      },
    )
    openApps.push(degraded)
    const degradedResponse = await degraded.inject({
      method: 'GET',
      url: '/ready',
    })
    expect(degradedResponse.statusCode).toBe(200)
    expect(HealthResponseSchema.parse(degradedResponse.json())).toMatchObject({
      status: 'degraded',
      components: {
        claude: {
          status: 'unavailable',
          message: 'claude executable was not found',
        },
        codex: { status: 'ok' },
        workspace: { status: 'ok' },
      },
    })
  })

  it('rechecks theme, Skill and MCP files on every readiness request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const copiedThemes = mkdtempSync(join(tmpdir(), 'fastppt-themes-'))
    cpSync(themesRoot, copiedThemes, { recursive: true })
    const app = await createGateway(
      {
        host: '127.0.0.1',
        port: 4317,
        allowedWebOrigins: ['http://127.0.0.1:4318'],
        workspaceRoot: root,
        workspaceName: 'test-workspace',
        themesRoot: copiedThemes,
        exportTimeoutMs: 120_000,
        maxConcurrentRunsPerHarness: 1,
      },
      {
        watchThemes: false,
        harnesses: {
          claude: new FakeCodexHarness('claude'),
          codex: new FakeCodexHarness('codex'),
        },
        exporter: new FakeExporter(),
      },
    )
    openApps.push(app)
    expect(
      HealthResponseSchema.parse(
        (await app.inject({ method: 'GET', url: '/ready' })).json(),
      ).status,
    ).toBe('ok')

    await rm(join(root, '.claude', 'skills', 'fastppt', 'SKILL.md'))
    await writeFile(
      join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { fastppt: { command: 'wrong' } } }),
    )
    await writeFile(
      join(
        copiedThemes,
        'slidev-theme-academy',
        'agent',
        'theme-manifest.json',
      ),
      '{ invalid json',
    )

    const readiness = HealthResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/ready' })).json(),
    )
    expect(readiness).toMatchObject({
      status: 'degraded',
      components: {
        themes: { status: 'unavailable' },
        skills: { status: 'degraded' },
        mcp: { status: 'degraded' },
      },
    })
  })

  it('returns the workspace and restricts browser origins', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const app = await makeApp(root)
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workspace',
    })
    expect(response.statusCode).toBe(200)
    expect(WorkspaceInfoSchema.parse(response.json()).name).toBe(
      'test-workspace',
    )

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/workspace/files/content',
      headers: {
        origin: 'http://127.0.0.1:4318',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
      },
    })
    expect(preflight.statusCode).toBe(204)
    expect(preflight.headers['access-control-allow-methods']).toContain('PUT')

    const foreignLocalOrigin = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/workspace/files/content',
      headers: {
        origin: 'http://127.0.0.1:9999',
        'access-control-request-method': 'PUT',
      },
    })
    expect(foreignLocalOrigin.statusCode).toBe(403)
    expect(foreignLocalOrigin.json()).toMatchObject({
      error: {
        code: 'INVALID_REQUEST',
        message: 'Origin is not allowed',
        retryable: false,
      },
    })
    expect(
      foreignLocalOrigin.headers['access-control-allow-origin'],
    ).toBeUndefined()
  })

  it('returns precise not-found errors for runs and browser inspections', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const app = await makeApp(root, new FakeCodexHarness())
    const headers = {}
    const run = await app.inject({
      method: 'GET',
      url: '/api/v1/runs/missing-run/audit',
      headers,
    })
    expect(run.statusCode).toBe(404)
    expect(run.json()).toMatchObject({
      error: { code: 'RUN_NOT_FOUND', retryable: false },
    })

    for (const method of ['GET', 'POST'] as const) {
      const inspection = await app.inject({
        method,
        url:
          '/api/v1/inspections/00000000-0000-4000-8000-000000000000' +
          (method === 'POST' ? '/result' : ''),
        headers,
        ...(method === 'POST' ? { payload: {} } : {}),
      })
      expect(inspection.statusCode).toBe(404)
      expect(inspection.json()).toMatchObject({
        error: { code: 'INSPECTION_NOT_FOUND', retryable: false },
      })
    }
  })

  it('lists, reads and revision-protects workspace files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    writeFileSync(join(root, 'slides.md'), '# Initial\n')
    const app = await makeApp(root)
    const headers = {}

    const tree = await app.inject({
      method: 'GET',
      url: '/api/v1/workspace/files',
      headers,
    })
    expect(tree.statusCode).toBe(200)
    expect(tree.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'slides.md', type: 'file' }),
      ]),
    )

    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/workspace/files/content?path=slides.md',
      headers,
    })
    const before = FileContentSchema.parse(read.json())
    const write = await app.inject({
      method: 'PUT',
      url: '/api/v1/workspace/files/content',
      headers,
      payload: {
        path: 'slides.md',
        content: '# Updated\n',
        expectedRevision: before.revision,
      },
    })
    expect(FileContentSchema.parse(write.json()).content).toBe('# Updated\n')

    const conflict = await app.inject({
      method: 'PUT',
      url: '/api/v1/workspace/files/content',
      headers,
      payload: {
        path: 'slides.md',
        content: '# Stale\n',
        expectedRevision: before.revision,
      },
    })
    expect(conflict.statusCode).toBe(409)

    const traversal = await app.inject({
      method: 'GET',
      url: '/api/v1/workspace/files/content?path=..%2F..%2Fetc%2Fpasswd',
      headers,
    })
    expect(traversal.statusCode).toBe(403)
  })

  it('exposes validated themes and discovers Slidev decks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    writeFileSync(join(root, 'AGENTS.md'), '# Workspace instructions\n')
    writeFileSync(
      join(root, 'slides.md'),
      '---\ntheme: slidev-theme-academy\n---\n# Test\n',
    )
    const app = await makeApp(root)
    const headers = {}
    const themes = await app.inject({
      method: 'GET',
      url: '/api/v1/themes',
      headers,
    })
    expect(themes.statusCode).toBe(200)
    const themeList = ThemeSummarySchema.array().parse(themes.json())
    const academyTheme = themeList.find(
      (theme) => theme.themeId === 'slidev-theme-academy',
    )
    expect(academyTheme).toMatchObject({
      version: '0.1.22-fastppt.2',
      repositoryUrl: 'https://github.com/luocfprime/slidev-theme-ustc',
      skillId: 'fastppt-theme-academy',
    })
    expect(academyTheme?.description).toContain('学术')
    expect(academyTheme?.supportedFeatures).toContainEqual({
      id: 'academic-cover',
      label: '学术封面',
      description:
        '支持作者、机构、会议、日期、报告人标记及学校标识的结构化封面。',
    })
    expect(
      themeList.find((theme) => theme.themeId === 'slidev-theme-landing'),
    ).toMatchObject({
      version: '0.0.5-fastppt.1',
      skillId: 'fastppt-theme-landing',
    })
    const themeSkill = await app.inject({
      method: 'GET',
      url: '/api/v1/themes/slidev-theme-academy/skill',
      headers,
    })
    expect(themeSkill.statusCode).toBe(200)
    const academySkill = ThemeSkillDocumentSchema.parse(themeSkill.json())
    expect(academySkill).toMatchObject({
      themeId: 'slidev-theme-academy',
      skillId: 'fastppt-theme-academy',
      version: '0.1.22-fastppt.2',
      fileName: 'SKILL.md',
    })
    expect(academySkill.content).toContain('# FastPPT Academy theme')
    const rescan = await app.inject({
      method: 'POST',
      url: '/api/v1/themes/rescan',
      headers,
    })
    expect(rescan.statusCode).toBe(200)
    expect(rescan.json()).toMatchObject({ changed: false })
    const missingTheme = await app.inject({
      method: 'GET',
      url: '/api/v1/themes/missing-theme',
      headers,
    })
    expect(missingTheme.statusCode).toBe(404)
    expect(missingTheme.json()).toMatchObject({
      error: {
        code: 'THEME_NOT_FOUND',
        retryable: false,
        details: { themeId: 'missing-theme' },
      },
    })
    const skillStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/themes/slidev-theme-academy/skill-status?harness=claude',
      headers,
    })
    expect(skillStatus.statusCode).toBe(200)
    expect(skillStatus.json()).toMatchObject({
      available: true,
      skillId: 'fastppt-theme-academy',
      base: { state: 'installed' },
      theme: { state: 'installed' },
    })
    const decks = await app.inject({
      method: 'GET',
      url: '/api/v1/decks',
      headers,
    })
    expect(decks.statusCode).toBe(200)
    expect(decks.json()).toEqual([
      expect.objectContaining({
        entryFile: 'slides.md',
        themeId: 'slidev-theme-academy',
      }),
    ])
    const deckId = DeckSummarySchema.array().parse(decks.json())[0]?.id
    const formatted = await app.inject({
      method: 'POST',
      url: `/api/v1/decks/${String(deckId)}/format`,
      headers,
      payload: {},
    })
    expect(formatted.statusCode).toBe(200)
    expect(
      MarkdownFormatResultSchema.parse(formatted.json()).content,
    ).toContain('theme: slidev-theme-academy')

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/decks',
      headers,
      payload: { name: 'New Research Deck', themeId: 'slidev-theme-academy' },
    })
    expect(created.statusCode).toBe(200)
    const createdDeck = DeckSummarySchema.parse(created.json())
    expect(createdDeck.entryFile).toBe('new-research-deck.md')
    const createdSource = await app.inject({
      method: 'GET',
      url: `/api/v1/workspace/files/content?path=${encodeURIComponent(createdDeck.entryFile)}`,
      headers,
    })
    expect(createdSource.statusCode).toBe(200)
    expect(FileContentSchema.parse(createdSource.json()).content).toContain(
      'aspectRatio: 16/9',
    )
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/decks/${createdDeck.id}/markdown`,
      headers,
      payload: {
        expectedRevision: createdDeck.revision,
        content:
          '---\ntheme: slidev-theme-academy\nlayout: not-registered\n---\n# Invalid layout\n',
      },
    })
    expect(updated.statusCode).toBe(200)
    const validation = await app.inject({
      method: 'POST',
      url: `/api/v1/decks/${createdDeck.id}/validate`,
      headers,
    })
    expect(validation.statusCode).toBe(200)
    expect(validation.json()).toMatchObject({
      valid: false,
      themeSkillId: 'fastppt-theme-academy',
      errors: [{ code: 'LAYOUT_UNAVAILABLE' }],
    })
  })

  it('dry-runs formatting and reports invalid frontmatter without writing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const source = '---\ntheme: slidev-theme-academy\n---\n#  Title\n'
    writeFileSync(join(root, 'slides.md'), source)
    const app = await makeApp(root)
    const headers = {}
    const decks = await app.inject({
      method: 'GET',
      url: '/api/v1/decks',
      headers,
    })
    const deckId = DeckSummarySchema.array().parse(decks.json())[0]?.id
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/workspace/files/content?path=slides.md',
      headers,
    })
    const beforeFile = FileContentSchema.parse(before.json())
    const dryRun = await app.inject({
      method: 'POST',
      url: `/api/v1/decks/${String(deckId)}/format`,
      headers,
      payload: { dryRun: true, expectedRevision: beforeFile.revision },
    })
    expect(dryRun.statusCode).toBe(200)
    expect(MarkdownFormatResultSchema.parse(dryRun.json())).toMatchObject({
      changed: true,
      dryRun: true,
      written: false,
      revision: beforeFile.revision,
    })
    expect(readFileSync(join(root, 'slides.md'), 'utf8')).toBe(source)

    const invalid = '---\ntheme: [\n---\n# Broken\n'
    writeFileSync(join(root, 'slides.md'), invalid)
    const failed = await app.inject({
      method: 'POST',
      url: `/api/v1/decks/${String(deckId)}/format`,
      headers,
      payload: { dryRun: true },
    })
    expect(failed.statusCode).toBe(400)
    expect(failed.json()).toMatchObject({
      error: {
        code: 'INVALID_REQUEST',
        details: { line: 2, column: 1 },
      },
    })
    expect(readFileSync(join(root, 'slides.md'), 'utf8')).toBe(invalid)
  })

  it('queues, persists, reports and securely downloads editable PPTX exports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    writeFileSync(
      join(root, 'slides.md'),
      '---\ntheme: slidev-theme-academy\n---\n# Export fixture\n',
    )
    const app = await makeApp(root, undefined, themesRoot, new FakeExporter())
    const headers = {}
    const decks = DeckSummarySchema.array().parse(
      (
        await app.inject({ method: 'GET', url: '/api/v1/decks', headers })
      ).json(),
    )
    const deckId = decks[0]?.id
    expect(deckId).toBeDefined()
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/decks/${String(deckId)}/exports`,
      headers,
      payload: {
        format: 'editable-pptx',
        outputName: '../../Quarter:Final?.pptx',
      },
    })
    expect(created.statusCode).toBe(200)
    const exportId = z
      .object({ id: z.string().uuid(), outputName: z.string() })
      .parse(created.json())
    expect(exportId.outputName).toBe('Quarter-Final-.pptx')
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/exports/${exportId.id}/snapshot`,
      headers,
      payload: exportSnapshot,
    })
    expect(submitted.statusCode).toBe(200)

    await expect
      .poll(async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/exports/${exportId.id}`,
          headers,
        })
        return z.object({ status: z.string() }).parse(response.json()).status
      })
      .toBe('completed')
    const download = await app.inject({
      method: 'GET',
      url: `/api/v1/exports/${exportId.id}/download`,
      headers,
    })
    expect(download.statusCode).toBe(200)
    expect(download.body).toBe('fixture editable pptx')
    expect(download.headers['content-disposition']).toContain(
      'Quarter-Final-.pptx',
    )
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/exports/00000000-0000-4000-8000-000000000000',
      headers,
    })
    expect(missing.statusCode).toBe(404)
  })

  it('exports editable text through the real Slidewave Gateway runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-slidewave-'))
    writeFileSync(
      join(root, 'slides.md'),
      '---\ntheme: slidev-theme-academy\n---\n# Real Slidewave export\n',
    )
    const slidevHost = new SlidevHost({
      commandFactory: (_input, port) => ({
        command: process.execPath,
        args: [
          '-e',
          "require('node:http').createServer((_request,response)=>response.end('ready')).listen(Number(process.argv[1]),'127.0.0.1')",
          String(port),
        ],
        cwd: root,
      }),
      readyTimeoutMs: 3_000,
      stopTimeoutMs: 1_000,
    })
    const app = await makeApp(
      root,
      undefined,
      themesRoot,
      undefined,
      slidevHost,
    )
    const headers = {}
    const decks = DeckSummarySchema.array().parse(
      (
        await app.inject({ method: 'GET', url: '/api/v1/decks', headers })
      ).json(),
    )
    const deckId = decks[0]?.id
    expect(deckId).toBeDefined()
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/decks/${String(deckId)}/exports`,
      headers,
      payload: { format: 'editable-pptx', outputName: 'real-slidewave.pptx' },
    })
    expect(created.statusCode).toBe(200)
    const exportId = z
      .object({ id: z.string().uuid() })
      .parse(created.json()).id
    const editableText = 'FastPPT editable Slidewave text'
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/exports/${exportId}/snapshot`,
      headers,
      payload: {
        version: 1,
        source: 'slidev',
        slides: [
          {
            version: 1,
            id: '1',
            width: 1280,
            height: 720,
            elements: [
              {
                id: 'root/title',
                kind: 'text',
                text: editableText,
                box: { x: 80, y: 90, width: 640, height: 80 },
                order: 0,
                zIndex: 1,
                opacity: 1,
                source: { tag: 'h1', path: 'root/title' },
                style: {
                  fontFamily: 'Arial',
                  fontSizePx: 48,
                  fontWeight: 700,
                  fontStyle: 'normal',
                  lineHeightPx: 58,
                  letterSpacingPx: 0,
                  color: { hex: '112233', alpha: 1 },
                  align: 'left',
                  decoration: [],
                  direction: 'ltr',
                  language: 'en',
                },
              },
            ],
            warnings: [],
          },
        ],
        warnings: [],
      },
    })
    expect(submitted.statusCode).toBe(200)
    await expect
      .poll(async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/exports/${exportId}`,
          headers,
        })
        return z.object({ status: z.string() }).parse(response.json()).status
      })
      .toBe('completed')
    const download = await app.inject({
      method: 'GET',
      url: `/api/v1/exports/${exportId}/download`,
      headers,
    })
    expect(download.statusCode).toBe(200)
    expect(download.rawPayload.subarray(0, 2).toString('ascii')).toBe('PK')
    const slideXml = readZipEntry(
      download.rawPayload,
      'ppt/slides/slide1.xml',
    ).toString('utf8')
    expect(slideXml).toContain(`<a:t>${editableText}</a:t>`)
    expect(slideXml).toContain('<p:sp>')
  })

  it('returns pending iframe work in authoritative application state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-delegation-'))
    writeFileSync(
      join(root, 'slides.md'),
      '---\ntheme: slidev-theme-academy\n---\n# Delegation recovery\n',
    )
    const slidevHost = new SlidevHost({
      commandFactory: (_input, port) => ({
        command: process.execPath,
        args: [
          '-e',
          "require('node:http').createServer((_request,response)=>response.end('ready')).listen(Number(process.argv[1]),'127.0.0.1')",
          String(port),
        ],
        cwd: root,
      }),
      readyTimeoutMs: 3_000,
      stopTimeoutMs: 1_000,
    })
    const app = await makeApp(
      root,
      undefined,
      themesRoot,
      undefined,
      slidevHost,
    )
    const headers = {}
    const deckId = DeckSummarySchema.array().parse(
      (
        await app.inject({ method: 'GET', url: '/api/v1/decks', headers })
      ).json(),
    )[0]?.id
    expect(deckId).toBeDefined()
    const pendingExport = z
      .object({ id: z.string().uuid(), phase: z.string() })
      .parse(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/decks/${String(deckId)}/exports`,
            headers,
            payload: {
              format: 'editable-pptx',
              outputName: 'pending.pptx',
            },
          })
        ).json(),
      )
    expect(pendingExport.phase).toBe('awaiting-browser-capture')
    const pendingInspection = z
      .object({ id: z.string().uuid(), status: z.string() })
      .parse(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/decks/${String(deckId)}/inspections/overflow`,
            headers,
            payload: { slide: 1 },
          })
        ).json(),
      )
    expect(pendingInspection.status).toBe('queued')

    const state = ApplicationStateSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/application-state',
          headers,
        })
      ).json(),
    )
    expect(state.pendingBrowserExports.map((job) => job.id)).toEqual([
      pendingExport.id,
    ])
    expect(state.pendingBrowserInspections.map((job) => job.id)).toEqual([
      pendingInspection.id,
    ])
  })

  it('atomically rescans a changed validated theme registry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const fixtureThemes = mkdtempSync(join(tmpdir(), 'fastppt-themes-'))
    cpSync(themesRoot, fixtureThemes, { recursive: true })
    const app = await makeApp(root, undefined, fixtureThemes)
    const headers = {}
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/themes/slidev-theme-academy',
      headers,
    })
    const previousVersion = z
      .object({ registryVersion: z.string() })
      .parse(JSON.parse(before.body) as unknown).registryVersion
    const manifestPath = join(
      fixtureThemes,
      'slidev-theme-academy',
      'agent',
      'theme-manifest.json',
    )
    const manifest = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown)
    manifest.displayName = 'Academy Reloaded'
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const rescan = await app.inject({
      method: 'POST',
      url: '/api/v1/themes/rescan',
      headers,
    })
    expect(rescan.statusCode).toBe(200)
    expect(rescan.json()).toMatchObject({
      changed: true,
      previousVersion,
    })
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/themes/slidev-theme-academy',
      headers,
    })
    expect(after.json()).toMatchObject({
      displayName: 'Academy Reloaded',
    })
  })

  it('imports a PPTX theme through the upload endpoint and reloads the registry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-import-'))
    const fixtureThemes = createThemeFixture()
    const app = await makeApp(root, undefined, fixtureThemes)
    openApps.push(app)
    const sample = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../references/pptx-renderer/docs/example/1-chart-and-complex/source.pptx',
    )
    const pptx = readFileSync(sample)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/imports/pptx-theme',
      payload: {
        fileName: 'source.pptx',
        dataBase64: pptx.toString('base64'),
        themeName: 'import-test',
      },
    })
    expect(response.statusCode).toBe(200)
    const result = ImportPptxThemeResultSchema.parse(response.json())
    expect(result.themeId).toBe('slidev-theme-import-test')
    expect(result.skillId).toBe('fastppt-theme-import-test')
    expect(
      existsSync(join(fixtureThemes, 'slidev-theme-import-test', 'package.json')),
    ).toBe(true)
    const status = await app.inject({
      method: 'GET',
      url: `/api/v1/imports/pptx-theme/${result.themeId}`,
    })
    expect(status.statusCode).toBe(200)
    expect(status.json()).toMatchObject({
      themeId: result.themeId,
      stage: expect.stringMatching(/designing|ready|failed/),
      designing: expect.any(Boolean),
      layouts: expect.arrayContaining(['cover', 'default', 'section', 'end']),
      components: expect.any(Array),
      message: expect.any(String),
    })
  })

  it('rejects non-PPTX theme imports before starting extraction', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-import-invalid-'))
    const app = await makeApp(root)
    openApps.push(app)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/imports/pptx-theme',
      payload: {
        fileName: 'fake.pptx',
        dataBase64: Buffer.from('not a zip package').toString('base64'),
        themeName: 'invalid-import',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: expect.stringContaining('valid PPTX/ZIP'),
    })
  })

  it('removes a theme atomically and preserves modified stale managed Skills', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const fixtureThemes = mkdtempSync(join(tmpdir(), 'fastppt-themes-'))
    cpSync(themesRoot, fixtureThemes, { recursive: true })
    const app = await makeApp(root, undefined, fixtureThemes)
    const headers = {}
    const cleanSkill = join(root, '.claude', 'skills', 'fastppt-theme-landing')
    const modifiedSkill = join(
      root,
      '.agents',
      'skills',
      'fastppt-theme-landing',
    )
    writeFileSync(join(modifiedSkill, 'SKILL.md'), 'user modification\n')
    await rm(join(fixtureThemes, 'slidev-theme-landing'), {
      recursive: true,
      force: true,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/themes/rescan',
      headers,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ changed: true })
    const themes = z.array(z.object({ themeId: z.string() })).parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/themes',
          headers,
        })
      ).json(),
    )
    expect(themes.map((theme) => theme.themeId)).not.toContain(
      'slidev-theme-landing',
    )
    await expect(access(cleanSkill)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(join(modifiedSkill, 'SKILL.md'), 'utf8'),
    ).resolves.toBe('user modification\n')
  })

  it('reinstalls managed Skills after an atomic theme version update', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const fixtureThemes = mkdtempSync(join(tmpdir(), 'fastppt-themes-'))
    cpSync(themesRoot, fixtureThemes, { recursive: true })
    const app = await makeApp(root, undefined, fixtureThemes)
    const headers = {}
    const themeRoot = join(fixtureThemes, 'slidev-theme-landing')
    const nextVersion = '0.0.6-fastppt.1'
    const packagePath = join(themeRoot, 'package.json')
    const packageJson = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(readFileSync(packagePath, 'utf8')) as unknown)
    packageJson.version = nextVersion
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    const manifestPath = join(themeRoot, 'agent', 'theme-manifest.json')
    const manifest = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown)
    const skill = z.record(z.string(), z.unknown()).parse(manifest.skill)
    skill.version = nextVersion
    manifest.skill = skill
    manifest.version = nextVersion
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const skillPath = join(themeRoot, 'agent', 'SKILL.md')
    writeFileSync(
      skillPath,
      readFileSync(skillPath, 'utf8').replace(
        'version: 0.0.5-fastppt.1',
        `version: ${nextVersion}`,
      ),
    )

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/themes/rescan',
      headers,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ changed: true })
    const managed = z
      .object({
        skills: z.array(
          z.object({
            skillId: z.string(),
            expectedVersion: z.string(),
            installedVersion: z.string().optional(),
            state: z.string(),
          }),
        ),
      })
      .parse(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/managed/status',
            headers,
          })
        ).json(),
      )
    const updated = managed.skills.filter(
      (status) => status.skillId === 'fastppt-theme-landing',
    )
    expect(updated).toHaveLength(2)
    expect(updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expectedVersion: nextVersion,
          installedVersion: nextVersion,
          state: 'installed',
        }),
      ]),
    )
    expect(
      updated.every((status) => status.installedVersion === nextVersion),
    ).toBe(true)
  })

  it.each([
    {
      name: 'Skill identity mismatch',
      mutate: (fixtureThemes: string) => {
        const skillPath = join(
          fixtureThemes,
          'slidev-theme-academy',
          'agent',
          'SKILL.md',
        )
        writeFileSync(
          skillPath,
          readFileSync(skillPath, 'utf8').replace(
            'name: fastppt-theme-academy',
            'name: wrong-theme-skill',
          ),
        )
      },
      publicCode: 'THEME_SKILL_MAPPING_INVALID',
      internalCode: 'SKILL_MISMATCH',
      statusCode: 503,
    },
    {
      name: 'package version mismatch',
      mutate: (fixtureThemes: string) => {
        const packagePath = join(
          fixtureThemes,
          'slidev-theme-academy',
          'package.json',
        )
        const manifest = z
          .record(z.string(), z.unknown())
          .parse(JSON.parse(readFileSync(packagePath, 'utf8')) as unknown)
        manifest.version = '999.0.0'
        writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
      },
      publicCode: 'THEME_SKILL_VERSION_MISMATCH',
      internalCode: 'PACKAGE_MISMATCH',
      statusCode: 503,
    },
  ])(
    'normalizes $name during theme rescan',
    async ({ mutate, publicCode, internalCode, statusCode }) => {
      const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
      const fixtureThemes = mkdtempSync(join(tmpdir(), 'fastppt-themes-'))
      cpSync(themesRoot, fixtureThemes, { recursive: true })
      const app = await makeApp(root, undefined, fixtureThemes)
      mutate(fixtureThemes)
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/themes/rescan',
      })
      expect(response.statusCode).toBe(statusCode)
      expect(response.json()).toMatchObject({
        error: {
          code: publicCode,
          retryable: false,
          details: { internalCode },
        },
      })
      expect(response.body).not.toContain('stack')
    },
  )

  it('redacts provider secrets from normalized public errors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const harness = new ErrorHarness(
      new RpcError(
        'Provider rejected token=private-provider-token',
        'PROTOCOL_ERROR',
        {
          stderr: [
            'Authorization: Bearer private-bearer-token',
            'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz',
          ],
        },
      ),
    )
    const app = await makeApp(root, harness)
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions?harness=codex',
    })
    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({
      error: {
        code: 'HARNESS_PROTOCOL_ERROR',
        message: 'Provider rejected token=[REDACTED]',
        details: {
          internalCode: 'PROTOCOL_ERROR',
          cause: {
            stderr: ['Authorization: [REDACTED]', 'OPENAI_API_KEY=[REDACTED]'],
          },
        },
      },
    })
    expect(response.body).not.toContain('private-provider-token')
    expect(response.body).not.toContain('private-bearer-token')
    expect(response.body).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
  })

  it('preserves stable session and approval not-found envelopes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const app = await makeApp(root, new MissingSessionHarness())
    const headers = {}
    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/codex/missing-session',
      headers,
    })
    expect(session.statusCode).toBe(404)
    expect(session.json()).toMatchObject({
      error: {
        code: 'SESSION_NOT_FOUND',
        retryable: false,
        details: { sessionId: 'missing-session' },
      },
    })
    const approval = await app.inject({
      method: 'POST',
      url: '/api/v1/approvals/missing-approval/resolve',
      headers,
      payload: { decision: 'reject' },
    })
    expect(approval.statusCode).toBe(404)
    expect(approval.json()).toMatchObject({
      error: {
        code: 'APPROVAL_NOT_FOUND',
        retryable: false,
        details: { approvalId: 'missing-approval' },
      },
    })
  })

  it('hides unexpected error diagnostics from production responses', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const app = await makeApp(root, new UnexpectedErrorHarness())
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions?harness=codex',
    })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toMatchObject({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred.',
        retryable: false,
      },
    })
    expect(
      z
        .object({ error: z.object({ requestId: z.string().min(1) }) })
        .parse(response.json()).error.requestId,
    ).toBeTruthy()
    expect(response.body).not.toContain('private-stack-marker')
    expect(response.body).not.toContain('stack')
  })

  it.each([
    ['RUN_ALREADY_ACTIVE', 'SESSION_BUSY', 409, false],
    ['PROCESS_EXITED', 'HARNESS_UNAVAILABLE', 503, true],
    ['PROTOCOL_ERROR', 'HARNESS_PROTOCOL_ERROR', 502, true],
  ] as const)(
    'normalizes Harness error %s as %s',
    async (internalCode, publicCode, statusCode, retryable) => {
      const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
      const harness = new ErrorHarness(
        new RpcError('Harness fixture failed', internalCode, {
          fixture: true,
        }),
      )
      const app = await makeApp(root, harness)
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sessions?harness=codex',
      })
      expect(response.statusCode).toBe(statusCode)
      expect(response.json()).toMatchObject({
        error: {
          code: publicCode,
          retryable,
          details: {
            internalCode,
            cause: { fixture: true },
          },
        },
      })
      expect(response.body).not.toContain('stack')
    },
  )

  it.each([
    {
      name: 'spawn failure',
      command: 'fastppt-missing-slidev-command',
      args: [] as string[],
      code: 'SLIDEV_START_FAILED',
      internalCode: 'SLIDEV_SPAWN_FAILED',
    },
    {
      name: 'process exit',
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
      code: 'SLIDEV_BUILD_FAILED',
      internalCode: 'SLIDEV_EXITED',
    },
  ])(
    'returns a stable error for Slidev $name',
    async ({ command, args, code, internalCode }) => {
      const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
      writeFileSync(join(root, 'slides.md'), '# Preview fixture\n')
      const slidevHost = new SlidevHost({
        readyTimeoutMs: 1_000,
        commandFactory: () => ({ command, args, cwd: root }),
      })
      const app = await makeApp(
        root,
        undefined,
        themesRoot,
        undefined,
        slidevHost,
      )
      const decks = DeckSummarySchema.array().parse(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/decks',
          })
        ).json(),
      )
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${String(decks[0]?.id)}/preview/start`,
      })
      expect(response.statusCode).toBe(502)
      expect(response.json()).toMatchObject({
        error: {
          code,
          retryable: true,
          details: {
            internalCode,
            operation: 'preview',
          },
        },
      })
      expect(response.body).not.toContain('stack')
    },
  )

  it('stops Codex and Slidev child processes when the Gateway closes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-processes-'))
    const codexPidFile = join(root, 'codex.pid')
    writeFileSync(join(root, 'slides.md'), '# Process cleanup fixture\n')
    const codexFixture = String.raw`
const fs = require('node:fs')
const readline = require('node:readline')
fs.writeFileSync(process.argv[1], String(process.pid))
const lines = readline.createInterface({ input: process.stdin })
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
lines.on('line', line => {
  const message = JSON.parse(line)
  if (message.method === 'initialize')
    send({ id: message.id, result: { userAgent: 'fixture' } })
  if (message.method === 'thread/list')
    send({ id: message.id, result: { data: [], nextCursor: null } })
})
`
    const slidevFixture = String.raw`
const http = require('node:http')
const port = Number(process.argv[1])
const server = http.createServer((_request, response) => response.end('ready'))
server.listen(port, '127.0.0.1')
process.on('SIGTERM', () => server.close(() => process.exit(0)))
`
    const codex = new CodexAdapter({
      versionProvider: () => Promise.resolve('codex-cli 0.144.5'),
      commandFactory: () => ({
        command: process.execPath,
        args: ['-e', codexFixture, codexPidFile],
        cwd: root,
      }),
      requestTimeoutMs: 1_000,
      stopTimeoutMs: 1_000,
    })
    const slidevHost = new SlidevHost({
      commandFactory: (_input, port) => ({
        command: process.execPath,
        args: ['-e', slidevFixture, String(port)],
        cwd: root,
      }),
      readyTimeoutMs: 3_000,
      stopTimeoutMs: 1_000,
    })
    const app = await makeApp(root, codex, themesRoot, undefined, slidevHost)

    const sessions = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions?harness=codex',
    })
    expect(sessions.statusCode).toBe(200)
    const codexPid = Number(await readFile(codexPidFile, 'utf8'))
    expect(processExists(codexPid)).toBe(true)

    const decks = DeckSummarySchema.array().parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/decks',
        })
      ).json(),
    )
    const preview = await app.inject({
      method: 'POST',
      url: `/api/v1/decks/${String(decks[0]?.id)}/preview/start`,
    })
    expect(preview.statusCode).toBe(200)
    const slidevPid = z.object({ pid: z.number() }).parse(preview.json()).pid
    expect(processExists(slidevPid)).toBe(true)

    await app.close()
    expect(processExists(codexPid)).toBe(false)
    expect(processExists(slidevPid)).toBe(false)
  })

  it('defers theme reload installation changes until active runs finish', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const fixtureThemes = mkdtempSync(join(tmpdir(), 'fastppt-themes-'))
    cpSync(themesRoot, fixtureThemes, { recursive: true })
    const harness = new BlockingHarness('codex')
    const app = await makeApp(root, harness, fixtureThemes)
    const headers = {}
    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/codex/session-fixture/messages',
      headers,
      payload: {
        content: 'Make slides',
        themeId: 'slidev-theme-academy',
        attachments: [],
      },
    })
    expect(started.statusCode).toBe(202)

    const manifestPath = join(
      fixtureThemes,
      'slidev-theme-academy',
      'agent',
      'theme-manifest.json',
    )
    const manifest = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown)
    manifest.displayName = 'Reload after run'
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    let reloaded = false
    const reload = app
      .inject({ method: 'POST', url: '/api/v1/themes/rescan', headers })
      .then((response) => {
        reloaded = true
        return response
      })
    await Promise.resolve()
    expect(reloaded).toBe(false)
    harness.releaseNext()
    const response = await reload
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ changed: true })
  })

  it('closes with an active run and a queued theme reload', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const fixtureThemes = mkdtempSync(join(tmpdir(), 'fastppt-themes-'))
    cpSync(themesRoot, fixtureThemes, { recursive: true })
    const harness = new BlockingHarness('codex')
    const app = await makeApp(root, harness, fixtureThemes)
    const headers = {}
    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/codex/session-fixture/messages',
      headers,
      payload: {
        content: 'Make slides',
        themeId: 'slidev-theme-academy',
        attachments: [],
      },
    })
    expect(started.statusCode).toBe(202)

    const reload = app.inject({
      method: 'POST',
      url: '/api/v1/themes/rescan',
      headers,
    })
    await Promise.resolve()

    await expect(
      Promise.race([
        app.close().then(() => 'closed'),
        new Promise<string>((resolveTimeout) =>
          setTimeout(() => resolveTimeout('timed-out'), 1_000),
        ),
      ]),
    ).resolves.toBe('closed')
    await reload
  })

  it('authenticates subscriptions and pushes workspace file events', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    writeFileSync(join(root, 'slides.md'), '# Initial\n')
    const app = await makeApp(root)

    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing test server port')
    const url = `ws://127.0.0.1:${address.port}/api/v1/events`

    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    socket.send(JSON.stringify({ type: 'subscribe', topics: ['workspace'] }))
    expect(await nextMessage(socket)).toMatchObject({ type: 'subscribed' })

    const read = FileContentSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/workspace/files/content?path=slides.md',
        })
      ).json(),
    )
    const eventPromise = nextMessage(socket)
    await app.inject({
      method: 'PUT',
      url: '/api/v1/workspace/files/content',
      payload: {
        path: 'slides.md',
        content: '# WebSocket\n',
        expectedRevision: read.revision,
      },
    })
    const event = ServerEventSchema.parse(await eventPromise)
    expect(event).toMatchObject({ topic: 'workspace', type: 'file.changed' })
    socket.terminate()
  })

  it('publishes Agent events to their exact run topic', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const app = await makeApp(root, new FakeCodexHarness())
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing test server port')
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/events`)
    await new Promise<void>((resolveOpen, rejectOpen) => {
      socket.once('open', resolveOpen)
      socket.once('error', rejectOpen)
    })
    socket.send(
      JSON.stringify({ type: 'subscribe', topics: ['run:run-fixture'] }),
    )
    expect(await nextMessage(socket)).toMatchObject({ type: 'subscribed' })
    const eventPromise = nextMessage(socket)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/codex/session-fixture/messages',
      payload: {
        content: 'Publish to the exact run topic',
        themeId: 'slidev-theme-academy',
        attachments: [],
      },
    })
    expect(response.statusCode).toBe(202)
    expect(ServerEventSchema.parse(await eventPromise)).toMatchObject({
      topic: 'run:run-fixture',
      type: 'run.started',
      data: { runId: 'run-fixture' },
    })
    socket.terminate()
  })

  it('routes Codex sessions, streaming events, approvals and cancellation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const harness = new FakeCodexHarness()
    const app = await makeApp(root, harness)
    const headers = {}

    const harnesses = await app.inject({
      method: 'GET',
      url: '/api/v1/harnesses',
      headers,
    })
    expect(harnesses.statusCode).toBe(200)
    expect(harnesses.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'codex', status: 'available' }),
      ]),
    )

    const sessions = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions?harness=codex&cursor=next-page&limit=25',
      headers,
    })
    expect(SessionPageSchema.parse(sessions.json()).data[0]?.id).toBe(
      'session-fixture',
    )
    expect(harness.listed).toMatchObject({
      cwd: root,
      cursor: 'next-page',
      limit: 25,
    })
    const detail = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/codex/session-fixture',
      headers,
    })
    expect(UnifiedSessionSchema.parse(detail.json()).messages[0]?.content).toBe(
      'Hello',
    )
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers,
      payload: {
        harness: 'codex',
        cwd: root,
        title: 'Deck',
        profile: configuredSessionProfile,
      },
    })
    expect(created.json()).toEqual({
      harness: 'codex',
      sessionId: 'session-created',
    })
    const aliasedDetail = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/codex/session-created',
      headers,
    })
    expect(UnifiedSessionSchema.parse(aliasedDetail.json()).summary.title).toBe(
      'Deck',
    )
    const renamed = await app.inject({
      method: 'PUT',
      url: '/api/v1/sessions/codex/session-created/alias',
      headers,
      payload: { alias: 'Renamed deck' },
    })
    expect(renamed.json()).toMatchObject({ alias: 'Renamed deck' })
    const renamedDetail = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/codex/session-created',
      headers,
    })
    expect(UnifiedSessionSchema.parse(renamedDetail.json()).summary.title).toBe(
      'Renamed deck',
    )
    expect(
      ApplicationStateSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/application-state',
            headers,
          })
        ).json(),
      ),
    ).toMatchObject({
      recentHarness: 'codex',
      recentSession: { harness: 'codex', sessionId: 'session-created' },
      pendingApprovals: [],
    })

    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing test server port')
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/events`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    socket.send(JSON.stringify({ type: 'subscribe', topics: ['sessions'] }))
    await nextMessage(socket)

    const send = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/codex/session-fixture/messages',
      headers,
      payload: {
        content: 'Make slides',
        themeId: 'slidev-theme-academy',
        attachments: [],
      },
    })
    expect(send.statusCode).toBe(202)
    expect(send.json()).toEqual({ runId: 'run-fixture' })
    expect(harness.sent).toMatchObject({
      themeId: 'slidev-theme-academy',
      themeSkillId: 'fastppt-theme-academy',
      themeSkillVersion: '0.1.22-fastppt.2',
      skills: [
        expect.objectContaining({ name: 'fastppt' }),
        expect.objectContaining({ name: 'fastppt-theme-academy' }),
      ],
    })

    writeFileSync(join(root, 'attachment.png'), Buffer.from([1, 2, 3]))
    const attachmentSend = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/codex/session-fixture/messages',
      headers,
      payload: {
        content: 'Use this image',
        themeId: 'slidev-theme-academy',
        attachments: [{ type: 'image', path: 'attachment.png' }],
      },
    })
    expect(attachmentSend.statusCode).toBe(202)
    expect(harness.sent?.attachments).toEqual([
      { type: 'image', path: join(root, 'attachment.png') },
    ])
    const escapedAttachment = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/codex/session-fixture/messages',
      headers,
      payload: {
        content: 'Read outside',
        themeId: 'slidev-theme-academy',
        attachments: [{ type: 'image', path: '../secret.png' }],
      },
    })
    expect(escapedAttachment.statusCode).toBe(403)
    await expect
      .poll(
        async () =>
          (
            await app.inject({
              method: 'GET',
              url: '/api/v1/runs/run-fixture/audit',
              headers,
            })
          ).statusCode,
      )
      .toBe(200)
    const applicationState = ApplicationStateSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/application-state',
          headers,
        })
      ).json(),
    )
    expect(applicationState).toMatchObject({
      recentHarness: 'codex',
      recentTheme: 'slidev-theme-academy',
      pendingApprovals: [],
    })
    const latestAudit = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/codex/session-fixture/runs/latest',
      headers,
    })
    expect(latestAudit.statusCode).toBe(200)
    expect(latestAudit.json()).toMatchObject({
      runId: 'run-fixture',
      skillResolutionStatus: 'resolved',
    })
    const missingLatestAudit = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/claude/session-without-runs/runs/latest',
      headers,
    })
    expect(missingLatestAudit.statusCode).toBe(204)
    const audit = z
      .object({
        harness: z.literal('codex'),
        themeId: z.literal('slidev-theme-academy'),
        themeSkillId: z.literal('fastppt-theme-academy'),
        skillResolutionStatus: z.literal('resolved'),
        invocationStatus: z.literal('unknown'),
        invocationMechanism: z.literal('codex-fixture:documented-invocation'),
        events: z.array(UnifiedAgentEventSchema),
      })
      .parse(
        JSON.parse(
          (
            await app.inject({
              method: 'GET',
              url: '/api/v1/runs/run-fixture/audit',
              headers,
            })
          ).body,
        ) as unknown,
      )
    expect(audit).toMatchObject({
      harness: 'codex',
      themeId: 'slidev-theme-academy',
      themeSkillId: 'fastppt-theme-academy',
      skillResolutionStatus: 'resolved',
      invocationStatus: 'unknown',
      invocationMechanism: 'codex-fixture:documented-invocation',
    })
    for (const type of [
      'skill.invocation.requested',
      'skill.invocation.unknown',
    ] as const) {
      const event = audit.events.find((candidate) => candidate.type === type)
      expect(event).toBeDefined()
      expect(
        z.object({ simulated: z.literal(true) }).parse(event?.data),
      ).toEqual({ simulated: true })
    }
    const streamed = ServerEventSchema.parse(await nextMessage(socket))
    expect(streamed).toMatchObject({
      topic: 'sessions',
      type: 'run.started',
    })

    const cancel = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/codex/session-fixture/cancel',
      headers,
    })
    expect(cancel.statusCode).toBe(200)
    expect(harness.cancelled).toEqual({ sessionId: 'session-fixture' })
    socket.close()
  })

  it('restores only actionable pending approvals and expires them with the run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const harness = new ApprovalBlockingHarness('codex')
    const app = await makeApp(root, harness)
    const headers = {}
    const send = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/codex/session-fixture/messages',
      headers,
      payload: {
        content: 'Make slides',
        themeId: 'slidev-theme-academy',
        attachments: [],
      },
    })
    expect(send.statusCode).toBe(202)
    await expect
      .poll(async () =>
        ApplicationStateSchema.parse(
          (
            await app.inject({
              method: 'GET',
              url: '/api/v1/application-state',
              headers,
            })
          ).json(),
        ).pendingApprovals.map((approval) => approval.id),
      )
      .toEqual(['approval-blocking'])

    const approval = await app.inject({
      method: 'POST',
      url: '/api/v1/approvals/approval-blocking/resolve',
      headers,
      payload: { decision: 'approve-for-session' },
    })
    expect(approval.statusCode).toBe(200)
    expect(harness.approved).toEqual({
      approvalId: 'approval-blocking',
      decision: 'approve-for-session',
    })
    await expect
      .poll(
        async () =>
          ApplicationStateSchema.parse(
            (
              await app.inject({
                method: 'GET',
                url: '/api/v1/application-state',
                headers,
              })
            ).json(),
          ).pendingApprovals,
      )
      .toEqual([])
  })

  it('routes Claude session discovery and lifecycle through the same contract', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const app = await makeApp(root, new FakeCodexHarness('claude'))
    const headers = {}

    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/harnesses/claude/status',
      headers,
    })
    expect(HarnessStatusSchema.parse(status.json())).toMatchObject({
      kind: 'claude',
      status: 'available',
    })
    const sessions = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions?harness=claude',
      headers,
    })
    expect(SessionPageSchema.parse(sessions.json()).data[0]).toMatchObject({
      id: 'session-fixture',
      harness: 'claude',
    })
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers,
      payload: {
        harness: 'claude',
        cwd: root,
        title: 'Claude deck',
        profile: configuredSessionProfile,
      },
    })
    expect(created.json()).toEqual({
      harness: 'claude',
      sessionId: 'session-created',
    })
    const forked = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/claude/session-fixture/fork',
      headers,
    })
    expect(forked.json()).toEqual({
      harness: 'claude',
      sessionId: 'session-forked',
    })
    expect(
      ApplicationStateSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/application-state',
            headers,
          })
        ).json(),
      ).recentSession,
    ).toEqual({ harness: 'claude', sessionId: 'session-forked' })
  })

  it.each([
    ['claude', 'slidev-theme-academy', 'fastppt-theme-academy'],
    ['claude', 'slidev-theme-landing', 'fastppt-theme-landing'],
    ['codex', 'slidev-theme-academy', 'fastppt-theme-academy'],
    ['codex', 'slidev-theme-landing', 'fastppt-theme-landing'],
  ] as const)(
    'resolves %s × %s to exactly its common and theme Skills',
    async (kind, themeId, skillId) => {
      const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
      const harness = new FakeCodexHarness(kind)
      const app = await makeApp(root, harness)
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/sessions/${kind}/session-fixture/messages`,
        payload: { content: 'Make slides', themeId, attachments: [] },
      })
      expect(response.statusCode).toBe(202)
      expect(harness.sent?.skills?.map((skill) => skill.name)).toEqual([
        'fastppt',
        skillId,
      ])
      expect(harness.sent).toMatchObject({ themeId, themeSkillId: skillId })
    },
  )

  it.each(['claude', 'codex'] as const)(
    'routes a third registered theme through %s without business-layer changes',
    async (kind) => {
      const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
      writeFileSync(
        join(root, 'slides.md'),
        '---\ntheme: slidev-theme-fixture\n---\n# Fixture\n',
      )
      const harness = new FakeCodexHarness(kind)
      const app = await makeApp(root, harness, createThemeFixture())
      const headers = {}
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/sessions/${kind}/session-fixture/messages`,
        headers,
        payload: {
          content: 'Use the newly registered theme',
          themeId: 'slidev-theme-fixture',
          attachments: [],
        },
      })
      expect(response.statusCode).toBe(202)
      expect(harness.sent?.skills?.map((skill) => skill.name)).toEqual([
        'fastppt',
        'fastppt-theme-fixture',
      ])
      await expect
        .poll(
          async () =>
            (
              await app.inject({
                method: 'GET',
                url: '/api/v1/runs/run-fixture/audit',
                headers,
              })
            ).statusCode,
        )
        .toBe(200)
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/runs/run-fixture/audit',
            headers,
          })
        ).json(),
      ).toMatchObject({
        themeId: 'slidev-theme-fixture',
        themeSkillId: 'fastppt-theme-fixture',
        skillResolutionStatus: 'resolved',
        invocationStatus: 'unknown',
      })
    },
  )

  it.each([
    ['skillDiscovery', { skillDiscovery: false }],
    ['perRunSkillInvocation', { perRunSkillInvocation: false }],
  ] as const)(
    'rejects a theme run before the Harness without %s capability',
    async (_capability, overrides) => {
      const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
      const harness = new FakeCodexHarness('codex', overrides)
      const app = await makeApp(root, harness)
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/codex/session-fixture/messages',
        payload: {
          content: 'Make slides',
          themeId: 'slidev-theme-academy',
          attachments: [],
        },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({
        error: { code: 'HARNESS_SKILLS_UNSUPPORTED' },
      })
      expect(harness.sent).toBeUndefined()
    },
  )

  it('limits concurrent runs across sessions for each Harness', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const harness = new BlockingHarness('codex')
    const app = await makeApp(root, harness)
    const headers = {}
    const payload = {
      content: 'Make slides',
      themeId: 'slidev-theme-academy',
      attachments: [],
    }
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/codex/session-one/messages',
      headers,
      payload,
    })
    expect(first.statusCode).toBe(202)

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/codex/session-two/messages',
      headers,
      payload,
    })
    expect(rejected.statusCode).toBe(429)
    expect(rejected.json()).toMatchObject({
      error: {
        code: 'HARNESS_RUN_LIMIT_REACHED',
        retryable: true,
        details: { harness: 'codex', limit: 1 },
      },
    })

    harness.releaseNext()
    await expect
      .poll(async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/sessions/codex/session-two/messages',
          headers,
          payload,
        })
        return response.statusCode
      })
      .toBe(202)
    harness.releaseNext()
  })

  it('rejects a theme run before the Harness when a managed Skill conflicts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const harness = new FakeCodexHarness('claude')
    const app = await makeApp(root, harness)
    writeFileSync(
      join(root, '.claude', 'skills', 'fastppt-theme-academy', 'SKILL.md'),
      'user modification\n',
    )
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/claude/session-fixture/messages',
      payload: {
        content: 'Make slides',
        themeId: 'slidev-theme-academy',
        attachments: [],
      },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      error: {
        code: 'THEME_SKILL_INSTALL_CONFLICT',
        details: { internalCode: 'SKILL_INSTALL_UNAVAILABLE' },
      },
    })
    expect(harness.sent).toBeUndefined()
  })

  it('rejects a theme run before the Harness when its managed Skill is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const harness = new FakeCodexHarness()
    const app = await makeApp(root, harness)
    await rm(join(root, '.agents', 'skills', 'fastppt-theme-academy'), {
      recursive: true,
      force: true,
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/codex/session-fixture/messages',
      payload: {
        content: 'Make slides',
        themeId: 'slidev-theme-academy',
        attachments: [],
      },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({
      error: {
        code: 'THEME_SKILL_NOT_FOUND',
        retryable: false,
        details: { internalCode: 'SKILL_INSTALL_UNAVAILABLE' },
      },
    })
    expect(harness.sent).toBeUndefined()
  })

  it('normalizes a Harness invocation that ends before starting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-gateway-'))
    const harness = new InvocationFailureHarness()
    const app = await makeApp(root, harness)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/codex/session-fixture/messages',
      payload: {
        content: 'Make slides',
        themeId: 'slidev-theme-academy',
        attachments: [],
      },
    })
    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({
      error: {
        code: 'THEME_SKILL_INVOCATION_FAILED',
        retryable: true,
        details: { internalCode: 'RUN_START_FAILED' },
      },
    })
    expect(harness.sent).toMatchObject({
      themeId: 'slidev-theme-academy',
      themeSkillId: 'fastppt-theme-academy',
    })
  })
})
