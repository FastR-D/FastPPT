import { describe, expect, it } from 'vitest'

import { CodexAdapter } from '../src/codex-adapter.js'

import type { UnifiedAgentEvent } from '@fastppt/protocol'

const adapterFixture = String.raw`
const readline = require('node:readline')
const rl = readline.createInterface({ input: process.stdin })
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
const thread = id => ({
  id,
  preview: 'Build a deck',
  cwd: process.cwd(),
  createdAt: 1785750000,
  updatedAt: 1785750100,
  status: { type: 'idle' },
  name: 'Deck work',
  turns: [{
    id: 'turn-history',
    items: [
      { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: 'Hello' }] },
      { id: 'agent-1', type: 'agentMessage', text: 'Hi there' },
    ],
  }],
})
let activeTurn = null
let activeThread = null
let lastTurnInput = null
rl.on('line', line => {
  const message = JSON.parse(line)
  if (message.id === 900 && !message.method) {
    send({ method: 'serverRequest/resolved', params: { threadId: activeThread, requestId: 900 } })
    send({ method: 'item/completed', params: { threadId: activeThread, turnId: activeTurn, item: { id: 'cmd-1', type: 'commandExecution', command: 'pnpm test', cwd: process.cwd(), status: 'completed' } } })
    send({ method: 'item/completed', params: { threadId: activeThread, turnId: activeTurn, item: { id: 'agent-2', type: 'agentMessage', text: 'Finished' } } })
    send({ method: 'turn/completed', params: { threadId: activeThread, turn: { id: activeTurn, status: 'completed', items: [], error: null } } })
    return
  }
  switch (message.method) {
    case 'initialize': send({ id: message.id, result: { userAgent: 'fixture' } }); break
    case 'initialized': break
    case 'thread/list': send({ id: message.id, result: { data: [thread('thread-listed')], nextCursor: null } }); break
    case 'thread/read': send({ id: message.id, result: { thread: thread(message.params.threadId) } }); break
    case 'thread/start': send({ id: message.id, result: { thread: thread('thread-created') } }); break
    case 'thread/name/set': send({ id: message.id, result: {} }); break
    case 'thread/resume': send({ id: message.id, result: { thread: thread(message.params.threadId) } }); break
    case 'thread/fork': send({ id: message.id, result: { thread: thread('thread-forked') } }); break
    case 'turn/start': {
      lastTurnInput = message.params.input
      activeThread = message.params.threadId
      activeTurn = message.params.input[0].text.includes('cancel') ? 'turn-cancel' : 'turn-run'
      send({ id: message.id, result: { turn: { id: activeTurn, status: 'inProgress', items: [], error: null } } })
      send({ method: 'turn/started', params: { threadId: activeThread, turn: { id: activeTurn, status: 'inProgress', items: [] } } })
      if (activeTurn === 'turn-cancel') break
      send({ method: 'item/agentMessage/delta', params: { threadId: activeThread, turnId: activeTurn, itemId: 'agent-2', delta: 'Fin' } })
      send({ method: 'item/reasoning/summaryTextDelta', params: { threadId: activeThread, turnId: activeTurn, itemId: 'reason-1', delta: 'Check tests' } })
      send({ method: 'item/started', params: { threadId: activeThread, turnId: activeTurn, item: { id: 'cmd-1', type: 'commandExecution', command: 'pnpm test', cwd: process.cwd(), status: 'inProgress' } } })
      send({ method: 'item/agentMessage/delta', params: { threadId: activeThread, turnId: activeTurn, itemId: 'agent-2', delta: JSON.stringify(lastTurnInput) } })
      send({ method: 'item/commandExecution/requestApproval', id: 900, params: { threadId: activeThread, turnId: activeTurn, itemId: 'cmd-1', startedAtMs: Date.now(), reason: 'Run tests', command: 'pnpm test', cwd: process.cwd(), changes: [{ path: 'slides.md' }] } })
      break
    }
    case 'turn/interrupt': {
      send({ id: message.id, result: {} })
      send({ method: 'turn/completed', params: { threadId: message.params.threadId, turn: { id: message.params.turnId, status: 'interrupted', items: [], error: null } } })
      break
    }
  }
})
`

const crashingFixture = String.raw`
const readline = require('node:readline')
const rl = readline.createInterface({ input: process.stdin })
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
rl.on('line', line => {
  const message = JSON.parse(line)
  if (message.method === 'initialize')
    send({ id: message.id, result: { userAgent: 'fixture' } })
  if (message.method === 'thread/list') {
    console.error('simulated app-server crash')
    process.exit(17)
  }
})
`

function adapter(): CodexAdapter {
  return new CodexAdapter({
    versionProvider: () => Promise.resolve('codex-cli 0.144.5'),
    commandFactory: () => ({
      command: process.execPath,
      args: ['-e', adapterFixture],
      cwd: process.cwd(),
    }),
    requestTimeoutMs: 1000,
    stopTimeoutMs: 500,
    imageSkillPath: '/skills/imagegen',
  })
}

