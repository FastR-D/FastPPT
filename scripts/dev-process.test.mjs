import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { spawnDevProcess, terminateDevProcess } from './dev-process.mjs'

async function waitForPids(filename) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return JSON.parse(await readFile(filename, 'utf8'))
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  throw new Error('Process fixture did not start.')
}

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

test('terminates the development child process tree', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-dev-process-'))
  const filename = join(directory, 'pids.json')
  const child = spawnDevProcess(
    process.execPath,
    [
      new URL('./fixtures/process-tree.mjs', import.meta.url).pathname,
      filename,
    ],
    { stdio: 'ignore' },
  )
  const pids = await waitForPids(filename)
  try {
    await terminateDevProcess(child, 1_000)
    assert.equal(processExists(pids.parent), false)
    assert.equal(processExists(pids.child), false)
  } finally {
    if (processExists(pids.parent)) process.kill(pids.parent, 'SIGKILL')
    if (processExists(pids.child)) process.kill(pids.child, 'SIGKILL')
    await rm(directory, { recursive: true, force: true })
  }
})
