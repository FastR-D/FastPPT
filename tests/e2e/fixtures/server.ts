import { rm, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createGateway } from '@fastppt/gateway/app'
import {
  HarnessCapabilitiesSchema,
  HarnessStatusSchema,
  SessionPageSchema,
  UnifiedAgentEventSchema,
  UnifiedSessionSchema,
} from '@fastppt/protocol'

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
  HarnessKind,
  SessionPage,
  UnifiedAgentEvent,
  UnifiedMessage,
  UnifiedSession,
} from '@fastppt/protocol'
import type {
  EditablePptxExporter,
  ExportDeckInput,
} from '@fastppt/gateway/app'

const here = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(here, '../../..')
export const E2E_WORKSPACE = '/tmp/fastppt-e2e-workspace'

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

class BrowserFixtureHarness implements HarnessAdapter {
  readonly sessions = new Map<string, UnifiedMessage[]>()
  #sessionCounter = 0
  #runCounter = 0

  constructor(readonly kind: HarnessKind) {
    this.sessions.set(`${kind}-history-1`, [])
    this.sessions.set(`${kind}-history-2`, [])
  }

  getStatus() {
    return Promise.resolve(
      HarnessStatusSchema.parse({
        kind: this.kind,
        status: 'available',
        version: `${this.kind}-e2e-fixture`,
        verifiedVersionRange: 'fixture',
        compatible: true,
        capabilities: this.capabilities(),
      }),
    )
  }

  getCapabilities() {
    return Promise.resolve(this.capabilities())
  }

  listSessions(input: ListSessionsInput): Promise<SessionPage> {
    const ids = [...this.sessions.keys()]
    const pageIds =
      input.cursor === 'history-page-2' ? ids.slice(1) : ids.slice(0, 1)
    return Promise.resolve(
      SessionPageSchema.parse({
        data: pageIds.map((id) => ({
          id,
          harness: this.kind,
          title: `${this.kind} ${id.endsWith('-2') ? 'second' : 'first'} history`,
          preview: 'FastPPT browser fixture',
          cwd: E2E_WORKSPACE,
          createdAt: '2026-08-03T00:00:00.000Z',
          updatedAt: new Date().toISOString(),
          status: 'idle',
        })),
        nextCursor:
          input.cursor === 'history-page-2' || ids.length < 2
            ? null
            : 'history-page-2',
      }),
    )
  }

  getSession(input: GetSessionInput): Promise<UnifiedSession> {
    const messages = this.sessions.get(input.sessionId) ?? []
    return Promise.resolve(
      UnifiedSessionSchema.parse({
        summary: {
          id: input.sessionId,
          harness: this.kind,
          title: `${this.kind} ${input.sessionId.endsWith('-2') ? 'second' : 'first'} history`,
          preview: 'FastPPT browser fixture',
          cwd: E2E_WORKSPACE,
          createdAt: '2026-08-03T00:00:00.000Z',
          updatedAt: new Date().toISOString(),
          status: 'idle',
        },
        messages,
      }),
    )
  }

  createSession(_input: CreateSessionInput): Promise<SessionReference> {
    void _input
    const sessionId = `${this.kind}-e2e-${++this.#sessionCounter}`
    this.sessions.set(sessionId, [])
    return Promise.resolve({ harness: this.kind, sessionId })
  }

  resumeSession(input: ResumeSessionInput): Promise<SessionHandle> {
    this.sessions.set(input.sessionId, this.sessions.get(input.sessionId) ?? [])
    return Promise.resolve({
      harness: this.kind,
      sessionId: input.sessionId,
      cwd: input.cwd,
    })
  }

  forkSession(input: ForkSessionInput): Promise<SessionReference> {
    return this.createSession({ cwd: input.cwd })
  }