describe('CodexAdapter', () => {
  it('recognizes Codex CLI 0.146 as verified', async () => {
    const codex = new CodexAdapter({
      versionProvider: () => Promise.resolve('codex-cli 0.146.0'),
    })

    await expect(codex.getStatus()).resolves.toMatchObject({
      status: 'available',
      version: 'codex-cli 0.146.0',
      compatible: true,
      verifiedVersionRange: '>=0.144.0 <0.147.0',
    })
    await codex.dispose()
  })

  it('discovers, reads, creates, resumes and forks workspace sessions', async () => {
    const codex = adapter()
    const status = await codex.getStatus()
    expect(status).toMatchObject({
      status: 'available',
      version: 'codex-cli 0.144.5',
      compatible: true,
    })
    const page = await codex.listSessions({ cwd: process.cwd() })
    expect(page.data[0]).toMatchObject({
      id: 'thread-listed',
      harness: 'codex',
      title: 'Deck work',
    })
    const history = await codex.getSession({ sessionId: 'thread-listed' })
    expect(history.messages.map((message) => message.content)).toEqual([
      'Hello',
      'Hi there',
    ])
    await expect(
      codex.createSession({ cwd: process.cwd(), title: 'New deck' }),
    ).resolves.toEqual({ harness: 'codex', sessionId: 'thread-created' })
    await expect(
      codex.resumeSession({ sessionId: 'thread-listed', cwd: process.cwd() }),
    ).resolves.toMatchObject({ sessionId: 'thread-listed' })
    await expect(
      codex.forkSession({ sessionId: 'thread-listed', cwd: process.cwd() }),
    ).resolves.toEqual({ harness: 'codex', sessionId: 'thread-forked' })
    await codex.dispose()
  })

  it('normalizes streams and resolves reverse-RPC approvals', async () => {
    const codex = adapter()
    const events: UnifiedAgentEvent[] = []
    for await (const event of codex.sendMessage({
      sessionId: 'thread-listed',
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
      if (event.type === 'approval.requested') {
        const approval = event.data as { id: string }
        await codex.approveRequest({
          approvalId: approval.id,
          decision: 'approve',
        })
      }
    }
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'run.started',
        'skill.discovery.confirmed',
        'skill.invocation.requested',
        'skill.invocation.unknown',
        'assistant.delta',
        'reasoning.delta',
        'command.started',
        'approval.requested',
        'approval.resolved',
        'command.completed',
        'assistant.message',
        'run.completed',
      ]),
    )
    expect(
      events.find((event) => event.type === 'approval.requested')?.data,
    ).toMatchObject({
      harness: 'codex',
      cwd: process.cwd(),
      affectedFiles: ['slides.md'],
    })
    expect(events.every((event, index) => event.sequence === index + 1)).toBe(
      true,
    )
    const imageSkill = events
      .filter((event) => event.type === 'skill.discovery.confirmed')
      .flatMap(
        (event) =>
          (event.data as { skills: Array<{ name: string; path: string }> })
            .skills,
      )
      .find((skill) => skill.name === 'imagegen')
    expect(imageSkill).toEqual({
      id: 'imagegen',
      name: 'imagegen',
      path: '/skills/imagegen',
      version: 'system',
    })
    expect(
      events
        .filter((event) => event.type === 'assistant.delta')
        .map((event) => (event.data as { delta: string }).delta)
        .join(''),
    ).toContain('"name":"imagegen"')
    await codex.dispose()
  })

  it('interrupts an active turn', async () => {
    const codex = adapter()
    const events: UnifiedAgentEvent[] = []
    const consume = (async () => {
      for await (const event of codex.sendMessage({
        sessionId: 'thread-listed',
        cwd: process.cwd(),
        content: 'cancel this turn',
        attachments: [],
      }))
        events.push(event)
    })()
    await new Promise((resolve) => setTimeout(resolve, 30))
    await codex.cancelRun({ sessionId: 'thread-listed' })
    await consume
    expect(events.at(-1)?.type).toBe('run.cancelled')
    await codex.dispose()
  })

  it('rejects a second active turn for the same session', async () => {
    const codex = adapter()
    const consume = (async () => {
      for await (const _event of codex.sendMessage({
        sessionId: 'thread-listed',
        cwd: process.cwd(),
        content: 'cancel this turn',
        attachments: [],
      })) {
        void _event
      }
    })()
    const failure = (() => {
      try {
        codex.sendMessage({
          sessionId: 'thread-listed',
          cwd: process.cwd(),
          content: 'second turn',
          attachments: [],
        })
        return undefined
      } catch (cause) {
        return cause
      }
    })()
    expect(failure).toMatchObject({ code: 'RUN_ALREADY_ACTIVE' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    await codex.cancelRun({ sessionId: 'thread-listed' })
    await consume
    await codex.dispose()
  })

  it('restarts and reinitializes after an app-server crash', async () => {
    let processCount = 0
    const logs: string[] = []
    const codex = new CodexAdapter({
      onLog: (log) => logs.push(`${log.harness}:${log.stream}:${log.output}`),
      versionProvider: () => Promise.resolve('codex-cli 0.144.5'),
      commandFactory: () => ({
        command: process.execPath,
        args: ['-e', processCount++ === 0 ? crashingFixture : adapterFixture],
        cwd: process.cwd(),
      }),
      requestTimeoutMs: 1000,
      stopTimeoutMs: 500,
    })
    await expect(
      codex.listSessions({ cwd: process.cwd() }),
    ).rejects.toMatchObject({ code: 'PROCESS_EXITED' })
    await expect(
      codex.listSessions({ cwd: process.cwd() }),
    ).resolves.toMatchObject({
      data: [expect.objectContaining({ id: 'thread-listed' })],
    })
    expect(processCount).toBe(2)
    expect(logs).toEqual(['codex:stderr:simulated app-server crash'])
    await codex.dispose()
  })
})
