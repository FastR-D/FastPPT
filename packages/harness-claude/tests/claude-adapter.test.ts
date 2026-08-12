import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ClaudeAdapter } from '../src/claude-adapter.js'

import type {
  CanUseTool,
  Options,
  Query,
  SDKMessage,
  SDKSessionInfo,
  SessionMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { UnifiedAgentEvent } from '@fastppt/protocol'

const temporaryDirectories = new Set<string>()

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
  temporaryDirectories.clear()
})

const session: SDKSessionInfo = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  summary: 'Deck work',
  customTitle: 'Quarterly deck',
  firstPrompt: 'Build a presentation',
  cwd: process.cwd(),
  createdAt: 1_785_750_000_000,
  lastModified: 1_785_750_100_000,
}

const history: SessionMessage[] = [
  {
    type: 'user',
    uuid: 'user-1',
    session_id: session.sessionId,
    message: { role: 'user', content: 'Hello' },
    parent_tool_use_id: null,
    parent_agent_id: null,
  },
  {
    type: 'assistant',
    uuid: 'assistant-1',
    session_id: session.sessionId,
    message: { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
    parent_tool_use_id: null,
    parent_agent_id: null,
  },
  {
    type: 'user',
    uuid: 'tool-result-1',
    session_id: session.sessionId,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: '读取到的 slides.md 内容不应显示为用户消息',
        },
      ],
    },
    parent_tool_use_id: 'tool-1',
    parent_agent_id: null,
  },
]

function message(value: unknown): SDKMessage {
  return value as SDKMessage
}

function queryFrom(
  generator: () => AsyncGenerator<SDKMessage>,
  onInterrupt?: () => void,
): Query {
  const iterable = generator() as Query
  iterable.interrupt = async () => {
    await Promise.resolve()
    onInterrupt?.()
    return { still_queued: [] }
  }
  iterable.close = () => undefined
  return iterable
}

