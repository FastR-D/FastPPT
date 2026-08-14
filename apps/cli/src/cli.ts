#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { access, readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { createGateway } from '@fastppt/gateway/app'
import { loadGatewayConfig } from '@fastppt/config'

import { CLI_HELP, parseCliArguments } from './arguments.js'
import { resolveCliRuntimePaths } from './paths.js'
import { installBundledThemes } from './themes.js'

interface GatewayRuntime {
  version: number
  url: string
  pid: number
  startedAt: string
}

async function packageVersion(packageRoot: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(join(packageRoot, 'package.json'), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : 'unknown'
}

async function workspaceDirectory(input: string): Promise<string> {
  const resolved = await realpath(input)
  if (!(await stat(resolved)).isDirectory())
    throw new Error(`Workspace is not a directory: ${resolved}`)
  return resolved
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
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

async function readRuntime(workspaceRoot: string): Promise<GatewayRuntime | undefined> {
  try {
    const value = JSON.parse(
      await readFile(
        join(workspaceRoot, '.fastppt', 'runtime', 'gateway.json'),
        'utf8',
      ),
    ) as Partial<GatewayRuntime>
    if (
      value.version !== 1 ||
      typeof value.url !== 'string' ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.url) ||
      typeof value.pid !== 'number' ||
      typeof value.startedAt !== 'string'
    )
      return undefined
    return value as GatewayRuntime
  } catch {
    return undefined
  }
}

async function requestJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  const body = (await response.json()) as unknown
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return body
}

