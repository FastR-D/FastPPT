import { describe, expect, it } from 'vitest'

import { JsonlRpcClient } from '../src/jsonl-rpc.js'

const rpcFixture = String.raw`
const readline = require('node:readline')
const rl = readline.createInterface({ input: process.stdin })
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
rl.on('line', line => {
  const message = JSON.parse(line)
  if (message.method === 'fast') {
    send({ method: 'future/notification', params: { retained: true } })
    send({ id: message.id, result: { value: 'fast' } })
  } else if (message.method === 'slow') {
    setTimeout(() => send({ id: message.id, result: { value: 'slow' } }), 30)
  } else if (message.method === 'hang') {
    // Intentionally no response.
  } else if (message.method === 'exit') {
    console.error('fixture exploded')
    process.exit(9)
  }
})
`

function client(): JsonlRpcClient {
  return new JsonlRpcClient({
    commandFactory: () => ({
      command: process.execPath,
      args: ['-e', rpcFixture],
      cwd: process.cwd(),
    }),
    requestTimeoutMs: 1000,
    stopTimeoutMs: 500,
  })
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

describe('JsonlRpcClient', () => {
  it('matches out-of-order responses and preserves unknown notifications', async () => {
    const rpc = client()
    const notifications: string[] = []
    rpc.onMessage((message) => {
      if (message.method) notifications.push(message.method)
    })
    rpc.start()
    const pid = rpc.processId
    expect(pid).toBeTypeOf('number')
    const slow = rpc.request<{ value: string }>('slow')
    const fast = rpc.request<{ value: string }>('fast')
    await expect(fast).resolves.toEqual({ value: 'fast' })
    await expect(slow).resolves.toEqual({ value: 'slow' })
    expect(notifications).toContain('future/notification')
    await rpc.stop()
    expect(processExists(pid as number)).toBe(false)
  })

  it('times out requests and rejects pending work when the process exits', async () => {
    const stderrLines: string[] = []
    const rpc = new JsonlRpcClient({
      commandFactory: () => ({
        command: process.execPath,
        args: ['-e', rpcFixture],
        cwd: process.cwd(),
      }),
      requestTimeoutMs: 1000,
      stopTimeoutMs: 500,
      onStderrLine: (line) => stderrLines.push(line),
    })
    rpc.start()
    await expect(
      rpc.request('hang', {}, { timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
    const exiting = rpc.request('exit')
    await expect(exiting).rejects.toMatchObject({
      code: 'PROCESS_EXITED',
    })
    expect(rpc.stderr).toContain('fixture exploded')
    expect(stderrLines).toEqual(['fixture exploded'])
    await rpc.stop()
  })
})