function fixture(
  options: {
    queryFactory?: (input: {
      prompt: string | AsyncIterable<unknown>
      options?: Options
    }) => Query
    onLog?: NonNullable<ConstructorParameters<typeof ClaudeAdapter>[0]>['onLog']
    environment?: NodeJS.ProcessEnv
  } = {},
): ClaudeAdapter {
  return new ClaudeAdapter({
    ...(options.onLog ? { onLog: options.onLog } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
    sdk: {
      listSessions: () => Promise.resolve([session]),
      getSessionInfo: (sessionId) =>
        Promise.resolve(sessionId === session.sessionId ? session : undefined),
      getSessionMessages: () => Promise.resolve(history),
      forkSession: () =>
        Promise.resolve({ sessionId: '22222222-2222-4222-8222-222222222222' }),
      query:
        options.queryFactory ??
        (() =>
          queryFrom(async function* () {
            await Promise.resolve()
            yield message({
              type: 'result',
              subtype: 'success',
              session_id: session.sessionId,
              uuid: 'result-1',
            })
          })),
    },
  })
}

describe('ClaudeAdapter', () => {
  it('reports verified SDK capabilities and reads persisted sessions', async () => {
    const claude = fixture()
    await expect(claude.getStatus()).resolves.toMatchObject({
      status: 'available',
      compatible: true,
      version: 'agent-sdk 0.3.220 / Claude Code 2.1.220',
    })
    await expect(
      claude.listSessions({ cwd: process.cwd() }),
    ).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: session.sessionId,
          harness: 'claude',
          title: 'Quarterly deck',
        }),
      ],
      nextCursor: null,
    })
    const loaded = await claude.getSession({ sessionId: session.sessionId })
    expect(loaded.messages.map((entry) => entry.content)).toEqual([
      'Hello',
      'Hi',
    ])
    await expect(
      claude.resumeSession({
        sessionId: session.sessionId,
        cwd: process.cwd(),
      }),
    ).resolves.toMatchObject({ sessionId: session.sessionId })
    await expect(
      claude.forkSession?.({
        sessionId: session.sessionId,
        cwd: process.cwd(),
      }),
    ).resolves.toEqual({
      harness: 'claude',
      sessionId: '22222222-2222-4222-8222-222222222222',
    })
  })

  it('creates a reserved session and passes explicit skill invocation options', async () => {
    let capturedPrompt = ''
    let capturedOptions: Options | undefined
    const claude = fixture({
      queryFactory(input) {
        capturedPrompt =
          typeof input.prompt === 'string' ? input.prompt : '[async prompt]'
        capturedOptions = input.options
        return queryFrom(async function* () {
          await Promise.resolve()
          yield message({
            type: 'result',
            subtype: 'success',
            session_id: capturedOptions?.sessionId,
            uuid: 'result-1',
          })
        })
      },
    })
    const created = await claude.createSession({
      cwd: process.cwd(),
      title: 'New deck',
    })
    await expect(
      claude.getSession({ sessionId: created.sessionId }),
    ).resolves.toMatchObject({
      summary: { id: created.sessionId, title: 'New deck' },
      messages: [],
    })
    for await (const event of claude.sendMessage({
      sessionId: created.sessionId,
      cwd: process.cwd(),
      content: 'Create the slides',
      attachments: [],
      skills: [
        {
          id: 'fastppt',
          name: 'fastppt',
          path: '/skills/fastppt',
          version: '1',
        },
      ],
    })) {
      expect(event.harness).toBe('claude')
    }
    expect(capturedPrompt).toBe('/fastppt\n\nCreate the slides')
    expect(capturedOptions).toMatchObject({
      sessionId: created.sessionId,
      title: 'New deck',
      skills: ['fastppt'],
      settingSources: ['user', 'project'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    })
    expect(capturedOptions).not.toHaveProperty('resume')
  })

  it('forwards SDK stderr with run context', async () => {
    const logs: Array<{
      output: string
      sessionId?: string
      runId?: string
    }> = []
    const claude = fixture({
      onLog: (log) => logs.push(log),
      queryFactory(input) {
        input.options?.stderr?.('first line\nsecond line\n')
        return queryFrom(async function* () {
          await Promise.resolve()
          yield message({
            type: 'result',
            subtype: 'success',
            session_id: session.sessionId,
            uuid: 'result-log',
          })
        })
      },
    })
    for await (const _event of claude.sendMessage({
      sessionId: session.sessionId,
      cwd: process.cwd(),
      content: 'Log this run',
      attachments: [],
    }))
      void _event
    expect(logs.map((log) => log.output)).toEqual(['first line', 'second line'])
    expect(logs.every((log) => log.sessionId === session.sessionId)).toBe(true)
    expect(logs.every((log) => typeof log.runId === 'string')).toBe(true)
  })

  it('passes only required system and Claude variables to the SDK process', async () => {
    let capturedEnvironment: Options['env']
    const claude = fixture({
      environment: {
        HOME: '/fixture/home',
        PATH: '/fixture/bin',
        LANG: 'en_US.UTF-8',
        ANTHROPIC_API_KEY: 'anthropic-fixture',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth-fixture',
        OPENAI_API_KEY: 'must-not-leak',
        AWS_SECRET_ACCESS_KEY: 'must-not-leak',
      },
      queryFactory(input) {
        capturedEnvironment = input.options?.env
        return queryFrom(async function* () {
          await Promise.resolve()
          yield message({
            type: 'result',
            subtype: 'success',
            session_id: session.sessionId,
            uuid: 'result-environment',
          })
        })
      },
    })
    for await (const _event of claude.sendMessage({
      sessionId: session.sessionId,
      cwd: process.cwd(),
      content: 'Use the minimal environment',
      attachments: [],
    }))
      void _event
    expect(capturedEnvironment).toEqual({
      HOME: '/fixture/home',
      PATH: '/fixture/bin',
      LANG: 'en_US.UTF-8',
      ANTHROPIC_API_KEY: 'anthropic-fixture',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-fixture',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'fastppt/0.1.0',
    })
  })

  it('passes image attachments as a native multimodal user message', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fastppt-claude-image-'))
    temporaryDirectories.add(directory)
    const imagePath = join(directory, 'diagram.png')
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    let capturedMessage: unknown
    const claude = fixture({
      queryFactory(input) {
        return queryFrom(async function* () {
          if (typeof input.prompt !== 'string') {
            for await (const message of input.prompt) capturedMessage = message
          }
          yield message({
            type: 'result',
            subtype: 'success',
            session_id: session.sessionId,
            uuid: 'result-image',
          })
        })
      },
    })
    for await (const _event of claude.sendMessage({
      sessionId: session.sessionId,
      cwd: process.cwd(),
      content: 'Use this diagram',
      attachments: [{ type: 'image', path: imagePath }],
    })) {
      void _event
    }
    expect(capturedMessage).toMatchObject({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Use this diagram' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png' },
          },
        ],
      },
    })
  })

  it('normalizes streaming content and waits for UI approval', async () => {
    const claude = fixture({
      queryFactory({ options }) {
        return queryFrom(async function* () {
          yield message({
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'Draft' },
            },
            session_id: session.sessionId,
            uuid: 'delta-1',
            parent_tool_use_id: null,
          })
          const canUseTool = options?.canUseTool as CanUseTool
          const decision = await canUseTool(
            'Bash',
            { command: 'pnpm test' },
            {
              signal: new AbortController().signal,
              toolUseID: 'tool-1',
              requestId: 'request-1',
              title: 'Run tests',
              suggestions: [],
            },
          )
          yield message({
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Finished' },
                { type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} },
              ],
            },
            session_id: session.sessionId,
            uuid: 'assistant-2',
            parent_tool_use_id: null,
          })
          yield message({
            type: 'tool_progress',
            tool_name: 'Bash',
            tool_use_id: 'tool-1',
            elapsed_time_seconds: 1,
            session_id: session.sessionId,
            uuid: 'progress-1',
            parent_tool_use_id: null,
          })
          yield message({
            type: 'result',
            subtype:
              decision?.behavior === 'allow'
                ? 'success'
                : 'error_during_execution',
            session_id: session.sessionId,
            uuid: 'result-1',
          })
        })
      },
    })
    const events: UnifiedAgentEvent[] = []
    for await (const event of claude.sendMessage({
      sessionId: session.sessionId,
      cwd: process.cwd(),
      content: 'Run tests',
      attachments: [],
      skills: [
        {
          id: 'fastppt',
          name: 'fastppt',
          path: '/skills/fastppt',
          version: '1',
        },
        {
          id: 'theme',
          name: 'fastppt-theme-academy',
          path: '/skills/fastppt-theme-academy',
          version: '1',
        },
      ],
    })) {
      events.push(event)
      if (event.type === 'approval.requested')
        await claude.approveRequest({
          approvalId: (event.data as { id: string }).id,
          decision: 'approve-for-session',
        })
    }
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'run.started',
        'skill.discovery.confirmed',
        'skill.invocation.requested',
        'skill.invocation.unknown',
        'assistant.delta',
        'approval.requested',
        'approval.resolved',
        'assistant.message',
        'command.started',
        'command.output',
        'run.completed',
      ]),
    )
    expect(
      events.find((event) => event.type === 'approval.requested')?.data,
    ).toMatchObject({
      harness: 'claude',
      cwd: process.cwd(),
      affectedFiles: [],
    })
    expect(events.every((event, index) => event.sequence === index + 1)).toBe(
      true,
    )
  })

  it('interrupts an active query and can run again after a provider failure', async () => {
    let interrupted = false
    let calls = 0
    const claude = fixture({
      queryFactory() {
        calls += 1
        if (calls === 1)
          return queryFrom(async function* () {
            await Promise.resolve()
            if (calls < 0) yield message({})
            throw new Error('simulated query crash')
          })
        return queryFrom(
          async function* () {
            await new Promise((resolve) => setTimeout(resolve, 20))
            if (!interrupted)
              yield message({
                type: 'result',
                subtype: 'success',
                session_id: session.sessionId,
                uuid: 'result-2',
              })
          },
          () => {
            interrupted = true
          },
        )
      },
    })
    const failed: UnifiedAgentEvent[] = []
    for await (const event of claude.sendMessage({
      sessionId: session.sessionId,
      cwd: process.cwd(),
      content: 'First',
      attachments: [],
    }))
      failed.push(event)
    expect(failed.at(-1)?.type).toBe('run.failed')

    const consume = (async () => {
      const events: UnifiedAgentEvent[] = []
      for await (const event of claude.sendMessage({
        sessionId: session.sessionId,
        cwd: process.cwd(),
        content: 'Second',
        attachments: [],
      }))
        events.push(event)
      return events
    })()
    await new Promise((resolve) => setTimeout(resolve, 5))
    await claude.cancelRun({ sessionId: session.sessionId })
    const cancelled = await consume
    expect(interrupted).toBe(true)
    expect(cancelled.at(-1)?.type).toBe('run.cancelled')
  })
})
