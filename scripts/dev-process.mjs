import { spawn } from 'node:child_process'

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(true)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    timeout.unref()
    const onExit = () => {
      clearTimeout(timeout)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

function signalTree(processGroupId, signal) {
  if (!processGroupId) return
  try {
    process.kill(-processGroupId, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function waitForTreeExit(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(-processGroupId, 0)
    } catch (error) {
      if (error?.code === 'ESRCH') return true
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return false
}

async function taskkillTree(pid, force, timeoutMs) {
  const killer = spawn(
    'taskkill.exe',
    ['/pid', String(pid), '/t', ...(force ? ['/f'] : [])],
    { stdio: 'ignore' },
  )
  await waitForExit(killer, timeoutMs)
}

export function spawnDevProcess(command, args, options) {
  return spawn(command, args, {
    ...options,
    detached: process.platform !== 'win32',
  })
}

export async function terminateDevProcess(child, timeoutMs = 5_000) {
  const processGroupId = child.pid
  if (process.platform === 'win32' && child.pid)
    await taskkillTree(child.pid, false, timeoutMs)
  else signalTree(processGroupId, 'SIGTERM')
  const exited = await waitForExit(child, timeoutMs)
  if (
    exited &&
    (process.platform === 'win32' ||
      !processGroupId ||
      (await waitForTreeExit(processGroupId, timeoutMs)))
  )
    return

  if (process.platform === 'win32' && child.pid)
    await taskkillTree(child.pid, true, timeoutMs)
  else signalTree(processGroupId, 'SIGKILL')
  const forcedExit = await waitForExit(child, timeoutMs)
  const treeExited =
    process.platform === 'win32' ||
    !processGroupId ||
    (await waitForTreeExit(processGroupId, timeoutMs))
  if (!forcedExit || !treeExited)
    throw new Error('FastPPT development process tree did not exit.')
}
