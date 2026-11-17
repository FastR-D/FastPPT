import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkspaceService } from '../dist/workspace-service.js'

if (process.send) {
  const workspace = await WorkspaceService.create(process.argv[2])
  process.once('message', async () => {
    try {
      const result = await workspace.writeTextFile({
        path: 'deck.md',
        content: process.argv[4],
        expectedRevision: process.argv[3],
      })
      process.send({ result })
    } catch (error) {
      process.send({ error: { code: error.code, message: error.message } })
    } finally {
      process.disconnect()
    }
  })
  process.send({ ready: true })
} else {
  const root = await mkdtemp(join(tmpdir(), 'workspace-process-'))
  const workers = []
  try {
    await writeFile(join(root, 'deck.md'), '# Before\n')
    const workspace = await WorkspaceService.create(root)
    const before = await workspace.readTextFile('deck.md')
    for (let index = 0; index < 8; index++) {
      const child = fork(
        fileURLToPath(import.meta.url),
        [root, before.revision, `# Process ${index}\n`],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
      )
      let ready,
        finish,
        failReady,
        failResult,
        received = false,
        diagnostic = ''
      const readiness = new Promise((resolve, reject) => {
        ready = resolve
        failReady = reject
      })
      const result = new Promise((resolve, reject) => {
        finish = resolve
        failResult = reject
      })
      child.stderr.on('data', (data) => {
        diagnostic += data.toString()
      })
      child.on('message', (message) => {
        if (message.ready) ready()
        else {
          received = true
          finish(message)
        }
      })
      child.on('error', (error) => {
        failReady(error)
        failResult(error)
      })
      const exit = new Promise((resolve, reject) =>
        child.once('exit', (code) => {
          if (!received || code !== 0) {
            const error = new Error(
              `Writer process exited ${code}: ${diagnostic}`,
            )
            failReady(error)
            failResult(error)
            reject(error)
          } else resolve()
        }),
      )
      workers.push({ child, readiness, result, exit })
    }
    await Promise.all(workers.map((worker) => worker.readiness))
    for (const worker of workers) worker.child.send('write')
    const outcomes = await Promise.all(workers.map((worker) => worker.result))
    await Promise.all(workers.map((worker) => worker.exit))
    const winners = outcomes.filter((item) => item.result)
    assert.equal(winners.length, 1)
    for (const item of outcomes)
      if (item.error) assert.equal(item.error.code, 'FILE_REVISION_CONFLICT')
    assert.equal(
      await readFile(join(root, 'deck.md'), 'utf8'),
      winners[0].result.content,
    )
    const latest = await workspace.readTextFile('deck.md')
    await workspace.writeTextFile({
      path: 'deck.md',
      content: '# Next\n',
      expectedRevision: latest.revision,
    })
    assert.deepEqual(await readdir(root), ['deck.md'])
    console.log(
      'Independent-process revision contract passed: one committed writer, conflicts preserved, locks released',
    )
  } finally {
    for (const worker of workers)
      if (worker.child.exitCode === null) worker.child.kill()
    await Promise.allSettled(workers.map((worker) => worker.exit))
    await rm(root, { recursive: true, force: true })
  }
}