async function gatewayStatus(workspaceRoot: string): Promise<{
  running: boolean
  workspaceRoot: string
  runtime?: GatewayRuntime
  health?: unknown
  message: string
}> {
  const runtime = await readRuntime(workspaceRoot)
  if (!runtime)
    return {
      running: false,
      workspaceRoot,
      message: 'No Gateway is registered for this workspace.',
    }
  if (!processExists(runtime.pid))
    return {
      running: false,
      workspaceRoot,
      runtime,
      message: `The registered Gateway process ${runtime.pid} is no longer running.`,
    }
  try {
    const health = await requestJson(`${runtime.url}/health`)
    return {
      running: true,
      workspaceRoot,
      runtime,
      health,
      message: `Gateway is running at ${runtime.url}.`,
    }
  } catch (cause) {
    return {
      running: false,
      workspaceRoot,
      runtime,
      message: `Process ${runtime.pid} exists but its health endpoint is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }
}

function printValue(value: unknown, json: boolean): void {
  process.stdout.write(
    json ? `${JSON.stringify(value, null, 2)}\n` : `${String(value)}\n`,
  )
}

function openWebApp(): void {
  const target = 'https://fastppt.vercel.app'
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [target] }
      : process.platform === 'win32'
        ? { file: 'cmd', args: ['/c', 'start', '', target] }
        : { file: 'xdg-open', args: [target] }
  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: 'ignore',
  })
  child.on('error', () => undefined)
  child.unref()
}

async function runStatus(workspaceInput: string, json: boolean): Promise<void> {
  const root = await workspaceDirectory(workspaceInput)
  const status = await gatewayStatus(root)
  printValue(json ? status : status.message, json)
  if (!status.running) process.exitCode = 1
}

async function runDoctor(
  workspaceInput: string,
  json: boolean,
  paths: ReturnType<typeof resolveCliRuntimePaths>,
): Promise<void> {
  const checks: Array<{ name: string; status: 'ok' | 'error'; message: string }> = []
  try {
    const installed = await installBundledThemes({
      bundledThemesRoot: paths.bundledThemesRoot,
      themesRoot: paths.themesRoot,
      version: await packageVersion(paths.packageRoot),
    })
    checks.push({
      name: 'theme-installation',
      status: 'ok',
      message: `${installed.themeCount} bundled themes available in ${paths.themesRoot}`,
    })
  } catch (cause) {
    checks.push({
      name: 'theme-installation',
      status: 'error',
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }
  let root: string | undefined
  try {
    root = await workspaceDirectory(workspaceInput)
    await access(root)
    checks.push({ name: 'workspace', status: 'ok', message: root })
  } catch (cause) {
    checks.push({
      name: 'workspace',
      status: 'error',
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }
  for (const [name, path] of [
    ['bundled-themes', paths.bundledThemesRoot],
    ['themes', paths.themesRoot],
    ['skill', paths.commonSkillRoot],
    ['mcp-server', paths.mcpServerEntry],
    ['slidev-runner', paths.slidevRunnerPath],
  ] as const) {
    try {
      await access(path)
      checks.push({ name, status: 'ok', message: path })
    } catch {
      checks.push({ name, status: 'error', message: `Missing runtime asset: ${path}` })
    }
  }
  if (root) {
    const status = await gatewayStatus(root)
    if (status.running && status.runtime) {
      try {
        const readiness = await requestJson(`${status.runtime.url}/ready`)
        const ready =
          typeof readiness === 'object' &&
          readiness !== null &&
          'status' in readiness &&
          readiness.status === 'ok'
        checks.push({
          name: 'gateway-readiness',
          status: ready ? 'ok' : 'error',
          message: JSON.stringify(readiness),
        })
      } catch (cause) {
        checks.push({
          name: 'gateway-readiness',
          status: 'error',
          message: cause instanceof Error ? cause.message : String(cause),
        })
      }
    } else {
      checks.push({
        name: 'gateway-readiness',
        status: 'error',
        message: status.message,
      })
    }
  }
  const ok = checks.every((check) => check.status === 'ok')
  if (json) printValue({ ok, checks }, true)
  else {
    for (const check of checks)
      process.stdout.write(
        `${check.status === 'ok' ? '✓' : '✗'} ${check.name}: ${check.message}\n`,
      )
  }
  if (!ok) process.exitCode = 1
}

async function runStop(workspaceInput: string, json: boolean): Promise<void> {
  const root = await workspaceDirectory(workspaceInput)
  const status = await gatewayStatus(root)
  if (!status.runtime || !processExists(status.runtime.pid)) {
    printValue(json ? status : status.message, json)
    process.exitCode = 1
    return
  }
  process.kill(status.runtime.pid, 'SIGTERM')
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline && processExists(status.runtime.pid))
    await new Promise((resolve) => setTimeout(resolve, 100))
  const stopped = !processExists(status.runtime.pid)
  const result = {
    stopped,
    pid: status.runtime.pid,
    message: stopped
      ? `Stopped Gateway process ${status.runtime.pid}.`
      : `Gateway process ${status.runtime.pid} did not stop within 5 seconds.`,
  }
  printValue(json ? result : result.message, json)
  if (!stopped) process.exitCode = 1
}

async function runStart(
  input: ReturnType<typeof parseCliArguments>,
  paths: ReturnType<typeof resolveCliRuntimePaths>,
): Promise<void> {
  const workspaceRoot = await workspaceDirectory(input.workspaceRoot)
  const version = await packageVersion(paths.packageRoot)
  const themes = await installBundledThemes({
    bundledThemesRoot: paths.bundledThemesRoot,
    themesRoot: paths.themesRoot,
    version,
  })
  if (themes.updated)
    process.stdout.write(
      `Installed ${themes.themeCount} bundled themes in ${paths.themesRoot}.\n`,
    )
  const existing = await gatewayStatus(workspaceRoot)
  if (existing.running) throw new Error(existing.message)
  const config = loadGatewayConfig(
    ['--workspace', workspaceRoot],
    process.cwd(),
    { themesRoot: paths.themesRoot },
  )
  config.port = input.port
  const app = await createGateway(config, {
    watchThemes: false,
    commonSkillRoot: paths.commonSkillRoot,
    mcpServerEntry: paths.mcpServerEntry,
    mcpRuntimeArgs: [],
    slidevRunnerPath: paths.slidevRunnerPath,
  })
  let closing = false
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return
    closing = true
    app.log.info({ signal }, 'Shutting down FastPPT backend')
    await app.close()
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))

  try {
    await app.listen({ host: config.host, port: config.port })
  } catch (cause) {
    await app.close()
    throw cause
  }
  app.log.info(
    {
      workspaceRoot: config.workspaceRoot,
      gateway: `http://${config.host}:${String(config.port)}`,
      web: 'https://fastppt.vercel.app',
    },
    'FastPPT is ready',
  )
  if (input.open) openWebApp()
}

async function main(): Promise<void> {
  const paths = resolveCliRuntimePaths(import.meta.url)
  const input = parseCliArguments(process.argv.slice(2), process.cwd())
  if (input.help) {
    process.stdout.write(CLI_HELP)
    return
  }
  if (input.version) {
    process.stdout.write(`${await packageVersion(paths.packageRoot)}\n`)
    return
  }
  switch (input.command) {
    case 'status':
      await runStatus(input.workspaceRoot, input.json)
      break
    case 'doctor':
      await runDoctor(input.workspaceRoot, input.json, paths)
      break
    case 'stop':
      await runStop(input.workspaceRoot, input.json)
      break
    case 'start':
      await runStart(input, paths)
      break
  }
}

main().catch((cause: unknown) => {
  process.stderr.write(
    `FastPPT command failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
  )
  process.exitCode = 1
})