  async *sendMessage(
    input: SendMessageInput,
  ): AsyncIterable<UnifiedAgentEvent> {
    const runId = `${this.kind}-run-${++this.#runCounter}`
    const base = {
      harness: this.kind,
      sessionId: input.sessionId,
      runId,
      themeId: input.themeId,
      themeSkillId: input.themeSkillId,
      themeSkillVersion: input.themeSkillVersion,
    }
    let sequence = 0
    const event = (type: string, data: unknown) =>
      UnifiedAgentEventSchema.parse({
        ...base,
        eventId: `${runId}-${++sequence}`,
        sequence,
        timestamp: new Date().toISOString(),
        type,
        data,
      })
    yield event('run.started', {})
    await delay(120)
    yield event('skill.discovery.confirmed', {
      skills: input.skills,
      mechanism: `${this.kind}-e2e-discovery`,
      simulated: true,
    })
    yield event('skill.invocation.requested', {
      skills: input.skills,
      mechanism: `${this.kind}-e2e-invocation`,
      simulated: true,
    })
    yield event('skill.invocation.unknown', {
      skills: input.skills,
      mechanism: `${this.kind}-e2e-invocation`,
      evidence: null,
      simulated: true,
    })
    yield event('assistant.delta', {
      delta: `Streaming ${input.themeSkillId}`,
    })
    yield event('approval.requested', {
      id: `${runId}-approval`,
      harness: this.kind,
      sessionId: input.sessionId,
      runId,
      kind: 'command',
      title: 'Preview validation',
      reason: 'Validate the generated deck',
      command: 'pnpm validate',
      cwd: input.cwd,
      affectedFiles: ['slides.md'],
      providerPayload: {},
    })
    await delay(900)
    const messages = this.sessions.get(input.sessionId) ?? []
    messages.push(
      { id: `${runId}-user`, role: 'user', content: input.content },
      {
        id: `${runId}-assistant`,
        role: 'assistant',
        content: `Completed with ${input.themeSkillId}`,
      },
    )
    this.sessions.set(input.sessionId, messages)
    yield event('run.completed', {})
  }

  cancelRun(_input: CancelRunInput): Promise<void> {
    void _input
    return Promise.resolve()
  }

  approveRequest(_input: ApprovalDecisionInput): Promise<void> {
    void _input
    return Promise.resolve()
  }

  dispose(): Promise<void> {
    return Promise.resolve()
  }

  private capabilities() {
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
    })
  }
}

class BrowserFixtureExporter implements EditablePptxExporter {
  getStatus() {
    return Promise.resolve({ status: 'available' as const, version: 'e2e' })
  }

  async export(input: ExportDeckInput) {
    if (
      input.snapshot.source !== 'slidev' ||
      input.snapshot.slides.length === 0 ||
      input.snapshot.slides.some((slide) => slide.elements.length === 0)
    )
      throw new Error('E2E export requires a real Slidev iframe snapshot')
    input.onProgress?.({ phase: 'capturing-slides', progress: 50 })
    await writeFile(input.outputPath, 'FastPPT editable PPTX E2E fixture')
    return {
      outputPath: input.outputPath,
      warnings: [],
      elementCount: input.snapshot.slides.reduce(
        (count, slide) => count + slide.elements.length,
        0,
      ),
      slideCount: input.snapshot.slides.length,
      qa: { ok: true, slideCount: input.snapshot.slides.length, issues: [] },
    }
  }
}

await rm(E2E_WORKSPACE, { recursive: true, force: true })
await mkdir(E2E_WORKSPACE, { recursive: true })
await writeFile(
  resolve(E2E_WORKSPACE, 'slides.md'),
  '---\ntheme: slidev-theme-academy\ntitle: Academy E2E\n---\n\n# Academy E2E\n\n---\n\n# Academy E2E second slide\n',
)
await writeFile(
  resolve(E2E_WORKSPACE, 'landing.md'),
  '---\ntheme: slidev-theme-landing\ntitle: Landing E2E\n---\n\n# Landing E2E\n\n---\n\n# Landing E2E second slide\n',
)

const app = await createGateway(
  {
    host: '127.0.0.1',
    port: 4317,
    allowedWebOrigins: [
      'http://127.0.0.1:4317',
      'http://127.0.0.1:4328',
    ],
    workspaceRoot: E2E_WORKSPACE,
    workspaceName: 'fastppt-e2e-workspace',
    themesRoot: resolve(repositoryRoot, 'themes'),
    exportTimeoutMs: 10_000,
    maxConcurrentRunsPerHarness: 1,
  },
  {
    watchThemes: false,
    harnesses: {
      claude: new BrowserFixtureHarness('claude'),
      codex: new BrowserFixtureHarness('codex'),
    },
    exporter: new BrowserFixtureExporter(),
  },
)
await app.listen({ host: '127.0.0.1', port: 4317 })

let closing = false
async function close(): Promise<void> {
  if (closing) return
  closing = true
  try {
    await app.close()
  } finally {
    await rm(E2E_WORKSPACE, { recursive: true, force: true })
  }
}
process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
